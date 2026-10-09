//  MidasBridge.swift
//  Ponte entre o app web do Midas (dentro do WKWebView) e a IA do próprio iPhone:
//    - ouvir:      Speech (reconhecimento de fala no aparelho)
//    - entender:   Foundation Models (modelo do Apple Intelligence, no aparelho)
//    - falar:      AVSpeechSynthesizer (voz masculina do sistema)
//
//  Requer iOS 26+ e um iPhone com Apple Intelligence ativado.
//  Como instalar: veja ios/README.md.
//
//  Do lado web (public/js/native.js) as chamadas são:
//    await window.webkit.messageHandlers.midas.postMessage({ action: "listen", locale: "pt-BR" })

import AVFoundation
import Foundation
import FoundationModels
import Speech
@preconcurrency import WebKit

// MARK: - Formato do comando que o modelo devolve

@Generable
struct MidasCommand {
    @Guide(description: "What the user wants to do", .anyOf(["add_debt", "register_payment", "set_due_date", "delete_last", "rename_person", "remove_person", "query", "clarify", "other"]))
    var action: String

    @Guide(description: "Name of the person as the user said it. Empty if none.")
    var person: String

    @Guide(description: "Amount of money as a plain number in the user's currency. 0 if not said.")
    var amount: Double

    @Guide(description: "they_owe_me = the person owes the user / paid the user. i_owe_them = the user owes / paid the person. unknown if unclear.", .anyOf(["they_owe_me", "i_owe_them", "unknown"]))
    var direction: String

    @Guide(description: "Date it happened as YYYY-MM-DD, from the calendar in the prompt. Empty if not said.")
    var date: String

    @Guide(description: "Due date as YYYY-MM-DD, from the calendar in the prompt. Empty if not said.")
    var dueDate: String

    @Guide(description: "New name, only for rename_person. Otherwise empty.")
    var newName: String

    @Guide(description: "Short note about what the money was for, if said. Otherwise empty.")
    var note: String

    @Guide(description: "Only for clarify or other: one short sentence to say to the user, in the user's language. Otherwise empty.")
    var reply: String
}

enum MidasBridgeError: LocalizedError {
    case invalidMessage, speechDenied, micDenied, speechUnavailable, llmUnavailable(String)

    var errorDescription: String? {
        switch self {
        case .invalidMessage: return "invalid_message"
        case .speechDenied: return "speech_denied"
        case .micDenied: return "mic_denied"
        case .speechUnavailable: return "speech_unavailable"
        case .llmUnavailable(let reason): return "llm_unavailable:\(reason)"
        }
    }
}

// MARK: - Ponte

@MainActor
final class MidasBridge: NSObject, WKScriptMessageHandlerWithReply, AVSpeechSynthesizerDelegate {
    static let shared = MidasBridge()

    /// Defina logo depois de criar o WKWebView (para enviar o texto parcial enquanto a pessoa fala).
    weak var webView: WKWebView?

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var listenContinuation: CheckedContinuation<String, Never>?
    private var bestTranscript = ""
    private var silenceTimer: Timer?
    private var maxTimer: Timer?

    private let synthesizer = AVSpeechSynthesizer()
    private var speakContinuation: CheckedContinuation<Void, Never>?

    private override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// Registra a ponte numa configuração de WKWebView (chame antes de criar o WebView).
    static func install(in configuration: WKWebViewConfiguration) {
        configuration.userContentController.addScriptMessageHandler(shared, contentWorld: .page, name: "midas")
    }

    // MARK: Mensagens vindas do JavaScript

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else {
            replyHandler(nil, MidasBridgeError.invalidMessage.localizedDescription)
            return
        }
        Task { @MainActor in
            do {
                replyHandler(try await self.handle(action, body), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    private func handle(_ action: String, _ body: [String: Any]) async throws -> Any? {
        let locale = (body["locale"] as? String) ?? Locale.current.identifier
        switch action {
        case "capabilities":
            return capabilities(locale: locale)
        case "prewarm":
            if case .available = SystemLanguageModel.default.availability {
                LanguageModelSession(instructions: (body["instructions"] as? String) ?? "").prewarm()
            }
            return true
        case "listen":
            return ["text": try await listen(locale: locale)]
        case "stopListening":
            finishListening()
            return true
        case "interpret":
            return try await interpret(instructions: body["instructions"] as? String ?? "",
                                       prompt: body["prompt"] as? String ?? "")
        case "speak":
            await speak(body["text"] as? String ?? "", locale: locale)
            return true
        case "stopSpeaking":
            synthesizer.stopSpeaking(at: .immediate)
            return true
        default:
            throw MidasBridgeError.invalidMessage
        }
    }

    // MARK: O que este aparelho suporta

    private func capabilities(locale: String) -> [String: Any] {
        var llm = "available"
        switch SystemLanguageModel.default.availability {
        case .available: llm = "available"
        case .unavailable(.deviceNotEligible): llm = "device_not_eligible"
        case .unavailable(.appleIntelligenceNotEnabled): llm = "apple_intelligence_not_enabled"
        case .unavailable(.modelNotReady): llm = "model_not_ready"
        case .unavailable: llm = "unavailable"
        }
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
        return [
            "llm": llm,
            "llmSupportsLocale": SystemLanguageModel.default.supportsLocale(Locale(identifier: locale)),
            "speech": recognizer?.isAvailable ?? false,
            "speechOnDevice": recognizer?.supportsOnDeviceRecognition ?? false,
            "maleVoice": Self.maleVoice(for: locale)?.name ?? "",
        ]
    }

    // MARK: Ouvir

    private func requestPermissions() async throws {
        let speechStatus = await withCheckedContinuation { (c: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) }
        }
        guard speechStatus == .authorized else { throw MidasBridgeError.speechDenied }
        guard await AVAudioApplication.requestRecordPermission() else { throw MidasBridgeError.micDenied }
    }

    /// Ouve até a pessoa parar de falar (~1,4 s de silêncio) e devolve o texto.
    private func listen(locale: String) async throws -> String {
        try await requestPermissions()
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
            throw MidasBridgeError.speechUnavailable
        }
        finishListening()
        synthesizer.stopSpeaking(at: .immediate)

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        recognitionRequest = request

        let input = audioEngine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
        audioEngine.prepare()
        try audioEngine.start()

        bestTranscript = ""
        return await withCheckedContinuation { continuation in
            listenContinuation = continuation
            restartSilenceTimer(seconds: 8) // ninguém falou nada
            maxTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in
                Task { @MainActor in self?.finishListening() }
            }
            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                let text = result?.bestTranscription.formattedString
                let isFinal = result?.isFinal ?? false
                let failed = error != nil
                Task { @MainActor in
                    guard let self else { return }
                    if let text, !text.isEmpty {
                        self.bestTranscript = text
                        self.sendPartial(text)
                        self.restartSilenceTimer(seconds: 1.4)
                    }
                    if isFinal || failed { self.finishListening() }
                }
            }
        }
    }

    private func restartSilenceTimer(seconds: TimeInterval) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.finishListening() }
        }
    }

    private func finishListening() {
        silenceTimer?.invalidate()
        maxTimer?.invalidate()
        silenceTimer = nil
        maxTimer = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        if let continuation = listenContinuation {
            listenContinuation = nil
            continuation.resume(returning: bestTranscript)
        }
    }

    private func sendPartial(_ text: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [text]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.midasNative && window.midasNative.onPartial(\(json)[0])")
    }

    // MARK: Entender

    private func interpret(instructions: String, prompt: String) async throws -> [String: Any] {
        guard case .available = SystemLanguageModel.default.availability else {
            throw MidasBridgeError.llmUnavailable(capabilities(locale: Locale.current.identifier)["llm"] as? String ?? "unavailable")
        }
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(to: prompt,
                                                 generating: MidasCommand.self,
                                                 options: GenerationOptions(temperature: 0.1))
        let c = response.content
        return [
            "action": c.action, "person": c.person, "amount": c.amount, "direction": c.direction,
            "date": c.date, "dueDate": c.dueDate, "newName": c.newName, "note": c.note, "reply": c.reply,
        ]
    }

    // MARK: Falar

    private func speak(_ text: String, locale: String) async {
        guard !text.isEmpty else { return }
        synthesizer.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = Self.maleVoice(for: locale)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.05
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            speakContinuation?.resume()
            speakContinuation = continuation
            synthesizer.speak(utterance)
        }
    }

    /// Melhor voz masculina instalada para o idioma (vozes "Aprimoradas"/"Premium" têm prioridade).
    static func maleVoice(for locale: String) -> AVSpeechSynthesisVoice? {
        let wanted = locale.replacingOccurrences(of: "_", with: "-")
        let language = String(wanted.prefix(2))
        func score(_ v: AVSpeechSynthesisVoice) -> Int {
            var s = 0
            if v.gender == .male { s += 100 }
            if v.language == wanted { s += 10 }
            switch v.quality {
            case .premium: s += 3
            case .enhanced: s += 2
            default: break
            }
            return s
        }
        return AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix(language) }
            .max { score($0) < score($1) } ?? AVSpeechSynthesisVoice(language: wanted)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.resumeSpeaking() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.resumeSpeaking() }
    }

    private func resumeSpeaking() {
        speakContinuation?.resume()
        speakContinuation = nil
    }
}

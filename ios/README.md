# App iOS do Midas (PWABuilder + IA do iPhone)

O app iOS é o site do Midas dentro de um WKWebView (gerado pelo PWABuilder), mais uma
pequena ponte em Swift, `MidasBridge.swift`, que dá ao site acesso à IA do próprio iPhone:

| Etapa | Recurso da Apple | Onde roda |
|---|---|---|
| Ouvir | Speech (`SFSpeechRecognizer`) | no aparelho |
| Entender | Foundation Models (modelo do Apple Intelligence) | no aparelho |
| Falar | `AVSpeechSynthesizer`, voz masculina | no aparelho |

O modelo só classifica o pedido num formato fixo (`MidasCommand`). Quem aplica a alteração
e escreve a resposta é o código web (`shared/commands.js`). As alterações viram registros
normais que sincronizam com o servidor, então a voz funciona até offline.

**Requisitos:** iOS 26+, iPhone com Apple Intelligence (iPhone 15 Pro ou mais novo) com o
Apple Intelligence ativado, Xcode 26+ num Mac.

## Passo a passo

1. Gere o pacote iOS no [PWABuilder](https://www.pwabuilder.com) com a URL do Midas e abra o projeto no Xcode.
2. Arraste `MidasBridge.swift` para dentro do projeto (marque o target do app).
3. Em **General → Minimum Deployments**, coloque **iOS 26.0**.
4. Registre a ponte onde o projeto cria o `WKWebViewConfiguration` (no template do
   PWABuilder fica no arquivo `WebView.swift`, junto dos outros `userContentController.add(...)`):

   ```swift
   MidasBridge.install(in: config)        // antes de criar o WKWebView
   let webView = WKWebView(frame: ..., configuration: config)
   MidasBridge.shared.webView = webView   // logo depois de criar
   ```

   O nome da variável de configuração pode ser outro (ex.: `webConfiguration`); use a que o projeto já tem.

5. Em `Info.plist`, adicione:

   | Chave | Texto sugerido |
   |---|---|
   | `NSMicrophoneUsageDescription` | O Midas usa o microfone para ouvir seus comandos de voz. |
   | `NSSpeechRecognitionUsageDescription` | O Midas transforma sua fala em texto no próprio iPhone. |

6. Rode num iPhone de verdade (o simulador não tem Apple Intelligence).

## Dicas

- **Voz mais natural:** em Ajustes → Acessibilidade → Conteúdo Falado → Vozes → Português (Brasil),
  baixe uma voz masculina "Aprimorada". O Midas escolhe sozinho a melhor voz masculina instalada.
- **Idioma:** a fala é reconhecida no idioma escolhido nas configurações do Midas; em "Automático",
  usa o idioma do iPhone.
- **Ajustar o comportamento da IA:** as instruções do modelo ficam em `shared/commands.js`
  (`commandInstructions`). Mudou ali, publicou o site, e o app já usa a versão nova, sem recompilar.

// Cliente do Qwen.
//  - chat():       entende o comando e chama as ferramentas (function calling).
//                  Endpoint compatível com OpenAI: Ollama local (padrão da stack) ou DashScope.
//  - transcribe(): voz -> texto, detectando o idioma
//  - speak():      texto -> voz masculina
// Ouvir/falar usam o serviço de voz local (MIDAS_VOICE_URL: faster-whisper + Piper)
// quando configurado; senão, a API da DashScope (Qwen3-ASR/TTS, precisa de QWEN_API_KEY).

const env = (k, d = '') => (process.env[k] ?? d).trim();

const LANGS = {
  pt: 'Portuguese', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian',
};
const CODE_BY_NAME = Object.fromEntries(Object.entries(LANGS).map(([code, name]) => [name.toLowerCase(), code]));

/** "Portuguese" / "pt" / "pt-BR" -> "pt" */
export function languageCode(lang) {
  if (!lang) return null;
  const s = String(lang).trim().toLowerCase();
  return CODE_BY_NAME[s] || (LANGS[s.slice(0, 2)] ? s.slice(0, 2) : null);
}

export function qwenConfig() {
  const baseUrl = env('QWEN_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const apiKey = env('QWEN_API_KEY');
  const selfHosted = !/dashscope/.test(baseUrl);
  const voiceUrl = env('MIDAS_VOICE_URL').replace(/\/$/, '');
  const hasAccess = Boolean(apiKey) || selfHosted;
  return {
    baseUrl,
    apiKey,
    isDashScope: !selfHosted,
    voiceUrl,
    chatModel: env('QWEN_CHAT_MODEL', selfHosted ? 'qwen3:4b-instruct' : 'qwen-plus'),
    asrModel: voiceUrl ? 'local' : hasAccess ? env('QWEN_ASR_MODEL') : '',
    ttsModel: voiceUrl ? 'local' : apiKey ? env('QWEN_TTS_MODEL') : '',
    ttsUrl: env('QWEN_TTS_URL', 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'),
    voice: env('QWEN_VOICE', 'Ethan'), // voz masculina (API DashScope)
    // Em CPU (Qwen local) cada etapa pode levar minutos.
    timeoutMs: Number(env('QWEN_TIMEOUT_MS')) || (selfHosted || voiceUrl ? 300_000 : 45_000),
    enabled: hasAccess,
  };
}

async function post(url, body, apiKey, timeoutMs = qwenConfig().timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Qwen ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function chat(messages, tools) {
  const cfg = qwenConfig();
  const body = { model: cfg.chatModel, messages, tools, tool_choice: 'auto', temperature: 0.2 };
  if (cfg.isDashScope) body.enable_thinking = false; // respostas rápidas para conversa por voz
  const json = await post(`${cfg.baseUrl}/chat/completions`, body, cfg.apiKey);
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error('Qwen: empty response');
  if (typeof msg.content === 'string') msg.content = msg.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return msg;
}

/** @returns {{ text: string, language: string|null }} language = código ("pt") */
export async function transcribe(base64, mime) {
  const cfg = qwenConfig();
  if (cfg.voiceUrl) {
    const json = await post(`${cfg.voiceUrl}/asr`, { audio: base64, mime });
    return { text: String(json.text || '').trim(), language: languageCode(json.language) };
  }
  if (!cfg.asrModel) throw new Error('ASR not configured');
  const json = await post(
    `${cfg.baseUrl}/chat/completions`,
    {
      model: cfg.asrModel,
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${mime};base64,${base64}` } }] }],
      asr_options: { enable_itn: true },
    },
    cfg.apiKey,
  );
  const msg = json.choices?.[0]?.message || {};
  const info = (msg.annotations || []).find((a) => a.type === 'audio_info');
  return { text: String(msg.content || '').trim(), language: languageCode(info?.language) };
}

/**
 * @param language código do idioma da resposta ("pt"), se conhecido
 * @returns {string|null} URL (ou data: URL) do áudio
 */
export async function speak(text, language) {
  const cfg = qwenConfig();
  if (!cfg.ttsModel || !text) return null;
  if (cfg.voiceUrl) {
    const json = await post(`${cfg.voiceUrl}/tts`, { text, language: languageCode(language) });
    return `data:${json.mime || 'audio/mpeg'};base64,${json.audio}`;
  }
  const json = await post(
    cfg.ttsUrl,
    { model: cfg.ttsModel, input: { text, voice: cfg.voice, language_type: 'Auto' } },
    cfg.apiKey,
    30000,
  );
  return json.output?.audio?.url || null;
}

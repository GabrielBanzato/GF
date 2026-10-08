// Cliente do Qwen via API compatível com OpenAI (DashScope ou self-hosted).
//  - chat():       entende o comando e chama as ferramentas (function calling)
//  - transcribe(): voz -> texto, com detecção automática de idioma (Qwen3-ASR)
//  - speak():      texto -> voz (Qwen3-TTS), voz masculina ou feminina

const env = (k, d = '') => (process.env[k] ?? d).trim();

export function qwenConfig() {
  const baseUrl = env('QWEN_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const apiKey = env('QWEN_API_KEY');
  const selfHosted = !/dashscope/.test(baseUrl);
  const hasAccess = Boolean(apiKey) || selfHosted;
  return {
    baseUrl,
    apiKey,
    isDashScope: !selfHosted,
    chatModel: env('QWEN_CHAT_MODEL', 'qwen-plus'),
    asrModel: hasAccess ? env('QWEN_ASR_MODEL') : '',
    ttsModel: apiKey ? env('QWEN_TTS_MODEL') : '',
    ttsUrl: env('QWEN_TTS_URL', 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'),
    voices: { female: env('QWEN_VOICE_FEMALE', 'Cherry'), male: env('QWEN_VOICE_MALE', 'Ethan') },
    enabled: hasAccess,
  };
}

async function post(url, body, apiKey, timeoutMs = 45000) {
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

/** @returns {{ text: string, language: string|null }} */
export async function transcribe(base64, mime) {
  const cfg = qwenConfig();
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
  return { text: String(msg.content || '').trim(), language: info?.language || null };
}

/** @returns {string|null} URL do áudio gerado (válida por algumas horas) */
export async function speak(text, voice) {
  const cfg = qwenConfig();
  if (!cfg.ttsModel || !text) return null;
  const json = await post(
    cfg.ttsUrl,
    { model: cfg.ttsModel, input: { text, voice: cfg.voices[voice] || cfg.voices.female, language_type: 'Auto' } },
    cfg.apiKey,
    30000,
  );
  return json.output?.audio?.url || null;
}

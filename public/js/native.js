// Ponte com a IA do próprio iPhone (ios/MidasBridge.swift).
// Só existe dentro do app iOS; no navegador, hasNative() é falso.

const handler = () => window.webkit?.messageHandlers?.midas;
let onPartial = null;

// O Swift chama isto com o texto parcial enquanto a pessoa fala.
window.midasNative = { onPartial: (text) => onPartial?.(text) };

export const hasNative = () => Boolean(handler());

async function call(action, data = {}) {
  try {
    return await handler().postMessage({ action, ...data });
  } catch (err) {
    // O Swift devolve códigos como "speech_denied" ou "llm_unavailable:device_not_eligible"
    const code = String(err?.message || err).replace(/^Error:\s*/, '');
    throw Object.assign(new Error(code), { code: code.split(':')[0], detail: code.split(':')[1] });
  }
}

export const capabilities = (locale) => call('capabilities', { locale });
export const prewarm = (instructions) => call('prewarm', { instructions }).catch(() => {});

export async function listen(locale, partial) {
  onPartial = partial;
  try {
    const { text } = await call('listen', { locale });
    return String(text || '').trim();
  } finally {
    onPartial = null;
  }
}

export const stopListening = () => call('stopListening').catch(() => {});
export const interpret = (instructions, prompt) => call('interpret', { instructions, prompt });
export const speak = (text, locale) => call('speak', { text, locale });
export const stopSpeaking = () => call('stopSpeaking').catch(() => {});

// Microfone, detecção de fim de fala e reprodução da voz da IA.

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

let audioCtx = null;
let player = null;
let active = null; // gravação/reconhecimento em andamento: { stop, cancel }

/** Precisa ser chamado dentro do toque do usuário (exigência do iOS para tocar áudio depois). */
export function unlockAudio() {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume().catch(() => {});
  if (!player) {
    player = new Audio();
    player.setAttribute('playsinline', '');
  }
  if (!player.src || player.ended || player.paused) {
    player.src = SILENT_WAV;
    player.play().catch(() => {});
  }
  speechSynthesis?.getVoices();
}

export const isBusy = () => Boolean(active);
export const stopListening = () => active?.stop();
export const cancelListening = () => active?.cancel();

/**
 * Grava até a pessoa parar de falar (silêncio), ou até tocar de novo no botão.
 * @returns {Promise<{blob: Blob, mime: string} | null>} null se ninguém falou
 */
export async function record({ onLevel, silenceMs = 1300, maxMs = 25000, noSpeechMs = 7000 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  const start = performance.now();
  let lastVoice = start;
  let spoke = false;
  let noise = 0.008;
  let raf;

  return new Promise((resolve) => {
    const finish = () => { if (rec.state !== 'inactive') rec.stop(); };
    rec.onstop = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((tr) => tr.stop());
      source.disconnect();
      active = null;
      onLevel?.(0);
      const type = rec.mimeType || mime || 'audio/webm';
      resolve(spoke && chunks.length ? { blob: new Blob(chunks, { type }), mime: type } : null);
    };
    active = {
      stop: () => { spoke ||= performance.now() - start > 700; finish(); },
      cancel: () => { spoke = false; finish(); },
    };
    rec.start(250);

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (now - start < 350) noise = noise * 0.8 + rms * 0.2; // calibra o ruído ambiente
      const threshold = Math.max(noise * 2.5, 0.012);
      if (rms > threshold) { lastVoice = now; spoke = true; }
      onLevel?.(Math.min(1, rms / (threshold * 4)));
      if ((spoke && now - lastVoice > silenceMs) || now - start > maxMs || (!spoke && now - start > noSpeechMs)) return finish();
      raf = requestAnimationFrame(tick);
    };
    tick();
  });
}

/** Reconhecimento do próprio navegador (quando o servidor não tem ASR configurado). */
export function browserRecognize({ locale, onPartial }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return Promise.reject(new Error('unsupported'));
  return new Promise((resolve, reject) => {
    const r = new SR();
    r.lang = locale;
    r.interimResults = true;
    r.continuous = false;
    let text = '';
    r.onresult = (e) => {
      text = [...e.results].map((x) => x[0].transcript).join('');
      onPartial?.(text);
    };
    r.onerror = (e) => (['no-speech', 'aborted'].includes(e.error) ? resolve('') : reject(new Error(e.error)));
    r.onend = () => { active = null; resolve(text.trim()); };
    active = { stop: () => r.stop(), cancel: () => { text = ''; r.abort(); } };
    r.start();
  });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function stopSpeaking() {
  if (player) player.pause();
  speechSynthesis?.cancel();
}

export function playUrl(url) {
  return new Promise((resolve, reject) => {
    player.onended = () => resolve();
    player.onerror = () => reject(new Error('audio'));
    player.src = url;
    player.play().catch(reject);
  });
}

const FEMALE = ['female', 'feminin', 'luciana', 'joana', 'fernanda', 'francisca', 'catarina', 'samantha', 'karen', 'victoria', 'moira', 'tessa', 'monica', 'paulina', 'marisol', 'helena', 'maria', 'zira', 'amelie', 'amélie', 'anna', 'alice', 'tingting', 'ting-ting', 'kyoko', 'yuna', 'sara', 'ava', 'allison', 'susan', 'serena'];
const MALE = ['male', 'masculin', 'felipe', 'daniel', 'fred', 'alex', 'diego', 'jorge', 'juan', 'thomas', 'luca', 'yuri', 'ricardo', 'david', 'mark', 'rishi', 'aaron', 'arthur', 'reed', 'eddy', 'grandpa', 'otoya'];

/** Voz do próprio aparelho, escolhendo masculina/feminina pelo nome da voz. */
export function speakLocal(text, { gender = 'female', locale = 'pt-BR' } = {}) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || !text) return resolve();
    const prefix = locale.slice(0, 2).toLowerCase();
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix));
    const hints = gender === 'male' ? MALE : FEMALE;
    const other = gender === 'male' ? FEMALE : MALE;
    const name = (v) => v.name.toLowerCase();
    const voice =
      voices.find((v) => hints.some((h) => name(v).includes(h)) && !(gender === 'male' && name(v).includes('female'))) ||
      voices.find((v) => !other.some((h) => name(v).includes(h))) ||
      voices[0];
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang || locale;
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

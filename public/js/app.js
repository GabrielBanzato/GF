import { api, setToken } from './api.js';
import { store } from './store.js';
import { t, setLanguage, uiLanguage, speechLocale, LANGUAGE_OPTIONS, CURRENCY_OPTIONS } from './i18n.js';
import { data, loadLocal, setProfile, addLocalOp, addLocalOps, newOp, applyRemoteOps, sync, startAutoSync, wipeLocal } from './sync.js';
import { saveBackup, exportBackup } from './backup.js';
import * as voice from './voice.js';
import * as native from './native.js';
import { commandInstructions, buildCommandPrompt, applyCommand } from '../shared/commands.js';
import { OP, summarize, formatMoney, toCents, todayIn } from '../shared/ledger.js';

const $ = (sel) => document.querySelector(sel);
const orb = $('#orb');
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

let config = { assistantName: 'Midas', ai: false, serverAsr: false, serverTts: false, passwordMin: 8 };
let autoSyncStarted = false;
let turn = 0; // identifica a conversa atual; um toque no meio cancela a anterior

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nLabel)));
  $('#deleteLabel').textContent = t('deleteType', { phrase: t('deletePhrase') });
  document.title = config.assistantName;
  setAuthMode(authMode, { keepMsg: true });

  const langSel = $('#settingsForm [name=language]');
  langSel.replaceChildren(...LANGUAGE_OPTIONS.map(([v, label]) => new Option(label || t('auto'), v)));
  const curSel = $('#settingsForm [name=currency]');
  curSel.replaceChildren(...CURRENCY_OPTIONS.map((c) => new Option(c, c)));
}

const locale = () => (uiLanguage() === 'pt' ? 'pt-BR' : navigator.language);
const money = (cents) => formatMoney(cents, data.profile?.currency || 'BRL', locale());
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: '2-digit', month: 'short' });

function relTime(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return t('justNow');
  if (mins < 60) return t('minutesAgo', { n: mins });
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t('at', { time }) : `${d.toLocaleDateString(locale())} ${time}`;
}

// ---------------------------------------------------------------------------
// Tela principal: conversa por voz
// ---------------------------------------------------------------------------
function setState(state) {
  orb.dataset.state = state;
  orb.classList.toggle('no-level', state === 'listening' && !config.serverAsr);
  const labels = { idle: 'tapToTalk', listening: 'listening', thinking: 'thinking', speaking: 'speaking' };
  $('#status').textContent = t(labels[state]);
  updateHint();
}

function setCaption(heard = '', reply = '') {
  $('#heard').textContent = heard;
  $('#reply').textContent = reply;
  updateHint();
}

// --- Saudação e frases de exemplo (tela inicial) ---------------------------
function renderGreeting() {
  const hour = new Date().getHours();
  const key = hour < 5 ? 'goodEvening' : hour < 12 ? 'goodMorning' : hour < 18 ? 'goodAfternoon' : 'goodEvening';
  const first = String(data.profile?.name || '').trim().split(/\s+/)[0];
  $('#greeting').textContent = first ? t('greetName', { greet: t(key), name: first }) : t(key);
  $('#today').textContent = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

let hintIndex = 0;
function updateHint() {
  const hint = $('#hint');
  const idle = orb.dataset.state === 'idle' && !$('#heard').textContent && !$('#reply').textContent;
  hint.classList.toggle('show', idle);
}
function rotateHint() {
  const hints = t('hints').split('|');
  const hint = $('#hint');
  hint.classList.remove('show');
  setTimeout(() => {
    hint.textContent = `“${hints[hintIndex++ % hints.length]}”`;
    updateHint();
  }, 700);
}

function flashStatus(key) {
  $('#status').textContent = t(key);
}

orb.addEventListener('click', () => {
  voice.unlockAudio();
  const state = orb.dataset.state;
  if (state === 'listening') return native.hasNative() ? native.stopListening() : voice.stopListening();
  if (state === 'speaking') { turn++; native.hasNative() ? native.stopSpeaking() : voice.stopSpeaking(); return setState('idle'); }
  if (state === 'thinking') { turn++; setCaption(); return setState('idle'); } // o pedido continua no servidor; o resultado chega pela sincronização
  converse();
});

async function converse() {
  const myTurn = ++turn;
  // No app iOS, tudo roda no próprio iPhone (funciona até offline).
  if (native.hasNative()) return nativeConverse(myTurn);
  if (!navigator.onLine) { setCaption('', t('offlineTalk')); return pulseLedger(); }
  if (!config.ai) { setCaption('', t('aiOff')); return; }

  setState('listening');
  setCaption();
  let body;
  try {
    if (config.serverAsr && window.MediaRecorder) {
      const audio = await voice.record({ onLevel: (l) => orb.style.setProperty('--level', l.toFixed(3)) });
      if (myTurn !== turn) return;
      if (!audio) { setState('idle'); return flashStatus('didntHear'); }
      body = { audio: await voice.blobToBase64(audio.blob), mime: audio.mime };
    } else {
      const loc = speechLocale(data.profile?.language);
      const text = await voice.browserRecognize({ locale: loc, onPartial: (s) => setCaption(s) });
      if (myTurn !== turn) return;
      if (!text) { setState('idle'); return flashStatus('didntHear'); }
      body = { text, language: loc.slice(0, 2) };
    }
  } catch (err) {
    setState('idle');
    const denied = err?.name === 'NotAllowedError' || err?.message === 'not-allowed';
    return flashStatus(denied ? 'micDenied' : 'genericError');
  }

  setState('thinking');
  let res;
  try {
    res = await runTurnJob(body, myTurn);
  } catch (err) {
    if (myTurn !== turn) return;
    setState('idle');
    if (err.status === 401) return onLogout();
    if (err.code === 'network') { data.serverDown = true; renderLedger(); setCaption('', t('offlineTalk')); return pulseLedger(); }
    return setCaption('', t(err.code === 'ai_not_configured' ? 'aiOff' : 'genericError'));
  }
  if (!res || myTurn !== turn) return;
  if (res.status === 'error') { setState('idle'); return setCaption(res.transcript, t('genericError')); }
  if (!res.heard) { setState('idle'); return flashStatus('didntHear'); }

  setCaption(res.transcript, res.reply);
  applyRemoteOps(res.ops);

  setState('speaking');
  await speak(res.reply, res.audioUrl, res.language);
  if (myTurn !== turn) return;
  setState('idle');

  // Se a IA fez uma pergunta, já volta a ouvir para a conversa fluir.
  if (/[?？]\s*$/.test(res.reply)) converse();
}

// ---------------------------------------------------------------------------
// IA do próprio iPhone: ouvir (Speech) → entender (Apple Intelligence) → falar
// ---------------------------------------------------------------------------
let history = []; // última troca: ajuda em "e ele também me deve 20"
const SPEECH_LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT' };

function nativeLanguage() {
  const loc = speechLocale(data.profile?.language);
  const lang = loc.slice(0, 2);
  return { loc, lang };
}

async function nativeConverse(myTurn) {
  const { loc, lang } = nativeLanguage();
  setState('listening');
  setCaption();
  let text;
  try {
    text = await native.listen(loc, (partial) => setCaption(partial));
  } catch (err) {
    setState('idle');
    return flashStatus(['speech_denied', 'mic_denied'].includes(err.code) ? 'micDenied' : 'genericError');
  }
  if (myTurn !== turn) return;
  if (!text) { setState('idle'); return flashStatus('didntHear'); }

  setCaption(text);
  setState('thinking');
  const today = todayIn(tz());
  const currency = data.profile?.currency || 'BRL';
  let result;
  try {
    const cmd = await native.interpret(
      commandInstructions(config.assistantName),
      buildCommandPrompt({ text, ops: data.ops, today, currency, history }),
    );
    if (myTurn !== turn) return;
    result = applyCommand(cmd, { ops: data.ops, today, currency, language: lang, makeOp: (type, payload) => newOp(type, payload, 'voice') });
  } catch (err) {
    setState('idle');
    return setCaption(text, t(err.code === 'llm_unavailable' ? 'appleIntelligenceOff' : 'genericError'));
  }

  await addLocalOps(result.ops); // sincroniza com o servidor sozinho (ou quando a conexão voltar)
  history = [{ role: 'user', text }, { role: 'assistant', text: result.reply }];
  setCaption(text, result.reply);
  setState('speaking');
  try { await native.speak(result.reply, SPEECH_LOCALES[lang] || loc); } catch { /* sem voz: o texto já está na tela */ }
  if (myTurn !== turn) return;
  setState('idle');

  // Se o Midas fez uma pergunta, já volta a ouvir para a conversa fluir.
  if (result.ask) converse();
}

/** Avisa logo de cara se o aparelho não tem Apple Intelligence disponível. */
async function checkNative() {
  if (!native.hasNative()) return;
  try {
    const caps = await native.capabilities(nativeLanguage().loc);
    if (caps.llm === 'device_not_eligible') setCaption('', t('deviceNotSupported'));
    else if (caps.llm !== 'available') setCaption('', t('appleIntelligenceOff'));
    else native.prewarm(commandInstructions(config.assistantName));
  } catch { /* versão antiga do app sem a ponte completa */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O servidor processa o comando em segundo plano (com o Qwen em CPU pode levar
 * minutos). Envia, depois consulta o andamento e vai mostrando cada etapa.
 */
async function runTurnJob(body, myTurn) {
  let res = await api('POST', '/api/turn', body, { timeoutMs: 60000 });
  let failures = 0;
  let shownReply = false;
  while (!['done', 'error'].includes(res.status)) {
    if (myTurn !== turn) return null;
    const stage = { queued: res.position ? t('queued', { n: res.position }) : t('thinking'), transcribing: t('transcribing'), thinking: t('thinking'), speaking: t('preparingVoice') }[res.status];
    if (stage) $('#status').textContent = stage;
    if (res.transcript && !shownReply) setCaption(res.transcript, '');
    if (res.reply && !shownReply) {
      // A resposta em texto e as alterações já chegam antes da voz ficar pronta.
      shownReply = true;
      setCaption(res.transcript, res.reply);
      applyRemoteOps(res.ops);
    }
    await wait(1500);
    try {
      res = await api('GET', `/api/turn/${res.jobId}`, undefined, { timeoutMs: 20000 });
      failures = 0;
    } catch (err) {
      if (err.code !== 'network' || ++failures > 8) throw err; // tolera instabilidades curtas de rede
    }
  }
  return res;
}

async function speak(text, audioUrl, language) {
  if (audioUrl) {
    try { return await voice.playUrl(audioUrl); } catch { /* cai para a voz do aparelho */ }
  }
  const loc = language && data.profile?.language === 'auto' ? language : speechLocale(data.profile?.language);
  await voice.speakLocal(text, { locale: loc });
}

function pulseLedger() {
  const btn = $('#ledgerBtn');
  btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 500, iterations: 2 });
}

// ---------------------------------------------------------------------------
// Painéis
// ---------------------------------------------------------------------------
function openSheet(id) {
  document.querySelectorAll('.sheet').forEach((s) => (s.hidden = s.id !== id));
  $(`#${id}`).scrollTop = 0;
}
const closeSheets = () => document.querySelectorAll('.sheet:not(#welcome)').forEach((s) => (s.hidden = true));

document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheets(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

// --- Configurações ---------------------------------------------------------
$('#settingsBtn').addEventListener('click', () => {
  const f = $('#settingsForm');
  const p = data.profile || {};
  f.name.value = p.name || '';
  f.email.value = p.email || '';
  f.currency.value = p.currency || 'BRL';
  f.language.value = p.language || 'auto';
  $('#settingsMsg').textContent = '';
  $('#deleteForm').hidden = true;
  $('#passwordForm').hidden = true;
  $('#passwordStart').hidden = false;
  $('#passwordMsg').textContent = '';
  $('#deleteStart').hidden = false;
  openSheet('settingsSheet');
});

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $('#settingsMsg');
  msg.className = 'form-msg';
  try {
    const { profile } = await api('PATCH', '/api/account', {
      name: f.name.value, email: f.email.value, currency: f.currency.value, language: f.language.value,
    });
    await setProfile(profile);
    setLanguage(profile.language);
    applyI18n();
    f.language.value = profile.language;
    f.currency.value = profile.currency;
    setState(orb.dataset.state);
    msg.textContent = t('saved');
  } catch (err) {
    msg.className = 'form-msg error';
    msg.textContent = errorText(err);
  }
});

$('#deleteStart').addEventListener('click', () => {
  $('#deleteStart').hidden = true;
  const f = $('#deleteForm');
  f.hidden = false;
  f.confirmation.value = '';
  f.querySelector('[type=submit]').disabled = true;
  f.confirmation.focus();
});

$('#deleteForm').addEventListener('input', (e) => {
  const f = e.currentTarget;
  f.querySelector('[type=submit]').disabled = f.confirmation.value.trim().toUpperCase() !== t('deletePhrase');
});

$('#deleteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $('#deleteMsg');
  if (f.confirmation.value.trim().toUpperCase() !== t('deletePhrase')) return;
  try {
    await api('DELETE', '/api/account', { confirmation: f.confirmation.value.trim() });
    await wipeLocal();
    location.reload();
  } catch (err) {
    msg.className = 'form-msg error';
    msg.textContent = err.code === 'network' ? t('offlineTalk') : t('genericError');
  }
});

// --- Controle financeiro / offline -----------------------------------------
function openLedger() {
  const f = $('#entryForm');
  if (!f.date.value) f.date.value = todayIn(tz());
  openSheet('ledgerSheet');
  renderLedger();
  sync();
}
$('#ledgerBtn').addEventListener('click', openLedger);
$('#summaryStrip').addEventListener('click', openLedger);

$('#entryForm').addEventListener('change', (e) => {
  if (e.target.name === 'kind') $('[data-due]').hidden = !e.target.value.startsWith('debt');
});

$('#entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const amount = toCents(f.amount.value);
  const person = f.person.value.trim();
  if (!person || !(amount > 0)) return (amount > 0 ? f.person : f.amount).focus();
  const [kind, direction] = f.kind.value.split('_');
  const payload = { person, amount, direction, date: f.date.value || todayIn(tz()) };
  if (kind === 'debt' && f.dueDate.value) payload.dueDate = f.dueDate.value;
  if (f.note.value.trim()) payload.note = f.note.value.trim();
  await addLocalOp(kind === 'debt' ? OP.DEBT_ADD : OP.PAYMENT_ADD, payload);
  f.amount.value = '';
  f.note.value = '';
  f.dueDate.value = '';
});

$('#people').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn || !confirm(t('removeEntry'))) return;
  await addLocalOp(OP.ENTRY_DELETE, { entryId: btn.dataset.remove, summary: btn.dataset.summary });
});

$('#downloadBtn').addEventListener('click', async () => {
  if (!data.backupAt) data.backupAt = await saveBackup({ ops: data.ops, profile: data.profile, assistantName: config.assistantName });
  await exportBackup();
});

function el(tag, attrs = {}, ...children) {
  const node = Object.assign(document.createElement(tag), attrs);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function renderLedger() {
  const today = todayIn(tz());
  const { people, totals } = summarize(data.ops, today);
  const pending = data.pending.size;
  const offline = !navigator.onLine;

  // Indicador no botão do lápis
  const badge = $('#ledgerBadge');
  badge.hidden = !(pending || offline || data.serverDown);
  badge.classList.toggle('warn', offline || data.serverDown);

  // Faixa "a receber · a pagar" na tela inicial
  $('#summaryStrip').hidden = !people.length;
  $('#sumIn').textContent = money(totals.receivable);
  $('#sumOut').textContent = money(totals.payable);

  if ($('#ledgerSheet').hidden) return;

  const status = $('#syncStatus');
  status.classList.toggle('warn', offline || data.serverDown);
  status.textContent = offline
    ? t('offlinePending', { n: pending })
    : data.serverDown
      ? t('serverDown')
      : pending
        ? t('onlinePending', { n: pending })
        : data.lastSync ? t('synced', { when: relTime(data.lastSync) }) : t('notSynced');

  $('#totalIn').textContent = money(totals.receivable);
  $('#totalOut').textContent = money(totals.payable);
  $('#backupAt').textContent = data.backupAt ? t('backupAt', { when: relTime(data.backupAt) }) : t('noBackup');

  const open = new Set([...document.querySelectorAll('#people details[open]')].map((d) => d.dataset.key));
  const list = $('#people');
  if (!people.length) {
    list.replaceChildren(el('li', { className: 'empty', textContent: t('empty') }));
  } else {
    list.replaceChildren(...people.map((p) => {
      const nextDue = [p.nextDueIn, p.nextDueOut].filter(Boolean).sort()[0];
      const initials = p.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
      const sub = el('small', {});
      if (p.status === 'overdue') sub.append(el('span', { className: 'pill overdue', textContent: t('overdue') }), fmtDate(nextDue));
      else if (p.status === 'settled') sub.append(el('span', { className: 'pill settled', textContent: t('settled') }));
      else if (nextDue) sub.append(t('dueOn', { date: fmtDate(nextDue) }));
      else sub.append(t(p.net >= 0 ? 'owesYou' : 'youOwe'));
      const details = el('details', { open: open.has(p.key) },
        el('summary', {},
          el('span', { className: 'avatar', textContent: initials, ariaHidden: 'true' }),
          el('span', { className: 'who' }, el('b', { textContent: p.name }), sub),
          el('span', { className: `net ${p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : ''}`, textContent: money(p.net) }),
        ),
        el('ul', { className: 'entries' }, ...p.entries.map((e) => {
          const label = t(`t_${e.kind}_${e.direction}`);
          const meta = [fmtDate(e.date), e.dueDate ? t('dueOn', { date: fmtDate(e.dueDate) }) : '', e.note].filter(Boolean).join(' · ');
          return el('li', {},
            el('span', { className: 'what', textContent: label }, el('small', { textContent: meta })),
            el('span', { className: 'amt', textContent: money(e.amount) }),
            el('button', { className: 'rm', type: 'button', textContent: '×', ariaLabel: t('removeEntry') }),
          );
        })),
      );
      details.dataset.key = p.key;
      details.querySelectorAll('.rm').forEach((b, i) => {
        const e = p.entries[i];
        b.dataset.remove = e.id;
        b.dataset.summary = `${p.name} ${t(`t_${e.kind}_${e.direction}`)} ${money(e.amount)} ${e.date}`;
      });
      return el('li', {}, details);
    }));
  }
  $('#peopleList').replaceChildren(...people.map((p) => el('option', { value: p.name })));
}

// ---------------------------------------------------------------------------
// Conta: entrar, criar conta, esqueci a senha
// ---------------------------------------------------------------------------
function guessCurrency() {
  const region = (navigator.language.split('-')[1] || '').toUpperCase();
  const map = { BR: 'BRL', US: 'USD', GB: 'GBP', PT: 'EUR', ES: 'EUR', FR: 'EUR', DE: 'EUR', IT: 'EUR', AR: 'ARS', MX: 'MXN', CL: 'CLP', CO: 'COP', CA: 'CAD', AU: 'AUD', CH: 'CHF', JP: 'JPY', CN: 'CNY' };
  return map[region] || (navigator.language.startsWith('pt') ? 'BRL' : 'USD');
}

const errorText = (err) => {
  if (err.code === 'network') return t('offlineTalk');
  const key = `err_${err.code}`;
  const text = t(key, { n: config.passwordMin || 8 });
  return text === key ? t('genericError') : text;
};

let authMode = 'login';

function setAuthMode(mode, { keepMsg = false } = {}) {
  authMode = mode;
  const f = $('#authForm');
  document.querySelectorAll('#welcome [data-only]').forEach((el) => (el.hidden = !el.dataset.only.split(' ').includes(mode)));
  document.querySelectorAll('#welcome [data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  const titles = { login: t('welcome', { ai: config.assistantName }), register: t('welcome', { ai: config.assistantName }), forgot: t('forgotPassword'), reset: t('resetPassword') };
  const subs = { login: t('loginSub'), register: t('welcomeSub'), forgot: t('forgotSub'), reset: t('resetSub', { email: f.email.value.trim() }) };
  $('#welcomeTitle').textContent = titles[mode];
  $('#welcomeSub').textContent = subs[mode];
  $('#passwordLabel').textContent = mode === 'login' ? t('password') : t('passwordHint', { n: config.passwordMin || 8 });
  f.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#authSubmit').textContent = { login: t('login'), register: t('register'), forgot: t('sendCode'), reset: t('resetPassword') }[mode];
  if (!keepMsg) $('#authMsg').textContent = '';
}

function showAuth(mode = 'login', message = '') {
  const f = $('#authForm');
  if (data.profile?.email && !f.email.value) f.email.value = data.profile.email;
  setAuthMode(mode);
  $('#authMsg').className = 'form-msg';
  $('#authMsg').textContent = message;
  openSheet('welcome');
}

document.querySelectorAll('#welcome [data-mode]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));
document.querySelectorAll('#welcome [data-goto]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.goto)));

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $('#authMsg');
  const btn = $('#authSubmit');
  msg.className = 'form-msg error';
  const email = f.email.value.trim();
  if (authMode === 'register' && !f.name.value.trim()) { msg.textContent = t('err_name_required'); return f.name.focus(); }
  if (!email) { msg.textContent = t('err_invalid_email'); return f.email.focus(); }

  btn.disabled = true;
  try {
    if (authMode === 'forgot') {
      await api('POST', '/api/auth/forgot', { email, language: uiLanguage() });
      f.code.value = '';
      f.password.value = '';
      setAuthMode('reset');
      return f.code.focus();
    }
    const session =
      authMode === 'login' ? await api('POST', '/api/auth/login', { email, password: f.password.value })
      : authMode === 'reset' ? await api('POST', '/api/auth/reset', { email, code: f.code.value, password: f.password.value })
      : await api('POST', '/api/auth/register', {
          name: f.name.value, email, password: f.password.value,
          currency: data.profile?.currency || guessCurrency(), language: data.profile?.language || 'auto',
        });
    await signedIn(session);
    f.password.value = '';
  } catch (err) {
    msg.textContent = errorText(err);
  } finally {
    btn.disabled = false;
  }
});

async function signedIn({ token, profile }) {
  // Dados locais de OUTRA conta não podem vazar para esta.
  if (data.profile?.email && data.profile.email !== profile.email) await wipeLocal();
  await store.set('token', token);
  setToken(token);
  try { localStorage.setItem('midas.hasAccount', '1'); } catch { /* só muda a aba inicial do login */ }
  // Dados locais da mesma conta (ex.: sessão expirou offline) sobem; ids repetidos são ignorados.
  data.pending = new Set(data.ops.map((o) => o.id));
  data.cursor = 0;
  data.loggedOut = false;
  await setProfile(profile);
  setLanguage(profile.language);
  applyI18n();
  setState('idle');
  $('#welcome').hidden = true;
  startSync();
}

/** Token recusado pelo servidor: mantém os dados locais e pede para entrar de novo. */
async function onLogout() {
  data.loggedOut = true;
  await store.del('token');
  setToken(null);
  showAuth('login', data.profile ? t('sessionExpired') : '');
}

$('#logoutBtn').addEventListener('click', async () => {
  if (data.pending.size) await sync();
  if (data.pending.size && !confirm(t('unsyncedLogout', { n: data.pending.size }))) return;
  try { await api('POST', '/api/auth/logout', undefined, { timeoutMs: 5000 }); } catch { /* sem rede: o token some daqui de qualquer jeito */ }
  await wipeLocal();
  location.reload();
});

$('#passwordStart').addEventListener('click', () => {
  $('#passwordStart').hidden = true;
  const f = $('#passwordForm');
  f.hidden = false;
  f.username.value = data.profile?.email || '';
  f.currentPassword.focus();
});

$('#passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $('#passwordMsg');
  try {
    await api('POST', '/api/account/password', { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value });
    msg.className = 'form-msg';
    msg.textContent = t('passwordChanged');
    f.currentPassword.value = '';
    f.newPassword.value = '';
  } catch (err) {
    msg.className = 'form-msg error';
    msg.textContent = err.code === 'invalid_credentials' ? t('err_invalid_credentials') : errorText(err);
  }
});

function startSync() {
  if (autoSyncStarted) return sync();
  autoSyncStarted = true;
  startAutoSync();
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
async function boot() {
  await loadLocal();
  const token = await store.get('token');
  setToken(token);

  try {
    config = { ...config, ...(await api('GET', '/api/config', undefined, { timeoutMs: 6000 })) };
    await store.set('config', config);
  } catch {
    config = { ...config, ...((await store.get('config')) || {}) };
  }
  data.assistantName = config.assistantName;
  data.onChange = () => { renderLedger(); renderGreeting(); };
  data.onLogout = onLogout;

  setLanguage(data.profile?.language);
  applyI18n();
  setState('idle');
  renderLedger();
  renderGreeting();
  rotateHint();
  setInterval(rotateHint, 5000);
  setInterval(() => { renderLedger(); renderGreeting(); }, 30000); // "sincronizado há X min", saudação

  checkNative();

  if (!token || !data.profile) {
    let known = Boolean(data.profile);
    try { known ||= localStorage.getItem('midas.hasAccount') === '1'; } catch { /* sem localStorage */ }
    showAuth(known ? 'login' : 'register');
  }
  else startSync();

  if ('serviceWorker' in navigator && !window.Capacitor) {
    // Quando uma versão nova do app é publicada, recarrega uma vez para usá-la.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); }))
      .catch(() => {});
  }
}

boot();

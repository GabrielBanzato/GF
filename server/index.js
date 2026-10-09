import express from 'express';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { runTurn, forgetConversation } from './assistant.js';
import { chat, transcribe, speak, qwenConfig } from './qwen.js';
import { sanitizeOp, todayIn } from '../shared/ledger.js';
import { buildWorkbook } from '../shared/spreadsheet.js';
import {
  hashToken, newToken, newResetCode, hashPassword, verifyPassword, dummyVerify, createRateLimiter, sendResetEmail,
  PASSWORD_MIN, SESSION_IDLE_MS, RESET_CODE_TTL_MS, RESET_MAX_ATTEMPTS,
} from './auth.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DELETE_PHRASES = ['DELETAR', 'DELETE', 'ELIMINAR'];
const LANGUAGES = ['auto', 'pt', 'en', 'es', 'fr', 'de', 'it', 'zh', 'ja', 'ko'];
const CURRENCY_RE = /^[A-Z]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_OPS_PER_SYNC = 5000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function publicProfile(u) {
  return { name: u.name, email: u.email, currency: u.currency, language: u.language };
}

const normalizeEmail = (e) => String(e ?? '').trim().toLowerCase();

function validatePassword(pw) {
  const s = String(pw ?? '');
  if (s.length < PASSWORD_MIN || s.length > 200) throw new HttpError(400, 'weak_password');
  return s;
}

function validateProfile(body, current = {}) {
  const p = { ...current };
  if (body.name !== undefined) p.name = String(body.name).trim().slice(0, 80);
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (!EMAIL_RE.test(email) || email.length > 160) throw new HttpError(400, 'invalid_email');
    p.email = email;
  }
  if (body.currency !== undefined) {
    if (!CURRENCY_RE.test(body.currency)) throw new HttpError(400, 'invalid_currency');
    p.currency = body.currency;
  }
  if (body.language !== undefined) {
    if (!LANGUAGES.includes(body.language)) throw new HttpError(400, 'invalid_language');
    p.language = body.language;
  }
  return p;
}

export function createApp({
  db, dataDir, assistantName = 'Midas',
  ai = { chat, transcribe, speak, config: qwenConfig },
  sendEmail = sendResetEmail,
} = {}) {
  const sheetsDir = join(dataDir, 'sheets');
  mkdirSync(sheetsDir, { recursive: true });
  const sheetPath = (userId) => join(sheetsDir, `${userId}.xlsx`);

  // Regera a planilha do servidor (sempre sobrescreve a anterior).
  async function writeSheet(user, timeZone) {
    const buf = await buildWorkbook(ExcelJS, { ops: db.allOps(user.id), profile: user, today: todayIn(timeZone), assistantName });
    const file = sheetPath(user.id);
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, Buffer.from(buf));
    renameSync(tmp, file);
  }

  // Tentativas erradas de login: 10 por e-mail e 50 por IP (vários usuários podem dividir o mesmo IP).
  const loginByEmail = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });
  const loginByIp = createRateLimiter({ max: 50, windowMs: 15 * 60_000 });
  const forgotLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60_000 });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '15mb' }));
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    next();
  });

  const clientIp = (req) => req.get('cf-connecting-ip') || req.ip || '';

  const startSession = (user) => {
    const token = newToken();
    db.createSession(hashToken(token), user.id);
    return { token, profile: publicProfile(user) };
  };

  const auth = (req, _res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const tokenHash = token ? hashToken(token) : '';
    const user = tokenHash && db.userBySession(tokenHash, SESSION_IDLE_MS);
    if (!user) throw new HttpError(401, 'unauthorized');
    req.user = user;
    req.tokenHash = tokenHash;
    req.timeZone = req.get('x-timezone') || 'UTC';
    next();
  };

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/api/config', (_req, res) => {
    const cfg = ai.config();
    res.json({ assistantName, ai: cfg.enabled, serverAsr: Boolean(cfg.enabled && cfg.asrModel), serverTts: Boolean(cfg.ttsModel), deletePhrases: DELETE_PHRASES, passwordMin: PASSWORD_MIN });
  });

  // --- Login ---------------------------------------------------------------
  app.post('/api/auth/register', async (req, res) => {
    const body = req.body || {};
    const profile = validateProfile(body, { name: '', email: '', currency: 'BRL', language: 'auto' });
    if (!profile.name) throw new HttpError(400, 'name_required');
    if (!profile.email) throw new HttpError(400, 'invalid_email');
    const password = validatePassword(body.password);
    if (db.userByEmail(profile.email)) throw new HttpError(409, 'email_taken');
    const user = { id: randomUUID(), password_hash: await hashPassword(password), ...profile };
    try {
      db.createUser(user);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) throw new HttpError(409, 'email_taken');
      throw err;
    }
    res.status(201).json(startSession(user));
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const ip = clientIp(req);
    if (loginByEmail.blocked(email) || loginByIp.blocked(ip)) throw new HttpError(429, 'too_many_attempts');
    const user = email ? db.userByEmail(email) : null;
    const ok = user ? await verifyPassword(password, user.password_hash) : await dummyVerify(password);
    if (!ok) {
      loginByEmail.hit(email);
      loginByIp.hit(ip);
      throw new HttpError(401, 'invalid_credentials');
    }
    loginByEmail.reset(email);
    res.json(startSession(user));
  });

  app.post('/api/auth/logout', auth, (req, res) => {
    db.deleteSession(req.tokenHash);
    res.status(204).end();
  });

  // Sempre responde 204, exista ou não a conta (não revela quem está cadastrado).
  app.post('/api/auth/forgot', async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const keys = [`ip:${clientIp(req)}`, `email:${email}`];
    if (keys.some((k) => forgotLimiter.blocked(k))) throw new HttpError(429, 'too_many_attempts');
    keys.forEach((k) => forgotLimiter.hit(k));
    const user = EMAIL_RE.test(email) ? db.userByEmail(email) : null;
    if (user) {
      const code = newResetCode();
      db.saveResetCode(user.id, hashToken(`${user.id}:${code}`), new Date(Date.now() + RESET_CODE_TTL_MS).toISOString());
      try {
        await sendEmail({ to: user.email, name: user.name, code, language: user.language === 'auto' ? req.body?.language : user.language, assistantName });
      } catch (err) {
        console.error('[reset email]', err.message);
        throw new HttpError(502, 'email_failed');
      }
    }
    res.status(204).end();
  });

  app.post('/api/auth/reset', async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code ?? '').replace(/\D/g, '');
    const password = validatePassword(req.body?.password);
    const user = email ? db.userByEmail(email) : null;
    const entry = user ? db.getResetCode(user.id) : null;
    if (!entry || Date.parse(entry.expires_at) < Date.now() || entry.attempts >= RESET_MAX_ATTEMPTS) {
      if (entry) db.deleteResetCode(user.id);
      throw new HttpError(400, 'invalid_code');
    }
    if (hashToken(`${user.id}:${code}`) !== entry.code_hash) {
      db.bumpResetAttempts(user.id);
      throw new HttpError(400, 'invalid_code');
    }
    db.deleteResetCode(user.id);
    db.setPassword(user.id, await hashPassword(password));
    db.deleteAllSessions(user.id); // derruba aparelhos logados com a senha antiga
    res.json(startSession(user));
  });

  // --- Conta --------------------------------------------------------------
  app.get('/api/account', auth, (req, res) => res.json({ profile: publicProfile(req.user) }));

  app.patch('/api/account', auth, async (req, res) => {
    const updated = { ...req.user, ...validateProfile(req.body || {}, req.user) };
    if (updated.email !== req.user.email && db.userByEmail(updated.email)) throw new HttpError(409, 'email_taken');
    db.updateUser(updated);
    await writeSheet(updated, req.timeZone); // moeda/idioma mudam a planilha
    res.json({ profile: publicProfile(updated) });
  });

  app.post('/api/account/password', auth, async (req, res) => {
    if (!(await verifyPassword(String(req.body?.currentPassword ?? ''), req.user.password_hash))) throw new HttpError(401, 'invalid_credentials');
    db.setPassword(req.user.id, await hashPassword(validatePassword(req.body?.newPassword)));
    db.deleteOtherSessions(req.user.id, req.tokenHash); // outros aparelhos precisam entrar de novo
    res.status(204).end();
  });

  app.delete('/api/account', auth, (req, res) => {
    const typed = String(req.body?.confirmation || '').trim().toUpperCase();
    if (!DELETE_PHRASES.includes(typed)) throw new HttpError(400, 'confirmation_mismatch');
    db.deleteUser(req.user.id); // sessões e ops apagados em cascata
    rmSync(sheetPath(req.user.id), { force: true });
    forgetConversation(req.user.id);
    res.status(204).end();
  });

  // --- Sincronização ------------------------------------------------------
  // O cliente envia os ops que ainda não subiram e o último cursor que conhece;
  // recebe de volta tudo que entrou no servidor depois desse cursor.
  // Se o cursor do cliente for maior que o do servidor (servidor perdeu dados /
  // foi restaurado), respondemos reset=true e o cliente reenvia o histórico todo.
  app.post('/api/sync', auth, async (req, res) => {
    const incoming = Array.isArray(req.body?.ops) ? req.body.ops : [];
    if (incoming.length > MAX_OPS_PER_SYNC) throw new HttpError(413, 'too_many_ops');
    const since = Math.max(0, Number(req.body?.since) || 0);

    const before = db.cursor(req.user.id);
    if (since > before) return res.json({ reset: true, cursor: before });

    const clean = incoming.map(sanitizeOp).filter(Boolean);
    const added = clean.length ? db.insertOps(req.user.id, clean) : 0;
    if (added || !existsSync(sheetPath(req.user.id))) await writeSheet(req.user, req.timeZone);

    res.json({ ops: db.opsSince(req.user.id, since), cursor: db.cursor(req.user.id), accepted: clean.map((o) => o.id), profile: publicProfile(req.user) });
  });

  // --- Conversa por voz ---------------------------------------------------
  // Com o Qwen rodando em CPU, um comando pode levar mais de 100 s — o limite da
  // Cloudflare para uma requisição. Por isso o comando vira um "pedido" (job):
  // POST /api/turn responde na hora com o id e o app consulta GET /api/turn/:id
  // até ficar pronto, mostrando cada etapa (ouvindo → pensando → falando).
  // Os pedidos rodam um de cada vez, em fila: o servidor tem poucos núcleos.
  const jobs = new Map();
  let queue = Promise.resolve();
  const JOB_TTL_MS = 15 * 60_000;

  const publicJob = (j) => ({
    jobId: j.id, status: j.status, position: j.status === 'queued' ? [...jobs.values()].filter((o) => o.status === 'queued' && o.createdAt < j.createdAt).length : 0,
    heard: j.heard, transcript: j.transcript, language: j.language, reply: j.reply, ops: j.ops, cursor: j.cursor, audioUrl: j.audioUrl, error: j.error,
  });

  async function processTurn(job, { user, body, timeZone }) {
    try {
      let text = String(body.text || '').trim().slice(0, 2000);
      job.language = body.language || null;
      if (!text && body.audio) {
        job.status = 'transcribing';
        const heard = await ai.transcribe(String(body.audio), String(body.mime || 'audio/webm').split(';')[0]);
        text = heard.text;
        job.language = heard.language || job.language;
      }
      if (!text) {
        job.heard = false;
        job.status = 'done';
        return;
      }
      job.transcript = text;
      job.status = 'thinking';
      const { reply, ops } = await runTurn(
        { user, text, timeZone, today: todayIn(timeZone), spokenLanguage: job.language },
        { chat: ai.chat, insertOps: db.insertOps, getOps: db.allOps, assistantName },
      );
      job.reply = reply;
      job.ops = ops;
      job.cursor = db.cursor(user.id);
      if (ops.length) await writeSheet(user, timeZone);

      job.status = 'speaking';
      try {
        job.audioUrl = await ai.speak(reply, user.language !== 'auto' ? user.language : job.language);
      } catch (err) {
        console.warn('[tts]', err.message); // o app usa a voz do aparelho
      }
      job.status = 'done';
    } catch (err) {
      console.error('[turn]', err);
      job.status = 'error';
      job.error = 'ai_failed';
    }
  }

  app.post('/api/turn', auth, (req, res) => {
    if (!ai.config().enabled) throw new HttpError(503, 'ai_not_configured');
    const now = Date.now();
    for (const [id, j] of jobs) if (now - j.createdAt > JOB_TTL_MS) jobs.delete(id);
    if ([...jobs.values()].some((j) => j.userId === req.user.id && !['done', 'error'].includes(j.status))) {
      throw new HttpError(429, 'turn_in_progress');
    }
    const job = { id: randomUUID(), userId: req.user.id, createdAt: now, status: 'queued', heard: true, transcript: '', language: null, reply: '', ops: [], cursor: null, audioUrl: null, error: null };
    jobs.set(job.id, job);
    const input = { user: req.user, body: req.body || {}, timeZone: req.timeZone };
    queue = queue.then(() => processTurn(job, input));
    res.status(202).json(publicJob(job));
  });

  app.get('/api/turn/:id', auth, (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.userId !== req.user.id) throw new HttpError(404, 'not_found');
    res.json(publicJob(job));
  });

  // --- Planilha -----------------------------------------------------------
  app.get('/api/spreadsheet', auth, async (req, res) => {
    if (!existsSync(sheetPath(req.user.id))) await writeSheet(req.user, req.timeZone);
    res.download(sheetPath(req.user.id), 'controle-financeiro.xlsx');
  });

  // --- Front-end ----------------------------------------------------------
  app.use('/shared', express.static(join(ROOT, 'shared')));
  app.get('/vendor/exceljs.min.js', (_req, res) => res.sendFile(join(ROOT, 'node_modules/exceljs/dist/exceljs.min.js')));
  app.use(express.static(join(ROOT, 'public')));

  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !err.status ? 'server_error' : err.message });
  });

  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* .env é opcional */ }
  const dataDir = process.env.DATA_DIR || join(ROOT, 'data');
  const db = openDb(join(dataDir, 'midas.db'));
  const assistantName = process.env.ASSISTANT_NAME || 'Midas';
  const app = createApp({ db, dataDir, assistantName });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    const cfg = qwenConfig();
    console.log(`${assistantName} rodando em http://localhost:${port}`);
    if (!cfg.enabled) console.warn('⚠  QWEN_API_KEY não configurada — a conversa por voz fica desativada (o resto funciona). Veja .env.example');
    if (!process.env.RESEND_API_KEY) console.warn('⚠  RESEND_API_KEY não configurada — códigos de "esqueci minha senha" aparecem só neste log.');
  });
}

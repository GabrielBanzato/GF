// Estado local + sincronização automática com o servidor.
//
// Cada alteração é um op com id e horário. Offline, os ops ficam em `pending`.
// Ao reconectar (ou quando o servidor volta), enviamos os pendentes e recebemos
// o que mudou no servidor; as duas listas são unidas pelo id e reprocessadas em
// ordem cronológica — o resultado é sempre a versão mais completa dos dois lados.

import { store } from './store.js';
import { api, ApiError } from './api.js';
import { mergeOps, createOpFactory } from '/shared/ledger.js';
import { saveBackup } from './backup.js';

const makeOp = createOpFactory();
const SYNC_EVERY_MS = 30000;

export const data = {
  ops: [],
  pending: new Set(),
  cursor: 0,
  profile: null,
  lastSync: null,
  backupAt: null,
  serverDown: false,
  loggedOut: false,
  assistantName: 'Midas',
  onChange: () => {},
  onLogout: () => {},
};

let syncing = null;
let again = false;
let backupTimer;

async function persist() {
  await Promise.all([
    store.set('ops', data.ops),
    store.set('pending', [...data.pending]),
    store.set('cursor', data.cursor),
    store.set('profile', data.profile),
    store.set('lastSync', data.lastSync),
  ]);
}

function scheduleBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(async () => {
    try {
      data.backupAt = await saveBackup({ ops: data.ops, profile: data.profile, assistantName: data.assistantName });
      data.onChange();
    } catch (err) {
      console.warn('backup', err);
    }
  }, 800);
}

function changed({ backup = true } = {}) {
  data.onChange();
  if (backup) scheduleBackup();
}

export async function loadLocal() {
  const [ops, pending, cursor, profile, lastSync, backupAt] = await Promise.all(
    ['ops', 'pending', 'cursor', 'profile', 'lastSync', 'backupAt'].map((k) => store.get(k)),
  );
  data.ops = ops || [];
  data.pending = new Set(pending || []);
  data.cursor = cursor || 0;
  data.profile = profile || null;
  data.lastSync = lastSync || null;
  data.backupAt = backupAt || null;
}

export async function setProfile(profile) {
  data.profile = profile;
  await persist();
  changed();
}

/** Alteração feita à mão (lápis). Funciona offline. */
export async function addLocalOp(type, payload) {
  const op = makeOp(type, payload, navigator.onLine && !data.serverDown ? 'manual' : 'offline');
  data.ops = mergeOps(data.ops, [op]);
  data.pending.add(op.id);
  await persist();
  changed();
  sync();
  return op;
}

/** Cria um op com id/horário locais, sem gravar (usado pelos comandos de voz do aparelho). */
export const newOp = (type, payload, source = 'voice') => makeOp(type, payload, source);

/** Grava ops criados no aparelho (comando de voz interpretado pela Apple Intelligence). */
export async function addLocalOps(ops) {
  if (!ops?.length) return;
  data.ops = mergeOps(data.ops, ops);
  for (const op of ops) data.pending.add(op.id);
  await persist();
  changed();
  sync();
}

/** Ops criados pelo servidor durante uma conversa por voz. */
export async function applyRemoteOps(ops) {
  if (!ops?.length) return;
  data.ops = mergeOps(data.ops, ops);
  await persist();
  changed();
  sync();
}

export function sync() {
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function syncOnce() {
  if (data.loggedOut) return;
  if (!navigator.onLine) { data.serverDown = false; changed({ backup: false }); return; }
  const sending = data.ops.filter((o) => data.pending.has(o.id));
  let res;
  try {
    res = await api('POST', '/api/sync', { ops: sending, since: data.cursor });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { data.loggedOut = true; return data.onLogout(); }
    data.serverDown = true;
    changed({ backup: false });
    return;
  }
  data.serverDown = false;

  if (res.reset) {
    // O servidor tem menos histórico do que nós (ex.: restaurado de backup): reenviamos tudo.
    data.cursor = 0;
    data.pending = new Set(data.ops.map((o) => o.id));
    again = true;
    await persist();
    return;
  }

  const before = data.ops.length;
  for (const op of sending) data.pending.delete(op.id);
  data.ops = mergeOps(data.ops, res.ops);
  data.cursor = res.cursor;
  data.profile = res.profile || data.profile;
  data.lastSync = new Date().toISOString();
  await persist();
  changed({ backup: data.ops.length !== before || !data.backupAt || sending.length > 0 });
}

export function startAutoSync() {
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => changed({ backup: false }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(() => { if (!document.hidden) sync(); }, SYNC_EVERY_MS);
  sync();
}

export async function wipeLocal() {
  clearTimeout(backupTimer);
  await store.clear();
  Object.assign(data, { ops: [], pending: new Set(), cursor: 0, profile: null, lastSync: null, backupAt: null });
  const fs = window.Capacitor?.Plugins?.Filesystem;
  if (fs) await fs.rmdir({ path: 'Midas', directory: 'DOCUMENTS', recursive: true }).catch(() => {});
}

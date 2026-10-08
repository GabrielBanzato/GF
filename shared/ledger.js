// Livro-razão baseado em eventos. Roda igual no servidor e no navegador.
//
// Toda alteração é um "op" imutável: { id, ts, type, data, source }.
// O estado (pessoas, lançamentos, saldos) é sempre recalculado reprocessando
// os ops em ordem de `ts`. Assim, sincronizar cliente e servidor é só unir as
// duas listas de ops pelo `id` — nada se perde, mesmo editando dos dois lados.
//
// Valores são guardados em centavos (inteiros).
// direction: 'in'  = a pessoa me deve (a receber)
//            'out' = eu devo à pessoa (a pagar)

export const OP = Object.freeze({
  DEBT_ADD: 'debt.add',
  PAYMENT_ADD: 'payment.add',
  ENTRY_UPDATE: 'entry.update',
  ENTRY_DELETE: 'entry.delete',
  PERSON_RENAME: 'person.rename',
  PERSON_DELETE: 'person.delete',
});

const OP_TYPES = new Set(Object.values(OP));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function toCents(value) {
  const n = typeof value === 'string' ? Number(value.replace(/\s/g, '').replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function isDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s));
}

export function todayIn(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function compareOps(a, b) {
  if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Une listas de ops (sem duplicar ids) e ordena pelo histórico. */
export function mergeOps(...lists) {
  const byId = new Map();
  for (const list of lists) for (const op of list || []) if (op?.id && !byId.has(op.id)) byId.set(op.id, op);
  return [...byId.values()].sort(compareOps);
}

/** Valida um op vindo de fora (cliente). Retorna o op limpo ou null. */
export function sanitizeOp(op) {
  if (!op || typeof op !== 'object') return null;
  if (typeof op.id !== 'string' || op.id.length < 8 || op.id.length > 64) return null;
  if (typeof op.ts !== 'string' || Number.isNaN(Date.parse(op.ts))) return null;
  if (!OP_TYPES.has(op.type)) return null;
  const data = op.data && typeof op.data === 'object' ? op.data : {};
  return {
    id: op.id,
    ts: new Date(op.ts).toISOString(),
    type: op.type,
    data: JSON.parse(JSON.stringify(data)),
    source: ['voice', 'manual', 'offline'].includes(op.source) ? op.source : 'manual',
  };
}

/**
 * Cria ops com timestamps estritamente crescentes, para que vários ops do
 * mesmo instante (ex.: um comando de voz que gera 2 alterações) mantenham a ordem.
 */
export function createOpFactory(uuid = () => crypto.randomUUID()) {
  let last = 0;
  return (type, data, source = 'manual') => {
    last = Math.max(Date.now(), last + 1);
    return { id: uuid(), ts: new Date(last).toISOString(), type, data, source };
  };
}

/** Reprocessa os ops e devolve { people: Map<key, person>, entries: Map<id, entry> }. */
export function replay(ops) {
  const people = new Map();
  const entries = new Map();

  const getPerson = (name, create) => {
    const key = normalizeName(name);
    if (!key) return null;
    let p = people.get(key);
    if (!p && create) {
      p = { key, name: String(name).trim().replace(/\s+/g, ' '), entries: [] };
      people.set(key, p);
    }
    return p || null;
  };

  for (const op of [...ops].sort(compareOps)) {
    const d = op.data || {};
    switch (op.type) {
      case OP.DEBT_ADD:
      case OP.PAYMENT_ADD: {
        const amount = Math.round(Number(d.amount));
        if (!(amount > 0)) break;
        const p = getPerson(d.person, true);
        if (!p) break;
        const isDebt = op.type === OP.DEBT_ADD;
        const entry = {
          id: op.id,
          kind: isDebt ? 'debt' : 'payment',
          direction: d.direction === 'out' ? 'out' : 'in',
          amount,
          date: isDate(d.date) ? d.date : op.ts.slice(0, 10),
          dueDate: isDebt && isDate(d.dueDate) ? d.dueDate : null,
          note: typeof d.note === 'string' ? d.note : '',
          source: op.source || '',
          createdAt: op.ts,
          personKey: p.key,
        };
        p.entries.push(entry);
        entries.set(entry.id, entry);
        break;
      }
      case OP.ENTRY_UPDATE: {
        const e = entries.get(d.entryId);
        if (!e) break;
        const f = d.fields || {};
        if (Number(f.amount) > 0) e.amount = Math.round(Number(f.amount));
        if ('dueDate' in f && e.kind === 'debt') e.dueDate = isDate(f.dueDate) ? f.dueDate : null;
        if (isDate(f.date)) e.date = f.date;
        if (typeof f.note === 'string') e.note = f.note;
        break;
      }
      case OP.ENTRY_DELETE: {
        const e = entries.get(d.entryId);
        if (!e) break;
        entries.delete(e.id);
        const p = people.get(e.personKey);
        if (p) p.entries = p.entries.filter((x) => x.id !== e.id);
        break;
      }
      case OP.PERSON_RENAME: {
        const p = getPerson(d.from, false);
        const to = String(d.to ?? '').trim().replace(/\s+/g, ' ');
        const toKey = normalizeName(to);
        if (!p || !toKey) break;
        people.delete(p.key);
        const target = people.get(toKey);
        if (target) {
          for (const e of p.entries) { e.personKey = toKey; target.entries.push(e); }
        } else {
          p.key = toKey;
          p.name = to;
          for (const e of p.entries) e.personKey = toKey;
          people.set(toKey, p);
        }
        break;
      }
      case OP.PERSON_DELETE: {
        const p = getPerson(d.person, false);
        if (!p) break;
        for (const e of p.entries) entries.delete(e.id);
        people.delete(p.key);
        break;
      }
    }
  }
  return { people, entries };
}

/**
 * Saldo de uma pessoa. Pagamentos quitam as dívidas mais antigas primeiro (FIFO),
 * o que define qual é o próximo vencimento ainda em aberto.
 */
export function summarizePerson(person, today) {
  const out = { key: person.key, name: person.name, receivable: 0, payable: 0, nextDueIn: null, nextDueOut: null, overdue: false, status: 'settled', entries: [] };
  for (const dir of ['in', 'out']) {
    const debts = person.entries
      .filter((e) => e.kind === 'debt' && e.direction === dir)
      .sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date) || a.createdAt.localeCompare(b.createdAt));
    const paidTotal = person.entries.filter((e) => e.kind === 'payment' && e.direction === dir).reduce((s, e) => s + e.amount, 0);
    const balance = debts.reduce((s, e) => s + e.amount, 0) - paidTotal;
    let remainingPaid = paidTotal;
    let nextDue = null;
    for (const debt of debts) {
      const covered = Math.min(remainingPaid, debt.amount);
      remainingPaid -= covered;
      if (covered < debt.amount && debt.dueDate && (!nextDue || debt.dueDate < nextDue)) nextDue = debt.dueDate;
    }
    if (dir === 'in') { out.receivable = balance; out.nextDueIn = nextDue; } else { out.payable = balance; out.nextDueOut = nextDue; }
    if (balance > 0 && nextDue && today && nextDue < today) out.overdue = true;
  }
  out.net = out.receivable - out.payable;
  out.status = out.overdue ? 'overdue' : out.receivable > 0 || out.payable > 0 ? 'open' : 'settled';
  out.entries = [...person.entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return out;
}

export function summarize(ops, today) {
  const state = replay(ops);
  const statusRank = { overdue: 0, open: 1, settled: 2 };
  const people = [...state.people.values()]
    .map((p) => summarizePerson(p, today))
    .sort((a, b) => statusRank[a.status] - statusRank[b.status] || Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name));
  const totals = people.reduce(
    (t, p) => ({ receivable: t.receivable + Math.max(0, p.receivable), payable: t.payable + Math.max(0, p.payable) }),
    { receivable: 0, payable: 0 },
  );
  totals.net = totals.receivable - totals.payable;
  return { state, people, totals };
}

/** Encontra a pessoa citada: nome exato, primeiro nome único ou erro de digitação/transcrição leve. */
export function findPerson(state, name) {
  const key = normalizeName(name);
  if (!key) return null;
  if (state.people.has(key)) return state.people.get(key);
  const all = [...state.people.values()];
  const byPrefix = all.filter((p) => p.key.split(' ')[0] === key.split(' ')[0] && (p.key.startsWith(key) || key.startsWith(p.key)));
  if (byPrefix.length === 1) return byPrefix[0];
  if (key.length >= 4) {
    const close = all.filter((p) => levenshtein(p.key, key) <= 1);
    if (close.length === 1) return close[0];
  }
  return null;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function formatMoney(cents, currency = 'BRL', locale) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

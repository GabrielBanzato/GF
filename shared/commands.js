// Comandos de voz interpretados no próprio iPhone (Apple Intelligence / Foundation Models).
//
// O modelo do aparelho só CLASSIFICA o pedido num formato fixo (MidasCommand, definido
// no MidasBridge.swift). Quem aplica a alteração e monta a resposta falada é este código:
// resultados previsíveis mesmo com um modelo pequeno, e as alterações viram ops normais
// que sincronizam com o servidor (funciona até offline).

import { replay, findPerson, summarizePerson, summarize, formatMoney, isDate } from './ledger.js';
import { executeTool } from './tools.js';

export const ACTIONS = ['add_debt', 'register_payment', 'set_due_date', 'delete_last', 'rename_person', 'remove_person', 'query', 'clarify', 'other'];

/** Instruções fixas do modelo do aparelho. */
export function commandInstructions(assistantName = 'Midas') {
  return `You are ${assistantName}, the voice assistant of a personal debts ledger. Convert what the user said into ONE command.
The user may greet you by name ("fala ${assistantName}", "hey ${assistantName}", "opa") — ignore that, it is not a person.
Actions:
- add_debt: someone owes money or the user owes someone. "X me deve", "coloca o X na lista", "emprestei pro X" -> direction they_owe_me. "eu devo pro X", "peguei emprestado do X", "I owe X" -> i_owe_them.
- register_payment: a payment reduces a balance. "desconta", "abate", "X me pagou", "recebi do X" -> they_owe_me. "paguei o X" -> i_owe_them.
- set_due_date: change when a debt is due.
- delete_last: undo/remove the last entry ("apaga o último", "desfaz", "foi errado").
- rename_person: fix a name (person = old name, newName = new name).
- remove_person: remove a person and all records (only if explicitly asked).
- query: a question about balances ("quanto o X me deve?", "quem me deve?"). person empty for totals.
- clarify: who or how much is missing for a change — put ONE short question in reply.
- other: anything else — put a short friendly answer in reply.
Rules: amounts are plain numbers in the user's currency ("50 conto" = 50, "2k" = 2000, "mil e quinhentos" = 1500).
Dates: use the calendar given in the prompt and output YYYY-MM-DD. Leave text fields empty and amount 0 when not said.
Write reply (only for clarify/other) in the user's language, as a male assistant.`;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Pedido enviado ao modelo: calendário pronto (modelos pequenos erram contas de data) + saldos atuais. */
export function buildCommandPrompt({ text, ops, today, currency, history = [] }) {
  const { people } = summarize(ops, today);
  const money = (c) => formatMoney(c, currency, 'en-US');
  const weekday = (iso) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
  const next = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)).map((d) => `next ${weekday(d)}=${d}`).join(', ');
  const [y, m] = today.split('-');
  const calendar = `today=${today} (${weekday(today)}), yesterday=${addDays(today, -1)}, tomorrow=${addDays(today, 1)}, ${next}. A bare day of month N means ${y}-${m}-NN, or next month if that day already passed.`;
  const list = people.length
    ? people.map((p) => `${p.name} (${[p.receivable ? `owes the user ${money(p.receivable)}` : '', p.payable ? `the user owes ${money(p.payable)}` : ''].filter(Boolean).join('; ') || 'settled'})`).join(', ')
    : 'none yet';
  const prev = history.length ? `\nPrevious exchange:\n${history.map((h) => `${h.role}: ${h.text}`).join('\n')}` : '';
  return `Calendar: ${calendar}\nCurrency: ${currency}.\nPeople in the ledger: ${list}.${prev}\nThe user said: "${text}"`;
}

// --- Respostas faladas ----------------------------------------------------
const REPLIES = {
  pt: {
    addIn: '{p} agora te deve {bal}.', addOut: 'Anotado. Você deve {bal} para {p}.', due: ' Vencimento em {date}.', addNew: 'Pronto, coloquei {p} na lista. ',
    payIn: 'Feito, descontei {amt}. {rest}', payOut: 'Feito, registrei que você pagou {amt} para {p}. {rest}',
    restIn: '{p} ainda te deve {bal}.', restOut: 'Você ainda deve {bal} para {p}.', settled: 'Agora está tudo quitado com {p}.',
    dueSet: 'Certo, o vencimento de {p} agora é {date}.', deleted: 'Apaguei o último lançamento de {p}: {what}.', nothingToDelete: 'Não encontrei nenhum lançamento para apagar.',
    renamed: 'Pronto, {from} agora se chama {to}.', removed: 'Removi {p} da lista.',
    qIn: '{p} te deve {bal}.', qOut: 'Você deve {bal} para {p}.', qBoth: '{p} te deve {in} e você deve {out} para ele.', qNone: '{p} não te deve nada.',
    qTotal: 'No total, você tem {in} a receber e {out} a pagar.', qTop: ' Quem mais te deve é {p}, com {bal}.', qEmpty: 'Sua lista ainda está vazia.',
    notFound: 'Não achei ninguém chamado {p} na lista.', askWho: 'De quem estamos falando?', askAmount: 'Qual é o valor?', askDate: 'Para quando é o vencimento?',
    unknown: 'Não entendi. Pode repetir de outro jeito?',
    debt: 'dívida', payment: 'pagamento',
  },
  en: {
    addIn: '{p} now owes you {bal}.', addOut: 'Got it. You owe {p} {bal}.', due: ' Due on {date}.', addNew: 'Done, I added {p} to the list. ',
    payIn: 'Done, I took off {amt}. {rest}', payOut: 'Done, I recorded that you paid {p} {amt}. {rest}',
    restIn: '{p} still owes you {bal}.', restOut: 'You still owe {p} {bal}.', settled: "You're all settled with {p} now.",
    dueSet: 'Okay, {p} is now due on {date}.', deleted: "I deleted {p}'s last entry: {what}.", nothingToDelete: "I couldn't find any entry to delete.",
    renamed: 'Done, {from} is now {to}.', removed: 'I removed {p} from the list.',
    qIn: '{p} owes you {bal}.', qOut: 'You owe {p} {bal}.', qBoth: '{p} owes you {in} and you owe them {out}.', qNone: "{p} doesn't owe you anything.",
    qTotal: 'In total, you have {in} to receive and {out} to pay.', qTop: ' {p} owes you the most, {bal}.', qEmpty: 'Your list is still empty.',
    notFound: "I couldn't find anyone called {p} on the list.", askWho: 'Who are we talking about?', askAmount: "What's the amount?", askDate: "When is it due?",
    unknown: "I didn't get that. Could you say it another way?",
    debt: 'debt', payment: 'payment',
  },
  es: {
    addIn: '{p} ahora te debe {bal}.', addOut: 'Anotado. Le debes {bal} a {p}.', due: ' Vence el {date}.', addNew: 'Listo, agregué a {p} a la lista. ',
    payIn: 'Hecho, desconté {amt}. {rest}', payOut: 'Hecho, registré que le pagaste {amt} a {p}. {rest}',
    restIn: '{p} todavía te debe {bal}.', restOut: 'Todavía le debes {bal} a {p}.', settled: 'Ya está todo saldado con {p}.',
    dueSet: 'Bien, el vencimiento de {p} ahora es el {date}.', deleted: 'Borré el último movimiento de {p}: {what}.', nothingToDelete: 'No encontré ningún movimiento para borrar.',
    renamed: 'Listo, {from} ahora se llama {to}.', removed: 'Quité a {p} de la lista.',
    qIn: '{p} te debe {bal}.', qOut: 'Le debes {bal} a {p}.', qBoth: '{p} te debe {in} y tú le debes {out}.', qNone: '{p} no te debe nada.',
    qTotal: 'En total, tienes {in} por cobrar y {out} por pagar.', qTop: ' Quien más te debe es {p}, con {bal}.', qEmpty: 'Tu lista todavía está vacía.',
    notFound: 'No encontré a nadie llamado {p} en la lista.', askWho: '¿De quién hablamos?', askAmount: '¿Cuál es el importe?', askDate: '¿Para cuándo es el vencimiento?',
    unknown: 'No entendí. ¿Puedes decirlo de otra forma?',
    debt: 'deuda', payment: 'pago',
  },
};

const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

/**
 * Aplica um comando interpretado pelo modelo do aparelho.
 * @param cmd  { action, person, amount, direction, date, dueDate, newName, note, reply }
 * @param ctx  { ops, today, currency, language ("pt"), makeOp(type, data) }
 * @returns { ops: novos ops, reply: texto a falar, ask: true se fez uma pergunta }
 */
export function applyCommand(cmd, ctx) {
  const lang = REPLIES[ctx.language] ? ctx.language : 'en';
  const R = REPLIES[lang];
  const locale = LOCALES[lang];
  const say = (key, vars = {}) => R[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const money = (c) => formatMoney(c, ctx.currency, locale);
  const spokenDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const ask = (reply) => ({ ops: [], reply, ask: true });
  const done = (ops, reply) => ({ ops, reply, ask: false });

  const action = ACTIONS.includes(cmd?.action) ? cmd.action : 'other';
  const person = String(cmd?.person || '').trim();
  const amount = Number(cmd?.amount) || 0;
  const date = isDate(cmd?.date) ? cmd.date : undefined;
  const dueDate = isDate(cmd?.dueDate) ? cmd.dueDate : undefined;
  const note = String(cmd?.note || '').trim() || undefined;
  const direction = cmd?.direction === 'i_owe_them' ? 'i_owe_them' : cmd?.direction === 'they_owe_me' ? 'they_owe_me' : undefined;
  const toolCtx = { ops: ctx.ops, today: ctx.today, currency: ctx.currency, makeOp: ctx.makeOp };

  const balance = (ops, name) => {
    const p = findPerson(replay(ops), name);
    return p ? summarizePerson(p, ctx.today) : null;
  };
  const rest = (s, name) =>
    !s ? '' : s.receivable > 0 ? say('restIn', { p: name, bal: money(s.receivable) })
      : s.payable > 0 ? say('restOut', { p: name, bal: money(s.payable) })
        : say('settled', { p: name });
  const notFound = (r) => /not found/.test(r.error || '');

  switch (action) {
    case 'add_debt': {
      if (!person) return ask(say('askWho'));
      if (!(amount > 0)) return ask(say('askAmount'));
      const { ops, result } = executeTool('add_debt', { person, amount, direction: direction || 'they_owe_me', due_date: dueDate, date, note }, toolCtx);
      if (!result.ok) return ask(say('unknown'));
      const name = ops[0].data.person;
      const s = balance([...ctx.ops, ...ops], name);
      const out = direction === 'i_owe_them';
      const text = (result.new_person ? say('addNew', { p: name }) : '')
        + say(out ? 'addOut' : 'addIn', { p: name, bal: money(out ? s.payable : s.receivable) })
        + (dueDate ? say('due', { date: spokenDate(dueDate) }) : '');
      return done(ops, text.trim());
    }
    case 'register_payment': {
      if (!person) return ask(say('askWho'));
      if (!(amount > 0)) return ask(say('askAmount'));
      const { ops, result } = executeTool('register_payment', { person, amount, direction, date, note }, toolCtx);
      if (!result.ok) return notFound(result) ? ask(say('notFound', { p: person })) : ask(say('unknown'));
      const name = ops[0].data.person;
      const s = balance([...ctx.ops, ...ops], name);
      const out = ops[0].data.direction === 'out';
      return done(ops, say(out ? 'payOut' : 'payIn', { p: name, amt: money(ops[0].data.amount), rest: rest(s, name) }).trim());
    }
    case 'set_due_date': {
      if (!person) return ask(say('askWho'));
      if (!dueDate) return ask(say('askDate'));
      const { ops, result } = executeTool('set_due_date', { person, due_date: dueDate, direction }, toolCtx);
      if (!result.ok) return notFound(result) ? ask(say('notFound', { p: person })) : ask(say('unknown'));
      return done(ops, say('dueSet', { p: result.balance_now?.person || person, date: spokenDate(dueDate) }));
    }
    case 'delete_last': {
      const state = replay(ctx.ops);
      const target = person ? findPerson(state, person) : null;
      if (person && !target) return ask(say('notFound', { p: person }));
      const last = [...state.entries.values()]
        .filter((e) => !target || e.personKey === target.key)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!last) return done([], say('nothingToDelete'));
      const { ops } = executeTool('delete_entry', { entry_id: last.id }, toolCtx);
      const who = state.people.get(last.personKey)?.name || '';
      return done(ops, say('deleted', { p: who, what: `${R[last.kind]} ${money(last.amount)}` }));
    }
    case 'rename_person': {
      const to = String(cmd?.newName || '').trim();
      if (!person || !to) return ask(say('askWho'));
      const { ops, result } = executeTool('rename_person', { from: person, to }, toolCtx);
      if (!result.ok) return ask(say('notFound', { p: person }));
      return done(ops, say('renamed', { from: ops[0].data.from, to }));
    }
    case 'remove_person': {
      if (!person) return ask(say('askWho'));
      const { ops, result } = executeTool('remove_person', { person }, toolCtx);
      if (!result.ok) return ask(say('notFound', { p: person }));
      return done(ops, say('removed', { p: result.removed }));
    }
    case 'query': {
      if (person) {
        const s = balance(ctx.ops, person);
        if (!s) return done([], say('notFound', { p: person }));
        const text = s.receivable > 0 && s.payable > 0 ? say('qBoth', { p: s.name, in: money(s.receivable), out: money(s.payable) })
          : s.receivable > 0 ? say('qIn', { p: s.name, bal: money(s.receivable) })
            : s.payable > 0 ? say('qOut', { p: s.name, bal: money(s.payable) })
              : say('qNone', { p: s.name });
        return done([], text);
      }
      const { people, totals } = summarize(ctx.ops, ctx.today);
      if (!people.length) return done([], say('qEmpty'));
      const top = [...people].sort((a, b) => b.receivable - a.receivable)[0];
      return done([], say('qTotal', { in: money(totals.receivable), out: money(totals.payable) }) + (top.receivable > 0 ? say('qTop', { p: top.name, bal: money(top.receivable) }) : ''));
    }
    case 'clarify':
      return ask(String(cmd?.reply || '').trim() || say('unknown'));
    default:
      return done([], String(cmd?.reply || '').trim() || say('unknown'));
  }
}


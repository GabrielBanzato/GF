// Ferramentas (function calling) que o Qwen pode chamar.
// Cada ferramenta valida os argumentos e devolve os ops a gravar + um resultado
// curto que volta para o modelo formular a resposta falada.

import { OP, replay, findPerson, summarizePerson, toCents, isDate, formatMoney } from '../shared/ledger.js';

const direction = {
  type: 'string',
  enum: ['they_owe_me', 'i_owe_them'],
  description: 'they_owe_me = the person owes the user (receivable). i_owe_them = the user owes the person (payable).',
};

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_debt',
      description: 'Add a person to the list and/or register a new amount owed. Use for "X me deve", "coloca o X na lista", "I lent X", "eu devo pro X".',
      parameters: {
        type: 'object',
        properties: {
          person: { type: 'string', description: 'Name of the person as the user said it' },
          amount: { type: 'number', description: 'Amount in the user currency units (e.g. 150.50)' },
          direction,
          due_date: { type: 'string', description: 'Due date YYYY-MM-DD, if mentioned' },
          date: { type: 'string', description: 'Date the debt happened YYYY-MM-DD, if different from today' },
          note: { type: 'string', description: 'Short description (what it was for), if mentioned' },
        },
        required: ['person', 'amount', 'direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_payment',
      description: 'Register a payment that reduces a balance. Use for "desconta", "abate", "X me pagou", "paguei o X", "received from X".',
      parameters: {
        type: 'object',
        properties: {
          person: { type: 'string' },
          amount: { type: 'number' },
          direction: { ...direction, description: 'they_owe_me = the person paid the user. i_owe_them = the user paid the person. Omit if unclear.' },
          date: { type: 'string', description: 'Date the payment happened YYYY-MM-DD (e.g. yesterday)' },
          note: { type: 'string' },
        },
        required: ['person', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_due_date',
      description: 'Change the due date of the most recent open debt of a person.',
      parameters: {
        type: 'object',
        properties: { person: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, direction },
        required: ['person', 'due_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_entry',
      description: 'Delete a wrong entry (debt or payment), e.g. "apaga o último lançamento", "undo that". Use an entry id from the ledger context.',
      parameters: { type: 'object', properties: { entry_id: { type: 'string', description: 'Entry id or its first 8 characters' } }, required: ['entry_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_person',
      description: 'Rename a person (fix a name). If the new name already exists, the records are merged.',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_person',
      description: 'Remove a person and ALL their records. Only when the user explicitly asks to remove/delete the person.',
      parameters: { type: 'object', properties: { person: { type: 'string' } }, required: ['person'] },
    },
  },
];

const dir = (d) => (d === 'i_owe_them' ? 'out' : d === 'they_owe_me' ? 'in' : null);
const fail = (error) => ({ ops: [], result: { ok: false, error } });

/**
 * @param name   nome da ferramenta
 * @param args   argumentos (já parseados)
 * @param ctx    { ops, today, currency, makeOp(type, data) }
 */
export function executeTool(name, args, ctx) {
  const state = replay(ctx.ops);
  const known = () => [...state.people.values()].map((p) => p.name);
  const money = (c) => formatMoney(c, ctx.currency);
  const balanceOf = (ops, personName) => {
    const s = replay(ops);
    const p = findPerson(s, personName);
    if (!p) return null;
    const sum = summarizePerson(p, ctx.today);
    return { person: p.name, they_owe_me: money(sum.receivable), i_owe_them: money(sum.payable), status: sum.status };
  };
  const finish = (newOps, extra = {}, personName) => ({
    ops: newOps,
    result: { ok: true, ...extra, ...(personName ? { balance_now: balanceOf([...ctx.ops, ...newOps], personName) } : {}) },
  });

  switch (name) {
    case 'add_debt': {
      const person = String(args.person || '').trim();
      const amount = toCents(args.amount);
      if (!person) return fail('missing person');
      if (!(amount > 0)) return fail('amount must be greater than zero');
      const direction = dir(args.direction) || 'in';
      const existing = findPerson(state, person);
      const name = existing?.name || person;
      const op = ctx.makeOp(OP.DEBT_ADD, {
        person: name, amount, direction,
        date: isDate(args.date) ? args.date : ctx.today,
        ...(isDate(args.due_date) ? { dueDate: args.due_date } : {}),
        ...(args.note ? { note: String(args.note).slice(0, 200) } : {}),
      });
      return finish([op], { new_person: !existing, entry_id: op.id.slice(0, 8) }, name);
    }

    case 'register_payment': {
      const amount = toCents(args.amount);
      if (!(amount > 0)) return fail('amount must be greater than zero');
      const p = findPerson(state, args.person);
      if (!p) return fail(`person "${args.person}" not found. Known people: ${known().join(', ') || 'none'}`);
      let direction = dir(args.direction);
      if (!direction) {
        const s = summarizePerson(p, ctx.today);
        direction = s.payable > 0 && s.receivable <= 0 ? 'out' : 'in';
      }
      const op = ctx.makeOp(OP.PAYMENT_ADD, {
        person: p.name, amount, direction,
        date: isDate(args.date) ? args.date : ctx.today,
        ...(args.note ? { note: String(args.note).slice(0, 200) } : {}),
      });
      return finish([op], { entry_id: op.id.slice(0, 8) }, p.name);
    }

    case 'set_due_date': {
      if (!isDate(args.due_date)) return fail('due_date must be YYYY-MM-DD');
      const p = findPerson(state, args.person);
      if (!p) return fail(`person "${args.person}" not found. Known people: ${known().join(', ') || 'none'}`);
      const want = dir(args.direction);
      const debt = p.entries
        .filter((e) => e.kind === 'debt' && (!want || e.direction === want))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!debt) return fail(`${p.name} has no debts registered`);
      return finish([ctx.makeOp(OP.ENTRY_UPDATE, { entryId: debt.id, fields: { dueDate: args.due_date } })], {}, p.name);
    }

    case 'delete_entry': {
      const id = String(args.entry_id || '').trim();
      const matches = id.length >= 4 ? [...state.entries.values()].filter((e) => e.id.startsWith(id)) : [];
      if (matches.length !== 1) return fail(matches.length ? 'ambiguous entry id' : 'entry not found');
      const e = matches[0];
      const personName = state.people.get(e.personKey)?.name;
      const summary = `${personName} ${e.kind} ${e.direction} ${money(e.amount)} ${e.date}`;
      return finish([ctx.makeOp(OP.ENTRY_DELETE, { entryId: e.id, summary })], { deleted: summary }, personName);
    }

    case 'rename_person': {
      const p = findPerson(state, args.from);
      const to = String(args.to || '').trim();
      if (!p) return fail(`person "${args.from}" not found. Known people: ${known().join(', ') || 'none'}`);
      if (!to) return fail('missing new name');
      return finish([ctx.makeOp(OP.PERSON_RENAME, { from: p.name, to })], {}, to);
    }

    case 'remove_person': {
      const p = findPerson(state, args.person);
      if (!p) return fail(`person "${args.person}" not found. Known people: ${known().join(', ') || 'none'}`);
      return finish([ctx.makeOp(OP.PERSON_DELETE, { person: p.name })], { removed: p.name });
    }

    default:
      return fail(`unknown tool ${name}`);
  }
}

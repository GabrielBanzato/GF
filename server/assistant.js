// Um "turno" de conversa: texto do usuário -> Qwen (+ ferramentas) -> ops + resposta.

import { summarize, formatMoney, createOpFactory } from '../shared/ledger.js';
import { TOOLS, executeTool } from './tools.js';

const LANGUAGE_NAMES = { pt: 'Portuguese (Brazil)', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean' };
const MAX_TOOL_ROUNDS = 5;
const HISTORY_TTL_MS = 15 * 60 * 1000;
const HISTORY_MAX = 8;

/** Memória curta da conversa (permite "e ele também me deve 20"). */
const histories = new Map();

export function forgetConversation(userId) {
  histories.delete(userId);
}

function getHistory(userId) {
  const h = histories.get(userId);
  if (!h || Date.now() - h.at > HISTORY_TTL_MS) return [];
  return h.messages;
}

function pushHistory(userId, ...messages) {
  const list = [...getHistory(userId), ...messages].slice(-HISTORY_MAX);
  histories.set(userId, { at: Date.now(), messages: list });
}

export function buildSystemPrompt({ assistantName, user, today, timeZone, ops, spokenLanguage }) {
  const { people, totals, state } = summarize(ops, today);
  const money = (c) => formatMoney(c, user.currency);
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

  const ledger = people.length
    ? people.map((p) => {
        const parts = [];
        if (p.receivable) parts.push(`owes the user ${money(p.receivable)}${p.nextDueIn ? ` (due ${p.nextDueIn})` : ''}`);
        if (p.payable) parts.push(`the user owes them ${money(p.payable)}${p.nextDueOut ? ` (due ${p.nextDueOut})` : ''}`);
        return `- ${p.name}: ${parts.join('; ') || 'settled'} [${p.status}]`;
      }).join('\n')
    : '(empty — no people yet)';

  const recent = [...state.entries.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 15)
    .map((e) => `- id ${e.id.slice(0, 8)} | ${e.date} | ${state.people.get(e.personKey)?.name} | ${e.kind} ${e.direction === 'in' ? 'they_owe_me' : 'i_owe_them'} | ${money(e.amount)}${e.dueDate ? ` | due ${e.dueDate}` : ''}${e.note ? ` | ${e.note}` : ''}`)
    .join('\n');

  const replyLanguage = user.language && user.language !== 'auto'
    ? LANGUAGE_NAMES[user.language] || user.language
    : `the same language the user just spoke${spokenLanguage ? ` (detected: ${spokenLanguage})` : ''}`;

  return `You are ${assistantName}, a friendly voice assistant that keeps a personal ledger of who owes money to ${user.name || 'the user'} and whom ${user.name || 'the user'} owes.
Today is ${weekday}, ${today} (time zone ${timeZone}). Currency: ${user.currency}.
Always reply in ${replyLanguage}.

How to act:
- The user speaks casually and may call you by name ("fala ${assistantName}", "hey ${assistantName}", "opa") — that is just a greeting, not a person.
- Every change MUST go through a tool call. Never say something was saved unless the tool returned ok.
- "X me deve", "coloca o X na lista", "emprestei pro X", "tenho que receber do X" -> add_debt with they_owe_me.
- "eu devo pro X", "peguei emprestado do X" -> add_debt with i_owe_them.
- "desconta", "abate", "X me pagou", "recebi do X" -> register_payment (they_owe_me). "paguei o X" -> register_payment (i_owe_them).
- "tenho que receber até tal dia" -> due_date. Convert relative dates (ontem, amanhã, sexta que vem, dia 10, fim do mês) to YYYY-MM-DD using today's date. A bare day of month that has already passed means next month.
- Amounts in ${user.currency} units: understand slang like "50 conto", "50 pila", "2k", "mil e quinhentos".
- Match names to existing people when it is clearly the same person (first name, accents, small transcription errors).
- If who or how much is missing, ask ONE short question instead of guessing. Do not ask for optional info.
- For balance questions, answer from the ledger below.
- Your reply is spoken aloud: 1-2 short, natural sentences. No markdown, no lists, no emojis. After a change, confirm it and mention the new balance briefly.

Current ledger (totals: to receive ${money(totals.receivable)}, to pay ${money(totals.payable)}):
${ledger}

Most recent entries:
${recent || '(none)'}`;
}

/**
 * @param deps { chat, insertOps, getOps, assistantName }
 * @returns { reply, ops }  ops = novos ops gravados neste turno
 */
export async function runTurn({ user, text, timeZone, today, spokenLanguage }, deps) {
  let ops = deps.getOps(user.id);
  const makeOp = createOpFactory();
  const created = [];

  const messages = [
    { role: 'system', content: buildSystemPrompt({ assistantName: deps.assistantName, user, today, timeZone, ops, spokenLanguage }) },
    ...getHistory(user.id),
    { role: 'user', content: text },
  ];

  let reply = '';
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const msg = await deps.chat(messages, round < MAX_TOOL_ROUNDS ? TOOLS : undefined);
    messages.push({ role: 'assistant', content: msg.content || '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) {
      reply = msg.content || '';
      break;
    }
    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* argumentos inválidos -> ferramenta reporta erro */ }
      const { ops: newOps, result } = executeTool(call.function?.name, args, {
        ops, today, currency: user.currency, makeOp: (type, data) => makeOp(type, data, 'voice'),
      });
      if (newOps.length) {
        deps.insertOps(user.id, newOps);
        ops = [...ops, ...newOps];
        created.push(...newOps);
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  pushHistory(user.id, { role: 'user', content: text }, { role: 'assistant', content: reply });
  return { reply, ops: created };
}

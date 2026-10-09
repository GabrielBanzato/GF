import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, buildCommandPrompt } from '../shared/commands.js';
import { createOpFactory, mergeOps, summarize } from '../shared/ledger.js';

const TODAY = '2026-10-08'; // quinta-feira
let n = 0;
const makeOp = createOpFactory(() => `op-${String(++n).padStart(6, '0')}`);

function run(cmds, language = 'pt') {
  let ops = [];
  const replies = [];
  for (const cmd of cmds) {
    const r = applyCommand(cmd, { ops, today: TODAY, currency: 'BRL', language, makeOp: (t, d) => makeOp(t, d, 'voice') });
    ops = mergeOps(ops, r.ops);
    replies.push(r);
  }
  return { ops, replies };
}

test('"coloca o Fulano na lista, ele me deve 200 até dia 20"', () => {
  const { ops, replies } = run([{ action: 'add_debt', person: 'Fulano', amount: 200, direction: 'they_owe_me', dueDate: '2026-10-20' }]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].data.amount, 20000);
  assert.equal(ops[0].data.dueDate, '2026-10-20');
  assert.match(replies[0].reply, /coloquei Fulano na lista/);
  assert.match(replies[0].reply, /Fulano agora te deve R\$\s?200,00/);
  assert.match(replies[0].reply, /20 de outubro/);
});

test('"desconta 50 do fulano, ele me pagou ontem" e consulta', () => {
  const { ops, replies } = run([
    { action: 'add_debt', person: 'Fulano', amount: 200, direction: 'they_owe_me' },
    { action: 'register_payment', person: 'fulano', amount: 50, date: '2026-10-07' },
    { action: 'query', person: 'Fulano' },
  ]);
  assert.equal(summarize(ops, TODAY).people[0].receivable, 15000);
  assert.equal(ops[1].data.date, '2026-10-07');
  assert.match(replies[1].reply, /descontei R\$\s?50,00\. Fulano ainda te deve R\$\s?150,00/);
  assert.match(replies[2].reply, /Fulano te deve R\$\s?150,00/);
});

test('pagamento que quita tudo', () => {
  const { replies } = run([
    { action: 'add_debt', person: 'Ana', amount: 30, direction: 'they_owe_me' },
    { action: 'register_payment', person: 'Ana', amount: 30 },
  ]);
  assert.match(replies[1].reply, /tudo quitado com Ana/);
});

test('falta informação -> pergunta, sem alterar nada', () => {
  const { ops, replies } = run([
    { action: 'add_debt', person: 'João', amount: 0, direction: 'they_owe_me' },
    { action: 'add_debt', person: '', amount: 10 },
    { action: 'register_payment', person: 'Ninguém', amount: 10 },
    { action: 'clarify', reply: 'Quanto o João te deve?' },
  ]);
  assert.equal(ops.length, 0);
  assert.deepEqual(replies.map((r) => r.ask), [true, true, true, true]);
  assert.equal(replies[0].reply, 'Qual é o valor?');
  assert.match(replies[2].reply, /Não achei ninguém chamado Ninguém/);
  assert.equal(replies[3].reply, 'Quanto o João te deve?');
});

test('apagar o último, renomear, remover e totais', () => {
  const { ops, replies } = run([
    { action: 'add_debt', person: 'Carlos', amount: 80, direction: 'they_owe_me' },
    { action: 'add_debt', person: 'Bia', amount: 20, direction: 'i_owe_them' },
    { action: 'delete_last' },
    { action: 'rename_person', person: 'carlos', newName: 'Carlos Silva' },
    { action: 'query' },
    { action: 'remove_person', person: 'Carlos Silva' },
  ]);
  assert.match(replies[2].reply, /Apaguei o último lançamento de Bia/);
  assert.match(replies[3].reply, /Carlos agora se chama Carlos Silva/);
  assert.match(replies[4].reply, /R\$\s?80,00 a receber e R\$\s?0,00 a pagar/);
  assert.equal(summarize(ops, TODAY).people.length, 0);
});

test('respostas em inglês e ação desconhecida', () => {
  const { replies } = run([
    { action: 'add_debt', person: 'Maria', amount: 30, direction: 'i_owe_them' },
    { action: 'banana' },
  ], 'en');
  assert.match(replies[0].reply, /You owe Maria R\$\s?30\.00/);
  assert.equal(replies[1].reply, "I didn't get that. Could you say it another way?");
});

test('prompt traz calendário pronto e saldos', () => {
  const { ops } = run([{ action: 'add_debt', person: 'Fulano', amount: 200, direction: 'they_owe_me' }]);
  const prompt = buildCommandPrompt({ text: 'ele me pagou ontem', ops, today: TODAY, currency: 'BRL' });
  assert.match(prompt, /yesterday=2026-10-07/);
  assert.match(prompt, /next friday=2026-10-09/);
  assert.match(prompt, /Fulano \(owes the user R\$200\.00\)/);
  assert.match(prompt, /The user said: "ele me pagou ontem"/);
});

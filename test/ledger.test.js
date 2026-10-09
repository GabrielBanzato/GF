import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OP, replay, summarize, mergeOps, findPerson, toCents, createOpFactory, sanitizeOp } from '../shared/ledger.js';
import { executeTool } from '../shared/tools.js';

const TODAY = '2026-10-08';
let n = 0;
const make = createOpFactory(() => `op-${String(++n).padStart(6, '0')}`);

test('toCents aceita vírgula e ponto', () => {
  assert.equal(toCents('12,5'), 1250);
  assert.equal(toCents(99.99), 9999);
  assert.ok(Number.isNaN(toCents('abc')));
});

test('dívida + pagamento: saldo e vencimento (FIFO)', () => {
  const ops = [
    make(OP.DEBT_ADD, { person: 'João', amount: 10000, direction: 'in', date: '2026-09-01', dueDate: '2026-09-30' }),
    make(OP.DEBT_ADD, { person: 'joao', amount: 5000, direction: 'in', date: '2026-10-01', dueDate: '2026-10-20' }),
    make(OP.PAYMENT_ADD, { person: 'JOÃO', amount: 10000, direction: 'in', date: '2026-10-07' }),
  ];
  const [p] = summarize(ops, TODAY).people;
  assert.equal(p.name, 'João');
  assert.equal(p.receivable, 5000);
  assert.equal(p.nextDueIn, '2026-10-20'); // a primeira dívida já foi quitada
  assert.equal(p.status, 'open');
});

test('dívida vencida fica como atrasada', () => {
  const ops = [make(OP.DEBT_ADD, { person: 'Ana', amount: 3000, direction: 'in', dueDate: '2026-10-01' })];
  assert.equal(summarize(ops, TODAY).people[0].status, 'overdue');
});

test('merge une históricos offline e online sem perder nada', () => {
  const base = [make(OP.DEBT_ADD, { person: 'Bia', amount: 20000, direction: 'in' })];
  const online = [...base, make(OP.PAYMENT_ADD, { person: 'Bia', amount: 5000, direction: 'in' })];
  const offline = [...base, make(OP.PAYMENT_ADD, { person: 'Bia', amount: 3000, direction: 'in' })];
  const merged = mergeOps(online, offline);
  assert.equal(merged.length, 3);
  assert.equal(summarize(merged, TODAY).people[0].receivable, 12000);
  assert.deepEqual(mergeOps(offline, online), merged); // ordem determinística
});

test('remover lançamento, renomear e apagar pessoa', () => {
  const debt = make(OP.DEBT_ADD, { person: 'Carlos', amount: 1000, direction: 'out' });
  const ops = [
    debt,
    make(OP.DEBT_ADD, { person: 'Carlos', amount: 2000, direction: 'out' }),
    make(OP.ENTRY_DELETE, { entryId: debt.id }),
    make(OP.PERSON_RENAME, { from: 'carlos', to: 'Carlos Silva' }),
  ];
  const s = replay(ops);
  assert.equal(s.entries.size, 1);
  assert.equal(findPerson(s, 'carlos silva').name, 'Carlos Silva');
  assert.equal(summarize(ops, TODAY).people[0].payable, 2000);
  const gone = replay([...ops, make(OP.PERSON_DELETE, { person: 'Carlos Silva' })]);
  assert.equal(gone.people.size, 0);
});

test('findPerson tolera primeiro nome e erro de transcrição', () => {
  const s = replay([make(OP.DEBT_ADD, { person: 'Fernanda Lima', amount: 100, direction: 'in' })]);
  assert.equal(findPerson(s, 'fernanda')?.name, 'Fernanda Lima');
  assert.equal(findPerson(s, 'Fernanda Lina')?.name, 'Fernanda Lima');
  assert.equal(findPerson(s, 'Paulo'), null);
});

test('sanitizeOp rejeita lixo', () => {
  assert.equal(sanitizeOp({ id: 'x', ts: 'now', type: 'hack' }), null);
  assert.ok(sanitizeOp({ id: 'abcdefgh-1', ts: new Date().toISOString(), type: OP.DEBT_ADD, data: {}, source: 'offline' }));
});

test('ferramentas: "coloca o fulano na lista, ele me deve 150 até dia 20"', () => {
  const ctx = { ops: [], today: TODAY, currency: 'BRL', makeOp: (t, d) => make(t, d, 'voice') };
  const r1 = executeTool('add_debt', { person: 'Fulano', amount: 150, direction: 'they_owe_me', due_date: '2026-10-20' }, ctx);
  assert.equal(r1.result.ok, true);
  assert.equal(r1.result.new_person, true);
  ctx.ops = r1.ops;

  // "desconta 50 da conta do fulano, ele me pagou ontem"
  const r2 = executeTool('register_payment', { person: 'fulano', amount: 50, date: '2026-10-07' }, ctx);
  assert.equal(r2.result.ok, true);
  assert.equal(r2.ops[0].data.direction, 'in'); // inferido pelo saldo
  assert.match(r2.result.balance_now.they_owe_me, /100,00/);

  const r3 = executeTool('register_payment', { person: 'Ciclano', amount: 10 }, ctx);
  assert.equal(r3.result.ok, false);
  assert.equal(r3.ops.length, 0);

  const r4 = executeTool('add_debt', { person: 'Fulano', amount: -5, direction: 'they_owe_me' }, ctx);
  assert.equal(r4.result.ok, false);
});

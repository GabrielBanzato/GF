import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { OP, createOpFactory, mergeOps, summarize } from '../shared/ledger.js';

let server, base, dataDir, db;
const sentEmails = [];

// IA simulada: na 1ª chamada pede a ferramenta add_debt, na 2ª responde.
const fakeAi = {
  config: () => ({ enabled: true, asrModel: '', ttsModel: '' }),
  transcribe: async () => ({ text: '', language: null }),
  speak: async () => null,
  chat: async (messages) => {
    const last = messages.at(-1);
    if (last.role === 'user') {
      return {
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add_debt', arguments: JSON.stringify({ person: 'Fulano', amount: 200, direction: 'they_owe_me', due_date: '2026-11-10' }) } }],
      };
    }
    const result = JSON.parse(last.content);
    return { content: result.ok ? `Pronto, o Fulano te deve ${result.balance_now.they_owe_me}.` : 'Erro.' };
  },
};

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'midas-'));
  db = openDb(':memory:');
  const app = createApp({ db, dataDir, ai: fakeAi, sendEmail: async (msg) => { sentEmails.push(msg); } });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const call = async (method, path, token, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Timezone': 'America/Sao_Paulo', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.arrayBuffer() };
};

test('login: cadastro, entrar, sair, trocar e recuperar senha', async () => {
  const reg = { name: 'Ana', email: 'Ana@Example.com', password: 'senha-forte-1' };
  assert.equal((await call('POST', '/api/auth/register', null, { ...reg, password: '123' })).body.error, 'weak_password');
  assert.equal((await call('POST', '/api/auth/register', null, { ...reg, email: 'x' })).body.error, 'invalid_email');
  const created = await call('POST', '/api/auth/register', null, reg);
  assert.equal(created.status, 201);
  assert.equal(created.body.profile.email, 'ana@example.com');
  assert.equal((await call('POST', '/api/auth/register', null, reg)).status, 409);

  // Senha errada / e-mail inexistente dão o mesmo erro
  assert.equal((await call('POST', '/api/auth/login', null, { email: 'ana@example.com', password: 'errada' })).body.error, 'invalid_credentials');
  assert.equal((await call('POST', '/api/auth/login', null, { email: 'ninguem@example.com', password: 'errada' })).body.error, 'invalid_credentials');

  // Segundo aparelho
  const phone2 = await call('POST', '/api/auth/login', null, { email: ' ANA@example.com ', password: reg.password });
  assert.equal(phone2.status, 200);
  const t1 = created.body.token;
  const t2 = phone2.body.token;
  assert.equal((await call('GET', '/api/account', t2)).status, 200);

  // Trocar senha derruba os outros aparelhos
  assert.equal((await call('POST', '/api/account/password', t1, { currentPassword: 'errada', newPassword: 'nova-senha-123' })).status, 401);
  assert.equal((await call('POST', '/api/account/password', t1, { currentPassword: reg.password, newPassword: 'nova-senha-123' })).status, 204);
  assert.equal((await call('GET', '/api/account', t1)).status, 200);
  assert.equal((await call('GET', '/api/account', t2)).status, 401);

  // Sair
  assert.equal((await call('POST', '/api/auth/logout', t1)).status, 204);
  assert.equal((await call('GET', '/api/account', t1)).status, 401);

  // Esqueci minha senha
  assert.equal((await call('POST', '/api/auth/forgot', null, { email: 'naoexiste@example.com' })).status, 204);
  assert.equal(sentEmails.length, 0);
  assert.equal((await call('POST', '/api/auth/forgot', null, { email: 'ana@example.com' })).status, 204);
  const { code } = sentEmails.at(-1);
  assert.match(code, /^\d{6}$/);
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await call('POST', '/api/auth/reset', null, { email: 'ana@example.com', code: wrong, password: 'outra-senha-1' })).body.error, 'invalid_code');
  const reset = await call('POST', '/api/auth/reset', null, { email: 'ana@example.com', code, password: 'outra-senha-1' });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.token);
  // código só vale uma vez
  assert.equal((await call('POST', '/api/auth/reset', null, { email: 'ana@example.com', code, password: 'outra-senha-2' })).status, 400);
  assert.equal((await call('POST', '/api/auth/login', null, { email: 'ana@example.com', password: 'outra-senha-1' })).status, 200);
});

test('login: bloqueia após muitas tentativas erradas', async () => {
  await call('POST', '/api/auth/register', null, { name: 'Bob', email: 'bob@example.com', password: 'senha-do-bob' });
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/auth/login', null, { email: 'bob@example.com', password: `chute-${i}` });
  assert.equal(last.status, 429);
});

test('fluxo completo: voz, sync offline, planilha, deletar conta', async () => {
  const created = await call('POST', '/api/auth/register', null, { name: 'Gabriel', email: 'g@example.com', password: 'senha-segura', currency: 'BRL' });
  assert.equal(created.status, 201);
  const { token } = created.body;

  assert.equal((await call('GET', '/api/account', 'wrong')).status, 401);

  // Comando por voz (texto já transcrito): vira um pedido em segundo plano
  const started = await call('POST', '/api/turn', token, { text: 'fala Midas, coloca o Fulano na lista, ele me deve 200 e tenho que receber até dia 10' });
  assert.equal(started.status, 202);
  assert.ok(started.body.jobId);
  let turn;
  do {
    await new Promise((r) => setTimeout(r, 20));
    turn = await call('GET', `/api/turn/${started.body.jobId}`, token);
  } while (!['done', 'error'].includes(turn.body.status));
  assert.equal(turn.body.status, 'done');
  assert.equal((await call('GET', `/api/turn/${started.body.jobId}`, 'outro-token')).status, 401);
  assert.equal(turn.body.ops.length, 1);
  assert.match(turn.body.reply, /200,00/);

  // Aparelho estava offline e registrou um pagamento manual
  const make = createOpFactory();
  let local = [...turn.body.ops];
  const offlineOp = make(OP.PAYMENT_ADD, { person: 'Fulano', amount: 5000, direction: 'in', date: '2026-10-07' }, 'offline');
  local = mergeOps(local, [offlineOp]);

  const sync = await call('POST', '/api/sync', token, { ops: [offlineOp], since: turn.body.cursor });
  assert.equal(sync.status, 200);
  assert.deepEqual(sync.body.accepted, [offlineOp.id]);
  local = mergeOps(local, sync.body.ops);
  assert.equal(summarize(local, '2026-10-08').people[0].receivable, 15000);

  // Outro aparelho entrando na mesma conta recebe tudo
  const other = await call('POST', '/api/auth/login', null, { email: 'g@example.com', password: 'senha-segura' });
  const fresh = await call('POST', '/api/sync', other.body.token, { ops: [], since: 0 });
  assert.equal(fresh.body.ops.length, 2);

  // Reenviar o mesmo op não duplica
  const again = await call('POST', '/api/sync', token, { ops: [offlineOp], since: 0 });
  assert.equal(again.body.ops.length, 2);

  // Cliente à frente do servidor (servidor restaurado) -> reset
  const ahead = await call('POST', '/api/sync', token, { ops: [], since: 9999 });
  assert.equal(ahead.body.reset, true);

  // Planilha gerada no servidor
  const sheet = await call('GET', '/api/spreadsheet', token);
  assert.equal(sheet.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(sheet.body);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumo', 'Lançamentos', 'Histórico']);
  assert.equal(wb.getWorksheet('Resumo').getCell('A4').value, 'Fulano');
  assert.equal(wb.getWorksheet('Resumo').getCell('B4').value, 150);

  // Configurações
  const patched = await call('PATCH', '/api/account', token, { currency: 'USD', language: 'en' });
  assert.equal(patched.body.profile.currency, 'USD');
  assert.equal(patched.body.profile.voice, undefined);
  assert.equal((await call('PATCH', '/api/account', token, { email: 'invalido' })).status, 400);
  assert.equal((await call('PATCH', '/api/account', token, { email: 'ana@example.com' })).status, 409);

  // Deletar conta exige confirmação escrita
  assert.equal((await call('DELETE', '/api/account', token, { confirmation: 'sim' })).status, 400);
  assert.equal((await call('DELETE', '/api/account', token, { confirmation: 'deletar' })).status, 204);
  assert.equal((await call('GET', '/api/account', token)).status, 401);
  assert.equal((await call('GET', '/api/account', other.body.token)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', null, { email: 'g@example.com', password: 'senha-segura' })).status, 401);
});

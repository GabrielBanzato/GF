// Gera a planilha "Controle Financeiro" (.xlsx). Usado no servidor (Node) e no
// aparelho (navegador/app), recebendo a biblioteca ExcelJS como parâmetro.

import { summarize, OP, formatMoney } from './ledger.js';

const LABELS = {
  pt: {
    title: 'Controle Financeiro', updated: 'Atualizado em', currency: 'Moeda',
    summary: 'Resumo', entries: 'Lançamentos', history: 'Histórico',
    person: 'Pessoa', receivable: 'A receber', payable: 'A pagar', net: 'Saldo', nextDue: 'Próximo vencimento', status: 'Situação',
    total: 'Total', date: 'Data', type: 'Tipo', amount: 'Valor', dueDate: 'Vencimento', note: 'Observação', source: 'Origem',
    when: 'Data/hora', action: 'Ação', details: 'Detalhes',
    status_overdue: 'Atrasado', status_open: 'Em aberto', status_settled: 'Quitado',
    debt_in: 'Me deve', debt_out: 'Eu devo', payment_in: 'Recebi', payment_out: 'Paguei',
    src_voice: 'Voz', src_manual: 'Manual', src_offline: 'Offline',
    [OP.DEBT_ADD]: 'Dívida registrada', [OP.PAYMENT_ADD]: 'Pagamento registrado', [OP.ENTRY_UPDATE]: 'Lançamento alterado',
    [OP.ENTRY_DELETE]: 'Lançamento removido', [OP.PERSON_RENAME]: 'Pessoa renomeada', [OP.PERSON_DELETE]: 'Pessoa removida',
  },
  en: {
    title: 'Financial Control', updated: 'Updated at', currency: 'Currency',
    summary: 'Summary', entries: 'Entries', history: 'Change log',
    person: 'Person', receivable: 'To receive', payable: 'To pay', net: 'Balance', nextDue: 'Next due date', status: 'Status',
    total: 'Total', date: 'Date', type: 'Type', amount: 'Amount', dueDate: 'Due date', note: 'Note', source: 'Source',
    when: 'Date/time', action: 'Action', details: 'Details',
    status_overdue: 'Overdue', status_open: 'Open', status_settled: 'Settled',
    debt_in: 'Owes me', debt_out: 'I owe', payment_in: 'Received', payment_out: 'Paid',
    src_voice: 'Voice', src_manual: 'Manual', src_offline: 'Offline',
    [OP.DEBT_ADD]: 'Debt added', [OP.PAYMENT_ADD]: 'Payment added', [OP.ENTRY_UPDATE]: 'Entry changed',
    [OP.ENTRY_DELETE]: 'Entry removed', [OP.PERSON_RENAME]: 'Person renamed', [OP.PERSON_DELETE]: 'Person removed',
  },
  es: {
    title: 'Control Financiero', updated: 'Actualizado el', currency: 'Moneda',
    summary: 'Resumen', entries: 'Movimientos', history: 'Historial',
    person: 'Persona', receivable: 'Por cobrar', payable: 'Por pagar', net: 'Saldo', nextDue: 'Próximo vencimiento', status: 'Estado',
    total: 'Total', date: 'Fecha', type: 'Tipo', amount: 'Importe', dueDate: 'Vencimiento', note: 'Nota', source: 'Origen',
    when: 'Fecha/hora', action: 'Acción', details: 'Detalles',
    status_overdue: 'Atrasado', status_open: 'Pendiente', status_settled: 'Saldado',
    debt_in: 'Me debe', debt_out: 'Le debo', payment_in: 'Cobré', payment_out: 'Pagué',
    src_voice: 'Voz', src_manual: 'Manual', src_offline: 'Sin conexión',
    [OP.DEBT_ADD]: 'Deuda registrada', [OP.PAYMENT_ADD]: 'Pago registrado', [OP.ENTRY_UPDATE]: 'Movimiento modificado',
    [OP.ENTRY_DELETE]: 'Movimiento eliminado', [OP.PERSON_RENAME]: 'Persona renombrada', [OP.PERSON_DELETE]: 'Persona eliminada',
  },
};

const SYMBOLS = { BRL: 'R$', USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', ARS: '$', MXN: '$', CLP: '$', COP: '$', CAD: 'C$', AUD: 'A$', CHF: 'CHF' };
const NO_DECIMALS = new Set(['JPY', 'CLP']);

const COLORS = {
  ink: 'FF1F2328', muted: 'FF6B7280', header: 'FF111827', headerText: 'FFFFFFFF', line: 'FFE5E7EB', zebra: 'FFF9FAFB',
  overdue: 'FFFDE2E1', open: 'FFFFF4D6', settled: 'FFE3F5E8', pos: 'FF13795B', neg: 'FFB42318',
};

export function labelsFor(language) {
  const lang = String(language || 'pt').slice(0, 2);
  return LABELS[lang] || LABELS.en;
}

function moneyFormat(currency) {
  const sym = SYMBOLS[currency] || currency;
  const num = NO_DECIMALS.has(currency) ? '#,##0' : '#,##0.00';
  return `"${sym}" ${num};[Red]-"${sym}" ${num}`;
}

const asDate = (s) => (s ? new Date(`${s}T12:00:00Z`) : null);

function styleHeader(row) {
  row.height = 22;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: COLORS.headerText } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    c.alignment = { vertical: 'middle' };
  });
}

function addTitle(ws, text, subtitle, width) {
  ws.mergeCells(1, 1, 1, width);
  ws.mergeCells(2, 1, 2, width);
  ws.getCell(1, 1).value = text;
  ws.getCell(1, 1).font = { bold: true, size: 16, color: { argb: COLORS.ink } };
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = { size: 10, color: { argb: COLORS.muted } };
  ws.getRow(1).height = 26;
}

/**
 * @param ExcelJS  módulo/global da ExcelJS
 * @param opts { ops, profile: {name, currency, language}, today, assistantName }
 * @returns Promise<ArrayBuffer|Buffer>
 */
export async function buildWorkbook(ExcelJS, { ops, profile = {}, today, assistantName = 'Zeni' }) {
  const L = labelsFor(profile.language === 'auto' ? 'pt' : profile.language);
  const currency = profile.currency || 'BRL';
  const fmt = moneyFormat(currency);
  const { people, totals, state } = summarize(ops, today);
  const now = new Date();

  const wb = new ExcelJS.Workbook();
  wb.creator = assistantName;
  wb.created = now;
  wb.modified = now;
  const subtitle = `${profile.name ? profile.name + ' · ' : ''}${L.updated} ${now.toLocaleString()} · ${L.currency}: ${currency}`;

  // --- Resumo -----------------------------------------------------------
  const sum = wb.addWorksheet(L.summary, { views: [{ state: 'frozen', ySplit: 3 }] });
  sum.columns = [{ width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 14 }];
  addTitle(sum, `${L.title} — ${assistantName}`, subtitle, 6);
  const sh = sum.addRow([L.person, L.receivable, L.payable, L.net, L.nextDue, L.status]);
  styleHeader(sh);
  people.forEach((p) => {
    const next = [p.nextDueIn, p.nextDueOut].filter(Boolean).sort()[0] || null;
    const row = sum.addRow([p.name, p.receivable / 100, p.payable / 100, p.net / 100, asDate(next), L[`status_${p.status}`]]);
    [2, 3, 4].forEach((i) => (row.getCell(i).numFmt = fmt));
    row.getCell(5).numFmt = 'dd/mm/yyyy';
    row.getCell(4).font = { bold: true, color: { argb: p.net > 0 ? COLORS.pos : p.net < 0 ? COLORS.neg : COLORS.ink } };
    row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS[p.status] } };
    row.eachCell({ includeEmpty: true }, (c) => (c.border = { bottom: { style: 'thin', color: { argb: COLORS.line } } }));
  });
  const tr = sum.addRow([L.total, totals.receivable / 100, totals.payable / 100, totals.net / 100]);
  tr.font = { bold: true };
  [2, 3, 4].forEach((i) => (tr.getCell(i).numFmt = fmt));
  tr.eachCell((c) => (c.border = { top: { style: 'medium', color: { argb: COLORS.ink } } }));
  if (people.length) sum.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + people.length, column: 6 } };

  // --- Lançamentos ------------------------------------------------------
  const ent = wb.addWorksheet(L.entries, { views: [{ state: 'frozen', ySplit: 3 }] });
  ent.columns = [{ width: 12 }, { width: 26 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 40 }, { width: 11 }];
  addTitle(ent, L.entries, subtitle, 7);
  styleHeader(ent.addRow([L.date, L.person, L.type, L.amount, L.dueDate, L.note, L.source]));
  const allEntries = [...state.entries.values()].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  allEntries.forEach((e, i) => {
    const signed = (e.kind === 'debt') === (e.direction === 'in') ? e.amount : -e.amount;
    const row = ent.addRow([asDate(e.date), state.people.get(e.personKey)?.name || '', L[`${e.kind}_${e.direction}`], signed / 100, asDate(e.dueDate), e.note, L[`src_${e.source}`] || e.source]);
    row.getCell(1).numFmt = 'dd/mm/yyyy';
    row.getCell(5).numFmt = 'dd/mm/yyyy';
    row.getCell(4).numFmt = fmt;
    if (i % 2) row.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebra } }));
  });
  if (allEntries.length) ent.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + allEntries.length, column: 7 } };

  // --- Histórico (todas as alterações, inclusive remoções) ---------------
  const hist = wb.addWorksheet(L.history, { views: [{ state: 'frozen', ySplit: 3 }] });
  hist.columns = [{ width: 20 }, { width: 24 }, { width: 60 }, { width: 11 }, { width: 38 }];
  addTitle(hist, L.history, subtitle, 5);
  styleHeader(hist.addRow([L.when, L.action, L.details, L.source, 'ID']));
  [...ops].sort((a, b) => (a.ts < b.ts ? 1 : -1)).forEach((op) => {
    const row = hist.addRow([new Date(op.ts), L[op.type] || op.type, describeOp(op, currency, L), L[`src_${op.source}`] || op.source, op.id]);
    row.getCell(1).numFmt = 'dd/mm/yyyy hh:mm';
    row.getCell(5).font = { color: { argb: COLORS.muted }, size: 9 };
  });

  return wb.xlsx.writeBuffer();
}

function describeOp(op, currency, L) {
  const d = op.data || {};
  const money = (c) => formatMoney(c, currency);
  switch (op.type) {
    case OP.DEBT_ADD:
      return `${d.person}: ${L[`debt_${d.direction === 'out' ? 'out' : 'in'}`]} ${money(d.amount)}${d.dueDate ? ` · ${L.dueDate} ${d.dueDate}` : ''}${d.note ? ` · ${d.note}` : ''}`;
    case OP.PAYMENT_ADD:
      return `${d.person}: ${L[`payment_${d.direction === 'out' ? 'out' : 'in'}`]} ${money(d.amount)}${d.date ? ` · ${d.date}` : ''}${d.note ? ` · ${d.note}` : ''}`;
    case OP.ENTRY_UPDATE:
      return `${d.entryId}: ${Object.entries(d.fields || {}).map(([k, v]) => `${k}=${k === 'amount' ? money(v) : v}`).join(', ')}`;
    case OP.ENTRY_DELETE:
      return `${d.entryId}${d.summary ? ` · ${d.summary}` : ''}`;
    case OP.PERSON_RENAME:
      return `${d.from} → ${d.to}`;
    case OP.PERSON_DELETE:
      return d.person;
    default:
      return JSON.stringify(d);
  }
}

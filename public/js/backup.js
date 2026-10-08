// Backup local da planilha: a cada alteração o .xlsx é regerado no próprio
// aparelho e SOBRESCREVE o anterior (um único arquivo, sempre o mais recente).
//  - No navegador/PWA: guardado no IndexedDB.
//  - No app iOS (Capacitor): também gravado em Documentos/Zeni/controle-financeiro.xlsx,
//    visível no app Arquivos do iPhone.

import { buildWorkbook } from '/shared/spreadsheet.js';
import { todayIn } from '/shared/ledger.js';
import { store } from './store.js';

export const BACKUP_FILENAME = 'controle-financeiro.xlsx';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let excelPromise;
function loadExcel() {
  excelPromise ??= new Promise((resolve, reject) => {
    if (window.ExcelJS) return resolve(window.ExcelJS);
    const s = document.createElement('script');
    s.src = '/vendor/exceljs.min.js';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { excelPromise = null; reject(new Error('exceljs')); };
    document.head.append(s);
  });
  return excelPromise;
}

const toBase64 = (buf) => {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export async function saveBackup({ ops, profile, assistantName }) {
  const ExcelJS = await loadExcel();
  const buf = await buildWorkbook(ExcelJS, { ops, profile, today: todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone), assistantName });
  const blob = new Blob([buf], { type: MIME });
  const at = new Date().toISOString();
  await store.set('backup.xlsx', blob);
  await store.set('backupAt', at);

  const fs = window.Capacitor?.Plugins?.Filesystem;
  if (fs) {
    await fs.writeFile({ path: `Zeni/${BACKUP_FILENAME}`, data: toBase64(buf), directory: 'DOCUMENTS', recursive: true });
  }
  return at;
}

export async function exportBackup() {
  const blob = await store.get('backup.xlsx');
  if (!blob) return false;
  const file = new File([blob], BACKUP_FILENAME, { type: MIME });
  // iOS: a folha de compartilhamento permite "Salvar em Arquivos", AirDrop, etc.
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch (err) { if (err.name === 'AbortError') return true; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: BACKUP_FILENAME });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

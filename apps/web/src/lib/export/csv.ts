import { downloadBlob } from './download';
import { displayCell, headerRow, totalsRow } from './matrix';
import type { ExportDataset } from './types';

function esc(cell: string | number): string {
  const s = String(cell ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Construye el CSV (con BOM para que Excel respete los acentos). */
export function buildCsv<T>(ds: ExportDataset<T>): string {
  const lines: string[] = [];
  if (ds.meta?.length) {
    for (const m of ds.meta) lines.push(esc(`${m.label}: ${m.value}`));
    lines.push('');
  }
  lines.push(headerRow(ds).map(esc).join(','));
  for (const row of ds.rows) {
    lines.push(ds.columns.map((c) => esc(displayCell(c, row))).join(','));
  }
  if (ds.totals && ds.rows.length) {
    lines.push(totalsRow(ds, 'display').map(esc).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

export function exportCsv<T>(ds: ExportDataset<T>): void {
  const blob = new Blob([buildCsv(ds)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `${ds.filename}.csv`);
}

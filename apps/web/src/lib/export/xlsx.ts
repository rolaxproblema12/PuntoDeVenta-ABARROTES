import { downloadBlob } from './download';
import { headerRow, rawCell, totalsRow } from './matrix';
import type { ExportDataset } from './types';

function sheetAoa<T>(ds: ExportDataset<T>): (string | number)[][] {
  const aoa: (string | number)[][] = [];
  if (ds.meta?.length) {
    for (const m of ds.meta) aoa.push([`${m.label}:`, m.value]);
    aoa.push([]);
  }
  aoa.push(headerRow(ds));
  for (const row of ds.rows) aoa.push(ds.columns.map((c) => rawCell(c, row)));
  if (ds.totals && ds.rows.length) aoa.push(totalsRow(ds, 'raw'));
  return aoa;
}

/** Exporta uno o varios datasets como libro Excel (una hoja por dataset). */
export async function exportXlsx(
  datasets: ExportDataset[],
  filename: string,
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  datasets.forEach((ds, idx) => {
    const ws = XLSX.utils.aoa_to_sheet(sheetAoa(ds));
    let name = (ds.title.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Hoja') ;
    while (used.has(name)) name = `${name.slice(0, 26)}_${idx}`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  downloadBlob(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${filename}.xlsx`,
  );
}

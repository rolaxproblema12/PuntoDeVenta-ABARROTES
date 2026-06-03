import { exportCsv } from './csv';
import { exportPdf } from './pdf';
import { exportXlsx } from './xlsx';
import type { ExportDataset, ExportFormat } from './types';

export * from './types';
export { stamp } from './download';

/**
 * Exporta uno o varios datasets en el formato dado. Las librerías pesadas
 * (xlsx/jspdf) se cargan con import() dinámico → fuera del bundle inicial.
 */
export async function exportDatasets(
  datasets: ExportDataset[],
  format: ExportFormat,
  opts: { filename?: string; business?: string } = {},
): Promise<void> {
  const list = datasets.filter((d) => d && d.rows.length >= 0);
  if (list.length === 0) return;
  const filename = opts.filename ?? list[0]!.filename;

  if (format === 'csv') {
    // El CSV es una sola tabla por archivo: si hay varios, descarga uno por uno.
    list.forEach((d) => exportCsv(d));
    return;
  }
  if (format === 'xlsx') return exportXlsx(list, filename);
  return exportPdf(list, filename, opts.business);
}

export function exportDataset(
  ds: ExportDataset,
  format: ExportFormat,
  business?: string,
): Promise<void> {
  return exportDatasets([ds], format, { filename: ds.filename, business });
}

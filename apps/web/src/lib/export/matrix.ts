import { formatMoney, fromCents } from '@abarrotes/shared';
import type { ExportColumn, ExportDataset } from './types';

/** Encabezado de columnas. */
export function headerRow<T>(ds: ExportDataset<T>): string[] {
  return ds.columns.map((c) => c.header);
}

/** Celda legible (CSV/PDF): dinero formateado, resto como texto. */
export function displayCell<T>(col: ExportColumn<T>, row: T): string {
  const v = col.value(row);
  if (v === null || v === undefined || v === '') return '';
  if (col.money) return formatMoney(Number(v));
  return String(v);
}

/** Celda cruda (Excel): número real donde aplique (sumable en la hoja). */
export function rawCell<T>(col: ExportColumn<T>, row: T): string | number {
  const v = col.value(row);
  if (v === null || v === undefined || v === '') return '';
  if (col.money) return fromCents(Number(v));
  if (col.number) return Number(v);
  return String(v);
}

/** Fila de totales: suma columnas money/number. `mode` define el tipo de celda. */
export function totalsRow<T>(
  ds: ExportDataset<T>,
  mode: 'display' | 'raw',
): (string | number)[] {
  return ds.columns.map((col, i) => {
    if (i === 0) return 'TOTAL';
    if (col.money || col.number) {
      const sum = ds.rows.reduce((a, r) => {
        const v = col.value(r);
        return a + (v === null || v === undefined || v === '' ? 0 : Number(v));
      }, 0);
      if (col.money) return mode === 'display' ? formatMoney(sum) : fromCents(sum);
      return sum;
    }
    return '';
  });
}

export function isRightAligned<T>(col: ExportColumn<T>): boolean {
  return !!(col.money || col.number);
}

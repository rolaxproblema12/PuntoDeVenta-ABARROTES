/** Modelo de datos para exportar a Excel / CSV / PDF. */

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

export interface ExportColumn<T = any> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** value devuelve centavos → Excel numérico en pesos; CSV/PDF con formatMoney. */
  money?: boolean;
  /** value es numérico simple (cantidades) → alineado a la derecha. */
  number?: boolean;
}

export interface ExportMetaLine {
  label: string;
  value: string;
}

export interface ExportDataset<T = any> {
  /** Título legible y nombre de hoja en Excel. */
  title: string;
  /** Nombre base del archivo (sin extensión). */
  filename: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Líneas de encabezado (negocio, periodo, fecha de generación). */
  meta?: ExportMetaLine[];
  /** Agrega una fila de totales sumando columnas money/number. */
  totals?: boolean;
}

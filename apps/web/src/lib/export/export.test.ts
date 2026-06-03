import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv';
import { displayCell, rawCell, totalsRow } from './matrix';
import type { ExportDataset } from './types';

interface Row {
  name: string;
  qty: number;
  total: number; // centavos
}

const ds: ExportDataset<Row> = {
  title: 'Ventas',
  filename: 'ventas',
  totals: true,
  columns: [
    { header: 'Producto', value: (r) => r.name },
    { header: 'Cant.', value: (r) => r.qty, number: true },
    { header: 'Total', value: (r) => r.total, money: true },
  ],
  rows: [
    { name: 'Coca, 600ml', qty: 2, total: 3600 },
    { name: 'Sabritas "grande"', qty: 1, total: 1800 },
  ],
};

describe('matrix', () => {
  it('displayCell formatea dinero desde centavos', () => {
    expect(displayCell(ds.columns[2]!, ds.rows[0]!)).toContain('36');
    expect(displayCell(ds.columns[0]!, ds.rows[0]!)).toBe('Coca, 600ml');
  });

  it('rawCell devuelve pesos numéricos para Excel', () => {
    expect(rawCell(ds.columns[2]!, ds.rows[0]!)).toBe(36);
    expect(rawCell(ds.columns[1]!, ds.rows[0]!)).toBe(2);
  });

  it('totalsRow suma money y number', () => {
    const raw = totalsRow(ds, 'raw');
    expect(raw[0]).toBe('TOTAL');
    expect(raw[1]).toBe(3); // 2 + 1
    expect(raw[2]).toBe(54); // (3600 + 1800) / 100
  });
});

describe('buildCsv', () => {
  const csv = buildCsv(ds);

  it('inicia con BOM', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('escapa comas y comillas (RFC-4180)', () => {
    expect(csv).toContain('"Coca, 600ml"');
    expect(csv).toContain('"Sabritas ""grande"""');
  });

  it('incluye encabezado y fila de totales', () => {
    expect(csv).toContain('Producto,Cant.,Total');
    expect(csv).toContain('TOTAL');
  });
});

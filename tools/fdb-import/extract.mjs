#!/usr/bin/env node
// @ts-check
/**
 * Conversor local: lee la base de datos Firebird 1.5 de "Abarrotes Punto de Venta"
 * (pdvdata.fdb, ODS 10) y exporta la mercancía a un CSV/JSON normalizado que el
 * importador de la web puede consumir.
 *
 * Producción es serverless (Vercel/Supabase) y NO puede parsear un .fdb, así que
 * la lectura del archivo Firebird se hace aquí, en la máquina del usuario, usando
 * el motor Firebird 1.5 embebido (kit con isql.exe). Ver README.md.
 *
 * Uso:
 *   node tools/fdb-import/extract.mjs --db "D:\pdvdata.fdb"
 *   node tools/fdb-import/extract.mjs --db "D:\pdvdata.fdb" --kit "C:\Users\r\.fbtools\kit" --out tools/fdb-import/output
 *
 * Salida (en --out):
 *   productos.csv   columnas: codigo, descripcion, tipo_venta, costo, precio, mayoreo, departamento
 *   productos.json  mismo contenido como arreglo de objetos + metadatos
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';

// ── args ─────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DB = arg('db', 'D:\\pdvdata.fdb');
const KIT = arg('kit', join(os.homedir(), '.fbtools', 'kit'));
const OUT = resolve(arg('out', join('tools', 'fdb-import', 'output')));
const ISQL = join(KIT, 'isql.exe');

if (!existsSync(ISQL)) {
  console.error(`\n✗ No se encontró isql.exe en el kit Firebird:\n    ${ISQL}\n`);
  console.error('  Arma el kit siguiendo tools/fdb-import/README.md (motor Firebird 1.5 embebido).');
  process.exit(1);
}
if (!existsSync(DB)) {
  console.error(`\n✗ No se encontró la base de datos:\n    ${DB}\n  Pásala con --db "ruta\\pdvdata.fdb".`);
  process.exit(1);
}

// ── runner: ejecuta una consulta isql (SET LIST ON) y devuelve el texto ───────
function isql(sql) {
  const script = join(os.tmpdir(), `fdbq_${process.pid}.sql`);
  const outFile = join(os.tmpdir(), `fdbo_${process.pid}.txt`);
  writeFileSync(script, sql.replace(/\s*$/, '') + '\n', 'ascii'); // isql 1.5 exige \n tras el ; final
  execFileSync(ISQL, [DB, '-u', 'SYSDBA', '-p', 'masterkey', '-i', script, '-o', outFile], {
    cwd: KIT, // isql carga fbclient.dll (= fbembed.dll) desde su propia carpeta
  });
  // leer salida (latin1: la base es de un POS mexicano antiguo, charset NONE/win1252)
  return readFileSync(outFile, 'latin1');
}

// ── parser del formato SET LIST ON ────────────────────────────────────────────
// Cada registro es un bloque de líneas "CAMPO<espacios>VALOR", separados por
// líneas en blanco. Tolera valores con espacios internos y vacíos.
function parseList(text) {
  const records = [];
  let cur = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, ''); // rtrim
    if (line.trim() === '') {
      if (cur && Object.keys(cur).length) records.push(cur);
      cur = null;
      continue;
    }
    const m = /^([A-Z0-9_$]+)\s{2,}(.*)$/.exec(line);
    if (m) {
      if (!cur) cur = {};
      let val = m[2];
      if (val === '<null>') val = null;
      cur[m[1]] = val;
    } else if (cur) {
      // continuación rara (valor multilínea) → adjunta al último campo
      const keys = Object.keys(cur);
      const last = keys[keys.length - 1];
      if (last && cur[last] != null) cur[last] += ' ' + line.trim();
    }
  }
  if (cur && Object.keys(cur).length) records.push(cur);
  return records;
}

// ── 1. Departamentos (id → nombre, en claro en la tabla DEPARTAMENTOS) ────────
console.log('• Leyendo departamentos…');
const deptText = isql(
  'SET LIST ON;\nSELECT ID, NOMBRE FROM DEPARTAMENTOS ORDER BY ID;',
);
const deptById = new Map();
for (const r of parseList(deptText)) {
  deptById.set(String(r.ID), (r.NOMBRE ?? '').trim());
}
console.log(`  ${deptById.size} departamentos.`);

// ── 2. Productos ──────────────────────────────────────────────────────────────
console.log('• Leyendo productos…');
const prodText = isql(
  'SET LIST ON;\n' +
    'SELECT CODIGO, DESCRIPCION, TVENTA, PCOSTO, PVENTA, MAYOREO, DEPT, DINVENTARIO\n' +
    'FROM PRODUCTOS ORDER BY DESCRIPCION;',
);
const rawAll = parseList(prodText);
// Todo producto real tiene CODIGO (PK no nulo); descarta bloques vacíos que el
// formato SET LIST puede emitir al final de la salida.
const raw = rawAll.filter((r) => (r.CODIGO ?? '').trim() !== '');
const skipped = rawAll.length - raw.length;

function num(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const productos = raw.map((r) => {
  const tventa = (r.TVENTA ?? 'U').trim().toUpperCase();
  const granel = tventa === 'D'; // D = a granel/peso, U = por pieza
  // DINVENTARIO = -1 ⇒ "sin control de inventario" en Abarrotes PDV → existencia vacía
  // (no la importamos como 0). Si la tienda sí lleva stock (>= 0) la exportamos.
  const inv = num(r.DINVENTARIO);
  return {
    codigo: (r.CODIGO ?? '').trim(),
    descripcion: (r.DESCRIPCION ?? '').replace(/\s+$/, '').trim(),
    tipo_venta: granel ? 'granel' : 'pieza',
    costo: round2(num(r.PCOSTO)),
    precio: round2(num(r.PVENTA)),
    mayoreo: round2(num(r.MAYOREO)),
    existencia: inv >= 0 ? inv : '',
    departamento: deptById.get(String(num(r.DEPT))) || '',
  };
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── 3. Escribir salida ────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const cols = ['codigo', 'descripcion', 'tipo_venta', 'costo', 'precio', 'mayoreo', 'existencia', 'departamento'];
const csv = [
  cols.join(','),
  ...productos.map((p) => cols.map((c) => csvCell(p[c])).join(',')),
].join('\r\n');

// BOM para que Excel abra los acentos correctamente
writeFileSync(join(OUT, 'productos.csv'), '﻿' + csv, 'utf8');
writeFileSync(
  join(OUT, 'productos.json'),
  JSON.stringify(
    {
      source: DB,
      generated_at: new Date().toISOString(),
      count: productos.length,
      departamentos: [...deptById.values()].filter(Boolean),
      productos,
    },
    null,
    2,
  ),
  'utf8',
);

// ── resumen ───────────────────────────────────────────────────────────────────
const porDepto = {};
for (const p of productos) porDepto[p.departamento || '(sin)'] = (porDepto[p.departamento || '(sin)'] || 0) + 1;
const granel = productos.filter((p) => p.tipo_venta === 'granel').length;
console.log(`\n✓ ${productos.length} productos exportados a:\n  ${join(OUT, 'productos.csv')}\n  ${join(OUT, 'productos.json')}`);
if (skipped) console.log(`  (${skipped} bloques vacíos descartados)`);
console.log(`\n  Por departamento:`);
for (const [d, n] of Object.entries(porDepto).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${d}`);
console.log(`\n  Granel: ${granel}   Pieza: ${productos.length - granel}`);

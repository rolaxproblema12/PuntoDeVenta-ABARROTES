/**
 * Junta todas las migraciones (0001…) + seed.sql en un solo archivo
 * `supabase/all-in-one.sql` para pegarlo en el SQL Editor de Supabase Cloud.
 * No requiere Supabase CLI ni Docker.
 *
 *   node scripts/bundle-sql.mjs            (migraciones + seed)
 *   node scripts/bundle-sql.mjs --no-seed  (solo migraciones)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migDir = join(root, 'supabase', 'migrations');
const out = join(root, 'supabase', 'all-in-one.sql');
const includeSeed = !process.argv.includes('--no-seed');

const files = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

let bundle =
  '-- ARCHIVO GENERADO por scripts/bundle-sql.mjs — NO editar a mano.\n' +
  '-- Pega TODO esto en Supabase Studio → SQL Editor → Run.\n' +
  '-- Es idempotente: se puede re-ejecutar sin romper nada.\n\n';

for (const f of files) {
  bundle += `\n-- ╔══ ${f} ${'═'.repeat(Math.max(0, 60 - f.length))}╗\n`;
  bundle += readFileSync(join(migDir, f), 'utf8');
  bundle += '\n';
}

if (includeSeed) {
  bundle += `\n-- ╔══ seed.sql (datos demo) ═══════════════════════════════╗\n`;
  bundle += readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8');
}

writeFileSync(out, bundle, 'utf8');
console.log(
  `OK → ${out}\n${files.length} migraciones${includeSeed ? ' + seed' : ''} ` +
    `(${bundle.length.toLocaleString()} bytes)`,
);

import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2, Sheet } from 'lucide-react';
import { toast } from 'sonner';
import {
  exportDatasets,
  type ExportDataset,
  type ExportFormat,
} from '@/lib/export';

const LABELS: Record<ExportFormat, string> = {
  xlsx: 'Excel (.xlsx)',
  csv: 'CSV',
  pdf: 'PDF',
};

function iconFor(f: ExportFormat) {
  if (f === 'pdf') return <FileText size={14} />;
  if (f === 'csv') return <FileSpreadsheet size={14} />;
  return <Sheet size={14} />;
}

/**
 * Botón "Exportar" con menú de formatos. `getDatasets` se evalúa al hacer clic
 * (toma los datos actuales). Soporta un dataset o varios (libro multi-hoja /
 * PDF multi-tabla).
 */
export function ExportMenu({
  getDatasets,
  formats = ['xlsx', 'csv', 'pdf'],
  label = 'Exportar',
  filename,
  business,
  disabled,
  size,
}: {
  getDatasets: () => ExportDataset | ExportDataset[];
  formats?: ExportFormat[];
  label?: string;
  filename?: string;
  business?: string;
  disabled?: boolean;
  size?: 'sm';
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function run(format: ExportFormat) {
    try {
      setBusy(format);
      const got = getDatasets();
      const list = Array.isArray(got) ? got : [got];
      const total = list.reduce((a, d) => a + d.rows.length, 0);
      if (total === 0) {
        toast.error('No hay datos para exportar.');
        return;
      }
      await exportDatasets(list, format, { filename, business });
      toast.success(`Exportado a ${LABELS[format]}`);
      setOpen(false);
    } catch (e) {
      toast.error('No se pudo exportar: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={'btn' + (size === 'sm' ? ' sm' : '')}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download size={size === 'sm' ? 13 : 14} /> {label}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            zIndex: 60,
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r)',
            boxShadow: 'var(--shadow-lg)',
            minWidth: 170,
            padding: 4,
          }}
        >
          {formats.map((f) => (
            <button
              key={f}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => void run(f)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 10px',
                background: 'transparent',
                border: 'none',
                cursor: busy ? 'default' : 'pointer',
                textAlign: 'left',
                borderRadius: 6,
                fontSize: 'var(--text-sm)',
                color: 'var(--text)',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'var(--bg-sunken)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'transparent')
              }
            >
              {busy === f ? <Loader2 size={14} /> : iconFor(f)}
              {LABELS[f]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

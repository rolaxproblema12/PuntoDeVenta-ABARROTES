import { Construction } from 'lucide-react';
import { PageHeader, EmptyState, Badge } from '@/components/ui';

/** Página esqueleto reutilizable para módulos de Fase 0 aún no implementados. */
export function ModulePage({
  title,
  phase,
  features,
}: {
  title: string;
  phase: number;
  features: string[];
}) {
  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle="Módulo cableado (ruta, tipos y endpoint listos)."
        actions={<Badge tone="warn">Esqueleto · llega en Fase {phase}</Badge>}
      />
      <div className="card">
        <EmptyState
          icon={Construction}
          title="En construcción"
          hint="Funciones planeadas para este módulo:"
          action={
            <ul
              className="grid grid-2"
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                textAlign: 'left',
                maxWidth: 560,
              }}
            >
              {features.map((f) => (
                <li
                  key={f}
                  className="text-sm"
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-md)',
                    padding: '10px 12px',
                    color: 'var(--text-2)',
                  }}
                >
                  {f}
                </li>
              ))}
            </ul>
          }
        />
      </div>
    </div>
  );
}

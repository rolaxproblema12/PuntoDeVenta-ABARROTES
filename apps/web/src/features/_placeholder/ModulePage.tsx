import { Construction } from 'lucide-react';

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
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Construction className="text-amber-500" />
        <h1 className="text-2xl font-bold">{title}</h1>
        <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-600">
          Esqueleto · llega en Fase {phase}
        </span>
      </div>
      <p className="mb-4 text-slate-500">
        Módulo cableado (ruta, tipos y endpoint listos). Funciones planeadas:
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {features.map((f) => (
          <li
            key={f}
            className="rounded-lg border p-3 text-sm dark:border-slate-800"
          >
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Period {
  /** ISO yyyy-mm-dd inclusivo. */
  from: string;
  to: string;
}

const p2 = (n: number) => String(n).padStart(2, '0');

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Periodo por defecto: últimos `days` días terminando hoy. */
export function defaultPeriod(days = 14): Period {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(to) };
}

function lastDays(days: number): Period {
  return defaultPeriod(days);
}

function thisMonth(): Period {
  const now = new Date();
  return {
    from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoDay(now),
  };
}

const PRESETS: { label: string; get: () => Period }[] = [
  { label: 'Hoy', get: () => lastDays(1) },
  { label: '7 días', get: () => lastDays(7) },
  { label: '14 días', get: () => lastDays(14) },
  { label: '30 días', get: () => lastDays(30) },
  { label: 'Este mes', get: thisMonth },
];

/** Selector de rango de fechas con presets. */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div
      className="flex items-center gap-sm period-picker"
      style={{ flexWrap: 'wrap', gap: 8 }}
    >
      <div className="flex items-center gap-sm">
        <input
          type="date"
          className="field"
          style={{ width: 150 }}
          value={value.from}
          max={value.to}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
        <span className="text-3">→</span>
        <input
          type="date"
          className="field"
          style={{ width: 150 }}
          value={value.to}
          min={value.from}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-sm" style={{ gap: 4 }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="btn ghost sm"
            onClick={() => onChange(p.get())}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

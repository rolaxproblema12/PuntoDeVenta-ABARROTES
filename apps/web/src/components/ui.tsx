/**
 * Primitivos de UI (estilo Linear) — portados del prototipo MiTiendita.
 * Solo presentación; sin lógica de datos.
 */
import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/* ─── formato ─────────────────────────────────────────────────────────── */
export const fmt = {
  mxn: (n: number, opts: { decimals?: number } = {}): string => {
    const decimals = opts.decimals ?? 0;
    return (
      '$' +
      n.toLocaleString('es-MX', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    );
  },
  num: (n: number, decimals = 0): string =>
    n.toLocaleString('es-MX', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  pct: (n: number, decimals = 1): string => n.toFixed(decimals) + '%',
};

/* ─── PageHeader ──────────────────────────────────────────────────────── */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-hd">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-hd-actions">{actions}</div>}
    </div>
  );
}

/* ─── Card ────────────────────────────────────────────────────────────── */
export function Card({
  title,
  sub,
  action,
  children,
  padded = true,
  style,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  padded?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className="card" style={style}>
      {(title || action) && (
        <div className="card-hd">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={padded ? 'card-bd' : ''}>{children}</div>
    </div>
  );
}

/* ─── Kpi ─────────────────────────────────────────────────────────────── */
export function Kpi({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  icon: IconCmp,
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: number;
  deltaLabel?: string;
  icon?: LucideIcon;
  hint?: string;
}) {
  const up = (delta ?? 0) > 0;
  return (
    <div className="kpi">
      <div className="kpi-lbl">
        {IconCmp && <IconCmp size={13} className="icon" />}
        <span>{label}</span>
      </div>
      <div className="kpi-num">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="kpi-foot">
        {delta != null && (
          <span className={'kpi-delta ' + (up ? 'up' : 'down')}>
            {up ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        <span className="kpi-foot-lbl">{deltaLabel || hint}</span>
      </div>
    </div>
  );
}

/* ─── Badge ───────────────────────────────────────────────────────────── */
export type BadgeTone =
  | 'default'
  | 'pos'
  | 'neg'
  | 'warn'
  | 'info'
  | 'accent';

export function Badge({
  children,
  tone = 'default',
  dot,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  return (
    <span className={'badge ' + (tone !== 'default' ? tone : '')}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

/* ─── StatusDot ───────────────────────────────────────────────────────── */
export function StatusDot({
  status,
}: {
  status: 'ok' | 'warn' | 'offline' | string;
}) {
  const color =
    status === 'ok'
      ? 'var(--pos)'
      : status === 'warn'
        ? 'var(--warn)'
        : 'var(--neg)';
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 0 3px ${color}22`,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

/* ─── BarList ─────────────────────────────────────────────────────────── */
export function BarList({
  rows,
  suffix = '',
  color,
}: {
  rows: { label: string; value: number; display?: string }[];
  suffix?: string;
  color?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 4,
              fontSize: 'var(--text-sm)',
            }}
          >
            <span style={{ color: 'var(--text)' }}>{r.label}</span>
            <span className="tnum mono" style={{ color: 'var(--text-2)' }}>
              {r.display ?? r.value}
              {suffix}
            </span>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${(r.value / max) * 100}%`,
                background: color || 'var(--accent)',
                opacity: 0.4 + 0.6 * (r.value / max),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── MiniBar ─────────────────────────────────────────────────────────────
   Barra de progreso compacta para celdas de tabla / listas (stock vs mínimo,
   pagado vs total, etc.). Tono semántico con los tokens del tema. */
export type MiniBarTone = 'accent' | 'pos' | 'warn' | 'neg' | 'info';

const TONE_VAR: Record<MiniBarTone, string> = {
  accent: 'var(--accent)',
  pos: 'var(--pos)',
  warn: 'var(--warn)',
  neg: 'var(--neg)',
  info: 'var(--info)',
};

export function MiniBar({
  value,
  max,
  tone = 'accent',
  width,
}: {
  value: number;
  max: number;
  tone?: MiniBarTone;
  width?: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="minibar" style={width ? { maxWidth: width } : undefined}>
      <span style={{ width: `${pct}%`, background: TONE_VAR[tone] }} />
    </div>
  );
}

/* ─── AreaChart ───────────────────────────────────────────────────────── */
export function AreaChart<
  T extends Record<string, number | string>,
>({
  data,
  height = 200,
  valueKey,
  compareKey,
  labelKey = 'day',
  yFormat = (v: number) => '$' + (v / 1000).toFixed(0) + 'k',
}: {
  data: T[];
  height?: number;
  valueKey: keyof T;
  compareKey?: keyof T;
  labelKey?: keyof T;
  yFormat?: (v: number) => string;
}) {
  const w = 600;
  const h = height;
  const pad = { l: 40, r: 12, t: 14, b: 22 };
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const maxV =
    Math.max(
      ...data.map((d) =>
        Math.max(num(d[valueKey]), compareKey ? num(d[compareKey]) : 0),
      ),
      1,
    ) * 1.1;
  const xs = (i: number) =>
    pad.l + (i / Math.max(data.length - 1, 1)) * (w - pad.l - pad.r);
  const ys = (v: number) =>
    pad.t + (1 - v / maxV) * (h - pad.t - pad.b);
  const pts = data.map((d, i) => `${xs(i)},${ys(num(d[valueKey]))}`);
  const areaD = `M ${xs(0)} ${h - pad.b} L ${pts.join(' L ')} L ${xs(data.length - 1)} ${h - pad.b} Z`;
  const lineD = 'M ' + pts.join(' L ');
  const compareD = compareKey
    ? 'M ' + data.map((d, i) => `${xs(i)},${ys(num(d[compareKey]))}`).join(' L ')
    : null;
  const yvals = Array.from({ length: 5 }, (_, i) => (maxV / 4) * i);

  return (
    <div className="chart-wrap" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {yvals.map((v, i) => (
          <g key={i}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={ys(v)}
              y2={ys(v)}
              className="chart-grid"
              strokeDasharray={i === 0 ? '0' : '2 3'}
            />
            <text
              x={pad.l - 6}
              y={ys(v) + 3}
              textAnchor="end"
              className="chart-axis-y"
            >
              {yFormat(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <text
            key={i}
            x={xs(i)}
            y={h - 6}
            textAnchor="middle"
            className="chart-axis-x"
          >
            {String(d[labelKey] ?? '')}
          </text>
        ))}
        <path d={areaD} className="chart-area" />
        <path d={lineD} className="chart-line" />
        {compareD && <path d={compareD} className="chart-line-2" />}
        {data.map((d, i) => (
          <circle
            key={i}
            cx={xs(i)}
            cy={ys(num(d[valueKey]))}
            r="3"
            className="chart-dot"
          />
        ))}
      </svg>
    </div>
  );
}

/* ─── BarChart ────────────────────────────────────────────────────────── */
export function BarChart({
  data,
  height = 140,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1) * 1.1;
  return (
    <div
      style={{
        height,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 4,
        padding: '0 0 18px',
      }}
    >
      {data.map((d, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <div
            style={{
              width: '100%',
              height: `${(d.value / max) * (height - 28)}px`,
              background: 'var(--accent)',
              opacity: 0.25 + 0.7 * (d.value / max),
              borderRadius: '4px 4px 0 0',
            }}
          />
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-3)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {d.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Donut ───────────────────────────────────────────────────────────── */
export function Donut({
  segments,
  size = 140,
  thickness = 18,
  centerLabel,
  centerSub,
}: {
  segments: { name: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: ReactNode;
  centerSub?: ReactNode;
}) {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--bg-sunken)"
          strokeWidth={thickness}
        />
        {segments.map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          lineHeight: 1.15,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-.02em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {centerLabel}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {centerSub}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Modal ───────────────────────────────────────────────────────────── */
export function Modal({
  title,
  onClose,
  children,
  footer,
  maxWidth = 460,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}) {
  return (
    <div
      className="modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth }}>
        <div className="modal-hd">
          <h2>{title}</h2>
          <button
            className="tb-icon-btn"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="modal-bd">{children}</div>
        {footer && (
          <div
            className="modal-bd"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── EmptyState ──────────────────────────────────────────────────────── */
export function EmptyState({
  icon: IconCmp,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--text-3)',
      }}
    >
      {IconCmp && <IconCmp size={28} />}
      <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>{title}</div>
      {hint && <div className="text-sm">{hint}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { formatMoney, type PlanCode } from '@abarrotes/shared';
import { api } from '@/lib/apiClient';

interface PlanRow {
  code: PlanCode;
  name: string;
  price_cents: number;
  max_sucursales: number;
  max_users: number;
}

export default function PricingPage() {
  const { data: plans = [] } = useQuery({
    queryKey: ['pricing', 'plans'],
    queryFn: () => api<PlanRow[]>('/onboarding/plans'),
  });

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        padding: '72px 24px',
      }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto', textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          Precios simples
        </h1>
        <p className="text-2" style={{ marginTop: 10, fontSize: 15 }}>
          14 días gratis. Cancela cuando quieras.
        </p>
      </div>
      <div
        className="grid grid-3"
        style={{ maxWidth: 920, margin: '40px auto 0' }}
      >
        {plans.map((p) => (
          <div
            key={p.code}
            className="card"
            style={{ display: 'flex', flexDirection: 'column', padding: 24 }}
          >
            <h3
              className="fw-600"
              style={{
                margin: 0,
                fontSize: 15,
                textTransform: 'capitalize',
              }}
            >
              {p.name}
            </h3>
            <p
              style={{
                margin: '12px 0 0',
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: '-0.02em',
              }}
            >
              {formatMoney(p.price_cents)}
              <span
                className="text-3"
                style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}
              >
                /mes
              </span>
            </p>
            <ul
              className="text-sm"
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '20px 0 0',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                color: 'var(--text-2)',
              }}
            >
              <li className="flex items-center gap-sm">
                <Check size={15} style={{ color: 'var(--accent-text)' }} />
                {p.max_sucursales} sucursal(es)
              </li>
              <li className="flex items-center gap-sm">
                <Check size={15} style={{ color: 'var(--accent-text)' }} />
                {p.max_users} usuarios
              </li>
              <li className="flex items-center gap-sm">
                <Check size={15} style={{ color: 'var(--accent-text)' }} />
                POS, inventario y reportes
              </li>
            </ul>
            <Link
              to="/registro"
              className="btn accent"
              style={{
                textDecoration: 'none',
                marginTop: 24,
                height: 38,
                justifyContent: 'center',
              }}
            >
              Empezar
            </Link>
          </div>
        ))}
      </div>
      <p
        className="text-3 text-sm"
        style={{ marginTop: 40, textAlign: 'center' }}
      >
        <Link
          to="/"
          className="text-acc"
          style={{ textDecoration: 'none' }}
        >
          ← Volver
        </Link>
      </p>
    </div>
  );
}

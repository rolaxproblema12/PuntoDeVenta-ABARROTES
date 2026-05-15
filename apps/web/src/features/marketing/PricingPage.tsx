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
    <div className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-3xl font-extrabold">Precios simples</h1>
        <p className="mt-2 text-slate-400">
          14 días gratis. Cancela cuando quieras.
        </p>
      </div>
      <div className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-3">
        {plans.map((p) => (
          <div
            key={p.code}
            className="flex flex-col rounded-2xl bg-slate-900 p-6"
          >
            <h3 className="text-lg font-bold capitalize">{p.name}</h3>
            <p className="mt-2 text-3xl font-extrabold">
              {formatMoney(p.price_cents)}
              <span className="text-base font-normal text-slate-400">/mes</span>
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-300">
              <li className="flex gap-2">
                <Check size={16} className="text-brand" />
                {p.max_sucursales} sucursal(es)
              </li>
              <li className="flex gap-2">
                <Check size={16} className="text-brand" />
                {p.max_users} usuarios
              </li>
              <li className="flex gap-2">
                <Check size={16} className="text-brand" />
                POS, inventario y reportes
              </li>
            </ul>
            <Link
              to="/registro"
              className="btn-touch mt-6 bg-brand text-white"
            >
              Empezar
            </Link>
          </div>
        ))}
      </div>
      <p className="mt-10 text-center text-sm text-slate-500">
        <Link to="/" className="text-brand">
          ← Volver
        </Link>
      </p>
    </div>
  );
}

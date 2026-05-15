import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatMoney, type PlanCode } from '@abarrotes/shared';
import { api } from '@/lib/apiClient';
import { supabase } from '@/lib/supabase';

interface PlanRow {
  code: PlanCode;
  name: string;
  price_cents: number;
  max_sucursales: number;
  max_users: number;
}

export default function SignupPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    business_name: '',
    owner_name: '',
    email: '',
    password: '',
    plan_code: 'basico' as PlanCode,
  });
  const [busy, setBusy] = useState(false);

  const { data: plans = [] } = useQuery({
    queryKey: ['signup', 'plans'],
    queryFn: () => api<PlanRow[]>('/onboarding/plans'),
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/onboarding/signup', { method: 'POST', body: form });
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (error) throw error;
      toast.success('¡Tu sistema está listo! Prueba gratis de 14 días.');
      nav('/pos');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-2xl bg-white p-8 shadow-xl dark:bg-slate-900"
      >
        <h1 className="text-2xl font-bold">Crea tu sistema</h1>
        <p className="text-sm text-slate-500">
          14 días gratis. Sin tarjeta para empezar.
        </p>
        <input
          required
          className="w-full rounded-lg border p-3 dark:bg-slate-800"
          placeholder="Nombre del negocio"
          value={form.business_name}
          onChange={(e) => set('business_name', e.target.value)}
        />
        <input
          required
          className="w-full rounded-lg border p-3 dark:bg-slate-800"
          placeholder="Tu nombre"
          value={form.owner_name}
          onChange={(e) => set('owner_name', e.target.value)}
        />
        <input
          required
          type="email"
          className="w-full rounded-lg border p-3 dark:bg-slate-800"
          placeholder="Correo"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
        />
        <input
          required
          type="password"
          minLength={8}
          className="w-full rounded-lg border p-3 dark:bg-slate-800"
          placeholder="Contraseña (mín. 8)"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
        />
        <select
          className="w-full rounded-lg border p-3 dark:bg-slate-800"
          value={form.plan_code}
          onChange={(e) => set('plan_code', e.target.value as PlanCode)}
        >
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name} — {formatMoney(p.price_cents)}/mes ·{' '}
              {p.max_sucursales} suc · {p.max_users} usuarios
            </option>
          ))}
        </select>
        <button
          disabled={busy}
          className="btn-touch w-full bg-brand text-white hover:bg-brand-dark"
        >
          {busy ? 'Creando…' : 'Empezar prueba gratis'}
        </button>
        <p className="text-center text-sm text-slate-400">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-brand">
            Inicia sesión
          </Link>
        </p>
      </form>
    </div>
  );
}

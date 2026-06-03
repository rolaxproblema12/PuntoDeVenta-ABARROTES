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
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        onSubmit={submit}
        className="card"
        style={{
          width: '100%',
          maxWidth: 420,
          padding: 32,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: 'var(--text)',
            color: 'var(--bg-elev)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            marginBottom: 16,
          }}
        >
          a
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          Crea tu sistema
        </h1>
        <p className="text-2 text-sm" style={{ margin: '6px 0 20px' }}>
          14 días gratis. Sin tarjeta para empezar.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="label">Nombre del negocio</label>
            <input
              required
              className="field"
              placeholder="Nombre del negocio"
              value={form.business_name}
              onChange={(e) => set('business_name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Tu nombre</label>
            <input
              required
              className="field"
              placeholder="Tu nombre"
              value={form.owner_name}
              onChange={(e) => set('owner_name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Correo</label>
            <input
              required
              type="email"
              className="field"
              placeholder="Correo"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input
              required
              type="password"
              minLength={8}
              className="field"
              placeholder="Contraseña (mín. 8)"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Plan</label>
            <select
              className="field"
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
          </div>
          <button
            disabled={busy}
            className="btn accent"
            style={{
              width: '100%',
              height: 38,
              justifyContent: 'center',
              marginTop: 4,
            }}
          >
            {busy ? 'Creando…' : 'Empezar prueba gratis'}
          </button>
        </div>
        <p
          className="text-3 text-sm"
          style={{ textAlign: 'center', margin: '18px 0 0' }}
        >
          ¿Ya tienes cuenta?{' '}
          <Link
            to="/login"
            className="text-acc"
            style={{ textDecoration: 'none' }}
          >
            Inicia sesión
          </Link>
        </p>
      </form>
    </div>
  );
}

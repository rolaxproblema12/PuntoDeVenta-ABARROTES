import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) setError(error.message);
    else nav('/pos');
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
          ABARROTES POS
        </h1>
        <p className="text-2 text-sm" style={{ margin: '6px 0 20px' }}>
          Inicia sesión para continuar
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="label">Correo</label>
            <input
              className="field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Correo"
            />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input
              className="field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
            />
          </div>
          {error && (
            <p className="text-neg text-sm" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <button
            className="btn accent"
            disabled={busy}
            style={{
              width: '100%',
              height: 38,
              justifyContent: 'center',
              marginTop: 4,
            }}
          >
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
        <p
          className="text-3 text-sm"
          style={{ textAlign: 'center', margin: '18px 0 0' }}
        >
          ¿No tienes sistema?{' '}
          <Link
            to="/registro"
            className="text-acc"
            style={{ textDecoration: 'none' }}
          >
            Crea el tuyo gratis
          </Link>
        </p>
        {import.meta.env.VITE_SHOW_DEMO_CREDS === 'true' && (
          <p
            className="text-3 text-xs"
            style={{ textAlign: 'center', margin: '12px 0 0' }}
          >
            Demo: admin@pos.local / super@pos.local / encargado@pos.local /
            cajero@pos.local · password123
          </p>
        )}
      </form>
    </div>
  );
}

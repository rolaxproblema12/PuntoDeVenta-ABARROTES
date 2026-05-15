import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('cajero@pos.local');
  const [password, setPassword] = useState('password123');
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-xl dark:bg-slate-900"
      >
        <h1 className="text-2xl font-bold">ABARROTES POS</h1>
        <p className="text-sm text-slate-500">Inicia sesión para continuar</p>
        <input
          className="w-full rounded-lg border p-3 dark:bg-slate-800"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Correo"
        />
        <input
          className="w-full rounded-lg border p-3 dark:bg-slate-800"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          className="btn-touch w-full bg-brand text-white hover:bg-brand-dark"
          disabled={busy}
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="text-xs text-slate-400">
          Demo: admin@pos.local / super@pos.local / encargado@pos.local /
          cajero@pos.local · password123
        </p>
      </form>
    </div>
  );
}

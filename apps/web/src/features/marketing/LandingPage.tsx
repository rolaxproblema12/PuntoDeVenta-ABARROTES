import { Link } from 'react-router-dom';
import { BarChart3, Cloud, ShieldCheck, Smartphone } from 'lucide-react';

const FEATURES = [
  { icon: Smartphone, t: 'Vende desde cualquier lugar', d: 'Celular, tablet o PC. Solo abre el navegador, sin instalar nada.' },
  { icon: Cloud, t: 'Tu información en la nube', d: 'Sincronización en tiempo real y respaldos automáticos.' },
  { icon: BarChart3, t: 'Control total', d: 'Inventario, ventas, cortes de caja y reportes en un solo lugar.' },
  { icon: ShieldCheck, t: 'Aislado y seguro', d: 'Cada negocio con su propio sistema, datos separados.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="mx-auto flex max-w-5xl items-center justify-between p-6">
        <span className="text-xl font-bold">🛒 ABARROTES POS</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/precios" className="hover:text-brand">Precios</Link>
          <Link to="/login" className="hover:text-brand">Entrar</Link>
          <Link
            to="/registro"
            className="rounded-lg bg-brand px-4 py-2 font-semibold"
          >
            Empezar gratis
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-extrabold sm:text-5xl">
          El punto de venta para tu tienda de abarrotes
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-400">
          Crea tu sistema en minutos. Paga una mensualidad y vende desde
          cualquier dispositivo. 14 días de prueba gratis.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            to="/registro"
            className="rounded-xl bg-brand px-6 py-3 font-semibold"
          >
            Crear mi sistema
          </Link>
          <Link
            to="/precios"
            className="rounded-xl border border-slate-700 px-6 py-3 font-semibold"
          >
            Ver precios
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.t} className="rounded-2xl bg-slate-900 p-6">
            <f.icon className="text-brand" />
            <h3 className="mt-3 font-bold">{f.t}</h3>
            <p className="mt-1 text-sm text-slate-400">{f.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

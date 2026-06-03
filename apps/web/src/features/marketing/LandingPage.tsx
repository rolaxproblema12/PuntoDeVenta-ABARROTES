import { Link } from 'react-router-dom';
import { BarChart3, Cloud, ShieldCheck, Smartphone } from 'lucide-react';

const FEATURES = [
  { icon: Smartphone, t: 'Vende desde cualquier lugar', d: 'Celular, tablet o PC. Solo abre el navegador, sin instalar nada.' },
  { icon: Cloud, t: 'Tu información en la nube', d: 'Sincronización en tiempo real y respaldos automáticos.' },
  { icon: BarChart3, t: 'Control total', d: 'Inventario, ventas, cortes de caja y reportes en un solo lugar.' },
  { icon: ShieldCheck, t: 'Aislado y seguro', d: 'Cada negocio con su propio sistema, datos separados.' },
];

const brandMark = (
  <span
    style={{
      width: 24,
      height: 24,
      borderRadius: 6,
      background: 'var(--text)',
      color: 'var(--bg-elev)',
      display: 'grid',
      placeItems: 'center',
      fontSize: 14,
      fontWeight: 800,
      letterSpacing: '-0.04em',
    }}
  >
    a
  </span>
);

export default function LandingPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      <header
        style={{
          maxWidth: 1080,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 24px',
        }}
      >
        <span
          className="flex items-center gap-sm"
          style={{ fontWeight: 700, letterSpacing: '-0.015em', fontSize: 15 }}
        >
          {brandMark} ABARROTES POS
        </span>
        <nav className="flex items-center gap-md text-sm">
          <Link to="/precios" className="text-2" style={{ textDecoration: 'none' }}>
            Precios
          </Link>
          <Link to="/login" className="text-2" style={{ textDecoration: 'none' }}>
            Entrar
          </Link>
          <Link to="/registro" className="btn accent" style={{ textDecoration: 'none' }}>
            Empezar gratis
          </Link>
        </nav>
      </header>

      <section
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '96px 24px',
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            margin: 0,
          }}
        >
          El punto de venta para tu tienda de abarrotes
        </h1>
        <p
          className="text-2"
          style={{ maxWidth: 520, margin: '18px auto 0', fontSize: 15 }}
        >
          Crea tu sistema en minutos. Paga una mensualidad y vende desde
          cualquier dispositivo. 14 días de prueba gratis.
        </p>
        <div
          className="flex items-center"
          style={{ justifyContent: 'center', gap: 10, marginTop: 32 }}
        >
          <Link
            to="/registro"
            className="btn accent"
            style={{
              textDecoration: 'none',
              height: 44,
              padding: '0 22px',
              fontSize: 14,
            }}
          >
            Crear mi sistema
          </Link>
          <Link
            to="/precios"
            className="btn"
            style={{
              textDecoration: 'none',
              height: 44,
              padding: '0 22px',
              fontSize: 14,
            }}
          >
            Ver precios
          </Link>
        </div>
      </section>

      <section
        className="grid grid-4"
        style={{
          maxWidth: 1080,
          margin: '0 auto',
          padding: '0 24px 96px',
        }}
      >
        {FEATURES.map((f) => (
          <div key={f.t} className="card" style={{ padding: 20 }}>
            <f.icon size={20} style={{ color: 'var(--accent-text)' }} />
            <h3
              className="fw-600"
              style={{ margin: '12px 0 0', fontSize: 14 }}
            >
              {f.t}
            </h3>
            <p className="text-2 text-sm" style={{ margin: '6px 0 0' }}>
              {f.d}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}

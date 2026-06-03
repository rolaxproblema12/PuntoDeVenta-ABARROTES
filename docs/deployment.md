# Despliegue (nube, SIN Docker) — acceso por URL desde celular/PC

> **Docker NO se usa para vender.** Solo es para correr Supabase en tu PC de
> desarrollo (opcional). En producción todo vive en la nube y las cajeras
> entran desde el navegador. Esta guía evita Docker por completo.

Arquitectura: **Web (Vercel)** → **API (Render/Railway)** → **Supabase Cloud** ·
Pagos con **Stripe**. Es un SaaS multi-tenant: cada cliente que se registra y
paga obtiene su sistema aislado.

---

## 1. Crear el proyecto en Supabase (gratis, sin Docker)

1. Entra a <https://supabase.com> → **Sign in** (con GitHub o correo).
2. **New project** → nombre `abarrotes-pos`, contraseña de BD (guárdala),
   región la más cercana (ej. `East US`), plan **Free**. Crear (~2 min).
3. En el proyecto: **Project Settings → API**. Copia:
   - **Project URL** → `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - **anon public** → `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`
   - **service_role** (secreto) → `SUPABASE_SERVICE_ROLE_KEY` (solo API)
4. **Project Settings → API → JWT Settings**: el JWKS está en
   `https://<TU-REF>.supabase.co/auth/v1/.well-known/jwks.json`
   → `SUPABASE_JWT_JWKS_URL`.
5. **Authentication → Providers → Email**: deja habilitado. Para demo,
   desactiva "Confirm email" (Authentication → Providers → Email →
   *Confirm email* OFF) para que el alta sea inmediata.

## 2. Cargar el esquema (dos opciones, ninguna usa Docker)

**Opción A — pegar SQL (lo más simple, sin instalar nada):**

```bash
pnpm db:bundle           # genera supabase/all-in-one.sql (migraciones + seed)
```

Abre **Supabase Studio → SQL Editor → New query**, pega TODO el contenido de
`supabase/all-in-one.sql` y **Run**. Es idempotente (se puede re-ejecutar).
Para producción sin datos demo: `pnpm db:bundle:schema` y omite el seed.

**Opción B — Supabase CLI (sin Docker, contra la nube):**

```bash
# instala el CLI (NO necesita Docker para 'db push'):  scoop install supabase
supabase link --project-ref <TU-REF>      # pide la BD password
pnpm db:push                              # aplica migrations a la nube
```

## 3. Configurar Stripe (modo prueba primero)

1. <https://dashboard.stripe.com> → modo **Test**.
2. **Developers → API keys**: copia **Secret key** → `STRIPE_SECRET_KEY`.
3. **Product catalog → Add product**: crea 3 productos (Básico/Pro/Negocio),
   cada uno con un **precio recurrente mensual en MXN**. Copia cada
   **Price ID** (`price_…`) → `STRIPE_PRICE_BASICO/PRO/NEGOCIO`.
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://<TU-API>/api/v1/billing/webhook`
   - Eventos: `customer.subscription.created/updated/deleted`,
     `invoice.payment_failed`, `checkout.session.completed`.
   - Copia el **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
   - Local: `stripe listen --forward-to localhost:3000/api/v1/billing/webhook`.

## 4. Desplegar la API (Render — plan gratis)

1. <https://render.com> → **New → Web Service** → conecta el repo.
2. Root dir: repositorio raíz. Build: `pnpm install && pnpm --filter
   @abarrotes/shared build && pnpm --filter @abarrotes/api build`.
   Start: `node apps/api/dist/main.js`.
3. **Environment**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_JWKS_URL`, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `APP_PUBLIC_URL`
   (la URL pública del web), `API_PORT=10000`, `NODE_ENV=production`,
   `CORS_ORIGINS=https://tu-proyecto.vercel.app` (el dominio del web; sin esto en
   producción la API rechaza las peticiones del navegador).
4. Deploy → anota la URL pública (ej. `https://abarrotes-api.onrender.com`).

## 5. Desplegar el Web (Vercel — gratis)

El repo ya trae **`vercel.json`** en la raíz: define el build del monorepo
(`pnpm --filter @abarrotes/web build`), la carpeta de salida (`apps/web/dist`)
y el **rewrite SPA** (`/(.*) → /index.html`) para que recargar rutas como
`/pos` no dé 404. No tienes que escribir comandos a mano.

1. <https://vercel.com> → **Add New… → Project** → importa el repo de GitHub.
2. **Root Directory: déjalo en la raíz del repo** (NO lo cambies a `apps/web`;
   `vercel.json` ya apunta al build correcto y necesita ver `packages/shared`).
   Framework Preset: **Other** (lo toma de `vercel.json`).
3. Antes de desplegar, abre **Environment Variables** y agrega (scope
   *Production* y *Preview*) — son de **build**, deben existir ANTES del build:
   - `VITE_SUPABASE_URL` = Project URL de Supabase
   - `VITE_SUPABASE_ANON_KEY` = anon public key
   - `VITE_API_URL` = `https://<TU-API>/api/v1` (la URL de Render del paso 4)
4. **Deploy**. Queda en `https://tu-proyecto.vercel.app` (o conecta un dominio).
   **Esa es la URL que abren las cajeras desde el celular.** Es PWA: pueden
   "Agregar a pantalla de inicio".

> Importante: si cambias una variable `VITE_*` después, hay que **redeploy**
> (se hornean en el bundle en tiempo de build, no se leen en runtime).
>
> Orden recomendado: primero el paso 4 (API en Render) para tener su URL, luego
> este paso 5 con `VITE_API_URL` ya apuntando a ella. Y agrega la URL de Vercel
> a `CORS_ORIGINS` y `APP_PUBLIC_URL` de la API (Render) para que acepte sus
> peticiones.

## 6. Designar al dueño de la plataforma (super-admin)

Crea tu usuario en `/registro` (o créalo en Supabase → Authentication →
Users), copia su `id` (UUID) y en el SQL Editor:

```sql
insert into platform_admins (user_id) values ('<TU-USER-UUID>')
on conflict do nothing;
```

Entra al sistema → verás "Plataforma" en el menú (`/admin/platform`):
lista de tenants, MRR y suspender/reactivar.

## 7. Verificación end-to-end

1. Visitante entra a la URL del web → Landing → **Empezar gratis** →
   `/registro` → crea negocio → entra a su POS (trial 14 días).
2. Repite con otro negocio (otro correo) → confirma que **no ve** datos del
   primero (aislamiento por `tenant_id` + RLS).
3. En **Facturación** → *Suscribirme* → Stripe Checkout (tarjeta de prueba
   `4242 4242 4242 4242`) → el webhook deja el tenant en `active`.
4. Como super-admin: suspende un tenant → su POS se bloquea (pantalla
   "Suscripción inactiva"); reactívalo → vuelve a funcionar.

## Notas

- Las llaves **service_role** y **STRIPE_SECRET** van **solo** en la API,
  nunca en el web.
- El plan Free de Supabase basta para empezar; escala cambiando de plan sin
  tocar código.
- Backups: Supabase los hace automáticamente (Project → Database → Backups).

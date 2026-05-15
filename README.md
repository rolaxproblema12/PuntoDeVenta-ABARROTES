# ABARROTES POS — SaaS de Punto de Venta

**Producto SaaS multi-tenant**: cualquiera entra a la web, se registra, paga una
suscripción y obtiene **su propio sistema POS aislado**. Mismo código y
estructura para todos; datos separados por `tenant_id` + RLS. El dueño de la
plataforma (super-admin) administra todos los negocios.

POS para tiendas de **abarrotes y conveniencia**: multiusuario, multisucursal,
tiempo real, offline y nube. Arquitectura **híbrida**: Supabase
(Postgres + Auth + Realtime) + capa API REST en **NestJS** (integridad
transaccional, Stripe) + web PWA.

> **Para producción NO se necesita Docker.** Docker solo sirve para correr
> Supabase localmente (opcional). Guía completa sin Docker, con acceso por URL
> desde el celular: **[docs/deployment.md](docs/deployment.md)**.

## Monorepo

```
packages/shared/   Tipos y schemas zod compartidos (@abarrotes/shared)
apps/api/          NestJS 10 (Fastify) — REST /api/v1 + Swagger
apps/web/          React 18 + Vite — PWA, offline, touch-first
supabase/          Migraciones numeradas idempotentes + seed
docs/              architecture / db-schema / api-contract / offline-sync
```

## Requisitos

- Node 20+ y pnpm 9+ (`npm i -g pnpm@9`)
- Una cuenta gratis en [Supabase](https://supabase.com) y [Stripe](https://stripe.com)
- *(Opcional, solo dev local)* Docker + Supabase CLI

## Puesta en marcha (nube, recomendado — sin Docker)

```bash
pnpm install
cp .env.example .env.local        # rellena con datos de tu proyecto Supabase + Stripe
pnpm db:bundle                    # genera supabase/all-in-one.sql
# → pega ese SQL en Supabase Studio → SQL Editor → Run
pnpm dev                          # API :3000/api/v1 (Swagger /docs) + Web :5173
```

Guía paso a paso (crear proyecto Supabase, Stripe, desplegar en Vercel/Render,
designar super-admin, verificación): **[docs/deployment.md](docs/deployment.md)**.

### Alternativa: Supabase local (requiere Docker)

```bash
pnpm db:start && pnpm db:seed && pnpm dev
```

## Scripts

| Script            | Descripción                               |
| ----------------- | ----------------------------------------- |
| `pnpm dev`        | API + Web en paralelo                     |
| `pnpm build`      | Build de shared, api y web                |
| `pnpm typecheck`  | `tsc --noEmit` en todos los workspaces    |
| `pnpm lint`       | ESLint en todos los workspaces            |
| `pnpm test`       | Vitest (web + api)                        |
| `pnpm db:reset`   | Reaplica migraciones + seed desde cero    |

## Verificación Fase 0 (hecha)

`pnpm install` · `shared` build+tests ✓ · `api` typecheck+build+tests ✓ y
arranca (`/health` 200, `/auth/me` 401 sin token, Swagger `/api/v1/docs` 200) ·
`web` typecheck+build (PWA + chunks) + tests ✓ · `pnpm lint` ✓.

> **Pendiente de entorno:** el smoke e2e contra la BD (crear una venta real)
> requiere **Docker Desktop + Supabase CLI**, que no están instalados en esta
> máquina. Instálalos (`scoop install supabase`) y corre
> `pnpm db:start && pnpm db:seed && pnpm dev`. Las 13 migraciones y el seed ya
> están escritos e idempotentes.

## Estado (roadmap por fases)

- **Fase 0 — Scaffold (este commit):** monorepo, 13 migraciones, API con 14 módulos
  esqueleto + guards, web con 10 módulos esqueleto + infraestructura offline/realtime.
- **Fase 1:** POS, inventario, productos, auth/roles, multisucursal funcionales.
- **Fases 2-4:** clientes/crédito, compras, promociones, analítica, endurecimiento.

Consulta `docs/architecture.md` y el plan en `.claude/plans/`.

> El sistema de referencia en `Alienshop/PuntodeVenta(webSystem)` se usó **solo como
> referencia de patrones** y no debe modificarse.

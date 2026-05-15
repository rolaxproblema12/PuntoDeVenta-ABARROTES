# ABARROTES POS — Punto de Venta Inteligente

POS profesional y escalable para tiendas de **abarrotes y conveniencia**: multiusuario,
multisucursal, tiempo real y sincronización en la nube. Arquitectura **híbrida**:
Supabase (Postgres + Auth + Realtime) + capa API REST delgada en **NestJS** para
integridad transaccional y futuras apps móviles.

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
- Docker Desktop + [Supabase CLI](https://supabase.com/docs/guides/cli) (`scoop install supabase`)

## Arranque local

```bash
pnpm install
cp .env.example .env.local        # rellena con los valores de `pnpm db:start`
pnpm db:start                     # supabase start (Postgres + Auth + Realtime)
pnpm db:migrate                   # aplica supabase/migrations en orden
pnpm db:seed                      # carga datos de ejemplo (seed.sql)
pnpm dev                          # API :3000/api/v1 (Swagger /docs) + Web :5173
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

## Estado (roadmap por fases)

- **Fase 0 — Scaffold (este commit):** monorepo, 13 migraciones, API con 14 módulos
  esqueleto + guards, web con 10 módulos esqueleto + infraestructura offline/realtime.
- **Fase 1:** POS, inventario, productos, auth/roles, multisucursal funcionales.
- **Fases 2-4:** clientes/crédito, compras, promociones, analítica, endurecimiento.

Consulta `docs/architecture.md` y el plan en `.claude/plans/`.

> El sistema de referencia en `Alienshop/PuntodeVenta(webSystem)` se usó **solo como
> referencia de patrones** y no debe modificarse.

# CLAUDE.md — Notas de desarrollo internas

## Qué es esto

Monorepo pnpm de un POS para abarrotes. Arquitectura híbrida Supabase + NestJS.
Plan completo: `C:\Users\r\.claude\plans\crea-una-nueva-versi-n-squishy-seahorse.md`.

## Reglas duras

- **NUNCA** modificar `C:\Users\r\Documents\Alienshop\PuntodeVenta(webSystem)`.
  Es solo referencia de patrones (lectura).
- Migraciones: numeradas, idempotentes (`create ... if not exists`,
  `do $$ ... exception when duplicate_object`). **Nunca editar una migración ya
  aplicada** — agregar una nueva.
- Dinero en tránsito = enteros (centavos). Ver `packages/shared/src/money.ts`.
- Toda escritura multi-tabla va dentro de **una** función Postgres (RPC) llamada
  desde la API → atómica. La API nunca encadena varias escrituras `supabase-js`.
- `sucursal_id` en toda tabla transaccional + RLS con `is_active_user_in_sucursal()`.

## Convenciones

- Tipos y schemas zod compartidos en `@abarrotes/shared` (única fuente de verdad
  para formularios web y DTOs de la API).
- Web: feature-folders en `apps/web/src/features/<modulo>/` con
  `pages/`, `hooks/`, `types.ts`, `schemas.ts`.
- API: `apps/api/src/<modulo>/` con `*.module.ts`, `*.controller.ts`,
  `*.service.ts`, `dto/`.
- Lecturas no críticas → Supabase directo desde web (RLS). Escrituras críticas →
  API NestJS.

## Estado de módulos

| Módulo            | Estado Fase 0 |
| ----------------- | ------------- |
| auth              | esqueleto     |
| pos               | esqueleto     |
| inventory         | esqueleto     |
| products          | esqueleto     |
| sucursales        | esqueleto     |
| security          | esqueleto     |
| reports           | esqueleto     |
| customers         | esqueleto     |
| purchasing        | esqueleto     |
| smart (IA)        | esqueleto (feature-flag, sin ML) |
| cloud/sync        | esqueleto     |

Phase 0 entrega estructura compilable y ruteable; la lógica funcional llega en Fase 1+.

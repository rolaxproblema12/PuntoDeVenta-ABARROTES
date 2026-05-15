# Arquitectura

Monorepo pnpm. Arquitectura **híbrida**: Supabase (Postgres + Auth + Realtime)
+ capa API REST delgada en NestJS para integridad transaccional.

```
Navegador (React PWA)
  │  lecturas no críticas + realtime  ─────────────►  Supabase (RLS)
  │  escrituras críticas (venta, caja, sync) ──────►  NestJS API ──► RPC Postgres (atómico)
  └  offline: caché IndexedDB + cola de ventas ────►  /sync/replay (idempotente)
```

- **packages/shared**: enums, tipos y schemas zod. Única fuente de verdad para
  formularios web y DTOs de la API. Dinero = centavos enteros.
- **apps/api**: NestJS 10 + Fastify. Guard JWT (verifica JWKS de Supabase),
  RolesGuard, PinGuard. Toda escritura multi-tabla → una función SQL atómica.
  Las RPC se llaman con el JWT del usuario (auth.uid() resuelto) y son
  SECURITY DEFINER para escribir; los chequeos RLS/rol viven en SQL.
- **apps/web**: React 18 + Vite + Tailwind + TanStack Query (+ persist IndexedDB)
  + Zustand. PWA con vite-plugin-pwa. Sidebar filtrado por rol.
- **supabase**: 13 migraciones idempotentes numeradas + seed.

Decisiones (ver plan): híbrido, scaffold completo de 10 módulos, IA diferida,
offline = lectura cacheada + cola de ventas con replay idempotente.

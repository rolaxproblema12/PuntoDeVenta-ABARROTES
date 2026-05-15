import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BLOCKED_TENANT = new Set(['suspended', 'canceled']);
/** Rutas siempre permitidas aunque el tenant esté suspendido. */
const EXEMPT = ['/billing', '/onboarding', '/auth', '/health', '/platform'];

/**
 * Defensa en profundidad: si la suscripción del tenant está suspendida o
 * cancelada, bloquea operaciones de escritura (salvo facturación/alta).
 * El bloqueo principal de ventas vive además en el trigger SQL
 * `sales_tenant_guard` (no se puede saltar ni por la API).
 */
@Injectable()
export class TenantActiveGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (!MUTATING.has(req.method)) return true;
    const url: string = req.url ?? '';
    if (EXEMPT.some((p) => url.includes(p))) return true;
    if (req.user?.isPlatformAdmin) return true;

    const status: string | null = req.tenant?.status ?? null;
    if (status && BLOCKED_TENANT.has(status)) {
      throw new ForbiddenException(
        'TENANT_SUSPENDED: suscripción inactiva, reactiva tu plan',
      );
    }
    return true;
  }
}

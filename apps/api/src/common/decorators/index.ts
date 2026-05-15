import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthUser, UserRole, PinGatedAction } from '@abarrotes/shared';

/** Marca una ruta como pública (sin guard JWT). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restringe por rol mínimo / lista de roles. */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Exige validación por PIN (header X-Pin) para acciones críticas. */
export const REQUIRE_PIN_KEY = 'requirePin';
export const RequirePin = (action: PinGatedAction) =>
  SetMetadata(REQUIRE_PIN_KEY, action);

/** Inyecta el usuario autenticado resuelto por SupabaseJwtGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_RANK, type AuthUser, type UserRole } from '@abarrotes/shared';
import { ROLES_KEY } from '../decorators';

/** Permite el acceso si el rol del usuario alcanza alguno de los requeridos. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('Sin usuario');

    const minRank = Math.min(...required.map((r) => ROLE_RANK[r]));
    if (ROLE_RANK[user.role] < minRank) {
      throw new ForbiddenException('Rol insuficiente');
    }
    return true;
  }
}

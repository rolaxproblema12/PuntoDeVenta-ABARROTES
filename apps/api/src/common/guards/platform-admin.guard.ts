import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/** Marca rutas que solo el dueño de la plataforma (super-admin) puede usar. */
export const PLATFORM_ONLY_KEY = 'platformOnly';
export const PlatformOnly = () =>
  Reflect.metadata(PLATFORM_ONLY_KEY, true);

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(
      PLATFORM_ONLY_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;
    const req = ctx.switchToHttp().getRequest();
    if (!req.user?.isPlatformAdmin) {
      throw new ForbiddenException('Solo el administrador de la plataforma');
    }
    return true;
  }
}

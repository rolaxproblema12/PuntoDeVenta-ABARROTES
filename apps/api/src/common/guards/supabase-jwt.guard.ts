import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthUser } from '@abarrotes/shared';
import { ENV } from '../../config/env';
import { IS_PUBLIC_KEY } from '../decorators';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Verifica el JWT emitido por Supabase contra su JWKS (sin secreto compartido),
 * valida aud/exp y carga el profile (rol, activo, sucursales) en request.user.
 * Re-chequea `active` en cada request (segunda puerta de auth, server-side).
 */
@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private readonly jwks = createRemoteJWKSet(new URL(ENV.jwksUrl));

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers?.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException('Token ausente');

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        audience: ENV.jwtAud,
      }));
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const userId = payload.sub;
    if (!userId) throw new UnauthorizedException('Token sin sujeto');

    const admin = this.supabase.admin();
    const { data: profile } = await admin
      .from('profiles')
      .select('id, email, role, active, tenant_id')
      .eq('id', userId)
      .single();

    if (!profile || !profile.active) {
      throw new UnauthorizedException('Cuenta inactiva o inexistente');
    }

    const { data: links } = await admin
      .from('user_sucursales')
      .select('sucursal_id')
      .eq('user_id', userId);

    const { data: padmin } = await admin
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    let tenantStatus: string | null = null;
    if (profile.tenant_id) {
      const { data: tenant } = await admin
        .from('tenants')
        .select('status')
        .eq('id', profile.tenant_id)
        .maybeSingle();
      tenantStatus = tenant?.status ?? null;
    }

    const user: AuthUser = {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      active: profile.active,
      sucursalIds: (links ?? []).map((l) => l.sucursal_id),
      tenantId: profile.tenant_id ?? null,
      isPlatformAdmin: !!padmin,
    };
    req.user = user;
    req.tenant = { id: profile.tenant_id ?? null, status: tenantStatus };
    req.accessToken = token;
    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PinGatedAction } from '@abarrotes/shared';
import { REQUIRE_PIN_KEY } from '../decorators';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Para acciones críticas (@RequirePin): exige el header `X-Pin` y lo valida
 * server-side vía la función SQL `verify_pin` (bajo el JWT del usuario).
 */
@Injectable()
export class PinGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<PinGatedAction>(
      REQUIRE_PIN_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!action) return true;

    const req = ctx.switchToHttp().getRequest();
    const pin: string | undefined = req.headers?.['x-pin'];
    if (!pin) throw new ForbiddenException(`PIN requerido para ${action}`);

    const { data, error } = await this.supabase
      .asUser(req.accessToken)
      .rpc('verify_pin', { p_pin: pin });

    if (error || data !== true) {
      throw new ForbiddenException('PIN incorrecto');
    }
    return true;
  }
}

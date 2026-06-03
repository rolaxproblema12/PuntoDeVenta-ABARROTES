import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Injectable } from '@nestjs/common';
import {
  cashMovementSchema,
  closeCashSessionSchema,
  openCashSessionSchema,
  type CashMovementInput,
  type CloseCashSessionInput,
  type OpenCashSessionInput,
} from '@abarrotes/shared';
import { RequirePin } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Injectable()
class CashService {
  constructor(private readonly supabase: SupabaseService) {}

  async open(token: string, userId: string, input: OpenCashSessionInput) {
    const { data, error } = await this.supabase
      .asUser(token)
      .from('cash_sessions')
      .insert({
        ...input,
        status: 'open',
        opened_by: userId,
        created_by: userId,
      })
      .select('id, status, opening_amount')
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** Corte Z atómico: efectivo esperado correcto por método + denominaciones. */
  async close(token: string, id: string, input: CloseCashSessionInput) {
    const { data, error } = await this.supabase
      .asUser(token)
      .rpc('close_cash_session', {
        p_payload: {
          session_id: id,
          counted_cash: input.counted_cash,
          closing_notes: input.closing_notes ?? null,
          denominations: input.denominations ?? null,
        },
      });
    if (error) throw new Error(error.message);
    return data;
  }

  /** Corte X (lectura): no cierra la sesión. */
  async summary(token: string, id: string) {
    const { data, error } = await this.supabase
      .asUser(token)
      .rpc('cash_session_summary', { p_session: id });
    if (error) throw new Error(error.message);
    return data;
  }

  /** Ingreso/retiro de efectivo durante la sesión. */
  async movement(token: string, id: string, input: CashMovementInput) {
    const { data, error } = await this.supabase
      .asUser(token)
      .rpc('register_cash_movement', {
        p_payload: { ...input, cash_session_id: id },
      });
    if (error) throw new Error(error.message);
    return data;
  }
}

@ApiTags('cash')
@Controller('cash')
class CashController {
  constructor(private readonly cash: CashService) {}

  @Post('sessions')
  open(
    @Req() req: any,
    @Body(new ZodValidationPipe(openCashSessionSchema))
    body: OpenCashSessionInput,
  ) {
    return this.cash.open(req.accessToken, req.user.id, body);
  }

  @Post('sessions/:id/close')
  @RequirePin('cash.close_with_difference')
  close(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(closeCashSessionSchema))
    body: CloseCashSessionInput,
  ) {
    return this.cash.close(req.accessToken, id, body);
  }

  @Get('sessions/:id/summary')
  summary(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.cash.summary(req.accessToken, id);
  }

  @Post('sessions/:id/movements')
  movement(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(cashMovementSchema)) body: CashMovementInput,
  ) {
    return this.cash.movement(req.accessToken, id, body);
  }
}

@Module({ controllers: [CashController], providers: [CashService] })
export class CashModule {}

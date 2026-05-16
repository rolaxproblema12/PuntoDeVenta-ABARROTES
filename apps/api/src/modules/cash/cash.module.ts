import { Body, Controller, Module, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Injectable } from '@nestjs/common';
import {
  closeCashSessionSchema,
  openCashSessionSchema,
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

  async close(token: string, id: string, input: CloseCashSessionInput) {
    const sb = this.supabase.asUser(token);
    const { data: expected } = await sb
      .from('sales')
      .select('total')
      .eq('cash_session_id', id)
      .eq('status', 'completada');
    const expectedCash =
      (expected ?? []).reduce((a, r) => a + (r.total as number), 0) ?? 0;
    const { data, error } = await sb
      .from('cash_sessions')
      .update({
        status: 'closed',
        counted_cash: input.counted_cash,
        expected_cash: expectedCash,
        difference: input.counted_cash - expectedCash,
        closing_notes: input.closing_notes ?? null,
      })
      .eq('id', id)
      .select('id, status, expected_cash, counted_cash, difference')
      .single();
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
    @Param('id') id: string,
    @Body(new ZodValidationPipe(closeCashSessionSchema))
    body: CloseCashSessionInput,
  ) {
    return this.cash.close(req.accessToken, id, body);
  }
}

@Module({ controllers: [CashController], providers: [CashService] })
export class CashModule {}

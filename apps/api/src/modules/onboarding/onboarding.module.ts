import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { signupSchema, type SignupInput } from '@abarrotes/shared';
import { Public } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Injectable()
class OnboardingService {
  constructor(private readonly supabase: SupabaseService) {}

  async listPlans() {
    const { data, error } = await this.supabase
      .admin()
      .from('plans')
      .select('code, name, price_cents, currency, max_sucursales, max_users')
      .order('price_cents');
    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Alta self-service: crea el usuario auth y provisiona TODO su sistema en
   * una transacción (RPC provision_tenant). El web luego hace sign-in.
   */
  async signup(input: SignupInput) {
    const admin = this.supabase.admin();

    const { data: created, error: userErr } = await admin.auth.admin.createUser(
      {
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: input.owner_name },
      },
    );
    if (userErr || !created.user) {
      throw new Error(userErr?.message ?? 'No se pudo crear el usuario');
    }

    const { data, error } = await admin.rpc('provision_tenant', {
      p: {
        owner_user_id: created.user.id,
        business_name: input.business_name,
        owner_name: input.owner_name,
        plan_code: input.plan_code,
      },
    });
    if (error) {
      // Limpia el usuario huérfano si el provisioning falló.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      throw new Error(error.message);
    }
    return data;
  }
}

@ApiTags('onboarding')
@Controller('onboarding')
class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Public()
  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  @Public()
  @Post('signup')
  signup(
    @Body(new ZodValidationPipe(signupSchema)) body: SignupInput,
  ) {
    return this.svc.signup(body);
  }
}

@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}

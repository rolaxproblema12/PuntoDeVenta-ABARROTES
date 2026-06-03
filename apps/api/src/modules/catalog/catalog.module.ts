import {
  Body,
  Controller,
  Injectable,
  Module,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { saveProductSchema, type SaveProductInput } from '@abarrotes/shared';
import { Roles } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SupabaseService } from '../../common/supabase/supabase.service';

/**
 * Catálogo. El alta/edición de producto es multi-tabla (products + precio +
 * código + stock inicial) y por eso ocurre en UNA RPC atómica `upsert_product`,
 * invocada con el JWT del usuario (RLS + guard de sucursal dentro de la función).
 * (Las categorías son tabla única → la web las escribe directo por Supabase.)
 */
@Injectable()
class CatalogService {
  constructor(private readonly supabase: SupabaseService) {}

  async upsertProduct(token: string, input: SaveProductInput) {
    const { data, error } = await this.supabase
      .asUser(token)
      .rpc('upsert_product', { p: input });
    if (error) throw new Error(error.message);
    return data;
  }
}

@ApiTags('catalog')
@Controller('catalog')
class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Alta o edición de producto (atómica). */
  @Post('products')
  @Roles('encargado')
  saveProduct(
    @Req() req: any,
    @Body(new ZodValidationPipe(saveProductSchema)) body: SaveProductInput,
  ) {
    return this.catalog.upsertProduct(req.accessToken, body);
  }
}

@Module({ controllers: [CatalogController], providers: [CatalogService] })
export class CatalogModule {}

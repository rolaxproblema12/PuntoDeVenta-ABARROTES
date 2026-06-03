import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  cancelSaleSchema,
  createSaleSchema,
  type CancelSaleInput,
  type CreateSaleInput,
} from '@abarrotes/shared';
import { Roles, RequirePin } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SalesService } from './sales.service';

@ApiTags('sales')
@Controller('sales')
class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** Crea una venta (atómica + idempotente). Soporta replay offline. */
  @Post()
  create(
    @Req() req: any,
    @Body(new ZodValidationPipe(createSaleSchema)) body: CreateSaleInput,
  ) {
    return this.sales.createSale(req.accessToken, body);
  }

  @Post(':id/cancel')
  @Roles('supervisor')
  @RequirePin('sale.cancel')
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSaleSchema)) body: CancelSaleInput,
  ) {
    return this.sales.cancelSale(req.accessToken, id, body.reason);
  }

  @Get()
  list(
    @Req() req: any,
    @Query('sucursal_id', new ParseUUIDPipe({ version: '4' }))
    sucursalId: string,
  ) {
    return this.sales.listSales(req.accessToken, sucursalId);
  }
}

@Module({
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}

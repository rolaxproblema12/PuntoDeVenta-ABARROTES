import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/** Mapea códigos de error de las RPC Postgres a HTTP. */
const PG_ERROR_MAP: Record<string, { status: number; code: string }> = {
  STOCK_INSUFFICIENT: { status: 409, code: 'STOCK_INSUFFICIENT' },
  CREDIT_LIMIT: { status: 409, code: 'CREDIT_LIMIT' },
  CREDIT_NO_CUSTOMER: { status: 400, code: 'CREDIT_NO_CUSTOMER' },
  CASH_SESSION_CLOSED: { status: 409, code: 'CASH_SESSION_CLOSED' },
  FORBIDDEN_SUCURSAL: { status: 403, code: 'FORBIDDEN_SUCURSAL' },
  UNSUPPORTED_OP: { status: 400, code: 'UNSUPPORTED_OP' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const requestId = randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = 'Error interno';
    let details: unknown;
    // Marca el caso fallthrough: ni HttpException ni mapeado por PG_ERROR_MAP.
    let unmappedInternal = false;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? 'ERROR';
      const r = exception.getResponse();
      message = typeof r === 'string' ? r : ((r as any).message ?? message);
      details = typeof r === 'object' ? r : undefined;
    } else if (exception && typeof exception === 'object') {
      const raw = String((exception as any).message ?? '');
      const key = Object.keys(PG_ERROR_MAP).find((k) => raw.includes(k));
      if (key) {
        status = PG_ERROR_MAP[key]!.status;
        code = PG_ERROR_MAP[key]!.code;
        message = raw;
      } else {
        // 500 no clasificado: no filtrar detalles internos al cliente.
        unmappedInternal = true;
        message = 'Error interno del servidor';
      }
    } else {
      unmappedInternal = true;
      message = 'Error interno del servidor';
    }

    if (unmappedInternal) {
      // Registro completo del error real solo en servidor.
      this.logger.error(
        JSON.stringify({
          requestId,
          rawMessage: String((exception as any)?.message ?? exception),
        }),
        (exception as any)?.stack,
      );
    } else if (status >= 500) {
      this.logger.error(`[${requestId}] ${message}`, (exception as any)?.stack);
    }

    res.status(status).send({ error: { code, message, details }, requestId });
  }
}

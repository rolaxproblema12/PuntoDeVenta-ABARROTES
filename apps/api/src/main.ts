import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ENV } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    // rawBody: necesario para verificar la firma del webhook de Stripe.
    { logger: ['error', 'warn', 'log'], rawBody: true },
  );

  app.setGlobalPrefix(ENV.apiPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: ENV.apiVersion,
  });
  // En producción usa la allowlist de ENV; en dev (o sin allowlist) abre origin
  // para no romper el flujo local.
  const useAllowlist =
    ENV.nodeEnv === 'production' && ENV.corsOrigins.length > 0;
  app.enableCors({
    origin: useAllowlist ? ENV.corsOrigins : true,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ABARROTES POS API')
    .setDescription('Capa REST transaccional (Supabase + NestJS)')
    .setVersion(`v${ENV.apiVersion}`)
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${ENV.apiPrefix}/v${ENV.apiVersion}/docs`, app, doc);

  await app.listen(ENV.port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `API en http://localhost:${ENV.port}/${ENV.apiPrefix}/v${ENV.apiVersion} ` +
      `· Swagger /${ENV.apiPrefix}/v${ENV.apiVersion}/docs`,
  );
}

void bootstrap();

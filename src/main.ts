import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.validation';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Before the container starts, so a misconfigured deploy fails immediately
  // rather than serving traffic with forgeable tokens.
  const { isProduction } = validateEnv();

  const app = await NestFactory.create(AppModule, {
    // Stack traces and driver errors must never reach a client response.
    logger: isProduction ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // `enableCors()` with no arguments allowed every origin on the internet to
  // make credentialed requests against the billing API.
  const origins =
    process.env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [];

  app.enableCors({
    origin: origins.length > 0 ? origins : !isProduction,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  // Swagger exposes the full API shape including auth flows. Useful in
  // development, an unnecessary disclosure in production.
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SS-Billing API')
      .setDescription('Decentralized subscription billing platform')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
    logger.log('Swagger UI mounted at /docs');
  }

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  logger.log(`API listening on port ${port}`);
}

bootstrap().catch((err) => {
  // Configuration failures surface here. Log and exit non-zero so the
  // orchestrator restarts or halts the rollout instead of running degraded.
  new Logger('Bootstrap').error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

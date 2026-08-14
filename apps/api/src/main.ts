import cookie from '@fastify/cookie';
import { defaultPorts } from '@tavi/config';
import { AppModule } from './app.module';
import { AppLogger } from './app-logger';
import { registerHttpObservability } from './http-observability';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 10 * 1024 * 1024,
    }),
    {
      bufferLogs: true,
    },
  );
  const logger = app.get(AppLogger);

  app.useLogger(logger);

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // Cast needed: Fastify 5.11.3 plugin generics disagree with Nest's Fastify
  // adapter register signature for @fastify/cookie.
  await app.register(
    cookie as Parameters<NestFastifyApplication['register']>[0],
    {
      secret: process.env.COOKIE_SECRET ?? 'tavi-local-dev-secret',
    },
  );
  app.enableCors({
    credentials: true,
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'],
  });
  registerHttpObservability(app);

  const port = Number(process.env.PORT ?? defaultPorts.api);

  await app.listen({
    port,
    host: '0.0.0.0',
  });
  logger.log('api.ready', { port });
}

void bootstrap();
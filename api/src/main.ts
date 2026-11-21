import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { raw } from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { config } from './config';

/** Production must not start with development secrets or settings. */
function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const weak = (['jwtSecret', 'qrSecret', 'otpSecret'] as const).filter((k) => config[k].includes('dev') || config[k].length < 32);
  if (weak.length) throw new Error(`Set strong JWT_SECRET, QR_SECRET, OTP_SECRET (32+ chars). Weak: ${weak.join(', ')}`);
  if (config.otpDevEcho) throw new Error('OTP_DEV_ECHO must be off in production');
  if (!config.uploads.bucket) throw new Error('Set S3_BUCKET and S3_PUBLIC_BASE_URL for photo uploads in production');
  if (!config.cashfree.appId || !config.cashfree.secretKey) console.warn('Cashfree keys not set: shops cannot pay for packages yet.');
}

export async function createApp() {
  assertProductionConfig();
  // rawBody: Cashfree webhooks are verified against the exact bytes received.
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], rawBody: true });
  app.setGlobalPrefix('v1');
  // Security headers (API only serves JSON and dev files, so no CSP needed) and gzip for slow mobile networks.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression({ threshold: 1024 }));
  app.enableShutdownHooks();
  // Development photo storage: images arrive as raw bytes (production uses S3 presigned uploads).
  app.use('/v1/uploads/local', raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }));
  app.enableCors(config.corsOrigins.length ? { origin: config.corsOrigins } : undefined);
  return app;
}

if (require.main === module) {
  createApp().then(async (app) => {
    await app.listen(config.port);
    console.log(`Mere Points API on :${config.port}/v1`);
  });
}

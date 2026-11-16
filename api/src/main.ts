import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

/** Production must not start with development secrets or settings. */
function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const weak = (['jwtSecret', 'qrSecret', 'otpSecret'] as const).filter((k) => config[k].includes('dev') || config[k].length < 32);
  if (weak.length) throw new Error(`Set strong JWT_SECRET, QR_SECRET, OTP_SECRET (32+ chars). Weak: ${weak.join(', ')}`);
  if (config.otpDevEcho) throw new Error('OTP_DEV_ECHO must be off in production');
  if (!config.razorpay.keyId || !config.razorpay.keySecret) console.warn('Razorpay keys not set: shops cannot pay for plans yet.');
}

export async function createApp() {
  assertProductionConfig();
  // rawBody: Razorpay webhooks are verified against the exact bytes received.
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], rawBody: true });
  app.setGlobalPrefix('v1');
  app.enableCors(config.corsOrigins.length ? { origin: config.corsOrigins } : undefined);
  return app;
}

if (require.main === module) {
  createApp().then(async (app) => {
    await app.listen(config.port);
    console.log(`Vyapar Point API on :${config.port}/v1`);
  });
}

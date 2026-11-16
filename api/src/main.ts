import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('v1');
  app.enableCors();
  return app;
}

if (require.main === module) {
  createApp().then(async (app) => {
    await app.listen(config.port);
    console.log(`Vyapar Point API on :${config.port}/v1`);
  });
}

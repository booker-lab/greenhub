import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { TimestampInterceptor } from './common/interceptors/timestamp.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalInterceptors(new TimestampInterceptor());

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3001',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`API Server running on port ${process.env.PORT ?? 3000}`);
}
bootstrap();

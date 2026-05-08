import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TimestampInterceptor } from './common/interceptors/timestamp.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new TimestampInterceptor());

  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        // 프로덕션에서는 origin 없는 요청 차단 (개발 환경에서만 허용)
        if (process.env.NODE_ENV === 'production') return callback(new Error('CORS rejected: no origin'));
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`API Server running on port ${process.env.PORT ?? 3000}`);
}
bootstrap();

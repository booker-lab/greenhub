import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import {
  configuredVercelPreviewProjects,
  isAllowedVercelPreviewOrigin,
} from './common/cors-origin';
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

  // Vercel preview 배포는 브랜치마다 URL이 달라 CORS_ORIGIN 정적 목록으로
  // 관리 불가 — jos-projects-d1cecc0c 팀 스코프로 한정한 패턴으로만 허용.
  // 형식: {project}-git-{branch}-jos-projects-d1cecc0c.vercel.app
  const previewProjects = configuredVercelPreviewProjects();
  const previewTeam = process.env.VERCEL_PREVIEW_TEAM ?? 'jos-projects-d1cecc0c';

  app.enableCors({
    origin: (origin, callback) => {
      // origin 없는 요청(헬스체크, 서버 간 통신)은 CORS 대상 아님 — 허용
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (isAllowedVercelPreviewOrigin(origin, previewProjects, previewTeam)) {
        return callback(null, true);
      }
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`API Server running on port ${process.env.PORT ?? 3000}`);
}
bootstrap();

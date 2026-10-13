import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { isAllowedCorsOrigin, resolveCorsOriginPolicy } from './common/cors-origin';
import { TimestampInterceptor } from './common/interceptors/timestamp.interceptor';
import { sanitizedValidationPipeOptions } from './common/validation/sanitized-validation';
import { resolveTrustProxyHops } from './config/runtime-config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // 신뢰할 프록시 홉 수만큼만 X-Forwarded-For를 해석해 req.ip를 정한다(요청 한도 집계 기준).
  // 0이면 프록시 헤더를 믿지 않고 소켓 상대 주소를 쓴다.
  const trustProxyHops = resolveTrustProxyHops(process.env);
  (app as NestExpressApplication).set('trust proxy', trustProxyHops > 0 ? trustProxyHops : false);
  app.enableShutdownHooks();

  app.use(helmet());

  // PILOT-AUTH-SANITIZED-VALIDATION-OBSERVABILITY-AND-EXACT-REVERIFY-34A:
  // OBSERVABILITY ONLY. Acceptance unchanged (whitelist + forbidNonWhitelisted).
  // The factory preserves 400 message/error/statusCode and additively attaches
  // sanitized validation.fields (property + constraint keys only, no values).
  app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
  app.useGlobalInterceptors(new TimestampInterceptor());

  // Vercel preview 배포는 브랜치마다 URL이 달라 CORS_ORIGIN 정적 목록으로
  // 관리 불가 — 팀 스코프로 한정한 패턴으로만 허용하며, 운영 런타임에서는
  // CORS_ALLOW_VERCEL_PREVIEWS=true일 때만 허용한다.
  // 형식: {project}-git-{branch}-{team}.vercel.app
  // 거부는 오류가 아니라 CORS 헤더 미부여로 처리한다(500 대신 브라우저 차단).
  // API는 Bearer 토큰 인증만 쓰므로 credentials(쿠키) 허용은 두지 않는다.
  const corsPolicy = resolveCorsOriginPolicy(process.env);
  app.enableCors({
    origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin, corsPolicy)),
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`API Server running on port ${process.env.PORT ?? 3000}`);
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    'API 서버 기동에 실패했습니다.',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './common/audit/audit.module';
import { FirestoreRetryableErrorFilter } from './common/filters/firestore-retryable-error.filter';
import { ClientThrottlerGuard } from './common/guards/client-throttler.guard';
import { shouldEnableScheduledJobs, validateRuntimeConfig, isApiUnitTestEnv } from './config/runtime-config';
import { DriverModule } from './driver/driver.module';
import { FirestoreModule } from './firestore/firestore.module';
import { HubsModule } from './hubs/hubs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OperationsModule } from './operations/operations.module';
import { OpsAlertModule } from './ops-alerts/ops-alert.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ProductsModule } from './products/products.module';
import { RetentionModule } from './retention/retention.module';
import { SaleRoundsModule } from './sale-rounds/sale-rounds.module';
import { SettlementsModule } from './settlements/settlements.module';
import { StoresModule } from './stores/stores.module';
import { VarietiesModule } from './varieties/varieties.module';

const configModule = ConfigModule.forRoot({
  isGlobal: true,
  validate: validateRuntimeConfig,
  ignoreEnvFile: isApiUnitTestEnv(process.env),
});
const scheduleModule = shouldEnableScheduledJobs(process.env)
  ? ScheduleModule.forRoot()
  : undefined;

@Module({
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ClientThrottlerGuard },
    { provide: APP_FILTER, useClass: FirestoreRetryableErrorFilter },
  ],

  imports: [
    configModule,
    ...(scheduleModule ? [scheduleModule] : []),
    // 'default' 단일 throttler만 전역 등록 — 일반 라우트 1분 100회.
    // 인증 라우트(register/login/kakao-login/refresh)는 auth.controller에서
    // @Throttle로 1분 10회 오버라이드. 등록된 모든 throttler는 전 라우트에
    // 전역 적용되므로, 별도 'auth' throttler를 두면 /health 등 비인증
    // 라우트까지 10/분으로 묶인다 (P2-A 계측 발견 — #CL-30).
    // 집계 기준(검증된 sub·login IP+이메일·클라이언트 IP)은 ClientThrottlerGuard가 정한다.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
      errorMessage: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    }),
    FirestoreModule,
    OpsAlertModule,
    AuditModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
    PaymentsModule,
    NotificationsModule,
    StoresModule,
    SettlementsModule,
    HubsModule,
    AdminModule,
    DriverModule,
    VarietiesModule,
    AiModule,
    SaleRoundsModule,
    OperationsModule,
    RetentionModule,
  ],
})
export class AppModule {}

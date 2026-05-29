import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BannerQueryService } from './banners/banner-query.service';
import { AuditModule } from './common/audit/audit.module';
import { DriverModule } from './driver/driver.module';
import { FirestoreModule } from './firestore/firestore.module';
import { HubsModule } from './hubs/hubs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ProductsModule } from './products/products.module';
import { SettlementsModule } from './settlements/settlements.module';
import { StoresModule } from './stores/stores.module';
import { VarietiesModule } from './varieties/varieties.module';

@Module({
  controllers: [AppController],
  providers: [AppService, BannerQueryService, { provide: APP_GUARD, useClass: ThrottlerGuard }],

  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // 'default' 단일 throttler만 전역 등록 — 일반 라우트 1분 100회.
    // 인증 라우트(register/login/kakao-login/refresh)는 auth.controller에서
    // @Throttle로 1분 10회 오버라이드. 등록된 모든 throttler는 전 라우트에
    // 전역 적용되므로, 별도 'auth' throttler를 두면 /health 등 비인증
    // 라우트까지 10/분으로 묶인다 (P2-A 계측 발견 — #CL-30).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
    }),
    FirestoreModule,
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
  ],
})
export class AppModule {}

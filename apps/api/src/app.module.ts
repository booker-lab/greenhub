import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { FirestoreModule } from './firestore/firestore.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StoresModule } from './stores/stores.module';
import { SettlementsModule } from './settlements/settlements.module';
import { HubsModule } from './hubs/hubs.module';
import { AdminModule } from './admin/admin.module';
import { DriverModule } from './driver/driver.module';
import { AuditModule } from './common/audit/audit.module';
import { VarietiesModule } from './varieties/varieties.module';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60000, limit: 100 },  // 일반: 1분 100회
        { name: 'auth', ttl: 60000, limit: 10 },       // 인증: 1분 10회
      ],
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

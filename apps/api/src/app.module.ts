import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  controllers: [AppController],
  providers: [AppService],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
    FirestoreModule,
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
  ],
})
export class AppModule {}

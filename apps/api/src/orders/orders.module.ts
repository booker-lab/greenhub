import { Module } from '@nestjs/common';
import { OrdersController, OrdersPublicController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersCreateService } from './orders-create.service';
import { OrdersQueryService } from './orders-query.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettlementsModule } from '../settlements/settlements.module';

@Module({
  imports: [NotificationsModule, PaymentsModule, SettlementsModule],
  controllers: [OrdersPublicController, OrdersController],
  providers: [OrdersService, OrdersCreateService, OrdersQueryService, OrdersLifecycleService],
  exports: [OrdersService],
})
export class OrdersModule {}

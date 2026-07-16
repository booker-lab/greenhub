import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationsModule } from '../operations/operations.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettlementsModule } from '../settlements/settlements.module';
import { OrderCapacityModule } from './order-capacity.module';
import { OrderChargesService } from './order-charges.service';
import { OrdersController, OrdersPublicController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersCreateService } from './orders-create.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { OrdersQueryService } from './orders-query.service';
import { RoundOrderCreateService } from './round-order-create.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

@Module({
  imports: [
    NotificationsModule,
    PaymentsModule,
    SettlementsModule,
    OrderCapacityModule,
    OperationsModule,
  ],
  controllers: [OrdersPublicController, OrdersController],
  providers: [
    OrdersService,
    OrdersCreateService,
    RoundOrderCreateService,
    OrdersQueryService,
    OrdersLifecycleService,
    RoundOrderLifecycleService,
    OrderChargesService,
  ],
  exports: [OrdersService, RoundOrderLifecycleService],
})
export class OrdersModule {}

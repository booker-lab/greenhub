import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationIssuesModule } from '../operations/operation-issues.module';
import { PaymentsModule } from '../payments/payments.module';
import { RetentionModule } from '../retention/retention.module';
import { SettlementsModule } from '../settlements/settlements.module';
import { DeliveryPhotosController } from './delivery-photos.controller';
import { DeliveryPhotosService } from './delivery-photos.service';
import { OrderCapacityModule } from './order-capacity.module';
import { OrderChargesService } from './order-charges.service';
import { OrdersController, OrdersPublicController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersCreateService } from './orders-create.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { OrdersQueryService } from './orders-query.service';
import { RoundOrderCreateService } from './round-order-create.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';
import { DriverOrderScopeService } from './driver-order-scope.service';

@Module({
  imports: [
    NotificationsModule,
    PaymentsModule,
    SettlementsModule,
    OrderCapacityModule,
    OperationIssuesModule,
    RetentionModule,
  ],
  controllers: [OrdersPublicController, OrdersController, DeliveryPhotosController],
  providers: [
    OrdersService,
    OrdersCreateService,
    RoundOrderCreateService,
    OrdersQueryService,
    OrdersLifecycleService,
    RoundOrderLifecycleService,
    DriverOrderScopeService,
    OrderChargesService,
    DeliveryPhotosService,
  ],
  exports: [
    OrdersService,
    OrdersQueryService,
    RoundOrderLifecycleService,
    DriverOrderScopeService,
  ],
})
export class OrdersModule {}

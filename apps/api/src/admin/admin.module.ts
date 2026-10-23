import { Module } from '@nestjs/common';
import { AdminPostDeliveryRefundController } from './admin-post-delivery-refund.controller';
import { AdminPostDeliveryRefundService } from './admin-post-delivery-refund.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettlementsModule } from '../settlements/settlements.module';

@Module({
  imports: [PaymentsModule, OrdersModule, SettlementsModule, NotificationsModule],
  controllers: [AdminController, AdminPostDeliveryRefundController],
  providers: [AdminService, AdminPostDeliveryRefundService],
})
export class AdminModule {}

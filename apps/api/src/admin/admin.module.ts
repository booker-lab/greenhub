import { Module } from '@nestjs/common';
import { AdminPostDeliveryRefundController } from './admin-post-delivery-refund.controller';
import { AdminPostDeliveryRefundService } from './admin-post-delivery-refund.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettlementsModule } from '../settlements/settlements.module';

@Module({
  imports: [PaymentsModule, OrdersModule, SettlementsModule],
  controllers: [AdminController, AdminPostDeliveryRefundController],
  providers: [AdminService, AdminPostDeliveryRefundService],
})
export class AdminModule {}

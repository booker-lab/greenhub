import { forwardRef, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderCapacityModule } from '../orders/order-capacity.module';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentRefundService } from './payment-refund.service';
import { PaymentsController, RefundController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PortoneClient } from './portone.client';

@Module({
  imports: [forwardRef(() => NotificationsModule), OrderCapacityModule],
  controllers: [PaymentsController, RefundController],
  providers: [PaymentsService, PaymentFinalizationService, PaymentRefundService, PortoneClient],
  exports: [PaymentsService],
})
export class PaymentsModule {}

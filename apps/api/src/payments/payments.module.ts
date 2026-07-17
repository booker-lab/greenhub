import { forwardRef, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationIssuesModule } from '../operations/operation-issues.module';
import { OrderCapacityModule } from '../orders/order-capacity.module';
import { RetentionModule } from '../retention/retention.module';
import { OrderChargePaymentService } from './order-charge-payment.service';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentRefundService } from './payment-refund.service';
import { PaymentsController, RefundController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PortoneClient } from './portone.client';

@Module({
  imports: [
    forwardRef(() => NotificationsModule),
    OrderCapacityModule,
    OperationIssuesModule,
    RetentionModule,
  ],
  controllers: [PaymentsController, RefundController],
  providers: [
    PaymentsService,
    PaymentFinalizationService,
    PaymentRefundService,
    OrderChargePaymentService,
    PortoneClient,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}

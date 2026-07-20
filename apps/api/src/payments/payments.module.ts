import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveE2EProviderMode } from '../common/e2e-provider-mode';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationIssuesModule } from '../operations/operation-issues.module';
import { OrderCapacityModule } from '../orders/order-capacity.module';
import { RetentionModule } from '../retention/retention.module';
import { OrderChargePaymentService } from './order-charge-payment.service';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentRefundService } from './payment-refund.service';
import { PaymentsController, RefundController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { E2EPortoneClient } from './e2e-portone.client';
import { PortoneClient } from './portone.client';

export function createPortoneProvider(config: ConfigService): PortoneClient {
  const mode = resolveE2EProviderMode(config);
  return mode.enabled
    ? (new E2EPortoneClient(config) as unknown as PortoneClient)
    : new PortoneClient(config);
}

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
    {
      provide: PortoneClient,
      inject: [ConfigService],
      useFactory: createPortoneProvider,
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}

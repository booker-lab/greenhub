import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController, RefundController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PortoneClient } from './portone.client';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderCapacityModule } from '../orders/order-capacity.module';

@Module({
  imports: [forwardRef(() => NotificationsModule), OrderCapacityModule],
  controllers: [PaymentsController, RefundController],
  providers: [PaymentsService, PortoneClient],
  exports: [PaymentsService],
})
export class PaymentsModule {}

import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController, RefundController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PortoneClient } from './portone.client';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [PaymentsController, RefundController],
  providers: [PaymentsService, PortoneClient],
  exports: [PaymentsService],
})
export class PaymentsModule {}

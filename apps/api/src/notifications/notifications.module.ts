import { Module, forwardRef } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AligoClient } from './aligo.client';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [forwardRef(() => PaymentsModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService, AligoClient],
  exports: [NotificationsService],
})
export class NotificationsModule {}

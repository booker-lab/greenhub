import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AligoClient } from './aligo.client';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  providers: [NotificationsService, AligoClient],
  exports: [NotificationsService],
})
export class NotificationsModule {}

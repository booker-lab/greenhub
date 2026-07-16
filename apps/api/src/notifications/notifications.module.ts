import { forwardRef, Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { PaymentsModule } from '../payments/payments.module';
import { AligoClient } from './aligo.client';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [forwardRef(() => PaymentsModule), forwardRef(() => OperationsModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService, AligoClient],
  exports: [NotificationsService],
})
export class NotificationsModule {}

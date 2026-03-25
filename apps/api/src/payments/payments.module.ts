import { Module } from '@nestjs/common';
import { PaymentsController, RefundController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PortoneClient } from './portone.client';

@Module({
  controllers: [PaymentsController, RefundController],
  providers: [PaymentsService, PortoneClient],
  exports: [PaymentsService],
})
export class PaymentsModule {}

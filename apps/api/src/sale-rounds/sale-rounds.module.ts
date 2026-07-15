import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PublicSaleRoundsController, SaleRoundsController } from './sale-rounds.controller';
import { SaleRoundsService } from './sale-rounds.service';

@Module({
  imports: [PaymentsModule],
  controllers: [PublicSaleRoundsController, SaleRoundsController],
  providers: [SaleRoundsService],
  exports: [SaleRoundsService],
})
export class SaleRoundsModule {}

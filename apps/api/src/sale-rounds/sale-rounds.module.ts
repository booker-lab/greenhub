import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SaleRoundStateService } from './sale-round-state.service';
import { PublicSaleRoundsController, SaleRoundsController } from './sale-rounds.controller';
import { SaleRoundsService } from './sale-rounds.service';

@Module({
  imports: [OrdersModule],
  controllers: [PublicSaleRoundsController, SaleRoundsController],
  providers: [SaleRoundsService, SaleRoundStateService],
  exports: [SaleRoundsService],
})
export class SaleRoundsModule {}

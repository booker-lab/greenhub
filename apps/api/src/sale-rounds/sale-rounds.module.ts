import { Module } from '@nestjs/common';
import { PublicSaleRoundsController, SaleRoundsController } from './sale-rounds.controller';
import { SaleRoundsService } from './sale-rounds.service';

@Module({
  controllers: [PublicSaleRoundsController, SaleRoundsController],
  providers: [SaleRoundsService],
  exports: [SaleRoundsService],
})
export class SaleRoundsModule {}

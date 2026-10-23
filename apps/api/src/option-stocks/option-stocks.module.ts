import { Module } from '@nestjs/common';
import { OptionStocksController } from './option-stocks.controller';
import { OptionStocksService } from './option-stocks.service';

@Module({
  controllers: [OptionStocksController],
  providers: [OptionStocksService],
})
export class OptionStocksModule {}

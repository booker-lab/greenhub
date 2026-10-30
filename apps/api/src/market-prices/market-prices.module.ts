import { Module } from '@nestjs/common';
import { FLOWER_AUCTION_FETCH, FlowerAuctionClient, type FlowerAuctionFetch } from './flower-auction.client';
import { MarketPricesController } from './market-prices.controller';
import { MarketPricesService } from './market-prices.service';

const defaultFetch: FlowerAuctionFetch = (url, init) => fetch(url, init);

@Module({
  controllers: [MarketPricesController],
  providers: [
    MarketPricesService,
    FlowerAuctionClient,
    { provide: FLOWER_AUCTION_FETCH, useValue: defaultFetch },
  ],
  exports: [MarketPricesService],
})
export class MarketPricesModule {}

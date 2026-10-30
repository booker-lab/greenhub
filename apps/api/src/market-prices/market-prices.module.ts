import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FLOWER_AUCTION_FETCH, FlowerAuctionClient, resolveFlowerAuctionFetch } from './flower-auction.client';
import { MarketPricesController } from './market-prices.controller';
import { MarketPricesService } from './market-prices.service';

/** aT 호출 경로. 고정 IP 프록시 설정이 있으면 그 프록시로만 보낸다. */
export const flowerAuctionFetchProvider: Provider = {
  provide: FLOWER_AUCTION_FETCH,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    resolveFlowerAuctionFetch(config.get<string>('FLOWER_AUCTION_OUTBOUND_PROXY_URL')),
};

@Module({
  controllers: [MarketPricesController],
  providers: [MarketPricesService, FlowerAuctionClient, flowerAuctionFetchProvider],
  exports: [MarketPricesService],
})
export class MarketPricesModule {}

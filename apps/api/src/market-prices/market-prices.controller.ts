import { MARKET_UNITS_PER_ITEM_MAX, type FlowerMarketGubn } from '@greenhub/shared';
import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MarketCatalogQueryDto, MarketLookupQueryDto, MarketSummariesQueryDto } from './dto/market-ref.dto';
import { MarketPricesService } from './market-prices.service';

// 경매 시세 조회. 판매자는 자기 가게만(서비스가 소유 확인), 관리자는 모든 가게. 손님에게는 열지 않는다.
@Controller('stores/:storeId/market-prices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MarketPricesController {
  constructor(private readonly marketPrices: MarketPricesService) {}

  /** 상품별 시세(회차 가격·구매 목록 화면). */
  @Get()
  @Roles('seller', 'admin')
  summaries(
    @Param('storeId') storeId: string,
    @Query() query: MarketSummariesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.marketPrices.summaries(storeId, user.sub, user.role, query.productIds.split(','));
  }

  /** 부류별 품목·품종 이름(상품 편집의 시세 연결 칸). */
  @Get('catalog')
  @Roles('seller', 'admin')
  catalog(
    @Param('storeId') storeId: string,
    @Query() query: MarketCatalogQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.marketPrices.catalog(storeId, user.sub, user.role, Number(query.flowerGubn) as FlowerMarketGubn);
  }

  /** 저장 전 연결 조건으로 시세 미리 보기. */
  @Get('lookup')
  @Roles('seller', 'admin')
  lookup(
    @Param('storeId') storeId: string,
    @Query() query: MarketLookupQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const unitsPerItem = query.unitsPerItem === undefined ? 1 : Number(query.unitsPerItem);
    if (!(unitsPerItem > 0) || unitsPerItem > MARKET_UNITS_PER_ITEM_MAX) {
      throw new BadRequestException('상품 1개당 경매 단위 수 형식이 올바르지 않습니다.');
    }
    return this.marketPrices.lookup(storeId, user.sub, user.role, {
      flowerGubn: Number(query.flowerGubn) as FlowerMarketGubn,
      pumName: query.pumName,
      ...(query.goodName ? { goodName: query.goodName } : {}),
      ...(query.grade ? { grade: query.grade } : {}),
      unitsPerItem,
    });
  }
}

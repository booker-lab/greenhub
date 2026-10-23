import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateOptionStockDto, UpdateOptionStockDto } from './dto/option-stock.dto';
import { OptionStocksService } from './option-stocks.service';

// 매장 옵션 재고 품목(직접 출력한 화분 등). 판매자는 자기 가게만(서비스가 소유 확인), 관리자는 모든 가게.
@Controller('stores/:storeId/option-stocks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OptionStocksController {
  constructor(private readonly optionStocks: OptionStocksService) {}

  @Get()
  @Roles('seller', 'admin')
  list(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.optionStocks.list(storeId, user.sub, user.role);
  }

  @Post()
  @Roles('seller', 'admin')
  create(
    @Param('storeId') storeId: string,
    @Body() dto: CreateOptionStockDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.optionStocks.create(storeId, user.sub, user.role, dto);
  }

  @Patch(':stockId')
  @Roles('seller', 'admin')
  update(
    @Param('storeId') storeId: string,
    @Param('stockId') stockId: string,
    @Body() dto: UpdateOptionStockDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.optionStocks.update(storeId, stockId, user.sub, user.role, dto);
  }
}

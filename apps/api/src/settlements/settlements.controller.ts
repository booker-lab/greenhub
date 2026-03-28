import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { QuerySettlementsDto, QuerySummaryDto } from './dto/query-settlements.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('stores/:storeId/settlements')
@UseGuards(JwtAuthGuard)
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  // summary는 :settlementId와 충돌하지 않도록 먼저 선언
  @Get('summary')
  getSummary(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Query() dto: QuerySummaryDto,
  ) {
    return this.settlementsService.getSummary(storeId, user.sub, dto);
  }

  @Get()
  getSettlements(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Query() dto: QuerySettlementsDto,
  ) {
    return this.settlementsService.getSettlements(storeId, user.sub, dto);
  }
}

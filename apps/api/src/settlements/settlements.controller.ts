import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { QuerySettlementsDto, QuerySummaryDto } from './dto/query-settlements.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

// 판매자 앱 정산 화면 전용(판매자·관리자). 매장 소유 확인은 서비스가 한 번 더 한다.
@Controller('stores/:storeId/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  // summary는 :settlementId와 충돌하지 않도록 먼저 선언
  @Get('summary')
  getSummary(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Query() dto: QuerySummaryDto,
  ) {
    return this.settlementsService.getSummary(storeId, user.sub, user.role, dto);
  }

  @Get()
  getSettlements(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Query() dto: QuerySettlementsDto,
  ) {
    return this.settlementsService.getSettlements(storeId, user.sub, user.role, dto);
  }
}

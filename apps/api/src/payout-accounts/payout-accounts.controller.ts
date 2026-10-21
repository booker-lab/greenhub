import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpsertPayoutAccountDto } from './dto/upsert-payout-account.dto';
import { PayoutAccountsService } from './payout-accounts.service';

// 판매자 정산 계좌. 판매자는 자기 가게만(서비스가 소유 확인), 관리자는 모든 가게.
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayoutAccountsController {
  constructor(private readonly payoutAccounts: PayoutAccountsService) {}

  @Get('stores/:storeId/payout-account')
  @Roles('seller', 'admin')
  getForStore(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.payoutAccounts.getForStore(storeId, user.sub, user.role);
  }

  @Put('stores/:storeId/payout-account')
  @Roles('seller', 'admin')
  upsert(
    @Param('storeId') storeId: string,
    @Body() dto: UpsertPayoutAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payoutAccounts.upsert(storeId, user.sub, user.role, dto);
  }

  @Get('admin/stores/:storeId/payout-account')
  @Roles('admin')
  getForAdmin(@Param('storeId') storeId: string) {
    return this.payoutAccounts.getForAdmin(storeId);
  }
}

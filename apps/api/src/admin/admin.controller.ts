import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
// biome-ignore lint/style/useImportType: Nest 생성자 주입 런타임 메타데이터에 클래스 값이 필요하다.
import { AdminService } from './admin.service';
// biome-ignore lint/style/useImportType: Nest ValidationPipe가 DTO 클래스 메타타입을 런타임에 사용한다.
import {
  BulkPaySettlementsDto,
  ForceRefundDto,
  QueryAdminDriversDto,
  QueryAdminOrdersDto,
  QueryAdminSettlementsDto,
  SetCommissionDto,
  SuspendUserDto,
  UpsertBannerDto,
} from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ── Stores ──────────────────────────────────────────────────────

  @Get('stores')
  getStores() {
    return this.admin.getStores();
  }

  @Patch('stores/:storeId/commission')
  setCommission(@Param('storeId') storeId: string, @Body() dto: SetCommissionDto) {
    return this.admin.setCommission(storeId, dto);
  }

  @Patch('stores/:storeId/archive')
  archiveStore(@Param('storeId') storeId: string) {
    return this.admin.archiveStore(storeId);
  }

  @Patch('stores/:storeId/restore')
  restoreStore(@Param('storeId') storeId: string) {
    return this.admin.restoreStore(storeId);
  }

  // ── Users ────────────────────────────────────────────────────────

  @Get('users')
  getUsers() {
    return this.admin.getUsers();
  }

  @Patch('users/:userId/status')
  suspendUser(@Param('userId') userId: string, @Body() dto: SuspendUserDto) {
    return this.admin.suspendUser(userId, dto);
  }

  // ── Orders ───────────────────────────────────────────────────────

  @Get('orders')
  getOrders(@Query() dto: QueryAdminOrdersDto) {
    return this.admin.getOrders(dto);
  }

  @Post('orders/:orderId/refund')
  forceRefund(@Param('orderId') orderId: string, @Body() dto: ForceRefundDto) {
    return this.admin.forceRefund(orderId, dto);
  }

  // ── Settlements ──────────────────────────────────────────────────

  @Get('settlements')
  getSettlements(@Query() dto: QueryAdminSettlementsDto) {
    return this.admin.getSettlements(dto);
  }

  @Patch('settlements/:settlementId/pay')
  markAsPaid(@Param('settlementId') settlementId: string) {
    return this.admin.markAsPaid(settlementId);
  }

  @Post('settlements/bulk-pay')
  bulkMarkAsPaid(@Body() dto: BulkPaySettlementsDto) {
    return this.admin.bulkMarkAsPaid(dto.ids);
  }

  // ── Drivers ──────────────────────────────────────────────────────

  @Get('drivers')
  getDrivers(@Query() dto: QueryAdminDriversDto) {
    return this.admin.getDrivers(dto);
  }

  @Patch('drivers/:userId/approve')
  approveDriver(@Param('userId') userId: string) {
    return this.admin.approveDriver(userId);
  }

  @Patch('drivers/:userId/suspend')
  suspendDriver(@Param('userId') userId: string, @Body() dto: SuspendUserDto) {
    return this.admin.suspendDriver(userId, dto);
  }

  // ── Invite ───────────────────────────────────────────────────────

  @Post('invite')
  generateInvite(@CurrentUser() user: JwtPayload) {
    return this.admin.generateInvite(user.sub);
  }

  @Get('invite')
  getInvites() {
    return this.admin.getInvites();
  }

  @Post('invite/:token/revoke')
  revokeInvite(@Param('token') token: string, @CurrentUser() user: JwtPayload) {
    return this.admin.revokeInvite(token, user.sub);
  }

  // ── Banner ───────────────────────────────────────────────────────

  @Get('banner')
  getBanner() {
    return this.admin.getBanner();
  }

  @Put('banner')
  upsertBanner(@Body() dto: UpsertBannerDto) {
    return this.admin.upsertBanner(dto);
  }
}

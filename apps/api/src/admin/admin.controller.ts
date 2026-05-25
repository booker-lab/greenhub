import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import {
  QueryAdminSettlementsDto,
  QueryAdminOrdersDto,
  QueryAdminDriversDto,
  SuspendUserDto,
  SetCommissionDto,
  ForceRefundDto,
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

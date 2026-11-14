import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import {
  AdminSettlementFilterDto,
  ApproveDriverDto,
  ArchiveStoreDto,
  QueryAdminSettlementsDto,
  QueryAdminOrdersDto,
  QueryAdminDriversDto,
  SuspendUserDto,
  SetCommissionDto,
  SetSalesModeDto,
  ForceRefundDto,
  UpsertBannerDto,
} from './dto/admin.dto';
import { GenerateInviteDto } from './dto/invite.dto';

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
  setCommission(
    @Param('storeId') storeId: string,
    @Body() dto: SetCommissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.setCommission(storeId, dto, user.sub);
  }

  // 판매 방식(예전 방식 legacy ↔ 회차 판매 round_direct) 전환. 같은 값이면 바꾸지 않고 200.
  @Patch('stores/:storeId/sales-mode')
  setSalesMode(
    @Param('storeId') storeId: string,
    @Body() dto: SetSalesModeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.setSalesMode(storeId, dto, user.sub);
  }

  @Patch('stores/:storeId/archive')
  archiveStore(
    @Param('storeId') storeId: string,
    @Body() dto: ArchiveStoreDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // 기록 없는 판매자는 본문 없이 보낸다. 본문 타입을 `| undefined`로 두면 design:paramtypes가 Object가 돼
    // 전역 ValidationPipe가 검증을 건너뛰므로 DTO 클래스만 쓴다. 본문이 없으면 ValidationPipe가 {}로 검증한다.
    return this.admin.archiveStore(storeId, user.sub, dto?.confirmStoreIdPrefix);
  }

  @Patch('stores/:storeId/restore')
  restoreStore(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.admin.restoreStore(storeId, user.sub);
  }

  // ── Users ────────────────────────────────────────────────────────

  @Get('users')
  getUsers() {
    return this.admin.getUsers();
  }

  @Patch('users/:userId/status')
  suspendUser(
    @Param('userId') userId: string,
    @Body() dto: SuspendUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.suspendUser(userId, dto, user.sub);
  }

  // ── Orders ───────────────────────────────────────────────────────

  @Get('orders')
  getOrders(@Query() dto: QueryAdminOrdersDto) {
    return this.admin.getOrders(dto);
  }

  @Post('orders/:orderId/refund')
  forceRefund(
    @Param('orderId') orderId: string,
    @Body() dto: ForceRefundDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.forceRefund(orderId, dto, user.sub);
  }

  // ── Settlements ──────────────────────────────────────────────────

  // 같은 조건 전체의 지급 대기·지급 완료·수수료·회수 필요 합계. 목록(더 보기)과 따로 받는다.
  @Get('settlements/summary')
  getSettlementsSummary(@Query() dto: AdminSettlementFilterDto) {
    return this.admin.getSettlementsSummary(dto);
  }

  @Get('settlements')
  getSettlements(@Query() dto: QueryAdminSettlementsDto) {
    return this.admin.getSettlements(dto);
  }

  @Patch('settlements/:settlementId/pay')
  markAsPaid(@Param('settlementId') settlementId: string, @CurrentUser() user: JwtPayload) {
    return this.admin.markAsPaid(settlementId, user.sub);
  }

  // ── Drivers ──────────────────────────────────────────────────────

  @Get('drivers')
  getDrivers(@Query() dto: QueryAdminDriversDto) {
    return this.admin.getDrivers(dto);
  }

  @Patch('drivers/:userId/approve')
  approveDriver(
    @Param('userId') userId: string,
    @Body() dto: ApproveDriverDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // 이전 화면은 본문 없이 보낸다(회차 비교 없음). 본문 타입을 `| undefined`로 두면 design:paramtypes가
    // Object가 돼 전역 ValidationPipe(whitelist·forbidNonWhitelisted·@IsInt·@Min)가 검증을 건너뛴다.
    // 본문이 없으면 ValidationPipe가 {}로 검증한 뒤 원래 값(undefined)을 넘기므로 `?.`로 읽는다.
    return this.admin.approveDriver(userId, user.sub, dto?.expectedRevision);
  }

  @Patch('drivers/:userId/suspend')
  suspendDriver(
    @Param('userId') userId: string,
    @Body() dto: SuspendUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.suspendDriver(userId, dto, user.sub);
  }

  // ── Invite ───────────────────────────────────────────────────────

  @Post('invite')
  generateInvite(@CurrentUser() user: JwtPayload, @Body() dto: GenerateInviteDto) {
    return this.admin.generateInvite(user.sub, dto);
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
  upsertBanner(@Body() dto: UpsertBannerDto, @CurrentUser() user: JwtPayload) {
    return this.admin.upsertBanner(dto, user.sub);
  }

  // ── Audit ────────────────────────────────────────────────────────

  @Get('audit-logs')
  getAuditLogs() {
    return this.admin.getAuditLogs();
  }
}

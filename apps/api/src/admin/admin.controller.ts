import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
// biome-ignore lint/style/useImportType: Nest 생성자 주입 런타임 메타데이터에 클래스 값이 필요하다.
import { AdminService } from './admin.service';
// biome-ignore lint/style/useImportType: Nest 생성자 주입에는 런타임 클래스 값이 필요하다.
import { AdminBannersService } from './admin-banners.service';
// biome-ignore lint/style/useImportType: Nest ValidationPipe가 DTO 클래스 메타타입을 런타임에 사용한다.
import {
  BulkPaySettlementsDto,
  CreateBannerDto,
  ForceRefundDto,
  GenerateInviteDto,
  QueryAdminDriversDto,
  QueryAdminInvitesDto,
  QueryAdminOrdersDto,
  QueryAdminSettlementsDto,
  SetCommissionDto,
  SetDefaultCommissionDto,
  SuspendUserDto,
  UpdateBannerDto,
  UpdateOrderTrackingDto,
  UpsertBannerDto,
} from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly banners: AdminBannersService,
  ) {}

  // ── Stores ──────────────────────────────────────────────────────

  @Get('platform-config')
  getPlatformConfig() {
    return this.admin.getPlatformConfig();
  }

  @Patch('platform-config/default-commission')
  setDefaultCommission(@Body() dto: SetDefaultCommissionDto) {
    return this.admin.setDefaultCommission(dto);
  }

  @Get('stores')
  getStores() {
    return this.admin.getStores();
  }

  @Get('stores/:storeId/summary')
  getStoreSummary(@Param('storeId') storeId: string) {
    return this.admin.getStoreSummary(storeId);
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

  @Get('orders/:orderId')
  getOrderDetail(@Param('orderId') orderId: string) {
    return this.admin.getOrderDetail(orderId);
  }

  @Post('orders/:orderId/refund')
  forceRefund(@Param('orderId') orderId: string, @Body() dto: ForceRefundDto) {
    return this.admin.forceRefund(orderId, dto);
  }

  @Patch('orders/:orderId/tracking')
  updateOrderTracking(
    @Param('orderId') orderId: string,
    @Body() dto: UpdateOrderTrackingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.updateOrderTracking(orderId, dto, user.sub);
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
  generateInvite(@CurrentUser() user: JwtPayload, @Body() dto: GenerateInviteDto) {
    return this.admin.generateInvite(user.sub, dto.expiresInDays);
  }

  @Get('invite')
  getInvites(@Query() dto: QueryAdminInvitesDto) {
    return this.admin.getInvites(dto);
  }

  @Post('invite/:token/revoke')
  revokeInvite(@Param('token') token: string, @CurrentUser() user: JwtPayload) {
    return this.admin.revokeInvite(token, user.sub);
  }

  @Post('invite/:token/rollback-seller')
  rollbackInviteSeller(@Param('token') token: string, @CurrentUser() user: JwtPayload) {
    return this.admin.rollbackInviteSeller(token, user.sub);
  }

  // ── Banner ───────────────────────────────────────────────────────

  @Get('banner')
  getBanner() {
    return this.banners.getBanner();
  }

  @Put('banner')
  upsertBanner(@Body() dto: UpsertBannerDto) {
    return this.banners.upsertBanner(dto);
  }

  @Get('banners')
  listBanners() {
    return this.banners.listBanners();
  }

  @Post('banners')
  createBanner(@Body() dto: CreateBannerDto) {
    return this.banners.createBanner(dto);
  }

  @Put('banners/:id')
  updateBanner(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.banners.updateBanner(id, dto);
  }

  @Delete('banners/:id')
  deleteBanner(@Param('id') id: string) {
    return this.banners.deleteBanner(id);
  }
}

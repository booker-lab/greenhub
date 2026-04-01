import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import {
  QueryAdminSettlementsDto,
  QueryAdminOrdersDto,
  SuspendUserDto,
  SetCommissionDto,
  ForceRefundDto,
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
  setCommission(
    @Param('storeId') storeId: string,
    @Body() dto: SetCommissionDto,
  ) {
    return this.admin.setCommission(storeId, dto);
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
  ) {
    return this.admin.suspendUser(userId, dto);
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
  ) {
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

  // ── Invite ───────────────────────────────────────────────────────

  @Post('invite')
  generateInvite(@CurrentUser() user: JwtPayload) {
    return this.admin.generateInvite(user.sub);
  }

  @Get('invite')
  getInvites() {
    return this.admin.getInvites();
  }
}

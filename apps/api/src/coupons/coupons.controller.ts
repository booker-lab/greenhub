import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

/** 공개: 지금 받을 수 있는 쿠폰 목록(로그인 없이 상단 띠에 보여준다). */
@Controller('stores')
export class PublicCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get(':storeId/coupons/public')
  listClaimable(@Param('storeId') storeId: string) {
    return this.coupons.listClaimableCoupons(storeId);
  }
}

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  // ── 판매자·관리자 ──
  @Get(':storeId/coupons')
  @UseGuards(RolesGuard)
  @Roles('seller', 'admin')
  listStoreCoupons(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.coupons.listStoreCoupons(storeId, user.sub, user.role);
  }

  @Post(':storeId/coupons')
  @UseGuards(RolesGuard)
  @Roles('seller', 'admin')
  @HttpCode(HttpStatus.CREATED)
  createCoupon(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCouponDto,
  ) {
    return this.coupons.createCoupon(storeId, user.sub, user.role, dto);
  }

  @Patch(':storeId/coupons/:couponId')
  @UseGuards(RolesGuard)
  @Roles('seller', 'admin')
  updateCoupon(
    @Param('storeId') storeId: string,
    @Param('couponId') couponId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.coupons.updateCoupon(storeId, couponId, user.sub, user.role, dto);
  }

  // ── 고객 ──
  @Post(':storeId/coupons/:couponId/claim')
  @UseGuards(RolesGuard)
  @Roles('consumer', 'admin')
  @HttpCode(HttpStatus.OK)
  claim(
    @Param('storeId') storeId: string,
    @Param('couponId') couponId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.coupons.claimCoupon(storeId, couponId, user.sub);
  }

  @Get(':storeId/me/coupons')
  listMine(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.coupons.listMyCoupons(storeId, user.sub);
  }

  @Get(':storeId/me/stamps')
  getStamps(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.coupons.getStamps(storeId, user.sub);
  }

  @Post(':storeId/me/stamps/:at/claim')
  @UseGuards(RolesGuard)
  @Roles('consumer', 'admin')
  @HttpCode(HttpStatus.OK)
  claimStamp(
    @Param('storeId') storeId: string,
    @Param('at', ParseIntPipe) at: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.coupons.claimStampReward(storeId, user.sub, at);
  }
}

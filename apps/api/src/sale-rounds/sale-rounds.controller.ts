import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  CopySaleRoundDto,
  CreateSaleRoundDto,
  UpdateSaleRoundDto,
  UpdateSaleRoundStatusDto,
} from './dto/sale-round.dto';
import { resolvePublicPastRoundLimit, SaleRoundsService } from './sale-rounds.service';

@Controller('stores/:storeId/sale-rounds/public')
export class PublicSaleRoundsController {
  constructor(private readonly saleRoundsService: SaleRoundsService) {}

  /**
   * 옵션 없이 부르면 기존처럼 상품 없는 회차 요약 전부를 준다.
   * `?include=items[&past=N]`이면 판매 예정·판매 중 회차 전부와 최신 지난 회차 N개를 상품까지 한 번에 준다.
   */
  @Get()
  getPublicRounds(
    @Param('storeId') storeId: string,
    @Query('include') include?: unknown,
    @Query('past') past?: unknown,
  ) {
    if (include === undefined) return this.saleRoundsService.listPublicRounds(storeId);
    if (include !== 'items') throw new BadRequestException('include 값이 올바르지 않습니다.');
    return this.saleRoundsService.listPublicRoundsWithItems(
      storeId,
      resolvePublicPastRoundLimit(past),
    );
  }

  @Get(':roundId')
  getPublicRound(@Param('storeId') storeId: string, @Param('roundId') roundId: string) {
    return this.saleRoundsService.getPublicRound(storeId, roundId);
  }
}

@Controller('stores/:storeId/sale-rounds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
export class SaleRoundsController {
  constructor(private readonly saleRoundsService: SaleRoundsService) {}

  @Get()
  getRounds(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.saleRoundsService.listSellerRounds(storeId, user.sub, user.role);
  }

  @Get(':roundId')
  getRound(
    @Param('storeId') storeId: string,
    @Param('roundId') roundId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.saleRoundsService.getRound(storeId, roundId, user.sub, user.role);
  }

  @Post()
  createRound(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSaleRoundDto,
  ) {
    return this.saleRoundsService.createRound(storeId, user.sub, user.role, dto);
  }

  @Post('copy')
  copyRound(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CopySaleRoundDto,
  ) {
    return this.saleRoundsService.copyRound(storeId, user.sub, user.role, dto);
  }

  @Patch(':roundId')
  updateRound(
    @Param('storeId') storeId: string,
    @Param('roundId') roundId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateSaleRoundDto,
  ) {
    return this.saleRoundsService.updateRound(storeId, roundId, user.sub, user.role, dto);
  }

  @Patch(':roundId/status')
  updateStatus(
    @Param('storeId') storeId: string,
    @Param('roundId') roundId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateSaleRoundStatusDto,
  ) {
    return this.saleRoundsService.updateStatus(storeId, roundId, user.sub, user.role, dto);
  }

  @Patch(':roundId/complete')
  completeRound(
    @Param('storeId') storeId: string,
    @Param('roundId') roundId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.saleRoundsService.completeRound(storeId, roundId, user.sub, user.role);
  }
}

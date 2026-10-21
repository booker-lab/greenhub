import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { FirestoreService } from '../firestore/firestore.service';
import { PostDeliveryRefundDto } from './dto/post-delivery-refund.dto';
import { PostDeliveryRefundService } from './post-delivery-refund.service';

/**
 * 판매자 배송 후 환불(배송 완료 7일까지). 기간이 지난 주문은 관리자 API가 처리한다.
 * 관리자 겸직 계정이 판매자 화면에서 부를 때도 판매자 규칙(7일·정산 미지급)을 그대로 적용한다.
 */
@Controller('stores/:storeId/orders/:orderId/post-delivery-refund')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
export class PostDeliveryRefundController {
  constructor(
    @Inject(PostDeliveryRefundService)
    private readonly refunds: PostDeliveryRefundService,
    @Inject(FirestoreService)
    private readonly firestore: FirestoreService,
  ) {}

  @Get()
  async getEligibility(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertStoreAccess(storeId, user);
    return this.refunds.getSellerEligibility(storeId, orderId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async refund(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PostDeliveryRefundDto,
  ) {
    await this.assertStoreAccess(storeId, user);
    return this.refunds.refund({
      storeId,
      orderId,
      actorRole: 'seller',
      actorId: user.sub,
      reasonCode: dto.reasonCode,
      memo: dto.memo,
    });
  }

  private async assertStoreAccess(storeId: string, user: JwtPayload) {
    if (user.role === 'admin') return;
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists || storeSnap.data()?.['ownerId'] !== user.sub) {
      throw new ForbiddenException('해당 스토어 주문을 환불할 권한이 없습니다.');
    }
  }
}

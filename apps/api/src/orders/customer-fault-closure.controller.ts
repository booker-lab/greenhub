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
import { CustomerFaultClosureService } from './customer-fault-closure.service';
import { CustomerFaultClosureDto } from './dto/customer-fault-closure.dto';

/**
 * 고객 사유 종결(환불 없음). 매장 주인 판매자와 관리자만 부른다. 주문 상태를 CLOSED_UNDELIVERED로
 * 바꾸는 유일한 경로다(일반 상태 변경 PATCH는 이 상태로 갈 수 없다).
 */
@Controller('stores/:storeId/orders/:orderId/customer-fault-closure')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
export class CustomerFaultClosureController {
  constructor(
    @Inject(CustomerFaultClosureService)
    private readonly closures: CustomerFaultClosureService,
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
    return this.closures.getEligibility(storeId, orderId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async close(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CustomerFaultClosureDto,
  ) {
    await this.assertStoreAccess(storeId, user);
    return this.closures.close({
      storeId,
      orderId,
      actorRole: user.role === 'admin' ? 'admin' : 'seller',
      actorId: user.sub,
      memo: dto.memo,
    });
  }

  private async assertStoreAccess(storeId: string, user: JwtPayload) {
    if (user.role === 'admin') return;
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists || storeSnap.data()?.['ownerId'] !== user.sub) {
      throw new ForbiddenException('해당 스토어 주문을 종결할 권한이 없습니다.');
    }
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import type { PostDeliveryRefundDto } from '../orders/dto/post-delivery-refund.dto';
import { PostDeliveryRefundService } from '../orders/post-delivery-refund.service';

/**
 * 관리자 배송 후 환불(기한 없음) — 계획서 R5.
 * 환불 자체는 판매자 경로와 같은 PostDeliveryRefundService가 소유하고, 여기서는 관리자 규칙
 * (기간·정산 조건 없음)과 행동 기록만 붙인다. 지급 완료 정산이면 정산 취소 단계가 회수 필요와
 * 관리자만 닫는 운영 기록을 남기고, 응답에 그 결과(recoveryRequired·recoveryAmount)가 실린다.
 * 회수 완료는 그 운영 기록을 관리자가 닫는 것으로 대신한다(전용 API 없음).
 */
@Injectable()
export class AdminPostDeliveryRefundService {
  private readonly logger = new Logger(AdminPostDeliveryRefundService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly refunds: PostDeliveryRefundService,
    private readonly audit: AuditService,
  ) {}

  async refund(orderId: string, dto: PostDeliveryRefundDto, actorId: string) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');
    const order = orderSnap.data() as Record<string, unknown>;

    const result = await this.refunds.refund({
      storeId: String(order['storeId'] ?? ''),
      orderId,
      actorRole: 'admin',
      actorId,
      reasonCode: dto.reasonCode,
      memo: dto.memo,
    });

    // 환불이 실패해 예외가 나면 여기까지 오지 않으므로 끝난 환불만 기록된다.
    // 기록 실패로 이미 끝난 환불을 되돌리지 않으므로 오류 로그만 남긴다(강제 환불과 같은 방식).
    const recoveryAfter = result.recoveryRequired
      ? { recoveryRequired: true, recoveryAmount: result.recoveryAmount }
      : {};
    try {
      await this.audit.logAdmin({
        action: 'admin.order.post_delivery_refunded',
        actorId,
        targetType: 'order',
        targetId: orderId,
        before: { status: (order['status'] as string | undefined) ?? null },
        after: { status: 'CANCELLED', reasonCode: dto.reasonCode, ...recoveryAfter },
        reason: dto.memo,
      });
    } catch (error) {
      this.logger.error(
        `[AdminAudit] 기록 실패 action=admin.order.post_delivery_refunded error=${(error as Error)?.name ?? 'unknown'}`,
      );
    }
    return result;
  }
}

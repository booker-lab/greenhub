import type { SettlementRecoveryStatus } from '@greenhub/shared';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import { PostDeliveryRefundService } from '../orders/post-delivery-refund.service';
import type { PostDeliveryRefundDto } from '../orders/dto/post-delivery-refund.dto';

/**
 * 관리자 배송 후 환불(기한 없음)과 지급 뒤 환불 정산의 "회수 완료" 처리 — 계획서 R5.
 * 환불 자체는 판매자 경로와 같은 PostDeliveryRefundService가 소유하고, 여기서는 관리자 규칙
 * (기간·정산 조건 없음)과 행동 기록만 붙인다. 지급 완료 정산이면 정산 취소 단계가 회수 대기 기록을 남긴다.
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
    // 기록 실패로 이미 끝난 환불을 되돌리지 않으므로 오류 로그만 남긴다.
    try {
      await this.audit.logAdmin({
        action: 'admin.order.post_delivery_refunded',
        actorId,
        targetType: 'order',
        targetId: orderId,
        before: { status: (order['status'] as string | undefined) ?? null },
        after: { status: 'CANCELLED', reasonCode: dto.reasonCode },
        reason: dto.memo,
      });
    } catch (error) {
      this.logger.error(
        `[AdminAudit] 기록 실패 action=admin.order.post_delivery_refunded error=${(error as Error)?.name ?? 'unknown'}`,
      );
    }
    return result;
  }

  async completeRecovery(settlementId: string, actorId: string) {
    const ref = this.firestore.doc(`settlements/${settlementId}`);
    await this.firestore.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new NotFoundException('정산 내역을 찾을 수 없습니다.');
      const data = snap.data() as Record<string, any>;
      const recovery = data['recovery'] as Record<string, unknown> | null | undefined;
      if (!recovery) {
        throw new BadRequestException('돌려받을 돈이 없는 정산입니다.');
      }
      if (recovery['status'] === 'RECOVERED') {
        throw new BadRequestException('이미 회수 완료된 정산입니다.');
      }
      const now = this.firestore.Timestamp.now();
      t.update(ref, {
        recovery: {
          ...recovery,
          status: 'RECOVERED' satisfies SettlementRecoveryStatus,
          recoveredAt: now,
          recoveredBy: actorId,
        },
        updatedAt: now,
      });
      // 회수 표시와 기록을 같은 트랜잭션에 넣어, 기록 없는 회수 완료가 생기지 않게 한다(지급 처리와 같은 방식).
      await this.audit.logAdmin(
        {
          action: 'admin.settlement.recovery_completed',
          actorId,
          targetType: 'settlement',
          targetId: settlementId,
          before: { recoveryStatus: 'PENDING', amount: recovery['amount'] ?? null },
          after: { recoveryStatus: 'RECOVERED' },
        },
        t,
      );
    });
    return { settlementId, recoveryStatus: 'RECOVERED' as const };
  }
}

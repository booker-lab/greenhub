import type * as admin from 'firebase-admin';
import type { FirestoreService } from '../../firestore/firestore.service';
import { isOrderCancelledOrCancelling } from '../../orders/order-cancellation-state';

/** 주문 상태 때문에 정산을 확정·지급하지 않는 이유. */
export type OrderPayoutHoldReason = 'ORDER_CANCELLED_OR_CANCELLING' | 'ORDER_MISSING';

/**
 * 정산의 주문이 취소됐거나 취소·환불이 진행 중이면 확정·지급을 막는다(트랜잭션 안에서 판정).
 * 주문 문서가 없으면 판단할 근거가 없으므로 막는다(fail closed).
 * 같은 트랜잭션에서 주문을 읽어, 환불 시작과 확정·지급이 겹쳐도 한쪽만 먼저 커밋된다.
 */
export async function readOrderPayoutHoldInTransaction(
  firestore: Pick<FirestoreService, 'doc'>,
  transaction: Pick<admin.firestore.Transaction, 'get'>,
  orderId: string,
): Promise<OrderPayoutHoldReason | null> {
  const snap = await transaction.get(firestore.doc(`orders/${orderId}`));
  if (!snap.exists) return 'ORDER_MISSING';
  return isOrderCancelledOrCancelling(snap.data()) ? 'ORDER_CANCELLED_OR_CANCELLING' : null;
}

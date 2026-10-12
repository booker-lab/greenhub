import type { OperationIssueType } from '@greenhub/shared';
import type * as admin from 'firebase-admin';
import type { FirestoreService } from '../../firestore/firestore.service';

/** 결제사 쪽 취소·분쟁 웹훅이 남기는 운영 기록 유형(payments 웹훅 처리와 같은 값). */
export const PROVIDER_REVERSAL_ISSUE_TYPE =
  'PROVIDER_REVERSAL_DETECTED' satisfies OperationIssueType;

/**
 * 주문에 아직 처리되지 않은(OPEN) 결제사 취소·분쟁 운영 기록이 있는지 트랜잭션 안에서 확인한다.
 * 기록 문서 ID는 웹훅 종류·취소 ID까지 포함한 해시라 주문만으로 직접 읽을 수 없어,
 * 동등 조건만 쓴 조회로 단일 필드 인덱스 병합을 사용한다(복합 인덱스 불필요).
 * RESOLVED·DISMISSED 기록은 막지 않는다.
 */
export async function hasOpenProviderReversalInTransaction(
  firestore: Pick<FirestoreService, 'collection'>,
  transaction: Pick<admin.firestore.Transaction, 'get'>,
  orderId: string,
): Promise<boolean> {
  const query = firestore
    .collection('operationIssues')
    .where('orderId', '==', orderId)
    .where('type', '==', PROVIDER_REVERSAL_ISSUE_TYPE)
    .where('status', '==', 'OPEN')
    .limit(1);
  const snap = await transaction.get(query);
  return !snap.empty;
}

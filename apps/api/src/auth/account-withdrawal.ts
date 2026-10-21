import {
  CANCELLABLE_ORDER_STATUSES,
  isOrderCancellationInProgress,
} from '../orders/order-cancellation-state';
import { isCurrentRedeliveryPaymentRequired } from '../orders/redelivery-resume-gate';

// 소비자 회원 탈퇴(`DELETE /auth/me`)의 판정 규칙. 서비스 코드와 테스트가 같은 목록을 쓴다.

// `users/{uid}.withdrawnAt`: 탈퇴 시각. 값이 있으면 그 문서로는 로그인·토큰 갱신·API 호출을 받지 않는다.
export const WITHDRAWN_AT_FIELD = 'withdrawnAt';

export const WITHDRAWAL_ACTIVE_ORDER_MESSAGE =
  '진행 중인 주문이 있어 탈퇴할 수 없습니다. 배송이 끝나거나 주문을 취소한 뒤 다시 시도해 주세요.';

export const WITHDRAWN_ACCOUNT_MESSAGE = '탈퇴한 계정입니다.';

// 탈퇴를 막는 주문 상태: 취소가 시작될 수 있는 상태(결제 대기~배송 보류)와 배송 중인 상태.
export const WITHDRAWAL_BLOCKING_ORDER_STATUSES: readonly string[] = [
  ...CANCELLABLE_ORDER_STATUSES,
  'DELIVERING',
  'HUB_ARRIVED',
];

// 익명화할 때 지우는 사용자 문서 필드. 문서 자체는 주문·결제가 uid로 참조하므로 남긴다.
export const WITHDRAWAL_ERASED_USER_FIELDS = [
  'name',
  'phone',
  'email',
  'savedAddresses',
  'fcmToken',
  'kakaoId',
  'passwordHash',
  'notificationPreferences',
] as const;

// 트랜잭션 뒤에 지우는 그 사용자의 문서: [컬렉션, 사용자 uid를 담는 필드].
// 주문·결제·후기·법정 보관 기록(`scripts/ops/retire-test-accounts.mjs` KEPT 목록)은 남긴다.
export const WITHDRAWAL_CLEANUP_REFERENCES = [
  ['restockSubscriptions', 'userId'],
  ['notifications', 'userId'],
  ['aiUsage', 'uid'],
] as const;

type OrderRecord = Record<string, unknown>;

export function isWithdrawalBlockingOrder(order: OrderRecord): boolean {
  return (
    WITHDRAWAL_BLOCKING_ORDER_STATUSES.includes(String(order['status'])) ||
    isOrderCancellationInProgress(order) ||
    isCurrentRedeliveryPaymentRequired(order)
  );
}

// 아직 만료되지 않은 결제 예약(결제창을 연 상태)인지 판정한다. 만료 시각을 읽을 수 없으면 진행 중으로 본다.
export function isActiveCheckoutReservation(
  reservation: Record<string, unknown>,
  nowMillis: number,
): boolean {
  if (reservation['status'] !== 'HELD') return false;
  const expiresAt = new Date(String(reservation['expiresAt'] ?? '')).getTime();
  return !Number.isFinite(expiresAt) || expiresAt > nowMillis;
}

export function isWithdrawnUser(user: Record<string, unknown> | undefined): boolean {
  const value = user?.[WITHDRAWN_AT_FIELD];
  return value !== undefined && value !== null;
}

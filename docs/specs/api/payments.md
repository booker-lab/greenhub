<!-- Language: ko -->

# Payments API / Domain Spec

> **최종 정합화**: 2026-08-24
> **상태**: Current
> **공통 타입 정본**: `packages/shared/src/payment.types.ts`
> **서버 구현 정본**: `apps/api/src/payments/**`
> **주문 연계 계약**: `docs/specs/api/orders.md`, `docs/specs/mvp-sales-round-direct-delivery.md`

## Task 2C candidate overlay

현재 branch candidate `c9d60f6`에서 다음을 검증했다.

- `P0-001`: `finalizePaidOrder()`가 provider `status !== 'PAID'` 입력을 side effect 없이 차단하고, `PAID` 정상 경로와 amount mismatch guard를 유지한다.
- `P0-002`: 취소 주문에 뒤늦게 도착한 provider payment가 주문을 부활시키지 않고 refund/finalization convergence와 idempotency를 유지한다.
- focused candidate 3 suites/16 tests 및 full API 41 suites/319 tests PASS.

이 overlay는 아직 `origin/main` `256abc7`에 통합되지 않은 candidate의 검증 상태다. 아래 main baseline finding은 main 통합 전 출시 상태로 유지한다.

## 1. 소유권과 범위

- 결제 검증·최종화·환불·재배송비 결제 처리는 NestJS API가 소유한다.
- consumer는 PortOne V2 SDK로 결제 UI를 시작하지만 결제 성공 여부를 클라이언트 반환값만으로 확정하지 않는다.
- 현재 일반 진입 경로는 PortOne V2 API를 재조회한 뒤 상태·금액에 따라 주문/결제를 수렴시킨다.
- **주의:** 현재 `main`의 `PaymentFinalizationService.finalizePaidOrder()` 자체는 전달받은 `paymentData.status === 'PAID'`를 독립적으로 재검증하지 않는다. 따라서 이 메서드를 “어떤 호출 경로에서도 비`PAID`를 차단하는 최종 보안 경계”로 문서화하면 안 된다.
- webhook은 중요한 수렴 경로지만 유일한 수렴 경로가 아니다. 15분 이상 `PENDING` 주문도 scheduler가 PortOne을 재조회해 paid/cancel/확인필요 상태로 수렴시킨다.
- legacy 본 결제와 회차 직배송 본 결제는 같은 payment finalization 기반을 공유하지만, 회차 주문은 `checkoutReservations`와 용량 반환·재확보 규칙을 추가로 사용한다.
- 재배송비는 본 결제와 별개의 `orderCharges` 결제로 관리한다.

## 2. PortOne V2 서버 설정

현재 서버가 사용하는 비밀 설정:

- `PORTONE_V2_SECRET`
- `PORTONE_WEBHOOK_SECRET`

client channel/store 설정은 각 frontend 환경의 현재 코드를 따른다. 실제 결제 수단의 계약·심사·활성화 상태는 외부 상태이므로 이 spec에 “현재 승인됨/대기 중”으로 고정하지 않는다. 결제 수단을 변경하는 작업은 PortOne 콘솔과 대상 환경을 직접 재조회한다.

비밀값 원문은 문서·로그·Git에 기록하지 않는다.

## 3. 본 결제 식별자와 기록

현재 일반 본 결제는 주문 ID를 PortOne `paymentId`로 사용한다.

```text
orderId == paymentId == payments/{paymentId}.id
```

결제 성공 후 `payments/{orderId}`에는 다음 핵심 필드가 기록된다.

```ts
{
  id: string
  orderId: string
  userId: string
  storeId: string
  amount: number
  payMethod: string | null
  status: 'PAID' | 'CANCELLED' | 'FAILED' | 'PENDING'
  portonePaymentId: string
  portoneTransactionId: string
  refundAmount: number | null
  refundedAt: Timestamp | null
  refundReason: string | null
  refundClaim?: {
    token: string
    expiresAt: number
  } | null
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

공개 shared `Payment`에는 `refundClaim` 같은 내부 동시성 필드가 포함되지 않는다. Firestore 내부 필드와 공개 DTO를 동일시하지 않는다.

`PENDING` 주문 단계에서는 본 결제 문서가 아직 없을 수 있다. 결제 성공 시 transaction 안에서 `PAID` 문서를 생성한다.

## 4. Webhook 보안 계약

Endpoint:

```text
POST /payments/webhook/portone
```

이 endpoint는 JWT를 사용하지 않지만 인증이 없는 endpoint가 아니다. 서버는 raw body와 다음 PortOne webhook header를 검증한다.

```text
webhook-id
webhook-timestamp
webhook-signature
```

현재 `PortoneClient.verifyWebhookSignature()` 계약:

- `PORTONE_WEBHOOK_SECRET` 필요
- raw body 필요
- header 세 개 모두 필요
- timestamp 허용 오차: ±5분
- HMAC SHA-256 signature를 timing-safe 비교
- 검증 실패 시 `401` 계열 실패
- invalid signature는 audit에 기록

과거 문서의 “웹훅 인증 미적용, IP allowlist 권장만” 설명은 현행 계약이 아니다.

## 5. Webhook 이벤트 처리

`PaymentsService.handleWebhook()`의 현재 흐름:

1. `paymentId`가 `order-charge-` prefix이면 재배송비 결제 경로로 분기한다.
2. 본 결제라면 `orders/{paymentId}`를 조회한다.
3. `Transaction.Ready`는 상태 변경 없이 무시한다.
4. `Transaction.Paid`가 아닌 이벤트는 아직 처리 가능한 `PENDING` 주문을 `payment_failed`로 취소·release하는 경로로 보낸다.
5. `Transaction.Paid`이면 webhook body의 금액을 신뢰하지 않고 `GET /payments/{paymentId}`로 PortOne 원격 결제를 다시 조회한다.
6. 현재 코드에서는 취소된 주문에 대해서만 원격 `paymentData.status !== 'PAID'`를 명시적으로 차단한 뒤 `PaymentFinalizationService.finalizePaidOrder()`에 전달한다.

중복 webhook은 최종화 service의 주문 상태 검사와 transaction으로 멱등 처리한다. “PENDING 아니면 무조건 skip”보다 실제 구현의 `canFinalize()` 조건을 따른다.

## 6. 결제 성공 최종화

`PaymentFinalizationService.finalizePaidOrder()`의 현재 구현을 설명한다.

### 현재 구현 한계 — provider 상태 최종 방어

현재 `main`에서 이 메서드는 다음을 자체 검사한다.

- 주문 존재 여부
- 주문이 `canFinalize()` 가능한 상태인지
- PortOne 금액과 주문 금액 일치 여부
- 회차 reservation/capacity 조건

그러나 **전달된 `paymentData.status`가 실제 `PAID`인지 메서드 내부에서 직접 차단하지 않는다.**

현재 일반 호출 경로의 방어는 다음과 같다.

- `cleanupPendingOrders()`는 `paymentData.status === 'PAID'`일 때만 finalization을 호출한다.
- webhook은 `Transaction.Paid` 이벤트에서 원격 결제를 재조회하지만, `PENDING` 주문에 대해 재조회 결과의 status를 finalization 직전에 다시 강제하지 않는다.

따라서 원하는 불변식은 다음과 같지만, **현재 `main` 구현 완료 사실로 읽으면 안 된다.**

```text
finalizePaidOrder(paymentData) accepts only paymentData.status === 'PAID'
```

이 방어가 코드와 회귀 테스트로 통합되기 전까지는 `finalizePaidOrder()`를 독립적인 `PAID` 최종 보안 경계로 취급하지 않는다.

### 금액 검증

```text
PortOne payment.amount.total === orders.totalAmount
```

불일치 시:

1. `payment.amount_tampered` audit 기록
2. PortOne 전액 환불 시도
3. 주문을 `amount_mismatch` 사유로 `CANCELLED`
4. 연결된 capacity/reservation 반환

클라이언트가 보낸 금액을 최종 검증값으로 사용하지 않는다.

### 정상 결제

호출자가 실제 `PAID` 결제만 전달했다는 전제 아래 현재 finalization은:

- `saleType === 'group'` → `RECRUITING`
- 그 외 → `ACCEPTED`
- `payments/{orderId}`를 `PAID`로 기록
- 법정 보관용 retention record 생성
- `ORDER_ACCEPTED` 또는 `GROUP_JOINED` 알림 요청

### 회차 주문(`schemaVersion: 2`)

- 정상 `PENDING` 결제는 기존 `checkoutReservation`을 transaction에서 consume한다.
- reservation이 없으면 정상 결제 최종화를 완료하지 않는다.
- 주문/결제/capacity가 한 transaction 경계에서 중복 적용되지 않도록 처리한다.

## 7. 15분 `PENDING` 수렴

`PaymentsService.cleanupPendingOrders()`는 매분 실행하며 15분보다 오래된 `PENDING` 주문을 찾는다.

중요: 현재 동작은 **바로 삭제하거나 무조건 취소하지 않는다.**

각 주문마다 PortOne 원격 결제를 먼저 조회한다.

| 원격 결과 | 처리 |
|---|---|
| `PAID` | 정상 finalization 시도 |
| 명확한 비결제 상태 | `timeout` 취소 |
| `404 + PAYMENT_NOT_FOUND` | `timeout` 취소 |
| 인증/네트워크/기타 조회 오류 | 주문 상태를 추측해 취소하지 않고 `PAYMENT_LOOKUP_FAILED` 운영 이슈 기록 |

legacy 비택배 주문은 취소 시 daily cap을 반환하고, `schemaVersion: 2` 회차 주문은 reservation을 `EXPIRED` 처리해 확보량을 반환한다.

## 8. 늦은 결제

회차 주문에서는 timeout 취소 뒤 실제 PortOne 결제가 늦게 `PAID`로 확인될 수 있다.

현재 `canFinalize()`은 다음 주문을 다시 수렴 대상으로 허용한다.

- `PENDING`
- `CANCELLED`이면서 `cancelReason === 'timeout'`이고 아직 late-payment refund가 확정되지 않은 주문

회차(`schemaVersion: 2`) timeout 취소 주문의 늦은 결제 처리:

1. 같은 회차/상품/배송지 한도를 다시 확보하려 시도한다.
2. 재확보 성공 → 새 reservation을 consume하며 정상 주문으로 최종화한다.
3. 재확보 실패 → PortOne 전액 환불 후 `latePaymentRefundedAt`과 `CANCELLED` payment 기록으로 수렴한다.

따라서 “timeout 뒤 webhook은 무조건 무시” 또는 “timeout 주문은 무조건 삭제”는 잘못된 구현 가정이다.

## 9. 환불

외부에 범용 환불 endpoint를 노출하지 않는다. 주문 취소·운영 예외 등 승인된 서버 흐름이 내부 환불 service를 호출한다.

`PaymentRefundService.refundByOrderId()`의 현재 계약:

1. 주문에 연결된 payment를 찾는다.
2. `PAID`이면서 아직 환불되지 않은 경우에만 refund claim을 획득한다.
3. claim TTL은 5분이다.
4. PortOne `/payments/{paymentId}/cancel`을 호출한다.
5. 성공 시 payment를 `CANCELLED`, `refundAmount/refundedAt/refundReason` 기록으로 갱신한다.
6. 법정 분쟁·고객지원 보존 record를 생성한다.
7. 실패 시 claim을 해제하고 `AUTO_REFUND_FAILED` 운영 이슈를 생성한다.

이미 `CANCELLED`, `refundedAt` 존재, 다른 유효 claim이 존재하는 경우 외부 환불을 중복 호출하지 않는다.

실제 사용자 취소·판매자 취소·공동구매 취소의 상태 허용 범위는 orders lifecycle이 소유한다.

## 10. 재배송비 결제

재배송비는 `payments/{orderId}` 본 결제와 섞지 않고 `orderCharges`로 관리한다.

PortOne payment ID 형식:

```text
order-charge-{chargeId}
```

현재 지원 type:

```text
REDELIVERY_FEE
```

`OrderChargePaymentService`는 webhook에서 다음을 검증한다.

- charge 존재
- 상태가 `PENDING`
- type이 `REDELIVERY_FEE`
- 저장된 `portonePaymentId`와 webhook payment ID 일치
- PortOne 원격 상태 `PAID`
- 원격 금액과 charge 금액 일치
- 연결 주문의 `redeliveryChargeId`, `storeId`, `userId` 일치

본 주문 취소 시 paid 재배송비도 별도 refund 경로로 환불할 수 있다. 본 결제와 재배송비 결제를 같은 payment record라고 가정하지 않는다.

## 10A. 결제 하위 계약 검증 상태

판정 기준은 `docs/DOCUMENT_CONSISTENCY.md`를 따른다.

### 본 결제 finalization provider 상태 — `IMPLEMENTATION FINDING`

현재 `finalizePaidOrder()` 내부의 비`PAID` 최종 차단이 없으므로 P0 미해결 상태다. caller 방어와 기존 race/멱등 테스트가 존재하더라도 이 불변식 전체를 `VERIFIED`로 승격하지 않는다.

추적: `docs/BACKLOG.md`의 `PAYMENT-FINALIZATION-PAID-GUARD`.

### 본 결제 환불 멱등성 — `VERIFIED`

`PaymentRefundService` 구현과 `payments.service.spec.ts`의 직접 회귀가 다음을 함께 보장한다.

- `PAID`이며 미환불인 결제만 refund claim 획득
- 동시 환불 호출과 완료 뒤 재시도에서 PortOne 외부 환불 1회
- 성공 뒤 `CANCELLED`/환불 금액·시각 기록
- provider 실패 시 claim 해제와 `AUTO_REFUND_FAILED` 운영 이슈
- 법정 분쟁·고객지원 retention 기록에 provider 원문·민감정보를 복제하지 않음

### 재배송비 결제·환불 — `VERIFIED`

`OrderChargePaymentService` 구현과 직접 회귀가 다음을 확인한다.

- `Transaction.Paid`에서 원격 결제를 재조회하고 `PAID` 상태·금액·charge/order 연결 관계 검증
- 불일치 시 `PENDING` charge를 확정하지 않음
- 실패 webhook 중복 시 `FAILED`로 한 번 수렴
- paid 재배송비 환불의 동시 호출·완료 후 재시도에서 PortOne 환불 1회
- 주문 생성 측에서는 고객 책임 배송 보류, WEATHER 제외, 양수 재배송비, 주문자 소유권을 확인

이 `VERIFIED` 판정은 위 계약 범위에 한정한다. 주문 취소 전체의 상태 허용 범위와 side effect는 orders lifecycle 계약을 별도로 확인한다.

## 11. 현재 조회 API

### Webhook

```text
POST /payments/webhook/portone
```

PortOne provider용. JWT 없음, provider signature 검증 필수.

### Payment ID 조회

```text
GET /payments/:paymentId
```

`JwtAuthGuard` 적용.

현재 허용:

- payment 소유 사용자
- admin
- 같은 store 소속 seller

### Store 주문 결제 조회

```text
GET /stores/:storeId/orders/:orderId/payment
```

`JwtAuthGuard` 적용. 현재 service는 admin 또는 해당 store 소속 사용자 역할/소유권을 확인한다.

범용 `POST /refund` 같은 public endpoint는 없다.

## 12. PortOne client 오류 처리

`PortoneClient`는 provider 실패를 `PortoneError(status, type, message)`로 보존한다.

중요한 구분:

- `404 + PAYMENT_NOT_FOUND`: PENDING reconciliation에서 “결제가 존재하지 않음”으로 취급 가능
- `401`: 인증 실패이며 결제 없음으로 취급하면 안 됨
- 네트워크/파싱/기타 provider 오류: 결제 상태를 추측하지 않고 확인 필요로 남김

오류 메시지는 진단용으로 정제하며 비밀 인증 header를 로그에 출력하지 않는다.

## 13. 공개 공통 타입

현재 `packages/shared/src/payment.types.ts`:

```ts
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
export type PayMethod = 'kakaopay' | 'naverpay' | 'card'

export interface Payment {
  id: string
  orderId: string
  userId: string
  storeId: string
  amount: number
  payMethod: PayMethod | null
  status: PaymentStatus
  portonePaymentId: string
  portoneTransactionId: string
  refundAmount: number | null
  refundedAt: string | null
  refundReason: string | null
  createdAt: string
  updatedAt: string
}
```

주의: provider의 `method.type` 문자열과 shared `PayMethod`의 좁은 union 사이 정규화 범위를 변경할 때는 실제 service와 consumer 사용처를 함께 검토한다. 문서만 보고 provider 문자열을 가정하지 않는다.

## 14. 운영 이슈 연계

결제 계열 주요 운영 이슈:

- `PAYMENT_LOOKUP_FAILED`: timeout reconciliation 중 원격 결제 상태를 신뢰성 있게 조회하지 못함
- `AUTO_REFUND_FAILED`: 자동 환불 provider 호출 실패

이 이슈가 열려 있으면 상태를 추측하거나 PortOne 콘솔에서 반복 환불하지 않는다. 운영 조치는 `docs/specs/ops/mvp-sales-round-runbook.md`를 따른다.

## 15. 검증 원칙

결제 계약 변경 시 최소 확인:

- `apps/api/src/payments/payments.controller.ts`
- `apps/api/src/payments/payments.service.ts`
- `apps/api/src/payments/payment-finalization.service.ts`
- `apps/api/src/payments/payment-refund.service.ts`
- `apps/api/src/payments/order-charge-payment.service.ts`
- `apps/api/src/payments/portone.client.ts`
- 관련 unit/e2e tests
- `packages/shared/src/payment.types.ts`
- 회차 결제면 `docs/specs/mvp-sales-round-direct-delivery.md`
- 운영 예외면 runbook

특히 finalization 안전성 변경 시 `PENDING`, `FAILED`, `CANCELLED`, `PAID`, 금액 불일치와 회차/legacy 경로를 각각 회귀 테스트로 확인한다. 문서에 적힌 원하는 불변식을 구현 완료 증거로 대신하지 않는다.

실제 결제·환불은 테스트 문서에 적힌 예시만으로 실행하지 않는다. 대상 환경과 승인 범위를 확인한다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-24 | 문서 정합성 기준에 따라 finalization P0, 본 결제 환불, 재배송비 결제·환불의 검증 상태를 분리 |
| 2026-08-23 | 현재 `main`의 `finalizePaidOrder()`가 provider `PAID` 상태를 자체 차단하지 않는 구현 한계를 명시하고 호출 경로 의존성을 정합화 |
| 2026-08-23 | webhook 서명, PortOne 재조회, PENDING reconciliation, 늦은 결제 재확보/환불, refund claim, 재배송비 결제에 맞춰 전면 정합화 |
| 2026-03-27 | PortOne V2 초기 전환 |
| 2026-03-26 | 초기 payments 설계 초안 |

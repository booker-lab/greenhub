<!-- Language: ko -->

# Orders API / Domain Spec

> **최종 정합화**: 2026-08-24
> **상태**: Current
> **공통 타입 정본**: `packages/shared/src/order.types.ts`
> **FSM 구현 정본**: `apps/api/src/orders/orders.helpers.ts`, `apps/api/src/orders/*lifecycle*`
> **회차 직배송 제품 계약**: `docs/specs/mvp-sales-round-direct-delivery.md`
> **운영 계약**: `docs/specs/ops/mvp-sales-round-runbook.md`

## 1. 소유권

`orders`는 consumer·seller·driver가 공유하는 핵심 도메인이다.

- 주문 생성·상태 전이·취소·재배송비·보류·사진 완료 write는 NestJS API가 소유한다.
- 공개 주문 타입은 `packages/shared/src/order.types.ts`가 소유한다.
- Firestore 원문에는 `reservationId`, `clientOrderPayloadHash`, `marketingConsent` 등 공개 DTO 외 내부 필드가 존재할 수 있다.
- legacy와 `schemaVersion: 2` 회차 주문이 공존하므로 한 흐름의 규칙을 다른 흐름에 자동 적용하지 않는다.

## 2. 주문 상태

```ts
type OrderStatus =
  | 'PENDING'
  | 'RECRUITING'
  | 'CONFIRMED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'DELIVERING'
  | 'DELIVERY_HELD'
  | 'HUB_ARRIVED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REVIEWED'
```

`DELIVERY_HELD`는 회차 직배송 배송 실패·재배송 흐름의 현재 상태다.

## 3. 역할별 FSM

`orders.helpers.ts`의 전이 허용 목록은 **필요조건일 뿐 충분조건이 아니다**. service/lifecycle의 소유권·delivery method·결제·회차 불변식을 추가로 통과해야 한다.

### Seller

- `ACCEPTED → PREPARING`
- `CONFIRMED → PREPARING`
- `PREPARING → DELIVERED` — 실제 lifecycle의 parcel 조건 추가
- `PREPARING → DELIVERY_HELD`
- `DELIVERING → DELIVERY_HELD`
- `DELIVERY_HELD → PREPARING`
- `DELIVERY_HELD → CANCELLED`
- seller 취소 기본 허용 상태: `ACCEPTED`, `CONFIRMED`, `PREPARING`

### Driver

- `PREPARING → DELIVERING`
- `PREPARING → DELIVERY_HELD`
- `DELIVERING → HUB_ARRIVED`
- `DELIVERING → DELIVERED`
- `DELIVERING → DELIVERY_HELD`
- `DELIVERY_HELD → DELIVERING`

### Consumer

- `DELIVERED → REVIEWED`
- `PICKED_UP → REVIEWED`

### Admin

helper 수준에서는 seller·driver 전이의 합집합과 seller 취소 가능 상태를 허용한다. 실제 endpoint별 추가 불변식은 별도 확인한다.

FSM 표만 근거로 Firestore 주문 상태를 직접 수정하지 않는다.

## 4. 배송 보류·재배송 계약

`DeliveryHoldSnapshot` 핵심 필드:

```ts
{
  heldAt: string
  reasonCode:
    | 'WEATHER'
    | 'ACCESS_UNAVAILABLE'
    | 'ADDRESS_ISSUE'
    | 'CUSTOMER_UNREACHABLE'
    | 'OTHER'
  reasonMessage: string
  customerResponsible: boolean
  redeliveryFee: number | null
  nextContactAt: string | null
  nextDeliveryAt: string | null
  resolvedAt: string | null
}
```

현재 제품·운영 불변식:

- `WEATHER`는 고객 책임 유료 재배송으로 취급하지 않는다.
- 고객 책임 첫 배송 실패에 양수 재배송비가 필요하면 주문자 본인이 `REDELIVERY_FEE` charge를 생성·결제한다.
- 같은 hold에 charge를 중복 생성하지 않는다.
- **유료 재배송은 결제 완료 전 실제 배송을 다시 시작하면 안 된다.**
- 결제 요청 알림을 받은 동안 소비자가 실제 결제 endpoint/UI를 사용할 수 있어야 한다.
- 유료 재배송까지 실패하면 자동 환불을 추측하지 않고 `REDELIVERY_FAILED` 운영 이슈로 이관한다.

현재 알림 매핑:

- `PREPARING|DELIVERING → DELIVERY_HELD` → `ORDER_DELIVERY_HELD`
- `DELIVERY_HELD → PREPARING` → `ORDER_REDELIVERY_PAYMENT_REQUESTED`
- `DELIVERY_HELD → DELIVERING` → `ORDER_REDELIVERY_SCHEDULED`

이 매핑은 현재 코드 사실이며, 아래 P0가 해결되기 전 **정상 재배송 상태머신의 보장으로 해석하지 않는다.**

### 재배송비 결제·재개 상태머신 — `IMPLEMENTATION FINDING` P0

2026-08-24 감사에서 단순 PAID guard 누락을 넘어 상태머신 자체가 결제 요청 흐름과 충돌함을 확인했다.

#### 경로 A — driver 직접 재개 우회

- `orders.helpers.ts`는 `DELIVERY_HELD → DELIVERING`을 허용한다.
- lifecycle은 해당 전환 직전에 현재 `redeliveryChargeId`의 charge `PAID`를 확인하지 않는다.
- driver 상세도 회차 직배송 `DELIVERY_HELD`이면 charge 상태와 무관하게 `배송 재개` CTA를 노출한다.

결과: 유료 재배송비가 미결제여도 직접 배송 재개가 가능할 수 있다.

#### 경로 B — seller `PREPARING` 경유 결제 불가·우회

현재 직접 테스트는 고객 책임+양수 재배송비인 `DELIVERY_HELD` 주문을 seller가 `PREPARING`으로 전환하는 것을 정상 성공으로 고정한다. 이 전환은 hold를 `resolvedAt`으로 닫고 회차 `heldOrderCount`도 감소시킨다.

하지만 동시에:

- `OrderChargesService.createRedeliveryFeeCharge()`는 주문이 **현재 `DELIVERY_HELD`**여야 charge를 만들 수 있다.
- consumer `canPayRedeliveryFee`도 **현재 status가 `DELIVERY_HELD`**일 때만 true다.
- 즉 seller `DELIVERY_HELD → PREPARING` 뒤 `ORDER_REDELIVERY_PAYMENT_REQUESTED` 알림이 나가더라도 소비자 결제 endpoint/UI는 더 이상 actionable하지 않다.
- 이후 `PREPARING → DELIVERING`에는 과거 paid-required hold의 미결제 상태를 확인하는 durable guard가 없다.

결과: `결제 요청 알림 → 실제 결제 불가`라는 unreachable flow와 `PREPARING` 경유 미결제 배송 시작 우회가 동시에 존재한다.

#### 판정

- `OrderChargePaymentService`의 charge **결제·환불 하위 계약은 `VERIFIED`**다.
- 그러나 **유료 재배송 주문 상태머신 전체는 P0 `IMPLEMENTATION FINDING`**이다.
- 단순히 driver `DELIVERY_HELD → DELIVERING` 한 경로에만 `PAID` 조건을 추가하면 seller `PREPARING` 경유 우회가 남으므로 완료가 아니다.

#### actual release SHA 전 완료 조건

구현 형태는 선택할 수 있지만 다음 불변식은 모두 필요하다.

1. 고객 책임+양수 재배송비가 요구된 hold에서 `payment required` 상태가 결제 완료 전 사라지지 않는다.
2. 결제 요청 알림 시점에도 소비자가 charge 생성/결제 UI와 endpoint를 실제 사용할 수 있다.
3. 현재 hold와 현재 charge의 연계를 `heldAt` 또는 동등 durable key로 검증한다.
4. charge는 `REDELIVERY_FEE`, 같은 order/store/user, `status === 'PAID'`일 때만 유료 재배송 배송 시작을 허용한다.
5. `PENDING|FAILED|REFUNDED|missing|mismatched`이면 모든 배송 시작 경로를 side effect 0으로 거부한다.
6. **`DELIVERY_HELD → DELIVERING`뿐 아니라 `DELIVERY_HELD → PREPARING → DELIVERING` 등 paid-required hold 이후의 모든 delivery-start 경로를 동일하게 gate한다.**
7. seller가 결제 요청을 위해 `PREPARING`으로 옮기는 구조를 유지한다면 `payment required` marker/charge linkage가 상태 변경 후에도 durable하게 남고 consumer 결제가 계속 가능해야 한다. 그렇지 않으면 결제 완료 전 hold를 해소하지 않는 구조로 변경한다.
8. 결제 완료 시점과 hold 해소/held counter 감소 시점을 하나의 명시적 계약으로 결정하고 race에서 음수·중복 해소가 없어야 한다.
9. 판매자/시스템 책임 또는 재배송비 없는 hold는 불필요한 결제 gate 없이 기존 정책대로 해소 가능해야 한다.
10. UI는 결제 대기/완료를 표현하되 서버 불변식의 대체물이 아니다.

필수 직접 회귀:

- 고객 책임 유료 hold → payment request 알림 뒤 consumer 결제 CTA/endpoint가 계속 actionable
- charge 없음/PENDING/FAILED/REFUNDED에서 driver direct resume 거부
- seller가 결제 전 `PREPARING`으로 전환할 수 있는지 정책대로 직접 고정
- `PREPARING` 경유에서도 미결제 `DELIVERING` 진입 거부
- `PAID` 뒤 정상 한 번 재개 성공
- seller/driver 동시 요청에서 한 번만 hold 해소·counter 감소·scheduled 알림
- 판매자 책임/무료 재배송 정상 회귀

추적: `docs/BACKLOG.md`의 `ORDER-REDELIVERY-PAID-RESUME-GATE`.

## 5. 주문 생성

`CreateOrderDto`는 legacy와 회차 주문을 함께 수용한다. DTO 통과만으로 주문 가능하지 않으며 상품·회차·배송지역·한도·가격·소유권·판매모드·멱등성을 service에서 검증한다.

## 6. 주요 API

```text
GET   /orders
GET   /orders/:orderId
POST  /stores/:storeId/orders/validate-cart
POST  /stores/:storeId/orders
GET   /stores/:storeId/orders
GET   /stores/:storeId/orders/:orderId
PATCH /stores/:storeId/orders/:orderId/status
PATCH /stores/:storeId/orders/:orderId/cancel
PATCH /stores/:storeId/orders/:orderId/delivery-hold
POST  /stores/:storeId/orders/:orderId/redelivery-fee
PATCH /stores/:storeId/orders/:orderId/delivery-photo
PATCH /stores/:storeId/orders/:orderId/review
PATCH /stores/:storeId/orders/:orderId/pickup-confirm
PATCH /stores/:storeId/orders/:orderId/hub-confirm
```

## 7. 권한 검증 상태

### API 조회 권한 — `VERIFIED`

- consumer: 자기 주문만
- seller: 실제 store owner만 해당 store
- driver: API 경로는 assigned `driverId` 주문만
- admin: 운영 범위

### Direct Firestore 주문 read — `IMPLEMENTATION FINDING` P0

current Rules는 `role == driver`이면 주문의 배정/store/status와 무관하게 read를 허용하고 seller/driver frontend는 raw order를 사용한다. 필요한 discovery는 유지하되 arbitrary read와 불필요 필드를 최소화해야 한다.

추적: `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`.

### 상태 변경 authorization — `IMPLEMENTED / UNVERIFIED`

seller ownership, driver assignment, consumer ownership guard는 구현돼 있으나 타-store seller·비담당 driver·first-claim 외 미배정 driver action과 거부 side-effect 0의 직접 회귀가 부족하다.

추적: `ORDER-MUTATION-AUTHORIZATION-COVERAGE`.

## 8. 회차 주문 취소

회차 취소는 단순 `CANCELLED` write가 아니다.

- cancellation claim/retry state
- 본 결제 환불
- paid 재배송비/추가 charge 환불
- reservation·round/item capacity 반환
- held counter 정합화
- 주문 취소
- settlement 취소

admin force-refund 우회는 `ADMIN-FORCE-REFUND-CONSISTENCY`를 따른다.

## 9. 배송 사진

회차 직배송 사진은 담당 기사가 서버 API로 비공개 Storage에 업로드하며 사진 연결 없이 직접배송 `DELIVERED` 완료를 허용하지 않는다. read URL은 주문 권한 검증 뒤 단기 signed URL로 발급한다.

## 10. 결제 연결

본 결제 finalization·timeout·늦은 결제·환불 정본은 `docs/specs/api/payments.md`다.

재배송비 charge 하위 계약 `VERIFIED`를 **재배송 상태머신 전체 `VERIFIED`로 확장하지 않는다.**

## 11. 검증 진입점

- `packages/shared/src/order.types.ts`
- `apps/api/src/orders/orders.helpers.ts`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders-query.service.ts`
- `apps/api/src/orders/*lifecycle*`
- `apps/api/src/orders/order-charges.service.ts`
- `apps/api/src/payments/order-charge-payment.service.ts`
- `apps/consumer/src/app/mypage/orders/[id]/**`
- `apps/driver/src/app/board/[orderId]/**`
- 관련 unit/spec/E2E
- `firestore.rules`와 Rules tests
- 회차 변경 시 제품 spec·운영 runbook

권한·금전 불변식은 UI 동작만으로 `VERIFIED` 처리하지 않는다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-24 | 재배송 P0를 단순 PAID resume guard에서 payment-request/hold-resolution/`PREPARING` 우회까지 포함한 상태머신 결함으로 보강 |
| 2026-08-24 | 유료 재배송비 결제 전 배송 재개 금지 P0 최초 반영 |
| 2026-08-24 | direct Firestore read authorization·최소화 P0 반영 |
| 2026-08-23 | 현행 endpoint/FSM/회차·legacy 공존 계약으로 정합화 |

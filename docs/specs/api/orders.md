<!-- Language: ko -->

# Orders API / Domain Spec

> **최종 정합화**: 2026-08-30
> **상태**: Current
> **공통 타입 정본**: `packages/shared/src/order.types.ts`
> **FSM 구현 정본**: `apps/api/src/orders/orders.helpers.ts`, `apps/api/src/orders/*lifecycle*`
> **회차 직배송 제품 계약**: `docs/specs/mvp-sales-round-direct-delivery.md`
> **운영 계약**: `docs/specs/ops/mvp-sales-round-runbook.md`

## RC-D source alignment note

현재 작업 트리의 A/B/C 구현 결과를 기준으로 이 문서의 주문 경계를 정렬한다. 전체 회귀 통과나
production 활성화를 이 문서만으로 주장하지 않는다.

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

이 매핑은 현재 코드 사실이다. `RoundOrderLifecycleService`와 `OrdersLifecycleService`는 회차 주문의
각 `DELIVERING` 전환 직전에 공통 `assertPaidRedeliveryResume`를 호출한다. 현재 배송 보류와 charge의
`orderId`·`storeId`·`userId`·`heldAt`·금액·type 연결 및 `status === 'PAID'`를 확인하고, charge가
누락되었거나 `PENDING|FAILED|REFUNDED`이거나 연결이 다르면 상태 변경 전에 거부한다. `DELIVERY_HELD
→ PREPARING`에서는 유료 보류 표식을 해소하지 않아 소비자가 결제를 계속할 수 있고, 결제 완료 뒤
`PREPARING → DELIVERING` 또는 직접 `DELIVERY_HELD → DELIVERING`을 재개한다. 무료·운영 책임 보류는
불필요한 결제 gate 없이 기존 정책으로 처리한다.

이 문서는 위 source guard의 존재를 기록한 것이며, 동시성·전체 lifecycle의 최종 release 판정은
별도 최종 회귀에서 한다.

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
- driver: 배정된 활성 주문과 배정 전 `PREPARING` direct/hub discovery 주문을 API projection으로 조회
- admin: 운영 범위

### 주문 read 경계 — seller current / driver SEC-02 소비

- seller 목록·상세는 JWT와 역할을 확인하는 API를 사용하고, 서버에서 store owner를 확인한 뒤
  list/detail projection만 반환한다. consumer·driver·다른 store의 seller는 거부한다.
- seller frontend의 주문 raw Firestore `onSnapshot` 경로는 현재 사용하지 않는다. `userId`,
  `driverId`, reservation·payment 내부 필드, marketing metadata 등은 seller projection에 넣지
  않는다.
- driver는 기존 CLOSED `SEC-02` API 경계와 배송 업무 projection을 사용한다. 이 문서는 driver
  authorization을 재설계하지 않는다.
- Firestore Rules의 legacy direct-read 잔여 계약이 별도로 남아 있다면 현재 API projection의
  근거로 사용하지 않으며, 법률 문구가 원문 전체 접근을 정당화하지 않는다.

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

재배송비 charge 결제·환불 하위 계약과 paid-before-resume source guard를 기록한다. 동시성·전체
상태머신의 최종 release 판정은 별도 회귀에서 수행한다.

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
| 2026-08-30 | 현재 회차 lifecycle의 paid-before-resume guard와 `DELIVERY_HELD → PREPARING` 결제 요청 경계를 반영하고 seller API projection 경계를 정합화 |
| 2026-08-24 | 유료 재배송비 결제 전 배송 재개 금지와 direct Firestore read authorization·최소화 finding 최초 반영 |
| 2026-08-23 | 현행 endpoint/FSM/회차·legacy 공존 계약으로 정합화 |

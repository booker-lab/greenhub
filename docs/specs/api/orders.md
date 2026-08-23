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

- 주문 생성·검증·상태 전이·취소·재배송비·배송 보류·배송 사진 완료 같은 write는 NestJS API가 소유한다.
- 공개 주문 타입은 `packages/shared/src/order.types.ts`가 소유한다.
- Firestore 원문에는 공개 타입 외 `reservationId`, `clientOrderPayloadHash`, `marketingConsent` 등 내부 필드가 존재할 수 있으므로 raw document를 공개 DTO와 동일시하지 않는다.
- legacy 주문과 `schemaVersion: 2` 회차 주문이 공존하므로 한 흐름의 규칙을 다른 흐름에 자동 적용하지 않는다.

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

`DELIVERY_HELD`는 회차 직배송의 배송 실패·재배송 흐름에서 사용하는 현재 공통 상태다.

## 3. 역할별 FSM

`orders.helpers.ts`의 일반 전이 허용 목록은 다음과 같다. 이 목록은 **필요조건일 뿐 충분조건이 아니다**. service/lifecycle의 소유권·delivery method·결제·회차 불변식을 추가로 통과해야 한다.

### Seller

- `ACCEPTED → PREPARING`
- `CONFIRMED → PREPARING`
- `PREPARING → DELIVERED` — 실제 lifecycle에서 parcel 조건 추가
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

FSM 표를 근거로 Firestore 주문 상태를 직접 수정하지 않는다.

## 4. 배송 보류·재배송 계약

`DeliveryHoldSnapshot`의 핵심 필드:

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

현재 제품·운영 계약:

- `WEATHER`는 고객 책임 유료 재배송으로 취급하지 않는다.
- 고객 책임 첫 배송 실패에서 양수 `redeliveryFee`가 요구되면 주문자 본인이 `POST /stores/:storeId/orders/:orderId/redelivery-fee`로 `REDELIVERY_FEE` charge를 생성·결제한다.
- 같은 보류에 대해 중복 charge를 만들지 않는다.
- **유료 재배송비가 요구된 보류는 연결 charge가 `PAID`임을 서버가 확인한 뒤에만 배송을 다시 시작할 수 있어야 한다.** 운영 정본은 명시적으로 `결제 전 재배송 금지`를 요구한다.
- 유료 재배송까지 다시 실패하면 자동 환불을 추측하지 않고 `REDELIVERY_FAILED` 운영 이슈로 이관한다.

알림 연결:

- `PREPARING|DELIVERING → DELIVERY_HELD` → `ORDER_DELIVERY_HELD`
- `DELIVERY_HELD → PREPARING` → `ORDER_REDELIVERY_PAYMENT_REQUESTED`
- `DELIVERY_HELD → DELIVERING` → `ORDER_REDELIVERY_SCHEDULED`

알림 템플릿·provider 계약은 `docs/specs/api/notifications.md`가 소유한다.

### 재배송비 결제 전 배송 재개 — `IMPLEMENTATION FINDING` P0

2026-08-24 현재 제품 계약과 실제 구현을 대조하면 위 결제 게이트가 서버에서 강제되지 않는다.

직접 근거:

- `docs/specs/ops/mvp-sales-round-runbook.md`는 첫 고객 사유 실패를 `재배송비 1건 생성·결제. 결제 전 재배송 금지`로 규정한다.
- `OrderChargePaymentService` 자체는 `PAID` 상태·금액·charge/order 연결과 환불 멱등성을 직접 검증한다.
- 그러나 `orders.helpers.ts`는 driver의 `DELIVERY_HELD → DELIVERING`을 허용하고, `OrdersLifecycleService`/`RoundOrderLifecycleService`는 해당 전환 직전에 연결 `orderCharges/{redeliveryChargeId}.status === 'PAID'`를 확인하지 않는다.
- driver `board/[orderId]/page.tsx`도 회차 직배송 `DELIVERY_HELD`이면 charge 상태를 확인하지 않고 항상 `배송 재개` CTA를 노출해 `DELIVERING` 전환을 호출한다.
- 현재 회귀 테스트는 charge 생성·결제·환불 자체는 고정하지만 미결제/실패 charge에서 배송 재개를 거부하는 서버 회귀를 고정하지 않는다.

판정:

- `OrderChargePaymentService`의 **재배송비 결제·환불 하위 계약은 `VERIFIED`**다.
- 그러나 **유료 재배송비 결제 완료를 배송 재개 전제조건으로 강제하는 주문 lifecycle 계약은 P0 `IMPLEMENTATION FINDING`**이다.
- UI에서 버튼을 숨기는 것만으로 완료하지 않는다. API 직접 호출에서도 fail-closed여야 한다.

actual release SHA 전 완료 조건:

- 고객 책임이고 `redeliveryFee > 0`인 현재 보류가 유료 재배송 대상인지 서버에서 판정한다.
- `DELIVERY_HELD → DELIVERING` 직전에 주문의 현재 `redeliveryChargeId`와 현재 보류의 `heldAt` 연계를 확인한다.
- 연결 charge가 존재하고 `type === 'REDELIVERY_FEE'`, 같은 order/store/user에 속하며 `status === 'PAID'`일 때만 유료 재배송 재개를 허용한다.
- `PENDING|FAILED|REFUNDED|missing|mismatched` charge에서는 주문·held counter·알림 side effect 없이 전환을 거부한다.
- 판매자/시스템 책임 또는 재배송비가 없는 보류는 불필요한 결제 요구 없이 기존 정책대로 해소 가능해야 한다.
- 이미 결제된 같은 보류의 정상 배송 재개는 한 번만 수렴한다.
- driver UI도 charge 상태를 명시적으로 표현하되 UI 방어를 서버 불변식의 대체물로 사용하지 않는다.
- 직접 unit/integration 회귀와 회차 E2E에 `미결제 재개 거부 → 결제 완료 → 재개 성공`을 포함한다.

추적: `docs/BACKLOG.md`의 `ORDER-REDELIVERY-PAID-RESUME-GATE`.

## 5. 주문 생성 입력

`CreateOrderDto`는 legacy와 회차 주문을 함께 수용한다. 주요 입력은 상품·수량·판매형태·배송방식·배송주소·배송 연락처이며 회차 주문은 `roundId`, `roundItems`, 선택적 마케팅 동의·유입 snapshot을 추가로 가진다.

DTO 형식 통과가 주문 가능성을 의미하지 않는다. 상품·회차·배송지역·한도·가격·소유권·판매모드·멱등성 검증을 service에서 추가로 통과해야 한다.

## 6. 현재 API endpoint

모든 보호 endpoint는 `JwtAuthGuard`와 service ownership 검사를 함께 사용한다.

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

판정 기준은 `docs/DOCUMENT_CONSISTENCY.md`를 따른다.

### API 조회 권한 — `VERIFIED`

`OrdersQueryService`와 직접 테스트가 다음을 고정한다.

- consumer: 자기 주문만 조회
- seller: 실제 store owner만 해당 store 주문 조회
- driver: API 경로에서는 배정된 `driverId` 주문만 조회
- admin: 운영 범위 조회
- storeId 없는 상세에서도 seller ownership·driver assignment 재검증

### Direct Firestore 주문 read — `IMPLEMENTATION FINDING` P0

실제 seller/driver frontend는 API 외 raw Firestore read를 사용한다.

- current `firestore.rules`는 `role == 'driver'`이면 주문의 배정·store·상태와 무관하게 read를 허용한다.
- driver 보드의 미배정 `PREPARING` direct/hub discovery 자체는 현재 제품 흐름에 필요하다.
- 그러나 임의 주문 원문 read와 역할에 불필요한 내부/동의/유입 필드 노출까지 허용할 근거는 아니다.

actual release SHA 전에는 discovery 최소 필드, assigned detail 최소 필드, seller 최소 필드와 Rules/앱 회귀를 함께 고정한다.

추적: `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`.

### 상태 변경 authorization — `IMPLEMENTED / UNVERIFIED`

구현은 seller store ownership, driver assignment, consumer order ownership을 검사하고 미배정 `PREPARING → DELIVERING` first-claim을 별도 허용한다.

현재 부족한 직접 회귀:

- 타-store seller status/delivery-hold mutation 거부
- 비담당 driver assigned-order mutation 거부
- first-claim 외 미배정 driver mutation 거부
- 거부 요청에서 order write·notification·refund·settlement side effect 0

추적: `ORDER-MUTATION-AUTHORIZATION-COVERAGE`.

## 8. 회차 주문 취소

회차 취소는 단순 `status=CANCELLED` write가 아니다.

- cancellation claim/retry state
- 본 결제 환불
- paid 재배송비/추가 charge 환불
- checkout reservation·round/item capacity 반환
- `DELIVERY_HELD` counter 정합화
- order cancellation 확정
- settlement 취소

관리자 강제 환불이 이 orchestration을 우회하는 현재 문제는 `docs/specs/api/admin.md`와 `ADMIN-FORCE-REFUND-CONSISTENCY`를 따른다.

## 9. 배송 사진

회차 직배송 완료는 서버 비공개 사진 API를 사용한다.

```text
POST /stores/:storeId/orders/:orderId/delivery-photos
GET  /stores/:storeId/orders/:orderId/delivery-photos/:photoId/url
```

- 담당 기사만 회차 직배송 `DELIVERING` 주문에 JPEG를 업로드할 수 있다.
- 최대 5 MiB.
- 사진은 서버가 비공개 Storage 경로에 저장하고 주문에 연결한다.
- 직접배송은 사진 연결 없이 `DELIVERED`로 완료할 수 없다.
- read URL은 주문 권한 검증 뒤 단기 signed URL로 발급한다.

상세는 `DeliveryPhotosService`, `StorageService`, 관련 Rules/tests가 정본이다.

## 10. Legacy 공동구매

legacy 공동구매의 `RECRUITING`, `CONFIRMED`, `GROUP_*` 알림과 자동 확정·미달 환불 흐름은 회차 직배송과 별개로 유지한다. 회차 출시를 위해 legacy 상태를 임의 삭제하지 않는다.

## 11. 결제 연결

회차 주문의 본 결제 finalization·timeout·늦은 결제·환불 정본은 `docs/specs/api/payments.md`다.

재배송비 결제 하위 계약이 `VERIFIED`라는 사실은 **주문 lifecycle이 결제 완료 전 재배송을 차단한다는 보장으로 확장하지 않는다.** 두 계약은 별도로 검증한다.

## 12. 검증 진입점

주문 변경 시 최소 확인:

- `packages/shared/src/order.types.ts`
- `apps/api/src/orders/orders.helpers.ts`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders-query.service.ts`
- `apps/api/src/orders/*lifecycle*`
- `apps/api/src/orders/order-charges.service.ts`
- `apps/api/src/payments/order-charge-payment.service.ts`
- 관련 unit/spec tests
- `firestore.rules`, `tests/firestore/firestore-rules.test.mjs`
- seller/driver raw Firestore 사용처
- 회차 변경이면 `docs/specs/mvp-sales-round-direct-delivery.md`와 운영 runbook

권한·금전 불변식은 UI 동작만으로 `VERIFIED` 처리하지 않는다. API 직접 호출, 동시성, 실패 side effect를 포함한 서버 증거가 필요하다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-24 | 재배송비 결제 전 배송 재개 금지 계약과 현재 서버/UI 우회 경로를 P0로 정합화; direct Firestore read·mutation coverage current finding 유지 |
| 2026-08-24 | direct Firestore read authorization·역할별 최소화 P0 반영 |
| 2026-08-23 | 현행 endpoint/FSM/회차·legacy 공존 계약으로 전면 정합화 |

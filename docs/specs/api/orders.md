<!-- Language: ko -->

# Orders API / Domain Spec

> **최종 정합화**: 2026-08-24
> **상태**: Current
> **공통 타입 정본**: `packages/shared/src/order.types.ts`
> **FSM 정본**: `apps/api/src/orders/orders.helpers.ts` 및 lifecycle service
> **회차 직배송 추가 계약**: `docs/specs/mvp-sales-round-direct-delivery.md`

## 1. 소유권

`orders`는 consumer·seller·driver가 공유하는 핵심 도메인이다.

- 주문 생성·검증·상태 전이·취소·재배송비·배송 보류·배송 사진 완료 같은 쓰기는 NestJS API가 소유한다.
- frontend는 현재 API와 허용된 Firebase read 경로를 사용한다.
- 공개 상태·주문 DTO의 공통 정본은 `packages/shared/src/order.types.ts`다.
- legacy 일반 판매·공동구매와 `schemaVersion: 2` 회차 주문이 같은 도메인에 공존하므로 한 흐름의 규칙을 다른 흐름에 임의 적용하지 않는다.

## 2. 주문 상태

현재 `OrderStatus`:

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

과거 spec에 없던 `DELIVERY_HELD`는 현재 공통 상태다. 회차 직배송의 배송 실패·재배송 흐름에서 사용한다.

## 3. 현재 역할별 FSM

`apps/api/src/orders/orders.helpers.ts` 기준 일반 상태 전이 허용 목록:

### Seller

- `ACCEPTED → PREPARING`
- `CONFIRMED → PREPARING`
- `PREPARING → DELIVERED` — parcel 등 실제 lifecycle guard를 추가로 통과해야 함
- `PREPARING → DELIVERY_HELD`
- `DELIVERING → DELIVERY_HELD`
- `DELIVERY_HELD → PREPARING`
- `DELIVERY_HELD → CANCELLED`
- seller 취소 허용 상태: `ACCEPTED`, `CONFIRMED`, `PREPARING`

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

현재 helper는 seller와 driver 전환을 합친 범위 및 seller 취소 가능 상태를 허용한다. 단, endpoint 소유권·delivery method·회차 상태 등 service/lifecycle의 추가 guard는 그대로 적용된다.

FSM 표만 보고 상태를 직접 Firestore에서 수정하지 않는다.

## 4. 배송 보류와 재배송

`DELIVERY_HELD` snapshot은 shared 타입에서 다음 핵심 필드를 가진다.

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

`HoldDeliveryDto`는 reason code, reason message, 책임 여부, 선택적 재배송비·다음 연락/배송 시각을 검증한다. 실제 책임 판정과 허용 전이는 lifecycle service를 따른다.

재배송 알림 연결:

- `PREPARING|DELIVERING → DELIVERY_HELD` → `ORDER_DELIVERY_HELD`
- `DELIVERY_HELD → PREPARING` → `ORDER_REDELIVERY_PAYMENT_REQUESTED`
- `DELIVERY_HELD → DELIVERING` → `ORDER_REDELIVERY_SCHEDULED`

알림 본문과 ALIGO provider 계약은 `docs/specs/api/notifications.md`가 소유한다.

## 5. 공통 주문 데이터

현재 `Order` 공통 타입의 주요 필드:

```ts
{
  id: string
  orderNumber?: string
  schemaVersion?: 1 | 2
  storeId: string
  userId: string
  productId: string
  quantity: number
  saleType: 'normal' | 'group'
  status: OrderStatus
  deliveryMethod: 'direct' | 'hub' | 'parcel'
  deliveryFee: number
  deliveryAddress: DeliveryAddress
  isMetropolitan: boolean
  hubId: string | null
  pickupCode: string | null
  totalAmount: number
  requestedDeliveryDate: string | null
  preparedAt: string | null
  cancelReason: string | null
  groupBuyConsent: GroupBuyConsent | null

  roundId?: string | null
  roundName?: string | null
  orderItems?: OrderItemSnapshot[]
  acquisition?: OrderAcquisitionSnapshot | null
  deliveryHold?: DeliveryHoldSnapshot | null
  deliveryPhone?: string | null
  deliveryPhotoIds?: string[]

  createdAt: string
  updatedAt: string

  productName?: string
  buyerName?: string
  address?: string
  buyerPhone?: string | null
  sellerPhone?: string | null
  hubName?: string | null
  hubAddress?: string | null
}
```

이 문서에 Firestore 내부 필드를 별도 복제하지 않는다. 새 공개 필드를 추가하면 shared 타입을 먼저 확인한다.

## 6. 주문 생성 입력

현재 `CreateOrderDto`는 legacy와 회차 주문을 함께 수용한다.

주요 필드:

```ts
{
  clientOrderRequestId?: string
  productId: string
  quantity: number
  saleType: 'normal' | 'group'
  deliveryMethod: 'direct' | 'hub' | 'parcel'
  hubId?: string
  deliveryAddress: {
    address: string
    addressDetail: string
    zipCode: string
  }
  deliveryPhone: string
  requestedDeliveryDate?: string
  groupBuyConsent?: {
    agreed: boolean
    agreedAt: string
  }
  roundId?: string
  roundItems?: Array<{
    roundItemId: string
    quantity: number
  }>
  marketingConsent?: {
    agreed: boolean
    channels: Array<'alimtalk' | 'sms'>
    copyVersion: string
    agreedAt?: string
  }
  acquisition?: {
    source: 'carrot' | 'direct' | 'unknown'
    campaign?: string | null
    content?: string | null
    landingUrl?: string | null
    capturedAt: string
  }
}
```

DTO 형식 통과가 실제 주문 가능성을 의미하지 않는다. 상품·회차·배송지역·한도·소유권·판매모드·가격·멱등성 등 service 검증을 추가로 통과해야 한다.

## 7. 현재 API endpoint

모든 endpoint는 현재 `JwtAuthGuard` 아래에서 동작하며 세부 권한은 service에서 추가 검증한다.

### Consumer 자기 주문

```text
GET /orders
GET /orders/:orderId
```

현재 인증 사용자의 주문만 조회하는 진입점이다.

### Store 주문

```text
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

`GET /stores/:storeId/orders`의 현재 controller query는 `userId?`, `status?`, `saleType?`다. 과거 문서의 `driverId` query를 현재 공개 controller 계약으로 사용하지 않는다.

## 7A. 역할·소유권 검증 상태

문서 정합성 기준은 `docs/DOCUMENT_CONSISTENCY.md`를 따른다. 역할별 FSM이 존재한다는 사실과 실제 소유권·배정 권한이 회귀 테스트로 보장된다는 사실을 구분한다.

### 조회 권한 — `VERIFIED`

`OrdersQueryService`와 `orders-query.service.spec.ts`가 직접 대조된다.

- consumer: 요청 query의 `userId`와 무관하게 자신의 주문만 목록 조회하며 타인 상세는 거부한다.
- seller: `stores/{storeId}.ownerId === requesterId`인 스토어의 목록·상세만 허용한다.
- driver: `order.driverId === requesterId`로 배정된 주문의 목록·상세만 허용한다.
- admin: 스토어 주문 전체 조회를 허용한다.
- storeId 없는 단건 조회도 seller 소유권과 driver 배정을 다시 검증한다.
- 회차 직배송 완료 사진 URL도 주문 조회 권한을 통과한 뒤에만 생성한다.

### 상태 변경 권한 — `IMPLEMENTED / UNVERIFIED`

`OrdersLifecycleService.assertOrderActionAccess()`의 현재 구현은 다음과 같다.

- admin: 일반 action ownership guard 통과.
- seller: 해당 `storeId`의 실제 `ownerId`와 requester가 일치해야 변경 가능.
- driver: 이미 `driverId`가 있으면 해당 기사만 변경 가능.
- driver 첫 수거: `driverId`가 없고 주문이 `PREPARING`이며 요청 전이가 `DELIVERING`일 때만 최초 claim을 허용하고 이후 `driverId`를 기록한다.
- consumer: 자신의 주문에 대해서만 action access를 통과하며 실제 허용 전이는 consumer FSM이 추가 제한한다.

현재 직접 검증된 근거에는 consumer의 위장 `DELIVERY_HELD` 요청 거부, 정상 seller/driver 회차 흐름, 배송사진 타인 접근 거부가 포함된다.

그러나 2026-08-24 문서 감사 기준으로 다음 mutation authorization 거부 시나리오를 직접 고정하는 회귀 테스트는 확인되지 않았다.

- 다른 스토어의 seller가 `PATCH .../status` 또는 `delivery-hold`를 시도하는 경우
- 이미 다른 기사에게 배정된 주문을 비담당 driver가 변경하는 경우
- 미배정 주문에서 허용된 최초 `PREPARING → DELIVERING` 이외의 driver action이 거부되는 경우
- 위 거부 요청에서 주문·알림·환불·정산 side effect가 발생하지 않는지 확인

권한은 P0 계약이므로 위 직접 회귀가 추가되기 전 상태 변경 authorization 전체를 `VERIFIED`로 표현하지 않는다. 추적: `docs/BACKLOG.md`의 `ORDER-MUTATION-AUTHORIZATION-COVERAGE`.

## 8. 배송 사진

회차 직배송의 현재 정본 사진 경로는 단순 `photoUrl` 첨부가 아니라 서버가 파일을 수신·보관하고 완료 처리하는 전용 API다.

```text
POST /stores/:storeId/orders/:orderId/delivery-photos
GET  /stores/:storeId/orders/:orderId/delivery-photos/:photoId/url
```

업로드 계약:

- multipart field: `photo`
- `idempotencyKey` 필요
- 파일 1개
- 최대 5 MiB
- 세부 content type·권한·상태 전이는 `DeliveryPhotosService`와 회차 직배송 spec을 따른다.

`PATCH .../delivery-photo`의 `photoUrl` 경로가 controller에 남아 있다는 이유로 회차 직배송에서 공개 Firebase URL 업로드를 정본으로 사용하지 않는다.

## 9. 알림 연결

현재 FSM helper의 주요 알림 매핑:

| 전이 | 템플릿 |
|---|---|
| `ACCEPTED → PREPARING` | `ORDER_PREPARING` |
| `CONFIRMED → PREPARING` | `GROUP_PREPARING` |
| `PREPARING → DELIVERING` | `ORDER_DELIVERING` |
| `PREPARING → DELIVERED` | `ORDER_DELIVERED` |
| `PREPARING → DELIVERY_HELD` | `ORDER_DELIVERY_HELD` |
| `DELIVERING → HUB_ARRIVED` | `ORDER_HUB_ARRIVED` |
| `DELIVERING → DELIVERED` | `ORDER_DELIVERED` |
| `DELIVERING → DELIVERY_HELD` | `ORDER_DELIVERY_HELD` |
| `DELIVERY_HELD → PREPARING` | `ORDER_REDELIVERY_PAYMENT_REQUESTED` |
| `DELIVERY_HELD → DELIVERING` | `ORDER_REDELIVERY_SCHEDULED` |

주문 생성/결제 확정/취소 시 발생하는 추가 알림은 해당 service와 notifications spec을 따른다.

## 10. Legacy 공동구매

legacy 공동구매에는 `RECRUITING`, `CONFIRMED`, `GROUP_*` 알림, `groupProductConfig` 기반 자동 확정·미달 환불 흐름이 남아 있다.

이 흐름은 회차 직배송과 별개다.

- 회차 출시를 위해 legacy 공동구매 상태를 제거하지 않는다.
- `targetQuantity`, `minQuantity`, deadline 동작의 현재 정본은 실제 product/group service를 확인한다.
- 과거 설계의 “스케줄러 또는 Firestore trigger” 같은 미확정 표현을 현행 계약으로 사용하지 않는다.

## 11. 결제와 `PENDING`

과거 spec의 “PortOne webhook 미수신 15분이면 주문 자동 삭제” 설명을 모든 주문 유형의 현행 계약으로 사용하지 않는다.

회차 주문에는 예약·결제 최종화·늦은 결제 수렴·한도 반환/재확보가 별도 구현돼 있다. 결제 상태 전환과 timeout 정본은 다음을 함께 확인한다.

- `docs/specs/api/payments.md`
- `docs/specs/mvp-sales-round-direct-delivery.md`
- `apps/api/src/payments/**`
- `apps/api/src/orders/round-order-lifecycle.service.ts`

## 12. 검증 원칙

주문 계약 변경 시 최소 확인:

- `packages/shared/src/order.types.ts`
- `apps/api/src/orders/dto/*`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders.helpers.ts`
- `apps/api/src/orders/*lifecycle*`
- `apps/api/src/orders/orders-query.service.spec.ts`
- 관련 unit/spec tests
- `apps/e2e`의 영향 시나리오
- 회차 변경이면 `docs/specs/mvp-sales-round-direct-delivery.md`

권한 계약은 `docs/DOCUMENT_CONSISTENCY.md`에 따라 직접 거부 회귀가 없으면 구현 존재만으로 `VERIFIED` 처리하지 않는다.

상태 전이·권한·결제·환불을 문서 예시만 보고 운영 데이터에 직접 적용하지 않는다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-24 | 조회 authorization은 VERIFIED, mutation authorization은 직접 거부 회귀 부족으로 IMPLEMENTED / UNVERIFIED 분리 |
| 2026-08-23 | `DELIVERY_HELD`, 회차 snapshot, 현재 endpoint/FSM, 재배송·배송사진·알림 계약에 맞춰 전면 정합화 |
| 2026-04-23 | legacy 공동구매 수량 용어 반영 |
| 2026-03-26 | 초기 orders 설계 초안 |

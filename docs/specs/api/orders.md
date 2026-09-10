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

### 8A. Legacy consumer cancel (RECRUITING group) — `IMPLEMENTATION COMPLETE`

- 대상: legacy `RECRUITING` group 주문의 `PATCH .../cancel` (`OrdersLifecycleService.cancelOrder`).
- `schemaVersion: 2 + roundId`는 기존 `RoundOrderLifecycleService.cancelByConsumer`로 위임하고 본 계약을 타지 않는다.
- provider refund 전에 `orders/{orderId}.cancellation = { status: REFUNDING, refundClaim: { token, expiresAt } }` durable ownership을 transaction으로 획득한다. fresh `RECRUITING`이 아니면 refund side effect `0`으로 `403`이다.
- 활성 `REFUNDING` claim과 충돌하는 동시 취소는 `409`이며 refund/quantity/settlement/notification을 실행하지 않는다.
- refund 실패는 `REFUND_FAILED`로 남고 거짓 `CANCELLED`를 만들지 않으며 retry 가능하다.
- refund 성공 뒤 local 실패는 `LOCAL_FAILED`로 남고 retry는 PortOne 의미적 중복 없이 `CANCELLED`로 수렴한다 (`PaymentRefundService` claim이 PortOne `1회`를 보장).
- local cancellation(`CANCELLED` + `COMPLETED` + `groupProductConfig.currentQuantity` decrement)은 token 검증 transaction에서 정확히 한 번만 수행한다.
- `settlement.cancelSettlement`는 owner만 호출하며 idempotent하고, `GROUP_CANCELLED_SELF`는 owner만 `consumer-cancel:{orderId}` stable dedupe key로 `1회` 전송한다.
- sequential duplicate(`CANCELLED+COMPLETED` 뒤 재요청)는 `403`을 유지하고 refund/quantity/notification을 반복하지 않는다.
- group scheduler(`confirmGroupBuy`/`cancelGroupBuyLack`)는 active cancellation ownership을 transaction fresh 재확인으로 존중하고 broadcast에서 제외한다.
- 증거: `apps/api/src/orders/orders-lifecycle.service.ts`, `apps/api/src/notifications/notifications.service.ts`, `apps/api/src/orders/legacy-consumer-cancel-convergence.spec.ts`(`8 tests`).

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

## 12. Status / Hold Duplicate Submission & Convergence Contract

> 결정 계약 게시: `DRIVER-COMMAND-IDEMPOTENCY-SERVER-CONTRACT-DECISION-01`
> 이 절은 idempotency 재설계나 server implementation이 아니라, 이미 COMPLETE된 위 결정 계약을
> 후속 `DRIVER-COMMAND-IDEMPOTENCY-SERVER-CONTRACT-IMPLEMENTATION-01`이 추측 없이 소비할 수 있도록
> remote-addressable canonical evidence로 게시한 것이다.
> `IMPLEMENTATION_STATUS = COMPLETE`이며 legacy plain branch의 transaction 재검증이
> `apps/api/src/orders/orders-lifecycle.service.ts`와
> `apps/api/src/orders/orders-duplicate-contract.spec.ts`(5 tests)로 검증된다.

### 12.1 SETTLED DECISION — 현재 계약에서 바꾸지 않는다

- `STATUS` / `DELIVERY_HOLD` command에는 현 단계에서 explicit idempotency key를 도입하지 않는다.
- 금지: `UpdateStatusDto` idempotencyKey 추가, `HoldDeliveryDto` idempotencyKey 추가,
  `Idempotency-Key` / `X-Idempotency` header 추가, command replay collection 추가,
  request log/idempotency collection 추가, replay response persistence 추가,
  TTL/retention infrastructure 추가.
- 현재 status/hold에는 durable command identity가 없다.
  `command identity = NONE`, `persistence authority = NONE`, `TTL / retention = NONE`.
- sequential duplicate(첫 command가 이미 commit된 뒤 같은 target status를 다시 보내는 경우)의
  canonical response는 `403 Forbidden`이다.
  `200 replay`는 도입하지 않으며(`DO NOT INTRODUCE`), no-op `200`도 도입하지 않는다.
  FSM self-loop가 없으므로 side effect 실행 전 거부되는 현재 의미를 유지한다.
  `403` 자체만으로 “내 이전 요청이 성공했다”고 판단하지 않는다.
- concurrent duplicate(동일 old state에서 같은 command가 동시 실행되는 경우)의
  canonical 수렴은 `winner = 200`, `loser = 409 Conflict`이다.
- FSM상 허용되지 않는 command는 `403`, transaction 중 다른 writer가 먼저 상태를 변경한
  race loser는 `409`이다. `403`/`409` 응답 체계를 변경하지 않는다.
- `ACK` 성공 또는 `ACK` 불확실 이후 authoritative reread가 실패해도
  자동 동일-command 재전송을 하지 않는다. canonical convergence는
  `NO_RESEND + AUTHORITATIVE_GET`이며, client는 동일 command를 재전송하는 대신
  authoritative GET으로 현재 상태를 확인한다.
  `GET` 성공 시 현재 authoritative state를 사용하고,
  `GET` 실패 시 상태 확인 경고 + 위험 command 제한 + 수동 재확인을 따른다.
- `delivery-hold`는 별도의 replay/idempotency 시스템을 만들지 않는다.
  held 상태에서 동일 hold 또는 다른 reason hold 재요청은 sequential `403`,
  동시 race loser는 `409`이다.
  새 hold는 이전 hold 해소 이후에만 생성 가능하며,
  새 `heldAt`이 새로운 hold/payment linkage epoch 역할을 한다.
- `POST redelivery-fee`의 기존 durable key/charge contract는 유지한다.
  Status/Hold command에 이를 복제하지 않는다.
- round-direct delivery-photo의 durable idempotency는 별도 기존 계약이며
  이번 status/hold 계약과 섞지 않는다.
  legacy-hub photo orphan cleanup 및 keyed server-upload 전환은
  이번 계약과 후속 S1 구현 범위 밖이다.

### 12.2 CURRENT IMPLEMENTATION — 현재 코드 사실

- 진입점: `PATCH /stores/:storeId/orders/:orderId/status` →
  `OrdersService.updateStatus` → `OrdersLifecycleService` / `RoundOrderLifecycleService`.
- thin alias는 독립 idempotency authority가 아니라 동일 lifecycle write contract를 소비한다.
  `PATCH .../delivery-hold`는 `status = DELIVERY_HELD`를 강제하여 동일 `updateStatus` chain으로 위임하고,
  legacy `PATCH .../delivery-photo` alias는 `status = DELIVERED + photoUrl`로
  동일 `updateStatus` chain을 소비한다.
  단 delivery-photo storage/upload 고유 idempotency 문제까지 status contract로 흡수하지 않는다.
- `UpdateStatusDto`와 `HoldDeliveryDto`에는 idempotency key field가 없으며,
  status/hold 경로에 `Idempotency-Key` header 처리도 없다. 현재 사실과 결정이 일치한다.
- 이미 transaction으로 보호되는 경로를 재작성 대상에서 제외한다.
  `schemaVersion: 2 + roundId` 경로는 `expectedStatus` transaction 보호가 존재하고,
  driver legacy status mutation 경로는 driver transaction + driver scope transaction 재확인이 존재하며,
  일부 seller `DELIVERING` / `CANCELLED` / held-delta transaction 경로에도 transaction 보호가 존재한다.
  남은 legacy plain branch도 `firestore.runTransaction` 안에서 order를 다시 읽고
  `storeId`와 `latest persisted status === entry expectedStatus`를 재확인한 뒤에만 write한다.
  불일치 시 `409 Conflict`, 일치 시 fresh snapshot 기반 update를 기록한다.
  소유자: `OrdersLifecycleService.updateStatus`의 최종 plain branch
  (`apps/api/src/orders/orders-lifecycle.service.ts`).
- 모든 status write가 transaction 내부에서
  `current persisted order.status == entry expectedStatus`를 다시 확인하도록 수렴시키는 것이
  서버 계약의 target invariant다.
  `EVERY_STATUS_WRITE_REVALIDATES_EXPECTED_STATUS_INSIDE_TRANSACTION`.

### 12.3 RESOLVED — S1 (`IMPLEMENTATION COMPLETE`)

- `S1`: legacy non-transactional plain status write의 `expectedStatus` transaction 공백은 해소됐다.
- 대표적인 영향 surface: seller legacy `ACCEPTED → PREPARING`,
  legacy parcel `PREPARING → DELIVERED`, `roundId` 없는 legacy `DELIVERY_HELD` 진입,
  동일 `OrdersLifecycleService.updateStatus`를 타는 기타 plain branch,
  seller parcel `PREPARING`에서의 `DELIVERED` vs `DELIVERY_HELD` 상충 경쟁.
- 해소 내용: plain branch가 `doc.update` 직접 write를 하지 않고
  `runTransaction` + fresh-read + `expectedStatus` 재검증으로 수렴한다.
  race loser는 status persistence 이전에 `409`로 종료하므로
  timestamp last-write-wins, transition notification 중복, legacy hold concurrent overwrite,
  `heldAt` 변경에 따른 redelivery charge linkage 불일치가 발생하지 않는다.
  transaction 성공 이후에만 settlement/notification 후속효과가 실행된다.
- 증거: `apps/api/src/orders/orders-lifecycle.service.ts`의 `updateStatus` 최종 plain branch,
  `apps/api/src/orders/orders-duplicate-contract.spec.ts`(5 tests:
  legacy success, sequential retry `403`, same-state race `409`,
  parcel success/race, roundId-less hold, conflicting-transition `409` + side-effect `0`).
- `IMPLEMENTATION_STATUS = COMPLETE`이다.

### 12.4 DEFERRED — 이번 계약에서 결정하지 않는다

- idempotency key scope 결정은 `DEFERRED`다. 현재 계약에는 key가 없으므로
  `scope = NO KEY IN CURRENT CONTRACT`이다.
- 향후 별도 explicit-key 설계가 필요해질 경우,
  `order+command(target status)`보다 request-ID 기반 `order+key` 계열이 적합하다는 설계 메모만 남긴다.
  이것을 현재 구현 요구사항으로 승격하지 않는다.

### 12.5 NON-GOALS — 후속 S1 구현에서도 하지 않는다

- `200` replay 도입
- explicit key 도입
- request log store 추가
- TTL system 추가
- FSM redesign
- redelivery payment redesign
- notification mapping/template redesign
- settlement redesign
- photo upload redesign
- client UI remediation
- product policy change

### 12.6 후속 구현 handoff

- 후속 implementation owner: `apps/api/src/orders/orders-lifecycle.service.ts`.
  후속 구현은 보호 경로를 재작성하는 것이 아니라 legacy plain branch를 동일 invariant로 수렴시키는 최소 변경이어야 하며,
  `schemaVersion: 2` round 경로를 교체하거나 재작성하지 않는다.
- 후속 proof:
  sequential same-status는 `403` + side effect `0`,
  concurrent legacy duplicate는 `1 x 200` + `1 x 409` + notification `1회` +
  counter drift `0` + single effective timestamp/write,
  legacy hold concurrent는 `1 x 200` + `1 x 409` + single `heldAt` +
  single notification + charge linkage epoch overwrite 없음.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-09-10 | `DRIVER-COMMAND-IDEMPOTENCY-SERVER-CONTRACT-DECISION-01` 결정 계약 게시: Status/Hold duplicate submission & convergence contract 추가, S1은 `IMPLEMENTATION PENDING`으로 명시 |
| 2026-09-10 | `DRIVER-COMMAND-IDEMPOTENCY-SERVER-CONTRACT-IMPLEMENTATION-01`: legacy plain branch transaction 재검증 수렴 확인 + conflicting-transition 회귀 1건 추가(`orders-duplicate-contract.spec.ts` 5 tests PASS) 후 Section 12를 `IMPLEMENTATION COMPLETE`로 수렴 |
| 2026-08-30 | 현재 회차 lifecycle의 paid-before-resume guard와 `DELIVERY_HELD → PREPARING` 결제 요청 경계를 반영하고 seller API projection 경계를 정합화 |
| 2026-08-24 | 유료 재배송비 결제 전 배송 재개 금지와 direct Firestore read authorization·최소화 finding 최초 반영 |
| 2026-08-23 | 현행 endpoint/FSM/회차·legacy 공존 계약으로 정합화 |

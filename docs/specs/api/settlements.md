<!-- Language: ko -->

# Settlements API / Domain Spec

> **최종 정합화**: 2026-08-24
> **상태**: Current
> **타입·라벨 SSOT**: `packages/shared/src/settlement.types.ts`
> **Seller API 정본**: `apps/api/src/settlements/**`
> **Admin 지급 처리 정본**: `apps/api/src/admin/**`

## 1. 범위

`settlements`는 완료 주문으로부터 판매자 정산 레코드를 생성하고, `pending → confirmed → paid` 수명주기와 취소 반영을 관리한다.

판매자 API는 조회와 요약을 제공하고, `confirmed → paid` 지급 처리는 admin API가 소유한다.

## 2. 상태 SSOT

현재 공통 상태:

```ts
type SettlementStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled'
```

공통 표시값도 `packages/shared/src/settlement.types.ts`가 소유한다.

| 상태 | 라벨 | 기본 색 |
|---|---|---|
| `pending` | 정산 대기 | yellow |
| `confirmed` | 확정 | blue |
| `paid` | 지급 완료 | green |
| `cancelled` | 취소 | red |

backend는 타입을, seller/admin UI는 공통 라벨·색 상수를 사용한다.

## 3. Settlement 문서

현재 `settlements/{orderId}`의 핵심 내부 필드:

```ts
{
  id: string
  storeId: string
  orderId: string
  totalAmount: number
  platformFeeRate: number
  platformFee: number
  netAmount: number
  status: SettlementStatus
  completedStatus: string
  settledAt: Timestamp
  confirmedAt: Timestamp | null
  paidAt: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

문서 ID는 주문 ID와 동일하게 사용한다.

공개 shared `Settlement`는 화면 공통에 필요한 필드 합집합이며 timestamp 직렬화 형태가 호출 경로마다 달라질 수 있어 `unknown`을 허용한다. Firestore 내부 schema와 frontend shared interface를 1:1이라고 가정하지 않는다.

## 4. 생성

`SettlementsService.createSettlement(order, completedStatus)`는 주문 완료 흐름에서 호출된다.

현재 핵심 계약:

- 같은 `orderId`의 settlement가 이미 있으면 다시 만들지 않는다.
- 존재 확인과 생성은 Firestore transaction 안에서 수행해 동시 완료 전이 경합을 차단한다.
- `totalAmount`에서 수수료와 순정산액을 계산한다.
- 초기 상태는 `pending`.
- `completedStatus`를 함께 저장한다.

현재 기본 수수료율:

```text
PLATFORM_FEE_RATE env
미설정 fallback = 0.05
```

fallback 5%는 코드 기본값이지 특정 운영 store에 실제 적용 중인 수수료를 문서만으로 보장하는 값은 아니다. admin의 store commission 설정과 settlement 생성 시 사용되는 전역 env를 혼동하지 않는다.

## 5. 수수료 계산

수수료 계산 정본은 `apps/api/src/settlements/_lib/fee-calculator`다.

정산 레코드에는 생성 시점의 다음 값이 snapshot으로 저장된다.

- `platformFeeRate`
- `platformFee`
- `netAmount`

나중에 수수료 설정이 바뀌어도 기존 settlement를 문서 추정으로 재계산하지 않는다.

## 6. `pending → confirmed` 자동 확정

`confirmDueSettlements()`는 매일 04:00 KST에 실행된다.

```text
@Cron('0 4 * * *', { timeZone: 'Asia/Seoul' })
```

마감 지연:

```text
SETTLEMENT_CONFIRM_DELAY_DAYS env
미설정 fallback = 1일
```

처리:

1. `status == pending`
2. `settledAt < now - confirmDelayDays`
3. 각 문서를 transaction에서 다시 읽음
4. 여전히 `pending`일 때만 `confirmed`
5. `confirmedAt`, `updatedAt` 기록

배치 도중 다른 경로가 `cancelled`로 바꾸면 transaction 재확인에서 skip해 취소 상태를 덮어쓰지 않는다.

## 7. 취소 반영

`cancelSettlement(orderId)`는 연결 settlement가 있으면 취소를 반영한다.

현재 규칙:

- settlement 없음 → no-op
- `cancelled` → 멱등 no-op
- `pending|confirmed` → `cancelled`
- `paid` → **`cancelled`로 역전하지 않음**

지급 완료 후 주문 취소·환불의 회계 처리는 단순 status 역전으로 해결하지 않는다. 현재 service는 warning을 남기고 paid settlement를 보존한다. 후속 회계 조정이 필요하면 별도 설계가 필요하다.

### Admin 강제 환불과의 현재 불일치 — P0

`cancelSettlement()` 자체의 위 규칙과 별개로, 현재 `AdminService.forceRefund()`는 이 메서드를 호출하지 않는다.

따라서 `POST /admin/orders/:orderId/refund`를 통해 주문을 `CANCELLED`로 직접 바꿔도 기존 settlement가 `pending|confirmed|paid` 상태로 그대로 남을 수 있다.

특히:

- `pending|confirmed` settlement는 정상 order cancellation이면 `cancelSettlement()`로 `cancelled`되어야 하지만 admin force refund 경로는 이를 우회한다.
- `paid` settlement는 원래도 단순 상태 역전 대상이 아니므로, 환불이 필요하다면 별도 회계 조정/운영 이슈/승인 흐름이 필요하다.
- 현재 admin force refund는 `CANCELLED` 외 주문 상태를 제한하지 않으므로 완료/정산 생성 후 주문에도 진입할 수 있다.

이 불일치는 `ADMIN-FORCE-REFUND-CONSISTENCY` P0로 추적한다. `cancelSettlement()`의 내부 멱등성만으로 admin 환불 전체 정산 일관성이 보장된다고 기록하지 않는다.

정본: `docs/specs/api/admin.md`, `docs/BACKLOG.md`.

## 8. Seller 정산 API

모든 seller settlement endpoint는 `JwtAuthGuard`가 적용된다.

권한:

- `admin` → store ownership 검사 예외
- 그 외 → `stores/{storeId}.ownerId === requesterId`

### 목록

```text
GET /stores/:storeId/settlements?from=<date>&to=<date>&status=<status>
```

query:

```text
from?: ISO date string
 to?: ISO date string
status?: pending | confirmed | paid | cancelled
```

- `to`는 해당 날짜 23:59:59.999까지 포함한다.
- 결과는 `settledAt DESC` 최신순이다.
- 응답: `{ settlements, total }`.

### 일별 요약

```text
GET /stores/:storeId/settlements/summary?date=<date>
```

미지정 시 현재 service의 `new Date().toISOString()` 기준 날짜를 사용한다.

응답:

```ts
{
  date: string
  count: number
  totalAmount: number
  totalPlatformFee: number
  totalNetAmount: number
  byStatus: Record<SettlementStatus, number>
}
```

날짜 경계는 JavaScript `Date`와 서버 실행 환경 영향을 받을 수 있으므로 KST 일별 정산 의미를 변경할 때는 timezone test를 함께 추가한다.

## 9. Admin 정산 API

admin controller 전체는 `JwtAuthGuard + RolesGuard + @Roles('admin')`으로 보호된다.

### 목록

```text
GET /admin/settlements
```

store/date filter를 지원하며 `settledAt DESC`, 최대 500건을 조회한다.

### 지급 처리

```text
PATCH /admin/settlements/:settlementId/pay
```

`markAsPaid()`의 현재 계약:

- settlement 없음 → not found
- 이미 `paid` → 거부
- `confirmed`가 아니면 거부
- transaction에서 status 재확인 후 `paid`
- `paidAt`, `updatedAt` 기록

즉, `pending → paid` 직접 전환은 허용하지 않는다.

## 10. 인덱스

현재 주요 query shape:

```text
storeId + settledAt
storeId + status + settledAt
status + settledAt        // confirm batch
```

정확한 배포 인덱스 정본은 `firestore.indexes.json`과 대상 Firebase 환경이다. 이 spec의 query 설명만 보고 production 인덱스를 임의 변경하지 않는다.

## 11. UI 집계와 표시

seller/admin UI는 공통 `SettlementStatus`, `STATUS_LABEL`, `STATUS_COLOR`를 사용한다.

관리자 요약에서 실제 지급 대상 성격의 합계를 계산할 때 `pending`·`cancelled` 포함 여부는 현재 frontend aggregator/UI 구현을 확인한다. 과거 UI 계획 문서를 API domain contract로 사용하지 않는다.

## 12. 회차 직배송과 정산

회차 주문도 orders lifecycle에서 완료 상태에 도달하면 기존 settlement 생성 경로와 연결될 수 있다. 다만 첫 운영 회차 출시 전에 실제 회차 주문의 다음 흐름을 E2E로 다시 확인한다.

- 배송사진 완료 → `DELIVERED`
- settlement 1건만 생성
- 후속 `REVIEWED`가 동일 settlement를 중복 생성하지 않음
- 정상 취소/환불 경합에서 pending/confirmed settlement가 `cancelled`로 수렴
- `paid` settlement 이후 환불은 별도 회계 정책을 따름
- admin 강제 환불도 `ADMIN-FORCE-REFUND-CONSISTENCY` 해결 후 같은 회계 불변식에 수렴

출시 상태 자체는 `docs/memory.md`와 활성 출시 PLAN을 따른다.

## 13. 검증 원칙

정산 변경 시 최소 확인:

- `packages/shared/src/settlement.types.ts`
- `apps/api/src/settlements/settlements.service.ts`
- `apps/api/src/settlements/settlements.controller.ts`
- `apps/api/src/settlements/dto/query-settlements.dto.ts`
- `apps/api/src/admin/admin.controller.ts`
- `apps/api/src/admin/admin.service.ts`
- `apps/api/src/orders/round-order-lifecycle.service.ts`
- payment/redelivery refund paths
- fee calculator / aggregator tests
- seller/admin settlement UI
- 관련 E2E
- `firestore.indexes.json`

금전 환불과 정산이 연결되는 변경은 payment provider 성공뿐 아니라 주문 상태, reservation/capacity, 재배송비, settlement 상태, 실패 재시도와 race를 함께 검증한다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-24 | admin force refund가 `cancelSettlement()` 및 정상 취소 lifecycle을 우회하는 P0 정산 불일치를 명시 |
| 2026-08-23 | 자동 confirm, transaction 멱등성, paid 역전 방지, admin 지급 API, 현재 조회/권한 계약으로 정합화 |
| 2026-03-28 | 초기 settlements 설계 초안 |
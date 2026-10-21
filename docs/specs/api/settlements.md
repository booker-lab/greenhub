<!-- Language: ko -->

# Settlements API / Domain Spec

> **최종 정합화**: 2026-09-26
> **상태**: Current
> **타입·라벨 SSOT**: `packages/shared/src/settlement.types.ts`
> **Seller API 정본**: `apps/api/src/settlements/**`
> **Admin 지급 처리 정본**: `apps/api/src/admin/**`
> **Admin privileged mutation direct proof**: `apps/api/src/admin/admin-privileged-mutation.spec.ts`

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
  orderNumber: string | null // 판매자 CSV용. 2026-10 이전 정산에는 없다
  roundId: string | null // 회차 주문만. 회차별 집계용
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

수수료율(2026-10-21 결정 ②):

1. 같은 transaction에서 `stores/{storeId}`를 읽어 `commissionRate`가 0~1 사이 숫자면 그 값을 쓴다
   (어드민 판매자 탭 `PATCH /admin/stores/:storeId/commission`이 저장).
2. 없거나 형식이 맞지 않으면 서버 기본값을 쓴다.

```text
PLATFORM_FEE_RATE env
미설정 fallback = 0.05
```

쓴 요율은 `platformFeeRate`로 정산에 남는다. 가게 문서를 transaction에서 읽으므로 생성 도중 요율이 바뀌면
재시도해 바뀐 요율을 쓴다. 이미 만든 정산은 요율이 바뀌어도 다시 계산하지 않는다.
선택 순수 함수: `_lib/fee-calculator.ts`의 `resolveFeeRate`. 직접 증거: `settlements-lifecycle.spec.ts`(가게 요율·0·형식 오류·미설정·재계산 없음·경합 재시도), `firestore-occ-contract.spec.ts`(R1·R1b·R1c).

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
미설정 fallback = 7일
```

기본 7일은 판매자 배송 후 환불 기간(배송 완료 7일)과 맞춘 값이다. 이 기간 안에는 정산이 `confirmed`가 되지 않으므로 지급(`paid`)도 일어나지 않는다. 결정 배경: `docs/specs/post-delivery-refund-plan.md` §2.3.

처리:

1. `status == pending`
2. `settledAt < now - confirmDelayDays`
3. 각 문서를 transaction에서 다시 읽음
4. 여전히 `pending`일 때만 `confirmed`
5. `confirmedAt`, `updatedAt` 기록

배치 도중 다른 경로가 `cancelled`로 바꾸면 transaction 재확인에서 skip해 취소 상태를 덮어쓰지 않는다.

결제사 취소·분쟁 보류: 같은 주문(`orderId`)에 `operationIssues`의 `type == PROVIDER_REVERSAL_DETECTED`, `status == OPEN` 기록이 있으면 자동 확정은 그 정산을 `pending`으로 둔 채 건너뛰고(warn 로그만 남기며 새 운영 기록은 만들지 않음), admin 지급(`markAsPaid`)은 `confirmed`여도 409로 거부한다. 판정은 각 transaction 안에서 동등 조건 조회(`orderId`·`type`·`status`, `limit 1`)로 하므로 복합 인덱스가 필요 없고, `RESOLVED`·`DISMISSED` 기록은 막지 않아 처리 후 다음 배치에서 확정·지급된다. 직접 증거: `settlements-lifecycle.spec.ts`(confirm 보류), `admin-privileged-mutation.spec.ts`(지급 409).

## 7. 취소 반영

`cancelSettlement(orderId)`는 연결 settlement가 있으면 취소를 반영한다.

현재 규칙:

- settlement 없음 → no-op
- `cancelled` → 멱등 no-op
- `pending|confirmed` → `cancelled`
- `paid` → **`cancelled`로 역전하지 않음**. 대신 판매자 회수 필요를 남긴다(2026-10-21 결정 ④)

지급 뒤 환불(`paid`)은 같은 transaction에서 다음을 쓴다.

- 정산 문서: `recoveryRequired: true`, `recoveryAmount`(그 정산의 `netAmount`), `recoveryRequiredAt`
- 운영 기록: `type: SETTLEMENT_RECOVERY_REQUIRED`, `severity: critical`, idempotencyKey `settlement-recovery:${orderId}`.
  관리자만 닫는다(`ADMIN_ONLY_MANUAL_RESOLVE_TYPES`, 판매자 앱 `operations/manual-resolve.ts`). 호출자 transaction 안의
  기록이라 텔레그램 알림은 보내지 않는다.

정산 상태(`SettlementStatus`)는 늘리지 않는다. 이미 `recoveryRequired`인 정산은 다시 쓰지 않아 관리자가 닫은 기록을 다시 열지 않는다.
`cancelSettlement()`는 `{ recoveryRequired, recoveryAmount }`를 돌려주고, 어드민 강제 환불 응답과 행동 기록(`after`)에 같은 값이 실린다.
실제 돈을 돌려받는 절차(계좌 이체·상계)는 앱 밖 운영이다.

### Core lifecycle 검증 상태 — `IMPLEMENTATION_PROVEN`

2026-08-24 감사에서 위 생성·자동 확정·취소 구현을 직접 확인했고, 이후 `apps/api/src/settlements/settlements-lifecycle.spec.ts`가 실제 `SettlementsService`를 구동해 위 금전 불변식을 직접 회귀한다. 따라서 core lifecycle은 `IMPLEMENTATION_PROVEN`이다.

직접 proof가 고정하는 계약:

- 완료 주문에서 settlement가 정확히 1건 생성되고 `totalAmount`·`platformFeeRate`·`platformFee`·`netAmount`·`status: pending`·`completedStatus`와 초기 `settledAt`/`createdAt`/`updatedAt` snapshot이 의도대로 고정됨
- 같은 주문의 중복 호출과 동시 완료 호출이 추가 생성이나 최초 snapshot·`settledAt` 덮어쓰기를 일으키지 않음
- `DELIVERED → REVIEWED`에서도 기존 1건과 최초 snapshot이 보존됨
- cutoff 이전 pending은 유지되고 due pending만 transaction fresh-read 후 confirmed로 전환되며 `confirmedAt`이 기록됨
- 이미 confirmed인 settlement는 다시 쓰지 않고, query가 stale해도 transaction fresh status가 우선함
- confirm commit 직전 cancel 경합에서도 cancelled가 confirmed로 되살아나지 않음
- missing settlement는 no-op, pending/confirmed는 cancelled로 수렴, cancelled는 멱등 no-op
- paid settlement가 cancellation으로 역전되지 않고 보존되며, 회수 필요 필드와 운영 기록이 한 transaction으로 남고 두 번째 호출은 다시 쓰지 않음
- 실제 주문 완료 경로(`DELIVERED`)가 settlement 1건을 만들고 후속 `REVIEWED`가 중복 생성하지 않음
- 정상 order cancellation이 pending/confirmed settlement를 cancelled로 수렴시킴

실제 주문 lifecycle(`OrdersLifecycleService`)과 실제 `SettlementsService`를 함께 구동하는 integration assertion도 위 spec에 포함된다.

증거: `apps/api/src/settlements/settlements-lifecycle.spec.ts`, `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`.

### Admin 강제 환불 정산 수렴 — `ADMIN-FORCE-REFUND-CONSISTENCY` `IMPLEMENTATION_PROVEN`

`AdminService.forceRefund()`는 주문 취소 후 `SettlementsService.cancelSettlement(orderId)`를 호출한다. 회차 주문(`schemaVersion === 2 && roundId`)은 `RoundOrderLifecycleService.cancelForRound()`에 위임한 뒤, legacy 주문은 `forceLegacyRefund()`의 `done` 및 local cancellation 확정 경로에서 각각 `cancelSettlement()`를 호출한다.

따라서 `POST /admin/orders/:orderId/refund`로 주문이 `CANCELLED`로 수렴하면 연결 settlement도 함께 수렴한다.

- settlement 없음 → no-op
- `pending|confirmed` settlement → `cancelled`
- `cancelled` → 멱등 no-op
- `paid` settlement → 역전하지 않고 보존

`paid` settlement 이후 환불의 회계 처리는 단순 status 역전으로 해결하지 않고 별도 회계 조정/운영 이슈/승인 흐름을 따른다.

직접 증거: `apps/api/src/admin/admin.service.spec.ts`와 `apps/api/src/admin/admin-legacy-refund-occ-retry.spec.ts`가 실제 `AdminService.forceRefund()`를 구동해 legacy `done`/확정 경로의 `cancelSettlement()` 수렴, conflict·provider 실패·local 선행 실패 시 미호출, 회차 경로의 `cancelForRound()` 위임을 직접 고정한다. `cancelSettlement()` 자체의 pending/confirmed → cancelled, paid 보존, 멱등성 계약은 core lifecycle proof(`apps/api/src/settlements/settlements-lifecycle.spec.ts`)가 소유한다.

`ADMIN-FORCE-REFUND-CONSISTENCY: PROVEN (admin refund converges settlement)`

정본: `docs/specs/api/admin.md`, `docs/BACKLOG.md`.

## 8. Seller 정산 API

모든 seller settlement endpoint는 `JwtAuthGuard` + `RolesGuard`(`@Roles('seller', 'admin')`)가 적용된다.

권한:

- `seller`·`admin` 외 role(consumer, driver)은 store 조회 전에 403
- `admin` → store ownership 검사 예외
- 그 외 → `stores/{storeId}.ownerId === requesterId`

### 목록

```text
GET /stores/:storeId/settlements?from=<date>&to=<date>&status=<status>&limit=<n>&cursor=<id>
```

query:

```text
from?: ISO date string
 to?: ISO date string
status?: pending | confirmed | paid | cancelled
limit?: 1 이상 정수 (생략 시 500, 500 초과는 500으로 줄인다)
cursor?: 앞 응답의 nextCursor (정산 문서 id)
```

- `to`는 해당 날짜 23:59:59.999까지 포함한다.
- 결과는 `settledAt DESC` 최신순이다.
- `limit + 1`건을 읽어 다음 페이지 여부를 판단하고, cursor 문서 snapshot 기준 `startAfter`로 이어 읽어 같은 `settledAt`도 빠짐·겹침이 없다.
- 다른 store의 cursor, 없는 cursor, 형식이 틀린 cursor는 목록 조회 전에 400이다.
- 응답: `{ settlements, total, hasMore, nextCursor }`. `total`은 이번 응답에 담긴 건수이고, `nextCursor`는 `hasMore`일 때만 값이 있다(아니면 `null`).

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

admin controller 전체에는 `JwtAuthGuard + RolesGuard + @Roles('admin')` 구현이 적용된다.

`apps/api/src/admin/admin-privileged-mutation.spec.ts`가 실제 `AdminController` + `JwtAuthGuard` + `RolesGuard` + `JwtStrategy` HTTP 경계를 구동해 10개 privileged mutation에 대해 unauthenticated 401, consumer/seller/driver 403, invalid role의 side-effect 0, admin 정상 요청의 service boundary 도달을 직접 고정한다. `markAsPaid`는 같은 spec에서 missing 및 `pending|cancelled|paid` 거부, `confirmed → paid` 전이와 `paidAt`/`updatedAt` 기록, 동시 지급 race의 단일 수렴까지 직접 assertion한다. 따라서 이 direct proof 범위에서는 `ADMIN-PRIVILEGED-MUTATION-COVERAGE`의 서버 authorization + 지급 상태 전이 항목이 닫혔다.

### 목록

```text
GET /admin/settlements?storeId&status&from&to&limit&cursor
GET /admin/settlements/summary?storeId&status&from&to
```

- 목록: `settledAt DESC`, `limit` 기본 100·상한 500, `cursor`(앞 응답 `nextCursor` = 마지막 정산 문서 id)로 이어 받는다.
  응답 `{ settlements, total, hasMore, nextCursor }`(`total`은 이번 응답 건수).
- 행 보강: `storeName`, `orderNumber`(정산에 없으면 주문 문서), `recoveryRequired`·`recoveryAmount`,
  `holdReason`(지급 전 정산에 열린 `PROVIDER_REVERSAL_DETECTED`가 있으면 `PROVIDER_REVERSAL`),
  `payoutAccount`(지급 대상 `confirmed` 행에만, 가게 정산 계좌 전체 번호).
- 합계: 같은 조건의 전체(최대 20,000건, 넘으면 `truncated`)로 `payable`(confirmed)·`paid`·`platformFee`(confirmed+paid)·`recovery`를 서버가 계산한다.
- 구현: `apps/api/src/admin/_lib/admin-settlements-query.ts`. 직접 증거: `admin-settlements-list.spec.ts`, `admin-settlements-status-filter.spec.ts`.

### 판매자 정산 계좌

```text
GET  /stores/:storeId/payout-account        // 판매자 본인·관리자, 끝 4자리 외 가림
PUT  /stores/:storeId/payout-account        // 판매자 본인·관리자, { bankName, accountHolder, accountNumber }
GET  /admin/stores/:storeId/payout-account  // 관리자, 전체 번호
```

`storePayoutAccounts/{storeId}`(`bankName`·`accountHolder`·`accountNumber`·`updatedAt`·`updatedBy`). 클라이언트 직접 접근은
`firestore.rules` 기본 거부(규칙 테스트 `storePayoutAccounts`). 저장은 행동 기록 `store.payout_account.updated`와 같은 transaction이며
기록에는 은행과 끝 4자리만 남긴다. 직접 증거: `apps/api/src/payout-accounts/payout-accounts.spec.ts`.

### 지급 처리

```text
PATCH /admin/settlements/:settlementId/pay
```

`markAsPaid()`의 현재 구현:

- settlement 없음 → not found
- 이미 `paid` → 거부
- `confirmed`가 아니면 거부
- transaction에서 status 재확인 후 `paid`
- `paidAt`, `updatedAt` 기록

즉 코드상 `pending → paid` 직접 전환은 허용하지 않는다.

### 검증 상태 — `IMPLEMENTATION_PROVEN`

위 금전 상태 전이 구현은 `apps/api/src/admin/admin-privileged-mutation.spec.ts`의 `AdminService.markAsPaid 상태 계약` suite가 실제 `AdminService`를 구동해 직접 회귀한다.

직접 proof가 고정하는 계약:

- missing settlement 거부와 transaction write 0
- `pending|cancelled|paid` 거부와 transaction write 0
- `confirmed → paid` 정상 성공, transaction fresh read, `paidAt`·`updatedAt` 기록
- 동시 지급 요청이 fresh status 기준으로 한 번만 수렴

증거: `apps/api/src/admin/admin-privileged-mutation.spec.ts`, `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`.

`SETTLEMENT-LIFECYCLE-COVERAGE`와 역할을 구분한다. core P0는 생성·confirm·cancel lifecycle을 소유하고, admin P0는 admin role boundary와 `confirmed → paid` 지급 mutation을 소유한다.

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

관리자 정산 화면 합계 카드는 서버 합계(`/admin/settlements/summary`)를 쓴다: 지급 대기(confirmed)·지급 완료(paid)·플랫폼 수수료(confirmed+paid)·판매자 회수 필요. 목록 "더 보기"로 불러온 범위와 무관하게 조건 전체 기준이다.

## 12. 회차 직배송과 정산

회차 주문도 orders lifecycle에서 완료 상태에 도달하면 기존 settlement 생성 경로와 연결된다. core settlement lifecycle은 `settlements-lifecycle.spec.ts`의 직접 proof로 `IMPLEMENTATION_PROVEN`이고, 실제 주문 lifecycle과 `SettlementsService`를 함께 구동해 다음을 직접 고정한다.

- 완료 경로(`DELIVERED`)가 settlement 1건만 생성
- 후속 `REVIEWED`가 동일 settlement를 중복 생성하거나 최초 snapshot을 덮지 않음
- 정상 취소 경로에서 pending/confirmed settlement가 `cancelled`로 수렴

다음 항목은 여전히 별도 gate에 의존한다.

- 배송사진 완료 → `DELIVERED` 회차 전환 자체와 정산 생성의 회차 E2E assertion
- `paid` settlement 이후 환불은 별도 회계 정책을 따름
- admin 강제 환불은 `admin.service.spec.ts`·`admin-legacy-refund-occ-retry.spec.ts` proof로 `cancelSettlement()` 수렴이 `ADMIN-FORCE-REFUND-CONSISTENCY` `IMPLEMENTATION_PROVEN`
- admin 지급은 `admin-privileged-mutation.spec.ts` direct status/race 증거로 서버 boundary와 지급 전이가 고정됨

출시 상태 자체는 `docs/memory.md`와 활성 출시 PLAN을 따른다.

## 13. 검증 원칙

정산 변경 시 최소 확인:

- `packages/shared/src/settlement.types.ts`
- `apps/api/src/settlements/settlements.service.ts`
- `apps/api/src/settlements/settlements.controller.ts`
- `apps/api/src/settlements/dto/query-settlements.dto.ts`
- `apps/api/src/admin/admin.controller.ts`
- `apps/api/src/admin/admin.service.ts`
- `apps/api/src/common/guards/roles.guard.ts`
- `apps/api/src/orders/round-order-lifecycle.service.ts`
- payment/redelivery refund paths
- fee calculator / aggregator tests
- seller/admin settlement UI
- 관련 unit/API E2E/Playwright
- `firestore.indexes.json`

금전 환불과 정산이 연결되는 변경은 payment provider 성공뿐 아니라 주문 상태, reservation/capacity, 재배송비, settlement 상태, 실패 재시도와 race를 함께 검증한다.

core lifecycle은 transaction 구현만으로 `VERIFIED` 처리하지 않고 생성·중복·confirm·cancel·paid 역전 방지를 직접 정상/거부/동시성 회귀로 고정한다.

admin 지급 상태 전이는 코드의 transaction 존재만으로 `VERIFIED` 처리하지 않고 정상·거부·동시성·authorization 경계를 직접 검증한다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-10-21 | 결정 ②④⑤⑦: 가게별 수수료율 반영, 지급 뒤 환불 회수 필요(`SETTLEMENT_RECOVERY_REQUIRED`), 판매자 정산 계좌 API, 관리자 정산 목록 이어받기·행 보강·서버 합계 |
| 2026-10-10 | seller 정산 API에 `RolesGuard`(seller, admin)를 적용하고, 목록에 `limit`(기본·상한 500)·`cursor` 페이지네이션과 `hasMore`·`nextCursor` 응답 필드를 추가 |
| 2026-09-26 | admin 강제 환불이 `cancelSettlement()`로 pending/confirmed를 cancelled로 수렴하고 paid를 역전하지 않는 계약을 `admin.service.spec.ts`·`admin-legacy-refund-occ-retry.spec.ts` proof로 `ADMIN-FORCE-REFUND-CONSISTENCY` `IMPLEMENTATION_PROVEN`에 동기화 |
| 2026-09-26 | admin privileged mutation authorization과 `markAsPaid` 지급 전이가 `admin-privileged-mutation.spec.ts` 직접 proof로 `IMPLEMENTATION_PROVEN`임을 §9·§12에 동기화 |
| 2026-09-25 | core lifecycle이 `settlements-lifecycle.spec.ts` 직접 proof로 `IMPLEMENTATION_PROVEN`임을 §7·§12에 동기화 |
| 2026-08-24 | settlement 생성·confirm·cancel core lifecycle의 직접 상태/race assertion 부재를 `SETTLEMENT-LIFECYCLE-COVERAGE` P0 `IMPLEMENTED / UNVERIFIED`로 분리 |
| 2026-08-24 | admin `confirmed → paid` 구현과 직접 검증 증거를 분리해 `ADMIN-PRIVILEGED-MUTATION-COVERAGE` P0 COVERAGE GAP에 연결 |
| 2026-08-24 | admin force refund가 `cancelSettlement()` 및 정상 취소 lifecycle을 우회하는 P0 정산 불일치를 명시 |
| 2026-08-23 | 자동 confirm, transaction 멱등성, paid 역전 방지, admin 지급 API, 현재 조회/권한 계약으로 정합화 |
| 2026-03-28 | 초기 settlements 설계 초안 |

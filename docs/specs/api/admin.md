<!-- Language: ko -->

# Admin API / Domain Spec

> **최종 정합화**: 2026-08-24
> **상태**: Current
> **API 정본**: `apps/api/src/admin/**`
> **인증 계약**: `docs/specs/api/auth.md`
> **주문 계약**: `docs/specs/api/orders.md`
> **결제 계약**: `docs/specs/api/payments.md`
> **정산 계약**: `docs/specs/api/settlements.md`
> **canonical URL**: `docs/URLS.md`

## 1. 범위와 권한

`admin`은 Greenhub 운영자 전용 관리 API다.

`AdminController` 전체에 다음 보호가 적용된다.

```text
JwtAuthGuard
RolesGuard
@Roles('admin')
```

seller 앱의 admin UI도 세션 role을 추가로 확인하지만 API 권한의 정본은 서버 guard다.

admin role을 어떤 운영 절차로 부여하는지는 계정 보안 정책이다. 과거 문서의 “Firestore 콘솔에서 직접 role을 바꾸는 것이 유일한 정식 방법”을 현행 운영 지침으로 사용하지 않는다. 실제 관리자 권한 부여는 별도 승인된 관리 절차로 수행한다.

### 검증 상태 — privileged mutation boundary

위 class-level guard 구현이 존재한다. `apps/api/src/admin/admin-privileged-mutation.spec.ts`가 실제 `AdminController` + `JwtAuthGuard` + `RolesGuard` + `JwtStrategy`를 Nest HTTP 경계로 구동해 다음을 직접 고정한다.

- 10개 privileged mutation(`refund`, `pay`, `approveDriver`, `suspendDriver`, `setCommission`, `archiveStore`, `restoreStore`, `suspendUser`, `generateInvite`, `upsertBanner`)에 대한 unauthenticated 401
- consumer/seller/driver 요청의 403
- invalid role에서 service 호출·payment/settlement/round lifecycle·Firestore write side-effect 0
- admin 정상 요청이 controller service boundary까지 도달

따라서 고위험 admin mutation authorization은 **`IMPLEMENTATION_PROVEN`**이다. 이 proof는 class-level guard를 우회하지 않고 실제 guard/service 조합을 통과한 HTTP 경계를 고정하므로, admin API role boundary를 read smoke/UI redirect로 판단하지 않는다.

추적: `docs/BACKLOG.md`의 `ADMIN-PRIVILEGED-MUTATION-COVERAGE`; 직접 증거: `apps/api/src/admin/admin-privileged-mutation.spec.ts`. `ADMIN-FORCE-REFUND-CONSISTENCY`의 lifecycle 일관성은 이 authorization proof와 별개로 `apps/api/src/admin/admin.service.spec.ts`·`apps/api/src/admin/admin-legacy-refund-occ-retry.spec.ts`가 직접 회귀한다.

## 2. 접근 URL

UI 진입점:

```text
{seller_domain}/admin
```

Production canonical seller domain:

```text
https://seller.greenlove.co.kr
```

따라서 production admin 기준 URL은:

```text
https://seller.greenlove.co.kr/admin
```

과거 `greenhub-seller.vercel.app` 같은 deployment alias를 canonical production URL로 사용하지 않는다.

로컬 seller 포트는 실행 방식에 따라 달라질 수 있으므로 `docs/URLS.md`를 확인한다.

## 3. Store 관리

### 목록

```text
GET /admin/stores
```

- `createdAt DESC`
- `{ stores, total }`

### Store 수수료율

```text
PATCH /admin/stores/:storeId/commission
```

body의 정확한 검증 범위는 `SetCommissionDto`를 따른다. 이 값과 settlement service의 전역 `PLATFORM_FEE_RATE` 사용 범위를 동일한 것으로 가정하지 않는다. 실제 수수료 모델 변경은 두 경로를 함께 점검한다.

### Store archive / restore

```text
PATCH /admin/stores/:storeId/archive
PATCH /admin/stores/:storeId/restore
```

현재 archive는 물리 삭제가 아니다.

- 주문 또는 settlement가 하나라도 존재하면 archive 거부
- 허용되면 `status: archived`, `archivedAt` 기록
- restore는 `status: active`로 복구하고 `archivedAt` 제거

기록이 있는 판매자를 강제로 삭제하는 도구로 사용하지 않는다.

## 4. Consumer 사용자 관리

### 목록

```text
GET /admin/users
```

현재 `role == consumer`만 조회한다. 반환 전에 `passwordHash`를 제거한다.

### 정지/복구 flag

```text
PATCH /admin/users/:userId/status
```

```ts
{ suspended: boolean }
```

이 endpoint는 Firestore `suspended` 값을 갱신한다.

현재 신규 로그인은 suspended 사용자를 거부하지만, **기존 세션의 refresh·JWT·Firebase custom claims가 언제 무효화되는지는 별도 auth P0**다. `suspended: true` write 성공만으로 기존 세션이 즉시 차단됐다고 기록하지 않는다.

정본: `docs/specs/api/auth.md`의 `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`.

## 5. 주문 관리

### 목록

```text
GET /admin/orders?storeId=<storeId>&status=<OrderStatus>
```

- 선택적 store/status filter
- `createdAt DESC`
- 최대 200건
- pagination 없음

### 관리자 환불

```text
POST /admin/orders/:orderId/refund
```

`AdminService.forceRefund()`는 현재 두 경로로 분기한다.

- `schemaVersion === 2 && roundId`인 회차 주문은 `RoundOrderLifecycleService.cancelForRound({ storeId, orderId, expectedStatus, reason })`로 위임한 뒤 `SettlementsService.cancelSettlement(orderId)`를 호출한다.
- 그 외 legacy 주문은 아래 `forceLegacyRefund` claim/orchestration 경로를 사용한다.

legacy 경로 `forceLegacyRefund()`의 현재 실제 흐름:

1. `claimLegacyRefund()`가 주문을 transaction에서 fresh read하고, 환불 허용 상태(`isLegacyRefundableStatus` + cancellation retry/missing 상태)만 `cancellation.status: REFUNDING` + 만료 claim으로 선점한다.
2. 이미 `CANCELLED + cancellation COMPLETED`면 `done`으로 수렴하고 `SettlementsService.cancelSettlement(orderId)`를 호출한다.
3. 유효한 진행 중 claim이 있으면 `in_progress`로 conflict 처리하고 provider를 호출하지 않는다.
4. claim을 획득한 경우에만 `PaymentsService.processRefundByOrderId()`로 본 결제를 환불한다.
5. `applyLegacyLocalCancellation()`이 claim token 검증 후 주문을 `CANCELLED`/`cancellation COMPLETED`로 확정하고 legacy capacity·group quantity를 반환한다. 이후 `SettlementsService.cancelSettlement(orderId)`를 호출한다.
6. provider 실패는 `REFUND_FAILED`, local 실패는 `LOCAL_FAILED`로 기록해 재시도를 보존하고 외부 환불을 반복하지 않는다.

`claimLegacyRefund()`의 post-transaction decision은 committed attempt의 return value만 사용한다. aborted attempt의 `done`/`in_progress` 결정을 retried claim으로 누출하지 않는다.

본 결제 provider 환불 자체의 claim/idempotency는 `PaymentRefundService`가 보호한다. `AdminService.forceRefund()`와 `RoundOrderLifecycleService.cancelForRound()`의 단일 orchestration 경계, reservation/counter 반환, paid 재배송비 환불, `paid` settlement 회계 처리는 아래 `ADMIN-FORCE-REFUND-CONSISTENCY` 검증 상태가 다룬다.

### Retry purity와 회차 취소 proof

legacy claim의 committed-return retry purity는 `apps/api/src/admin/admin-legacy-refund-occ-retry.spec.ts`가 직접 회귀한다. 회차 정상 취소 경로(`RoundOrderLifecycleService.cancelForRound` / `claimCancellation` / `applyLocalCancellation`)의 OCC retry purity는 `apps/api/src/orders/round-cancellation-occ-retry.spec.ts`가 aborted attempt가 committed retry를 오염시키지 않고 provider 환불이 정확히 한 번 수행되는 것을 직접 고정한다.

이 proof는 회차/legacy 취소 transaction의 retry-purity 계약을 고정한다. `ADMIN-FORCE-REFUND-CONSISTENCY`의 전체 후속효과 수렴은 `apps/api/src/admin/admin.service.spec.ts`와 `apps/api/src/admin/admin-legacy-refund-occ-retry.spec.ts`가 별도로 직접 회귀한다.

### 검증 상태 — `ADMIN-FORCE-REFUND-CONSISTENCY` `IMPLEMENTATION_PROVEN`

admin 환불의 주문·결제·정산·회차 capacity 후속효과 수렴은 `apps/api/src/admin/admin.service.spec.ts`와 `apps/api/src/admin/admin-legacy-refund-occ-retry.spec.ts`가 실제 `AdminService`를 구동해 직접 회귀한다.

직접 proof가 고정하는 계약:

- 회차 주문(`schemaVersion === 2 && roundId`)은 `RoundOrderLifecycleService.cancelForRound({ storeId, orderId, expectedStatus, reason })`로 위임하므로 정상 회차 취소의 본 결제 환불·reservation/counter 반환·round item quantity 반환·held counter 감소·주문 `CANCELLED` 확정 불변식을 재사용한다.
- `forceRefund()`는 회차 경로와 legacy 경로 모두에서 `SettlementsService.cancelSettlement(orderId)`를 호출해 pending/confirmed settlement를 `cancelled`로 수렴시킨다. `paid` settlement는 역전하지 않고 보존하며 회수 대기 기록(`recovery.status: PENDING`)을 붙인다(`settlements.md` §7).
- legacy 경로 `forceLegacyRefund()`는 claim/orchestration과 OCC retry purity를 유지하고, `done`/`in_progress`, provider 실패(`REFUND_FAILED`), local 실패(`LOCAL_FAILED`) 재시도 경계를 보존한다.
- conflict·provider 실패·local 실패 경로에서는 settlement 취소가 수행되지 않고, provider 환불 성공 전에는 local cancellation과 settlement 취소가 진행되지 않는다.
- legacy 환불은 `CANCELLED` 외 허용 상태(`PENDING`·`DELIVERING`·`HUB_ARRIVED`·`PICKED_UP`·`DELIVERED`·`REVIEWED` 등)를 거부하고 모든 부수효과를 차단한다.

`ADMIN-FORCE-REFUND-CONSISTENCY: PROVEN (forceRefund delegates to cancelForRound and cancelSettlement)`

`paid` settlement의 회계 조정/운영 이슈 처리, provider 성공 후 local 실패 재시도 상태 보존, admin 환불과 정상 취소 동시 요청의 멱등 수렴은 각각 `cancelSettlement()`·`forceLegacyRefund()`·`cancelForRound()` proof와 `apps/api/src/settlements/settlements-lifecycle.spec.ts`가 소유한다.

추적: `docs/BACKLOG.md`의 `ADMIN-FORCE-REFUND-CONSISTENCY`; 직접 증거: `apps/api/src/admin/admin.service.spec.ts`, `apps/api/src/admin/admin-legacy-refund-occ-retry.spec.ts`.

### 배송 후 환불

```text
POST /admin/orders/:orderId/post-delivery-refund   { reasonCode, memo }
```

- 배송 완료로 표시된 회차 주문을 기간·정산 조건 없이 전액 환불한다. 흐름과 거부 조건은 `orders.md` §8D가 정본이다.
- 정산이 이미 `paid`면 정산은 그대로 두고 회수 대기 기록(`recovery.status: PENDING`)이 붙는다.
- 성공한 환불만 `admin.order.post_delivery_refunded` 행동 기록을 남긴다(사유 칸 = 메모).
- 기존 `AdminService`와 분리된 `AdminPostDeliveryRefundService`·`AdminPostDeliveryRefundController`가 소유한다. 직접 증거: `apps/api/src/admin/admin-post-delivery-refund.service.spec.ts`.

## 6. 정산 관리

### 목록

```text
GET /admin/settlements?storeId=<storeId>&from=<date>&to=<date>&status=<status>
```

- `settledAt DESC`
- 최대 500건
- `status`(선택)는 shared `SETTLEMENT_STATUSES`(`pending`·`confirmed`·`paid`·`cancelled`)만 허용하고, 다른 값은 400. 지정하지 않으면 모든 상태를 돌려준다. 사용하는 복합 인덱스: `status+settledAt DESC`, `storeId+status+settledAt DESC`(`firestore.indexes.json`, 계약 `firestore-indexes.spec.ts`). 직접 증거: `apps/api/src/admin/admin-settlements-status-filter.spec.ts`
- `{ settlements, total }`

### 지급 처리

```text
PATCH /admin/settlements/:settlementId/pay
```

현재 구현:

- `confirmed`만 `paid`로 전환
- 이미 `paid`면 거부
- `confirmed` 외 상태 거부
- transaction 안에서 status 재확인
- `paidAt`, `paidBy`(처리한 어드민 ID), `updatedAt` 기록
- 같은 transaction에 `adminAuditLogs` 기록(`admin.settlement.paid`)을 함께 쓴다. 기록 없는 지급은 생기지 않는다.

### 회수 완료

```text
PATCH /admin/settlements/:settlementId/recovery-complete
```

- 지급 뒤 환불돼 `recovery.status == PENDING`인 정산만 `RECOVERED`로 바꾸고 `recoveredAt`·`recoveredBy`를 남긴다. 정산 `status: paid`는 그대로다.
- 회수 기록이 없거나 이미 `RECOVERED`면 400.
- 같은 transaction에 `admin.settlement.recovery_completed` 행동 기록을 쓴다.
- 실제 돈은 관리자가 판매자에게서 계좌로 받는다. 다음 정산에서 자동으로 빼지 않는다.

### 검증 상태 — `IMPLEMENTATION_PROVEN`

금전 상태 전이 구현은 `apps/api/src/admin/admin-privileged-mutation.spec.ts`의 `AdminService.markAsPaid 상태 계약` suite가 실제 `AdminService`를 구동해 직접 회귀한다.

직접 proof가 고정하는 계약:

- settlement 없음 거부
- `pending|cancelled|paid` 거부
- `confirmed → paid` 정상 성공과 `paidAt`·`updatedAt` 기록
- transaction에서 fresh status 재확인
- 동시 요청에서 한 번만 수렴
- invalid state/invalid role side effect 0
- 실제 controller guard + service 조합에서 admin만 도달

이 공백은 `ADMIN-PRIVILEGED-MUTATION-COVERAGE`가 소유한다. 상세 정산 상태 계약은 `docs/specs/api/settlements.md`가 정본이다.

## 7. Driver 관리

### 목록

```text
GET /admin/drivers?status=pending|approved|suspended
```

현재 구현은 Firestore에서 `role == driver` 최대 100건을 읽은 뒤 status를 service 메모리에서 필터·정렬한다.

status 판정:

- `pending`: `!driverApproved && !suspended`
- `approved`: `driverApproved && !suspended`
- `suspended`: `suspended`

### 승인

```text
PATCH /admin/drivers/:userId/approve
```

- 사용자 존재 확인
- `role === driver` 확인
- `driverApproved: true`

이 endpoint가 관리자 승인 경로라는 계약은 유지되며, 2026-08-24 감사에서 확인한 다음 우회는 현재 구현에서 닫혔다.

- 신규 Kakao `targetRole: driver`는 `driverApproved: false`로 생성되고 자동 승인되지 않는다.
- 기존 승인 필드 누락 driver는 로그인 side effect로 자동 승인되지 않는다.
- 공개 `POST /auth/register`의 `role: driver`는 `driverApproved: false`를 저장하고 client 주입을 거부하며, false/누락 승인 driver의 `POST /auth/login`은 token side effect 전에 거부된다.

따라서 driver 승인 게이트는 `IMPLEMENTED / PROVEN`이다. 직접 근거: `apps/api/src/auth/auth.service.spec.ts`, `apps/api/src/auth/strategies/jwt.strategy.spec.ts`. runtime/browser session lifecycle proof는 별도 `PENDING`이며 정본은 `docs/specs/api/auth.md`다.

### 정지/복구

```text
PATCH /admin/drivers/:userId/suspend
```

```ts
{ suspended: boolean }
```

Driver 신규 로그인은 `suspended`를 확인하지만 기존 access/refresh/Firebase claims의 revocation 시점은 현재 명확한 계약으로 고정돼 있지 않다. 정지 write만으로 기존 driver의 주문/API/Firestore 접근이 즉시 종료됐다고 가정하지 않는다.

Preview E2E credentials는 별도 allowlist/secret gate를 사용하므로 admin 승인·정지와 E2E gate를 혼동하지 않는다.

## 8. Seller 초대

### 생성

```text
POST /admin/invite
{ recipientEmail: string }   // 필수, 이메일 형식·254자 이하(#518)
```

현재 구현(`apps/api/src/admin/admin.service.ts` `generateInvite`):

- UUID에서 하이픈 제거 후 앞 16자를 대문자로 사용
- `invites/{token}` 저장: `createdBy`(admin user ID), `usedAt`·`usedBy` 초기 null, `createdAt`
- `recipientEmail`: 필수. 빠지거나 빈 값·공백뿐이면 400이고, trim·소문자로 정규화해 저장한다(#518). #518 이전에 발급된 받는 사람 없는 초대(`recipientEmail: null`)는 가입 때 받는 사람 확인을 건너뛴다
- 만료: 생성 시점 + 72시간(`INVITE_TTL_MS`, #512)

응답:

```ts
{
  token: string
  expiresAt: string
  recipientEmail: string
}
```

초대 token 원문은 권한 있는 온보딩 흐름에서만 취급하며 문서·이슈에 실제 token을 남기지 않는다.

### 목록

```text
GET /admin/invite
```

- `createdAt DESC`
- 최대 50건

### 취소

```text
POST /admin/invite/:token/revoke
```

- 토큰이 영숫자 1~64자가 아니면 404(가입과 같은 형식 규칙, `apps/api/src/auth/invite-conflict.ts`), 문서가 없어도 404
- 트랜잭션에서 취소 → 사용 → 만료 순으로 확인해 409 `reason`(`already_revoked`·`already_used`·`expired`)으로 거부한다
- 성공하면 문서를 지우지 않고 `revokedAt`·`revokedBy`를 남긴다. 응답 `{ token, revokedAt }`

### 가입 때의 초대 판정

`POST /auth/register`(role `seller`)는 `inviteToken`이 필수다. 판정은 `docs/specs/api/auth.md`를 따른다.

운영 런타임은 이메일 가입을 받지 않으므로(2026-10-18 결정, `docs/specs/api/auth.md` §7) 운영에서는 초대 토큰으로 가입할 수 없다. 초대 발급·목록·취소 API는 그대로 동작한다. 운영에서 새 판매자를 받는 방식은 정해지지 않았다(별도 결정).

## 9. Banner 관리

Admin:

```text
GET /admin/banner
PUT /admin/banner
```

Consumer public read:

```text
GET /banner
```

현재 고정 문서:

```text
banners/main_hero
```

주요 필드:

```ts
{
  imageUrl?: string
  tagText?: string
  headline?: string
  subText?: string
  cta1?: { label: string; href: string }
  cta2?: { label: string; href: string }
  isActive: boolean
  updatedAt: Timestamp
}
```

admin upsert는 client가 되돌려 보낸 `updatedAt/createdAt`을 제거하고 서버 `updatedAt`을 기록한다.

Storage write/read 권한은 현재 `storage.rules`를 정본으로 확인한다. 과거 문서의 “인증 사용자 누구나 banner 경로 write” 설명을 현재 보안 계약으로 자동 적용하지 않는다.

## 10. 어드민 행동 기록

어드민이 운영 데이터를 바꾸면 `adminAuditLogs/{id}`에 1건을 남긴다. 보안 사건 기록(`auditLogs`)과 섞지 않는다. 쓰기는 `AuditService.logAdmin`이 소유한다.

| action | 대상 | before → after | 사유 |
|---|---|---|---|
| `admin.store.commission_changed` | store | `commissionRate` | - |
| `admin.store.archived` / `admin.store.restored` | store | `status` | - |
| `admin.user.suspended` / `admin.user.unsuspended` | user | `suspended` | `SuspendUserDto.reason`(선택, 200자) |
| `admin.driver.approved` | driver | `driverApproved` | - |
| `admin.driver.suspended` / `admin.driver.unsuspended` | driver | `suspended` | `SuspendUserDto.reason` |
| `admin.order.force_refunded` | order | `status` → `CANCELLED` | `ForceRefundDto.reason`(200자) |
| `admin.order.post_delivery_refunded` | order | `status` → `CANCELLED`, `reasonCode` | 환불 메모(200자) |
| `admin.settlement.paid` | settlement | `status` | - |
| `admin.settlement.recovery_completed` | settlement | `recoveryStatus`(`PENDING` → `RECOVERED`), `amount` | - |
| `admin.banner.updated` | banner `main_hero` | 바꾼 칸만 | - |

문서 필드: `id`, `action`, `actorId`, `targetType`, `targetId`, `before`, `after`, `reason`, `createdAt`.

- 고객 이름·전화·주소는 넣지 않는다. 대상은 ID로만 가리킨다.
- 정산 지급과 회수 완료만 같은 transaction에 기록한다. 나머지는 작업이 성공한 뒤 기록하고, 기록이 실패하면 error 로그만 남긴다(이미 끝난 작업을 되돌리지 않는다).
- 실패한 작업(없는 대상, 환불 실패 등)은 기록하지 않는다.
- 초대 발급·취소(`createdBy`·`revokedBy`), 후기 복구(`moderationLog`), legal hold(`legalHoldUpdatedBy`)는 각 문서에 이미 처리자를 남기므로 이 기록 대상이 아니다.
- 조회: `GET /admin/audit-logs`는 `createdAt` 내림차순 최근 100건을 돌려준다. 단일 필드 정렬이라 복합 인덱스가 필요 없다. seller 앱 `/admin/audit`("기록" 탭)이 읽기 전용으로 보여 준다.
- 보관 기간은 아직 정하지 않았다(파기 cron 대상 아님).
- 직접 증거: `apps/api/src/admin/admin-audit.spec.ts`, `apps/api/src/common/audit/audit.service.spec.ts`, `admin-privileged-mutation.spec.ts`의 지급 transaction 기록 검사

## 11. 현재 알려진 구조적 제한

- admin 주문 목록: 최대 200건, pagination 없음
- admin 정산 목록: 최대 500건, pagination 없음
- driver 목록: 최대 100건 read 후 메모리 필터
- admin privileged mutation의 서버 authorization + side-effect 0은 `apps/api/src/admin/admin-privileged-mutation.spec.ts`로 `IMPLEMENTATION_PROVEN`
- admin settlement 지급 전이는 `apps/api/src/admin/admin-privileged-mutation.spec.ts`로 `IMPLEMENTATION_PROVEN`
- admin 강제 환불은 `apps/api/src/admin/admin.service.spec.ts`·`apps/api/src/admin/admin-legacy-refund-occ-retry.spec.ts` 직접 proof로 `ADMIN-FORCE-REFUND-CONSISTENCY`가 `IMPLEMENTATION_PROVEN`
- store 수수료 설정과 settlement 생성의 `PLATFORM_FEE_RATE` 관계는 단일 정책으로 완전히 통합돼 있지 않을 수 있으므로 변경 전 코드 재검증 필요
- driver 관리자 승인 게이트는 `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION` 해결 전 `VERIFIED`가 아님
- 사용자/driver `suspended` flag의 기존 세션 enforcement는 같은 auth P0 해결 전 `VERIFIED`가 아님
- 어드민 행동 기록은 10절 표의 작업만 다룬다. 판매자 겸용 엔드포인트(상품·회차·주문 상태 변경)에서 admin이 한 행동과 품종 등록·수정은 기록하지 않는다.

이 제한을 해소할 필요가 생기면 `docs/BACKLOG.md`에 현재 작업으로 승격한 뒤 별도 설계를 수행한다.

## 12. 검증 원칙

admin 변경 시 최소 확인:

- `apps/api/src/admin/admin.controller.ts`
- `apps/api/src/admin/admin.service.ts`
- `apps/api/src/admin/dto/admin.dto.ts`
- `apps/api/src/common/guards/roles.guard.ts`
- `apps/seller/src/app/admin/**`
- `apps/seller/src/hooks/useAdmin.ts`
- auth/orders/payments/settlements 관련 spec
- `RoundOrderLifecycleService`와 `OrderCapacityService`
- paid redelivery charge refund path
- 관련 unit/API E2E/Playwright

admin role boundary는 UI redirect만으로 `VERIFIED` 처리하지 않는다. 실제 HTTP 경계에서 unauthenticated 401, consumer/seller/driver 403, admin 허용과 거부 side-effect 0을 직접 고정한다.

환불처럼 금전·주문·capacity·정산을 함께 변경하는 작업은 provider 환불 성공만으로 완료 판정하지 않는다. 모든 local side effect와 실패 재시도·race를 직접 검증한다.

settlement 지급처럼 금전 상태를 변경하는 admin mutation은 정상·잘못된 상태·동시 요청을 직접 회귀한다.

승인·정지처럼 권한 수명주기에 영향을 주는 변경은 admin endpoint의 Firestore write 성공만 검사하지 않고 auth register/login/refresh/custom-token 및 실제 접근 차단까지 검증한다.

실제 환불·계정 권한 변경·운영 데이터 변경은 문서 정합성 검토 범위에서 실행하지 않는다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-10-21 | 배송 후 환불(§5)·정산 회수 완료(§6) endpoint와 행동 기록 2종 추가 |
| 2026-10-21 | 어드민 행동 기록(`adminAuditLogs`, `GET /admin/audit-logs`, seller "기록" 탭), 정산 지급 `paidBy`, 정지 사유(`SuspendUserDto.reason`) 추가 |
| 2026-10-18 | 운영 런타임의 이메일 가입 전면 거부로 운영에서는 초대 토큰 가입이 불가함을 명시(발급·목록·취소는 그대로) |
| 2026-09-26 | admin force refund가 `RoundOrderLifecycleService.cancelForRound` + `SettlementsService.cancelSettlement`로 수렴하고 `admin.service.spec.ts`·`admin-legacy-refund-occ-retry.spec.ts`로 직접 증명되어 `ADMIN-FORCE-REFUND-CONSISTENCY` P0 불일치 서술을 proven 계약으로 대체 |
| 2026-09-26 | privileged mutation HTTP authorization과 `markAsPaid` 지급 전이를 `admin-privileged-mutation.spec.ts` 직접 proof로 `IMPLEMENTATION_PROVEN`에 동기화하고, 회차 취소 OCC retry purity를 `round-cancellation-occ-retry.spec.ts`에 연결 |
| 2026-08-24 | admin privileged mutation 서버 authorization과 settlement 지급 상태 전이의 직접 회귀 부재를 `ADMIN-PRIVILEGED-MUTATION-COVERAGE` P0로 분리 |
| 2026-08-24 | 공개 email driver register/login 우회를 driver 승인 P0에 연결 |
| 2026-08-24 | admin force refund가 정상 회차 취소의 재배송비·reservation/counter·settlement 후속효과를 우회하는 구조를 P0 IMPLEMENTATION FINDING으로 정합화 |
| 2026-08-24 | driver 승인 자동 우회와 suspension 기존 세션 revocation을 auth P0와 연결하고 admin write 자체를 권한 enforcement 완료로 보지 않도록 정합화 |
| 2026-08-23 | canonical URL, archive/restore, 현재 정산·드라이버·초대 계약, 위험한 수동 권한 부여 지침을 현행화 |
| 2026-04-23 | banner 관리 추가 |
| 2026-04-03 | driver 관리 추가 |
| 2026-04-01 | 초기 admin 구현 문서화 |

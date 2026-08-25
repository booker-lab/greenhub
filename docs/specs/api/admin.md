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

위 class-level guard **구현은 존재**한다. 그러나 2026-08-24 감사에서 `apps/api/src/admin`에 controller/service 전용 `*.spec.ts`가 없고, 현재 확인한 API E2E도 admin mutation의 unauthenticated/non-admin 거부와 side-effect 0을 직접 고정하지 않는 것을 확인했다.

현재 Playwright admin 테스트는 비로그인 admin UI redirect와 admin 화면 read smoke 중심이며 운영 DB 보호를 위해 archive/restore 같은 mutation을 실제 수행하지 않는다. 이 UI 증거를 NestJS admin API role boundary 전체의 직접 검증으로 확장하지 않는다.

따라서 고위험 admin mutation authorization은 **`IMPLEMENTED / UNVERIFIED` + P0 `COVERAGE GAP`**으로 둔다.

추적: `docs/BACKLOG.md`의 `ADMIN-PRIVILEGED-MUTATION-COVERAGE`; 증거: `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`.

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

`AdminService.forceRefund()`의 현재 실제 흐름:

1. 주문 존재 확인
2. `status === CANCELLED`만 거부
3. `PaymentsService.processRefundByOrderId()`로 **본 결제** 환불 시도
4. 주문 문서를 직접 `status: CANCELLED`, `cancelReason`으로 갱신

본 결제 provider 환불 자체의 claim/idempotency는 `PaymentRefundService`가 보호한다. 그러나 이 endpoint를 **정상 주문 취소 lifecycle과 동일한 원자적 취소 계약**으로 해석하면 안 된다.

### 현재 구현 불일치 — `ADMIN-FORCE-REFUND-CONSISTENCY` P0

2026-08-24 정상 회차 취소 경로와 admin force refund를 대조한 결과, admin 경로는 주문·결제·정산·회차 capacity의 후속효과를 완전히 수렴시키지 않는다.

정상 회차 주문 취소(`RoundOrderLifecycleService.cancel`)는 필요 시 다음을 수행한다.

- 본 결제 환불
- paid 재배송비(`orderCharges`) 환불
- cancellation 상태로 재시도/race 제어
- `checkoutReservation` release
- 회차 ordered/reserved counters 및 round item 수량 반환
- `DELIVERY_HELD`이면 `heldOrderCount` 감소
- 주문 `CANCELLED` 확정
- `SettlementsService.cancelSettlement()` 호출

반면 현재 `AdminService.forceRefund()`는 위에서 **본 결제 환불 + 주문 직접 CANCELLED write만 수행**한다.

추가로 현재 admin 경로는 `CANCELLED` 외의 상태를 별도로 제한하지 않으므로 `PENDING`, `DELIVERY_HELD`, `DELIVERED`, `PICKED_UP`, `REVIEWED` 등에서도 진입할 수 있다. `PaymentRefundService`가 payment 없음/비`PAID`를 no-op해도 주문은 이후 `CANCELLED`로 직접 변경될 수 있다.

따라서 다음 불변식은 현재 `VERIFIED`가 아니다.

- admin 환불 뒤 회차 reservation/capacity가 누수 없이 반환됨
- paid 재배송비가 함께 환불됨
- held counter가 정확히 감소함
- 이미 생성된 pending/confirmed settlement가 취소됨
- paid settlement 이후 환불이 별도 회계 조정/운영 이슈로 안전하게 처리됨
- admin 환불과 정상 취소/동시 요청이 하나의 멱등 cancellation 상태로 수렴함

이 항목은 금전·정산·재고/회차 capacity를 동시에 건드리므로 **P0 `IMPLEMENTATION FINDING`**이다. 현재 admin UI에서 버튼을 제한하더라도 API/service 불변식을 대신하지 않는다.

actual release SHA 확정 전 최소 완료 조건:

- admin 환불의 허용 주문 상태를 명시적으로 정의한다.
- 회차 주문은 일반 주문의 `RoundOrderLifecycleService` 취소 불변식을 재사용하거나 동등한 단일 orchestration 경계로 통합한다.
- 본 결제와 연결된 paid 재배송비를 중복 없이 함께 환불한다.
- HELD/CONSUMED reservation, round counters, round item quantities, heldOrderCount를 주문 상태에 맞게 정확히 반환한다.
- pending/confirmed settlement는 cancelled로 수렴시킨다.
- 이미 `paid` settlement가 있는 주문의 환불 정책을 명시적으로 결정한다. 단순 `paid → cancelled` 역전은 금지하고, 회계 조정/operation issue/수동 승인 등 별도 안전 경계를 둔다.
- provider 환불 성공 후 local side-effect 실패 시 재시도 상태를 보존하고 외부 환불을 반복하지 않는다.
- 동시 admin 환불/정상 취소가 하나의 결과로 수렴한다.
- PENDING·ACCEPTED·DELIVERY_HELD·DELIVERED/REVIEWED·paid-settlement·redelivery-charge 조합을 직접 회귀 테스트한다.

추적: `docs/BACKLOG.md`의 `ADMIN-FORCE-REFUND-CONSISTENCY`.

## 6. 정산 관리

### 목록

```text
GET /admin/settlements?storeId=<storeId>&from=<date>&to=<date>
```

- `settledAt DESC`
- 최대 500건
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
- `paidAt`, `updatedAt` 기록

### 검증 상태 — `IMPLEMENTED / UNVERIFIED`

금전 상태 전이 구현은 있으나 이번 감사에서 `markAsPaid()`의 직접 service/API 회귀를 확인하지 못했다. seller settlement Playwright는 UI 날짜·탭 smoke 중심이며 admin 지급 mutation의 증거가 아니다.

다음이 직접 고정되기 전에는 지급 상태 전이를 `VERIFIED`로 승격하지 않는다.

- settlement 없음 거부
- `pending|cancelled|paid` 거부
- `confirmed → paid` 정상 성공
- transaction 재조회와 동시 요청에서 한 번만 수렴
- invalid state/invalid role side effect 0
- 실제 controller guard + service 조합에서 admin만 도달

이 공백은 `ADMIN-PRIVILEGED-MUTATION-COVERAGE` P0가 소유한다. 상세 정산 상태 계약은 `docs/specs/api/settlements.md`가 정본이다.

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

이 endpoint가 존재한다는 사실과 **관리자 승인만이 driver 권한을 부여하는 유일한 경로라는 보장**은 현재 동일하지 않다. 2026-08-24 감사에서 다음 우회를 확인했다.

- 신규 Kakao `targetRole: driver`가 `driverApproved: true`로 생성됨
- 기존 승인 필드 누락 driver가 Kakao 로그인 중 자동 승인됨
- 공개 email `POST /auth/register`가 `role: driver`를 생성할 수 있고 이어지는 `POST /auth/login`이 `driverApproved` 확인 없이 `role=driver` JWT를 발급함

따라서 현재 driver 승인 게이트는 P0 `IMPLEMENTATION FINDING`이며, admin 승인 UI/API만 보고 `VERIFIED`로 판단하지 않는다. 정본과 완료 조건: `docs/specs/api/auth.md` 및 Backlog `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`.

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
```

현재 구현:

- UUID에서 하이픈 제거 후 앞 16자를 대문자로 사용
- `invites/{token}` 저장
- 생성자 admin user ID 기록
- `usedAt`, `usedBy` 초기 null
- 만료: 생성 시점 + 7일

응답:

```ts
{
  token: string
  expiresAt: string
}
```

초대 token 원문은 권한 있는 온보딩 흐름에서만 취급하며 문서·이슈에 실제 token을 남기지 않는다.

### 목록

```text
GET /admin/invite
```

- `createdAt DESC`
- 최대 50건

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

## 10. 현재 알려진 구조적 제한

- admin 주문 목록: 최대 200건, pagination 없음
- admin 정산 목록: 최대 500건, pagination 없음
- driver 목록: 최대 100건 read 후 메모리 필터
- admin privileged mutation의 서버 authorization + side-effect 0 직접 회귀는 `ADMIN-PRIVILEGED-MUTATION-COVERAGE` 해결 전 `VERIFIED`가 아님
- admin settlement 지급 전이는 `ADMIN-PRIVILEGED-MUTATION-COVERAGE` 해결 전 `VERIFIED`가 아님
- admin 강제 환불은 `ADMIN-FORCE-REFUND-CONSISTENCY` 해결 전 주문 취소 lifecycle과 동일한 P0 안전 계약으로 사용하지 않음
- store 수수료 설정과 settlement 생성의 `PLATFORM_FEE_RATE` 관계는 단일 정책으로 완전히 통합돼 있지 않을 수 있으므로 변경 전 코드 재검증 필요
- driver 관리자 승인 게이트는 `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION` 해결 전 `VERIFIED`가 아님
- 사용자/driver `suspended` flag의 기존 세션 enforcement는 같은 auth P0 해결 전 `VERIFIED`가 아님
- admin actions의 통합 감사 로그 범위는 operation/audit 구현을 확인해야 하며 단순 endpoint 존재만으로 완전한 감사 추적을 보장하지 않는다.

이 제한을 해소할 필요가 생기면 `docs/BACKLOG.md`에 현재 작업으로 승격한 뒤 별도 설계를 수행한다.

## 11. 검증 원칙

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
| 2026-08-24 | admin privileged mutation 서버 authorization과 settlement 지급 상태 전이의 직접 회귀 부재를 `ADMIN-PRIVILEGED-MUTATION-COVERAGE` P0로 분리 |
| 2026-08-24 | 공개 email driver register/login 우회를 driver 승인 P0에 연결 |
| 2026-08-24 | admin force refund가 정상 회차 취소의 재배송비·reservation/counter·settlement 후속효과를 우회하는 구조를 P0 IMPLEMENTATION FINDING으로 정합화 |
| 2026-08-24 | driver 승인 자동 우회와 suspension 기존 세션 revocation을 auth P0와 연결하고 admin write 자체를 권한 enforcement 완료로 보지 않도록 정합화 |
| 2026-08-23 | canonical URL, archive/restore, 현재 정산·드라이버·초대 계약, 위험한 수동 권한 부여 지침을 현행화 |
| 2026-04-23 | banner 관리 추가 |
| 2026-04-03 | driver 관리 추가 |
| 2026-04-01 | 초기 admin 구현 문서화 |

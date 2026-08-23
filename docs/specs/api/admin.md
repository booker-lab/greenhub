<!-- Language: ko -->

# Admin API / Domain Spec

> **최종 정합화**: 2026-08-23
> **상태**: Current — driver 승인 enforcement는 Issue #37 P0 미해결
> **API 정본**: `apps/api/src/admin/**`
> **인증 계약**: `docs/specs/api/auth.md`
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

admin role 부여는 별도 승인된 관리 절차로 수행한다. 과거 문서의 수동 Firestore role 변경 지시를 현재 정식 절차로 사용하지 않는다.

## 2. 접근 URL

UI 진입점:

```text
{seller_domain}/admin
```

Production canonical seller domain:

```text
https://seller.greenlove.co.kr
```

따라서 production admin 기준 URL은 `https://seller.greenlove.co.kr/admin`이다. deployment alias를 canonical production URL로 사용하지 않는다.

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

`SetCommissionDto` 검증을 따른다. 이 값과 settlement service의 전역 `PLATFORM_FEE_RATE` 사용 범위를 동일한 정책으로 가정하지 않는다.

### Store archive / restore

```text
PATCH /admin/stores/:storeId/archive
PATCH /admin/stores/:storeId/restore
```

archive는 물리 삭제가 아니다. 주문 또는 settlement가 존재하면 archive를 거부하고, 허용 시 `status: archived`, `archivedAt`을 기록한다. restore는 `status: active`로 복구한다.

## 4. Consumer 사용자 관리

```text
GET /admin/users
PATCH /admin/users/:userId/status
```

`GET /admin/users`는 현재 `role == consumer`만 조회하며 반환 전 `passwordHash`를 제거한다.

status body:

```ts
{ suspended: boolean }
```

`suspended` flag 존재와 모든 인증/refresh/API 경로의 즉시 차단은 별개다. 계정 정지 정책 변경 시 `AuthService`, refresh, guard enforcement를 함께 검증한다.

## 5. 주문 관리

```text
GET  /admin/orders?storeId=<storeId>&status=<OrderStatus>
POST /admin/orders/:orderId/refund
```

목록은 선택적 store/status filter, `createdAt DESC`, 최대 200건, pagination 없음이다.

관리자 환불은 주문 존재와 `CANCELLED` 여부를 확인한 뒤 `PaymentsService.processRefundByOrderId()`를 호출하고 주문을 `CANCELLED`로 갱신한다. provider 멱등성·운영 이슈는 `docs/specs/api/payments.md`를 따른다.

## 6. 정산 관리

```text
GET   /admin/settlements?storeId=<storeId>&from=<date>&to=<date>
PATCH /admin/settlements/:settlementId/pay
```

- 목록: `settledAt DESC`, 최대 500건
- 지급: `confirmed`만 `paid`로 전환
- transaction 안에서 status 재확인
- `paidAt`, `updatedAt` 기록

정산 상태 계약은 `docs/specs/api/settlements.md`가 정본이다.

## 7. Driver 관리와 현재 F-001 경계

### 목록

```text
GET /admin/drivers?status=pending|approved|suspended
```

현재 구현은 `role == driver` 최대 100건을 읽고 메모리에서 status를 필터·정렬한다.

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

### 정지/복구

```text
PATCH /admin/drivers/:userId/suspend
```

```ts
{ suspended: boolean }
```

### 중요한 현재 제한

admin 승인 endpoint와 pending status 모델은 존재하지만 **현재 `AuthService.kakaoLogin()`이 신규 Kakao driver를 `driverApproved: true`로 생성하고 승인 필드가 없는 기존 driver도 자동 승인한다.** 따라서 새 Kakao driver에 대해 admin pending → approve workflow가 보안 경계로 실질적으로 강제되지 않는다.

또한 current `main`에서는 다음 F-001 문제가 함께 남아 있다.

- `/driver/orders`가 `driver`뿐 아니라 `seller`도 허용
- driver 주문 조회가 driverId로 필터되지 않음
- Firestore Rules가 role이 driver이면 전체 order read 허용
- custom token/Rules가 최신 `driverApproved`/`suspended` 상태를 충분히 재검증하지 않음

추적: Issue #37.

Issue #37의 목표는 admin 승인 workflow를 실제 API/Firebase 접근 경계로 연결하고, 정지/승인 변경 후 stale token 접근까지 차단하는 것이다.

Preview E2E credentials의 allowlist/secret gate는 별도 테스트 격리 장치이며 실제 운영 driver 승인 모델을 대체하지 않는다.

## 8. Seller 초대

```text
POST /admin/invite
GET  /admin/invite
```

현재 생성은 UUID 기반 token을 저장하고 생성자 admin ID, `usedAt`, `usedBy`, 생성 시점 + 7일 만료를 기록한다. 실제 token 원문을 문서·이슈에 남기지 않는다.

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

현재 고정 문서는 `banners/main_hero`다. admin upsert는 client가 보낸 `updatedAt/createdAt`을 제거하고 서버 `updatedAt`을 기록한다. Storage 권한은 `storage.rules`를 정본으로 확인한다.

## 10. 현재 알려진 구조적 제한

- admin 주문 목록: 최대 200건, pagination 없음
- admin 정산 목록: 최대 500건, pagination 없음
- driver 목록: 최대 100건 read 후 메모리 필터
- Issue #37 완료 전 driver admin 승인 workflow가 실제 접근 차단 경계로 강제되지 않음
- store 수수료 설정과 settlement 생성의 `PLATFORM_FEE_RATE` 관계는 변경 전 코드 재검증 필요
- 사용자 `suspended` enforcement는 endpoint별 인증 경로를 실제 검증해야 함
- admin actions의 통합 감사 로그 범위는 구현을 직접 확인해야 함

## 11. 검증 원칙

admin/driver 승인 변경 시 최소 확인:

- `apps/api/src/admin/admin.controller.ts`
- `apps/api/src/admin/admin.service.ts`
- `apps/api/src/admin/dto/admin.dto.ts`
- `apps/api/src/auth/**`
- `apps/api/src/driver/**`
- `apps/seller/src/app/admin/**`
- `apps/seller/src/hooks/useAdmin.ts`
- `firestore.rules`
- auth/orders/payments/settlements current spec
- 관련 unit/integration/E2E와 Rules emulator tests

실제 환불·계정 권한 변경·운영 데이터 변경은 문서 정합성 검토 범위에서 실행하지 않는다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-23 | current main F-001 재검증에 따라 driver admin 승인 endpoint와 실제 접근 enforcement의 차이를 명시 |
| 2026-08-23 | canonical URL, archive/restore, 정산·드라이버·초대 계약 정합화 |
| 2026-04-23 | banner 관리 추가 |
| 2026-04-03 | driver 관리 추가 |
| 2026-04-01 | 초기 admin 구현 문서화 |
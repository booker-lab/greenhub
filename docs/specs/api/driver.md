<!-- Language: ko -->

# Driver API / Security Contract

> **최종 정합화**: 2026-08-23 KST
> **상태**: Current with P0 gap — Issue #37
> **API 정본**: `apps/api/src/driver/**`, 관련 `apps/api/src/auth/**`, orders lifecycle
> **Firebase 정본**: `firestore.rules`, `storage.rules`

## 1. 범위

이 문서는 driver 계정 승인, `/driver/orders`, driver가 주문을 조회·선점·상태 전이할 때의 접근 경계를 다룬다.

회차 주문 상태 자체는 `docs/specs/api/orders.md`, 인증 일반 계약은 `docs/specs/api/auth.md`가 소유한다.

## 2. current main 구현 — 2026-08-23 재검증

### Driver 가입/로그인

현재 `AuthService.kakaoLogin()`:

- 신규 Kakao driver를 `driverApproved: true`로 생성한다.
- 기존 `role == driver` 사용자에 `driverApproved` 필드가 없으면 로그인 시 `true`로 업데이트한다.
- `suspended === true` 사용자는 Kakao 로그인에서 거부한다.
- `driverApproved === false`를 API 로그인 단계에서 별도로 거부하지 않는다.

따라서 admin의 `pending → approve` 모델이 신규 Kakao driver에 대해 실제 보안 경계로 강제되지 않는다.

### `/driver/orders`

현재 controller:

```text
GET /driver/orders?status=PREPARING,DELIVERING
JwtAuthGuard + RolesGuard
Roles: driver | seller
```

현재 service는 `driverId`를 인자로 받지만 실제 Firestore query/filter에 사용하지 않는다.

조회 조건은 요청한 상태 중 `PREPARING`, `DELIVERING`만 남긴 뒤:

```text
orders where status in requestedStatuses
orderBy preparedAt asc
```

이며 결과 전체를 반환한다.

즉 현재 `main`에서는 seller도 driver endpoint에 들어갈 수 있고, driver 본인 배정 여부가 조회 범위를 제한하지 않는다.

### Firestore Rules

현재 `orders` read는 다음 중 하나면 허용된다.

- order `storeId == request.auth.token.storeId`
- `role == admin`
- `role == driver`

`role == driver`에 승인 상태·정지 상태·본인 배정 주문 조건이 추가되지 않는다.

### Firebase custom token

현재 `AuthService.getFirebaseToken()`은 `userId`, `role`, `storeId` 기반 custom token을 만들며 최신 `driverApproved`/`suspended` 사용자 상태를 별도로 재검증하거나 해당 보안 상태를 claim으로 강제하지 않는다.

## 3. 보안 판정

현재 상태는 출시 허용 계약이 아니다.

추적: GitHub Issue #37 `P0: F-001 driver 승인·주문 접근 보안 remediation을 main에 통합`.

Issue #37 완료 전에는:

- driver approval을 운영 보안 경계가 이미 완성됐다고 문서화하지 않는다.
- actual release SHA를 고정하지 않는다.
- release-SHA 52 E2E를 최종 출시 증거로 수행하지 않는다.
- production 배포로 진행하지 않는다.

## 4. 목표 계약 — Issue #37

### 승인/정지

- 신규 driver 기본 `driverApproved: false`.
- 승인 전 API driver 접근 거부.
- `suspended === true` 즉시 거부.
- access/refresh/custom-token 경로에서 최신 사용자 승인·정지 상태 재검증.
- 승인 취소/정지 뒤 stale token이 계속 접근하지 못하도록 token/session 무효화 범위 검증.

### `/driver/orders`

- driver role 전용.
- 승인된 driver만 접근.
- 서버가 반환 대상을 제한:
  - 아직 배정되지 않았고 현재 driver가 선점할 수 있는 `PREPARING` 직배송/허용 주문
  - `driverId == current user`인 본인 배정 주문
- 다른 driver에게 배정된 주문은 반환하지 않음.
- seller는 seller/store 주문 API를 사용하고 `/driver/orders`를 사용하지 않음.

### 주문 선점

- 선점 가능 상태·배송 방식·현재 `driverId`를 transaction 안에서 재확인.
- 동시에 두 driver가 선점할 경우 한 명만 성공.
- 이미 배정/상태 변경된 주문은 실패.

### Firestore Rules

- 단순 `role == driver`만으로 전체 주문 read 금지.
- 승인·정지 상태를 현재 `users/{uid}` 또는 검증 가능한 최신 상태 기준으로 확인.
- 허용된 주문 범위만 read.
- stale custom token의 과거 승인 claim만으로 접근 허용 금지.

## 5. Admin과의 관계

`GET /admin/drivers`, `PATCH /admin/drivers/:userId/approve`, `PATCH /admin/drivers/:userId/suspend`는 admin 관리 surface다.

이 endpoint가 존재하는 것만으로 승인 enforcement가 완성된 것은 아니다. Issue #37은 admin의 승인 상태를 실제 auth/API/Firebase 접근 경계와 연결하는 작업이다.

## 6. E2E credentials와 운영 승인의 구분

Preview driver credentials에는 별도의 environment/secret/email allowlist gate가 있다. 이는 E2E 격리를 위한 테스트 장치다.

- E2E allowlist 통과 ≠ 운영 driver 승인
- E2E shared secret ≠ 운영 사용자 인증 정책
- fixture의 `driverApproved: true` ≠ 신규 production driver 기본값

## 7. 검증 요구사항

Issue #37 완료 판정 최소 증거:

- 신규 driver가 승인 전 거부됨
- admin 승인 후 정상 접근
- 정지/승인 취소 후 기존 token 접근 거부
- `/driver/orders` seller 거부
- 미승인 driver 거부
- 타 driver 배정 주문 미노출
- 허용된 미배정 주문 + 본인 배정 주문만 노출
- 동시 선점 한 명만 성공
- Firestore Rules emulator에서 미승인/정지/stale-token/타인 주문 read 거부
- 승인 driver의 허용 주문 read만 성공
- API unit/integration/E2E와 Rules tests 통과

## 8. 변경 시 함께 확인

- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/driver/driver.controller.ts`
- `apps/api/src/driver/driver.service.ts`
- driver가 사용하는 orders lifecycle/assignment 코드
- `apps/api/src/admin/admin.service.ts`
- `apps/driver/src/auth.ts`
- `firestore.rules`
- `tests/firestore/**`
- `apps/e2e` driver round-direct 시나리오
- `docs/specs/api/auth.md`
- `docs/specs/api/admin.md`
- `docs/specs/api/orders.md`

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-23 | current main F-001 재현 결과와 출시 전 목표 보안 계약을 분리해 최초 작성 |

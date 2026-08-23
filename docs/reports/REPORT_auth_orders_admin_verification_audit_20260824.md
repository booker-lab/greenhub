<!-- Language: ko -->

# REPORT — Auth / Orders / Admin 검증 정합성 감사

> 날짜: 2026-08-24 KST
> 기준 `main`: `abde4dea6cd0d63ce89a66e2d9d293e1f7fea0bf`
> 범위: `auth.md` → `orders.md` → `admin.md` Spec·Code·Test 삼각 검증
> 판정 기준: `docs/DOCUMENT_CONSISTENCY.md`

## 요약 판정

| 영역 | 판정 | 결과 |
|---|---|---|
| Auth driver approval | P0 `IMPLEMENTATION FINDING` 범위 확대 | 공개 email register/login 우회 추가 확인 |
| Orders API query authorization | `VERIFIED` 유지 | consumer/seller/driver/admin 직접 정상·거부 회귀 존재 |
| Orders mutation authorization | 기존 P0 `COVERAGE GAP` 유지 | 이번 감사에서 새 판정 없음 |
| Orders direct Firestore read | 기존 P0 `IMPLEMENTATION FINDING` 유지 | 이번 감사에서 새 판정 없음 |
| Admin server privileged mutations | `IMPLEMENTED / UNVERIFIED` + P0 `COVERAGE GAP` | 실제 guard 구현은 있으나 직접 서버 거부 회귀 부족 |
| Admin settlement `confirmed → paid` | `IMPLEMENTED / UNVERIFIED` + P0 `COVERAGE GAP` | transaction 구현은 있으나 직접 상태/race 회귀 미확인 |
| Admin force-refund lifecycle | 기존 P0 `IMPLEMENTATION FINDING` 유지 | 별도 remediation 항목 유지 |

## 1. Auth — driver 관리자 승인 우회 범위 확대

의도된 계약은 **관리자 승인 전 driver 권한을 얻을 수 없어야 한다**는 것이다.

기존 감사에서 Kakao 경로 두 개가 이미 확인돼 있었다.

1. 신규 Kakao `targetRole: driver`가 `driverApproved: true`로 즉시 생성됨.
2. 기존 driver의 `driverApproved === undefined`가 로그인 side effect로 `true`가 됨.

이번 감사에서 별도의 공개 email 경로를 추가 확인했다.

- `RegisterDto.role`은 `consumer | seller | driver`를 허용한다.
- `POST /auth/register`는 공개 endpoint다.
- `AuthService.register()`는 seller에만 invite gate를 적용하며 driver는 `role: driver`로 바로 생성할 수 있다.
- 이 email driver 문서에는 `driverApproved: true`가 필요하지 않다.
- `POST /auth/login`도 공개 endpoint다.
- `AuthService.login()`은 password와 `suspended`를 확인한 뒤 `driverApproved`를 확인하지 않고 저장된 `role`로 JWT를 발급한다.
- `GET /auth/firebase-token`은 현재 JWT의 `role/storeId`를 Firebase custom claims로 전달한다.

따라서 **익명 사용자가 공개 register→login 경로로 관리자 승인 없이 `role=driver` API JWT를 획득할 수 있는 구현 경로**가 존재한다.

이 문제는 `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`과 결합 위험이 있다. 현재 broad driver Firestore read가 남아 있으므로 self-issued driver 권한이 Firebase custom claim까지 이어지면 개인정보/주문 접근 위험이 확대될 수 있다.

판정:

- 기존 `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`의 **driver approval P0 `IMPLEMENTATION FINDING` 범위를 email register/login까지 확대**한다.
- 새 P0 ID를 별도로 만들지 않는다.
- stale refresh/custom claims 문제는 같은 umbrella 아래 기존 `DECISION REQUIRED + remediation`을 유지한다.

현재 직접 테스트는 Kakao identity·role mismatch·suspended login 일부를 고정하지만, `register(role=driver) → login` 승인 전 거부를 고정하지 않는다.

## 2. Orders — API query `VERIFIED` 유지

`OrdersQueryService`와 `orders-query.service.spec.ts`를 대조했다.

직접 회귀가 다음을 고정한다.

- consumer 목록은 요청 필터 위조와 무관하게 자기 주문만 반환.
- consumer는 타 소비자 주문 상세 거부.
- seller는 소유하지 않은 store 목록·상세 거부.
- driver는 배정 주문만 목록·상세 허용, 비배정 상세 거부.
- admin은 store 주문 목록 허용.
- storeId 없는 상세에서도 seller ownership과 driver assignment를 검증.
- 완료 주문 delivery photo URL도 authorization 뒤 생성하며 실패 시 공개 URL로 우회하지 않음.

따라서 `docs/specs/api/orders.md`의 **API 조회 authorization = `VERIFIED`** 판정은 과대보장이 아니며 유지한다.

단, 이 판정은 API service 경계에 한정한다. raw Firestore direct read P0와 mutation authorization coverage P0를 덮지 않는다.

## 3. Admin — privileged mutation coverage gap

`AdminController`에는 class-level로 다음이 구현돼 있다.

```text
JwtAuthGuard
RolesGuard
@Roles('admin')
```

또한 `RolesGuard`는 handler/class metadata의 role과 request JWT role을 비교한다.

그러나 현재 `apps/api/src/admin`에는 controller/service 전용 `*.spec.ts`가 없고, API E2E에도 admin mutation을 직접 다루는 전용 spec을 확인하지 못했다.

Playwright admin 테스트는 다음 정도를 확인한다.

- 비로그인 admin UI가 로그인으로 redirect.
- admin 세션에서 admin store 화면 렌더.
- 운영 DB 보호를 위해 archive/restore 같은 mutation은 실제 호출하지 않음.

따라서 UI route redirect를 NestJS admin API role boundary의 직접 증거로 확장하지 않는다.

고위험 admin mutation 예:

- 주문 강제 환불
- settlement 지급 처리
- 사용자/driver 정지·driver 승인
- store commission/archive/restore

판정:

- server admin guard **구현은 존재**한다.
- high-impact mutation의 unauthenticated/non-admin 직접 거부와 side-effect 0은 **`IMPLEMENTED / UNVERIFIED` + P0 `COVERAGE GAP`**으로 둔다.
- 별도 추적 ID: `ADMIN-PRIVILEGED-MUTATION-COVERAGE`.

## 4. Admin settlement 지급 처리

`AdminService.markAsPaid()`는 transaction 안에서 fresh settlement를 다시 읽고:

- missing → 거부
- 이미 `paid` → 거부
- `confirmed` 외 → 거부
- `confirmed` → `paid`
- `paidAt`, `updatedAt` 기록

을 구현한다.

하지만 admin/settlements 전용 service test가 없고 seller settlements Playwright는 UI 날짜·탭 smoke 중심이라 위 금전 상태 전이를 직접 고정하지 않는다.

따라서 **코드 구현을 `VERIFIED`로 승격하지 않는다.** `ADMIN-PRIVILEGED-MUTATION-COVERAGE` 완료 시 최소 다음을 직접 고정한다.

- missing settlement 거부
- `pending|cancelled|paid` 거부
- `confirmed → paid` 정상 성공
- transaction 재조회/race에서 한 번만 수렴
- invalid role/invalid state side effect 0
- 실제 controller guard와 service 조합에서 admin만 mutation 도달

## 5. 문서 전파 원칙

- Auth 기술 계약: `docs/specs/api/auth.md`
- Admin 권한·mutation 계약: `docs/specs/api/admin.md`
- Admin settlement 금전 상태 계약: `docs/specs/api/settlements.md`
- 미완료 Acceptance Criteria: `docs/BACKLOG.md`
- 현재 출시 상태: `docs/memory.md`
- 실행 순서/재개 지점: 활성 PLAN/HANDOFF

Orders의 이미 검증된 API query 계약은 변경하지 않는다. 검증된 항목을 새 finding 때문에 함께 낮추는 것은 정합성 원칙에 맞지 않는다.

## 범위 경계

이번 감사에서 코드, 테스트, Firebase Rules, provider, production, 운영 데이터는 변경하지 않았다.

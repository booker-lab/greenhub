<!-- Language: ko -->

# Auth API / Domain Spec

> **최종 정합화**: 2026-09-05
> **상태**: Current
> **공통 타입 정본**: `packages/shared/src/auth.types.ts`
> **API 정본**: `apps/api/src/auth/**`
> **앱 인증 정본**: `apps/consumer/src/auth.ts`, `apps/seller/src/auth.ts`, `apps/driver/src/auth.ts`
> **Preview OAuth 정책**: `docs/specs/ops/preview-auth-url-policy.md`

## Driver approval gate overlay — S4 initial gate

현재 accepted source `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`에 아래 approval-gate 하위 범위가 반영돼 있다. 이 source는 local publication candidate이며, policy-compliant PR로 remote `main`에 게시되기 전에는 remote `main` 또는 production 출시 상태로 해석하지 않는다.

- 공개 `POST /auth/register`의 driver user는 `driverApproved: false`로 생성되고, client가 `driverApproved: true`를 주입할 수 없다.
- 공개 `POST /auth/register` → `POST /auth/login`에서 승인값이 `false`이거나 누락된 driver는 JWT/refresh side effect 전에 거부된다. 승인된 driver는 정상 로그인하고 consumer/seller/admin 경로는 유지된다.
- Kakao 신규 driver는 자동 승인되지 않고, 기존 승인 필드 누락 driver도 로그인 side effect로 자동 승인되지 않는다.
- API `JwtStrategy`와 Firebase custom-token 경계가 현재 Firestore user의 role, `driverApproved`, `suspended`를 확인하며, stale/suspended/role-mismatch/missing-user/cross-driver 경계가 기존 candidate Rules/API 회귀로 확인됐다.
- 직접 근거: `apps/api/src/auth/auth.controller.spec.ts`, `apps/api/src/auth/auth.service.spec.ts`, `apps/api/src/auth/strategies/jwt.strategy.spec.ts`.

`AUTH-SESSION-CLAIM-REVOCATION`은 여전히 OPEN이다. refresh 시 authoritative user 상태 재조회, suspended/role/store/approval 변경 수렴, access-token revocation window와 session rotation 정책은 이 candidate에서 완료로 주장하지 않는다.

## 1. 인증 계층

Greenhub 인증은 두 계층으로 나뉜다.

| 계층 | 역할 |
|---|---|
| NextAuth.js v5 | 각 Next.js 앱의 Kakao OAuth, 세션, access/refresh token 보관·갱신 |
| NestJS Auth/JWT | Kakao access token 서버 검증, Greenhub JWT 발급·갱신, API 권한·사용자 데이터 |

주문·마이페이지 등 보호 기능은 로그인 사용자만 사용한다.

## 2. 운영 로그인 provider

현재 consumer·seller·driver의 NextAuth 설정은 **Kakao**를 운영 OAuth provider로 사용한다.

```text
consumer → targetRole: consumer
seller   → targetRole: seller
driver   → targetRole: driver
```

NextAuth callback은 Kakao에서 받은 access token을 `POST /auth/kakao-login`으로 넘기고, NestJS API가 Kakao 사용자 정보 API를 통해 실제 계정을 검증한다. 클라이언트가 임의로 전달한 Kakao ID·email·name을 신뢰하지 않는다.

`packages/shared`의 `AuthProvider`에는 과거 호환을 위해 `'naver' | 'email'`이 남아 있지만, **현재 세 앱의 NextAuth 운영 provider 목록에는 Naver가 없다.** Naver 로그인을 현재 지원 기능으로 문서화하지 않는다.

## 3. Credentials의 현재 용도

세 앱의 `Credentials` provider는 일반 사용자용 이메일 로그인 UI를 의미하지 않는다. 현재 자동화/E2E 전용 게이트다.

### Consumer / Seller

- `E2E_TEST_SECRET`이 없으면 credentials 요청을 모두 거부한다.
- request header `x-e2e-test-token`이 secret과 정확히 일치해야 한다.
- 이후 NestJS `POST /auth/login`을 호출한다.
- consumer는 `consumer|admin`, seller는 `seller|admin` 역할만 허용한다.

### Driver

driver credentials는 더 좁게 제한한다.

- `VERCEL_ENV === 'preview'`
- `ROUND_DIRECT_E2E_ENABLED === 'true'`
- `x-round-direct-e2e-secret`이 공유 secret과 timing-safe 비교에서 일치
- email이 `ROUND_DIRECT_E2E_DRIVER_EMAILS` allowlist에 포함
- API 응답 role이 `driver`
- `driverApproved === true`

따라서 이메일/비밀번호 endpoint가 존재한다고 해서 production 일반 로그인 경로로 노출하지 않는다. **다만 frontend가 일반 credentials UI를 노출하지 않는다는 사실은 공개 NestJS `register/login` endpoint 자체의 권한 안전성을 대신하지 않는다.**

## 4. 역할

```ts
type UserRole = 'consumer' | 'seller' | 'driver' | 'admin'
```

NestJS JWT payload의 현재 계약:

```ts
{
  sub: string
  role: 'consumer' | 'seller' | 'driver' | 'admin'
  storeId?: string | null
  iat?: number
  exp?: number
}
```

`storeId`는 seller/admin에서 존재할 수 있고 consumer/driver는 일반적으로 `null` 또는 미설정이다. 단순 역할만으로 모든 store 데이터 접근을 허용하지 않으며 endpoint/service와 Firebase Rules의 소유권·배정 검사를 추가로 적용해야 한다.

## 5. 역할 진입과 Driver 승인

`KakaoLoginDto.targetRole` 허용값:

```text
consumer | seller | driver
```

각 앱은 자신이 의도한 targetRole을 API에 전달하고 callback 응답의 실제 role을 다시 제한한다.

- consumer: `consumer|admin`
- seller: `seller|admin`
- driver: `driver|admin`

공개 `RegisterDto.role`도 현재 다음을 허용한다.

```text
consumer | seller | driver
```

### 의도된 Driver 계약

현재 admin/API/UI 구조에는 별도의 driver 승인 상태가 존재한다.

- `users/{userId}.driverApproved`
- `PATCH /admin/drivers/:userId/approve`
- driver 앱 callback은 실제 role이 `driver`일 때 `driverApproved === true`를 요구한다.

따라서 **관리자 승인 전 driver 권한을 획득할 수 없다는 계약**을 current 안전 계약으로 사용한다. role 승격·driver 승인·스토어 소유권을 OAuth targetRole, 공개 가입 role, 또는 stale token payload만으로 자동 부여하지 않는다.

### Candidate reconciliation — Driver approval P0

2026-08-24 `origin/main` 감사에서 신규/legacy Kakao 자동승인과 공개 email register/login 우회가 확인됐다. candidate에서는 다음 approval-gate 하위 범위를 직접 고정했다.

1. 신규 Kakao `targetRole: driver`는 `driverApproved: false`로 생성된다.
2. 기존 `driverApproved` 누락 driver는 Kakao 로그인 중 자동 승인되지 않는다.
3. 공개 `POST /auth/register`는 driver를 false approval 상태로 만들고 client-supplied approval을 거부한다. 이어지는 공개 `POST /auth/login`은 승인되지 않은 driver의 API JWT/refresh token 발급을 거부한다.

따라서 frontend Credentials UI 비노출에 의존하지 않는 API authorization boundary가 candidate에서 확인됐다. Firebase custom token도 현재 user의 승인·정지·역할 경계를 확인한다. broad driver order read와 refresh/session lifecycle은 별도 P0로 남는다.

추적 umbrella: `docs/BACKLOG.md`의 `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`. 기술 finding 이름으로 `DRIVER-APPROVAL-GATE-BYPASS`를 사용할 수 있으나 별도 완료 항목으로 중복 추적하지 않는다.

Accepted source에서 확인된 조건:

- [x] 공개 registration이 관리자 승인 전 usable driver authorization을 만들지 않음
- [x] email login이 미승인 driver에게 driver JWT/refresh token을 발급하지 않음
- [x] 미승인 driver의 Firebase driver custom claim 발급을 거부함
- [x] 신규 Kakao identity의 `targetRole: driver`가 관리자 승인 없이 `driverApproved: true`를 만들지 않음
- [x] 기존 `driverApproved` 누락 계정을 로그인 시 자동 승인하지 않음
- [x] admin 승인 전 driver API/Firebase/Rules 경계를 거부하는 candidate 회귀
- [x] admin 승인 후 driver 정상 경로 및 consumer/seller/admin role 진입 회귀

여전히 남은 조건:

- [ ] 과거 계정 migration이 필요하면 로그인 side effect가 아닌 명시적·감사 가능한 절차로 분리
- [ ] `AUTH-SESSION-CLAIM-REVOCATION`: refresh 시 authoritative 상태 재조회와 stale claim 재발급 차단
- [ ] suspended/role/store/driver approval 변경의 session revocation SLA와 access-token window 결정
- [ ] logout/refresh-token rotation을 포함한 session lifecycle 직접 회귀
- [ ] accepted source를 policy-compliant PR로 remote `main`에 통합

## 6. Access / Refresh token과 권한 변경 수렴

현재 NextAuth 앱은 API가 발급한 `accessToken`과 `refreshToken`을 NextAuth JWT/session에 저장한다.

- 일반 access token refresh 기준: 앱에서 발급 후 약 55분 시점에 갱신 시도
- refresh endpoint: `POST /auth/refresh`
- 갱신 실패 시 session에 token error를 표시하고 유효 access token을 비운다.
- driver E2E credentials session은 앱 레이어에서 더 짧은 access-token refresh 기준을 사용한다.

실제 서버 JWT 만료값은 환경 설정에 의해 달라질 수 있으므로 오래된 문서의 “항상 1시간/30일”을 외부 환경 현재값으로 단정하지 않는다.

### 현재 구현 한계 — stale authorization claims

현재 `AuthService.refresh()`는 refresh token 자체와 rotation record를 검증한 뒤 **기존 refresh JWT payload의 `sub/role/storeId`를 그대로 새 access/refresh token에 재사용**한다. 사용자 문서의 현재 `suspended`, `role`, `storeId`, driver 승인 상태를 refresh 시 다시 조회하지 않는다.

또한 `JwtStrategy.validate()`와 `RolesGuard`는 현재 JWT payload의 role/storeId를 사용하며 매 요청마다 user 문서의 suspension/권한 변경을 재검증하지 않는다.

따라서 관리자가 계정을 정지하거나 role/store 연결을 바꾼 뒤 기존 세션이 언제 차단되어야 하는지에 대한 **revocation SLA가 current spec에 명확히 정의돼 있지 않고**, 현재 refresh 경로는 stale claims를 계속 재발급할 수 있다.

판정:

- 신규 로그인에서 `suspended === true`를 거부하는 동작은 구현·테스트됨.
- **이미 발급된 세션의 정지/권한 변경 수렴은 `AUTH-SESSION-CLAIM-REVOCATION` OPEN, `DECISION REQUIRED` + P0 authorization remediation 대상**이다.
- 특히 “정지된 계정이 refresh를 통해 계속 새 권한 토큰을 얻을 수 있음”을 정상 계약으로 간주하지 않는다.

Task 2F-A/2F-B의 public approval-gate와 current-user 경계 검증은 이 refresh/session lifecycle finding을 닫지 않는다.

`AUTH-SESSION-CLAIM-REVOCATION` 최소 완료 조건:

- 계정 정지 시 기존 refresh token의 후속 갱신을 거부하는 정책을 정의·구현
- refresh 시 authoritative user 상태를 확인하고 현재 role/storeId/승인 상태와 충돌하는 stale claims를 재발급하지 않음
- role/storeId 변경 시 다음 refresh에서 이전 권한이 유지되지 않음
- access token 이미 발급분의 허용 revocation window를 명시적으로 결정하고 테스트함
- 즉시 차단이 요구되면 token version/session revocation 또는 동등한 서버 검증 경계를 사용
- logout/refresh-token rotation 동작 유지
- suspended/role-changed/store-changed/driver-approval-changed 시나리오 직접 회귀

## 7. 현재 Auth API

### 공개/인증 진입

```text
POST /auth/register
POST /auth/login
POST /auth/kakao-login
POST /auth/refresh
```

`register`, `login`, `kakao-login`, `refresh`에는 인증 brute-force 방어용 별도 throttle이 적용된다.

주의:

- `/auth/login`과 `/auth/register`는 API 기능으로 존재하지만 현재 세 앱의 production 일반 이메일 로그인 provider라는 뜻은 아니다.
- **이 두 endpoint가 공개라는 사실 자체는 현재 보안 경계다. UI 미노출을 authorization control로 취급하지 않는다.**
- 현재 `role: driver` register→login 승인 우회는 P0 implementation finding이다.
- 일반 사용자에게 credentials 인증을 제품 기능으로 노출하려면 별도 제품·보안 결정이 필요하다.

### 인증 사용자

```text
GET    /auth/me
PATCH  /auth/me
POST   /auth/me/addresses
PATCH  /auth/me/addresses/:addressId
DELETE /auth/me/addresses/:addressId
PATCH  /auth/me/addresses/:addressId/default
PATCH  /auth/me/fcm-token
GET    /auth/firebase-token
POST   /auth/logout
```

모두 `JwtAuthGuard`가 적용된다. `firebase-token`은 throttle 예외지만 JWT 인증은 필요하다.

## 8. 사용자 프로필 공통 타입

현재 shared 타입:

```ts
export interface UserProfile {
  id: string
  email: string
  name: string
  phone: string | null
  role: UserRole
  storeId: string | null
  providers: AuthProvider[]
  savedAddresses: SavedAddress[]
  fcmToken: string | null
  createdAt: string
  updatedAt: string
}
```

`providers`에 legacy 값이 존재할 수 있으므로 저장 데이터와 현재 UI provider 지원 범위를 구분한다.

## 9. 배송지

인증 사용자는 API를 통해 저장 배송지를 관리한다.

```ts
interface SavedAddress {
  id: string
  label: string
  address: string
  addressDetail: string
  zipCode: string
  isDefault: boolean
}
```

배송지 추가·수정·삭제·기본값 변경은 자신의 `userId` 범위에서만 처리한다. 운영 Firestore에서 다른 사용자의 주소 배열을 troubleshooting 목적으로 직접 수정하지 않는다.

## 10. Firebase Custom Token

`GET /auth/firebase-token`은 현재 API JWT 사용자에게 Firebase client용 custom token을 발급하는 경로다. 현재 controller는 `CurrentUser()`의 `sub/role/storeId`를 그대로 `AuthService.getFirebaseToken()`에 전달하고, service는 그 값으로 Firebase custom claims를 만든다.

따라서 이 경로의 안전성은 API JWT claims의 현재성에 의존한다. `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`이 해결되기 전에는 **미승인 driver·정지·role/store 변경 이후 Firebase claims가 authoritative user 상태와 일치한다고 가정하지 않는다.**

특히 Firestore Rules가 `role`/`storeId` claims를 데이터 접근의 근거로 사용하므로 auth claim lifecycle과 Rules authorization을 별개의 문제로 분리하지 않는다.

이 endpoint의 존재 때문에 Firebase Rules를 공개 read/write로 완화하지 않는다. Firebase 접근 계약은 현재 Rules와 해당 frontend 사용처를 함께 확인한다.

## 11. FCM 필드 상태

`PATCH /auth/me/fcm-token`과 shared `fcmToken` 필드는 현재 남아 있다. 그러나 현재 notifications API의 실제 외부 발송 구현은 ALIGO/SMS이며 FCM send 구현은 없다.

따라서 FCM token endpoint를 “현재 운영 push 알림이 활성화돼 있다”는 증거로 사용하지 않는다. 실제 FCM 재도입은 별도 Task에서 정의한다.

## 12. OAuth URL 정책

- Production Kakao callback의 canonical URL은 `docs/URLS.md`를 따른다.
- Preview에서는 Kakao 로그인 완료 smoke를 acceptance criterion으로 두지 않는다.
- commit별 Vercel Preview URL을 Kakao Redirect URI에 누적하지 않는다.
- 상세 정책은 `docs/specs/ops/preview-auth-url-policy.md`를 따른다.

실제 Vercel/Kakao 설정 현재값은 변경 작업 직전에 provider에서 재조회한다.

## 13. 보안 원칙

- Kakao identity는 서버에서 access token으로 재검증한다.
- password hash, refresh token, JWT, OAuth token, E2E shared secret을 문서·로그에 기록하지 않는다.
- Credentials provider는 E2E gate를 제거한 채 production 로그인으로 열지 않는다.
- **공개 register/login endpoint는 frontend UI 미노출을 보안 통제로 간주하지 않는다.**
- role/storeId/driver approval은 client targetRole, registration role 또는 stale token payload만으로 최종 결정하지 않는다.
- driver 관리자 승인 게이트를 가입·로그인 side effect로 자동 충족시키지 않는다.
- 계정 정지·role/store 변경이 refresh/custom-token 경로에서 무기한 과거 권한으로 유지되지 않도록 한다.
- 타인 주문·스토어 접근은 endpoint/service와 Firebase Rules의 소유권 검사를 통과해야 한다.
- driver E2E allowlist와 secret을 실제 운영 driver 인증 모델로 사용하지 않는다.
- 실계정 email, 사용자 UUID, 테스트 비밀번호를 troubleshooting 문서에 정본으로 저장하지 않는다.

## 14. 검증 진입점

인증 변경 시 최소 확인:

- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/dto/register.dto.ts`
- `apps/api/src/auth/strategies/jwt.strategy.ts`
- `apps/api/src/auth/types/jwt-payload.type.ts`
- `apps/api/src/common/guards/*`
- `apps/api/src/admin/admin.service.ts`의 approve/suspend 경로
- 세 앱 `src/auth.ts`
- `firestore.rules`, `storage.rules`
- `packages/shared/src/auth.types.ts`
- 관련 auth unit/E2E tests
- OAuth URL 변경이면 `docs/URLS.md`, `docs/specs/ops/preview-auth-url-policy.md`

권한·정지·승인 계약은 `docs/DOCUMENT_CONSISTENCY.md`에 따라 로그인 성공 테스트만으로 `VERIFIED` 처리하지 않는다. 공개 가입, 승인 전/후, suspension, refresh, Firebase custom claims까지 수명주기를 직접 검증한다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-24 | Task 2F-B candidate에서 public driver register/login approval gate, Kakao 자동승인 방지, JWT/current-user 경계를 검증하고 `AUTH-SESSION-CLAIM-REVOCATION`은 OPEN으로 유지 |
| 2026-08-24 | 공개 email `register(role=driver) → login`이 승인 없이 driver JWT를 발급할 수 있는 추가 P0 우회를 반영하고 Kakao/refresh/Firebase claim과 하나의 driver authorization lifecycle로 정합화 |
| 2026-08-24 | 신규/legacy driver 자동 승인 경로를 P0 IMPLEMENTATION FINDING으로 분리하고, 정지·role/store 변경의 refresh/custom-token stale claims를 P0 revocation 결정·remediation으로 명시 |
| 2026-08-23 | Kakao 운영 OAuth, E2E 전용 Credentials, driver approval, refresh/custom-token 현행 계약에 맞춰 전면 정합화 |
| 2026-07-01 | Kakao access token 서버 검증 계약 보강 |
| 2026-03-26 | 초기 auth 설계 초안 |

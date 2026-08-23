<!-- Language: ko -->

# Auth API / Domain Spec

> **최종 정합화**: 2026-08-23
> **상태**: Current — 단, driver 승인 보안은 Issue #37 P0 미해결
> **공통 타입 정본**: `packages/shared/src/auth.types.ts`
> **API 정본**: `apps/api/src/auth/**`
> **앱 인증 정본**: `apps/consumer/src/auth.ts`, `apps/seller/src/auth.ts`, `apps/driver/src/auth.ts`
> **Preview OAuth 정책**: `docs/specs/ops/preview-auth-url-policy.md`

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

`packages/shared`의 `AuthProvider`에는 과거 호환을 위해 `'naver' | 'email'`이 남아 있지만, 현재 세 앱의 NextAuth 운영 provider 목록에는 Naver가 없다.

## 3. Credentials의 현재 용도

세 앱의 `Credentials` provider는 일반 사용자용 이메일 로그인 UI가 아니라 자동화/E2E 전용 게이트다.

### Consumer / Seller

- `E2E_TEST_SECRET`이 없으면 credentials 요청을 거부한다.
- `x-e2e-test-token`이 secret과 정확히 일치해야 한다.
- 이후 NestJS `POST /auth/login`을 호출한다.
- consumer는 `consumer|admin`, seller는 `seller|admin` 역할만 허용한다.

### Driver

Driver credentials는 더 좁게 제한한다.

- `VERCEL_ENV === 'preview'`
- `ROUND_DIRECT_E2E_ENABLED === 'true'`
- `x-round-direct-e2e-secret`이 공유 secret과 timing-safe 비교에서 일치
- email이 `ROUND_DIRECT_E2E_DRIVER_EMAILS` allowlist에 포함
- API 응답 role이 `driver`
- 앱 레이어에서 `driverApproved === true` 요구

이 E2E gate는 실제 운영 driver 승인 모델의 보안 근거가 아니다.

## 4. 역할과 JWT

```ts
type UserRole = 'consumer' | 'seller' | 'driver' | 'admin'
```

현재 JWT payload:

```ts
{
  sub: string
  role: 'consumer' | 'seller' | 'driver' | 'admin'
  storeId?: string | null
  iat?: number
  exp?: number
}
```

현재 payload에는 `driverApproved`가 포함되지 않는다. role/storeId만으로 모든 데이터 접근을 허용해서는 안 되며, 특히 driver는 최신 사용자 승인·정지 상태를 서버에서 재검증하는 것이 목표 계약이다.

## 5. Kakao 역할 진입과 F-001 현재 상태

`KakaoLoginDto.targetRole` 허용값:

```text
consumer | seller | driver
```

각 앱은 자신이 의도한 targetRole을 전달하고 callback 응답 role을 제한한다.

- consumer: `consumer|admin`
- seller: `seller|admin`
- driver: `driver|admin`

### 현재 `main` 구현

2026-08-23 재검증 기준 `AuthService.kakaoLogin()`은 driver 승인에 대해 다음처럼 동작한다.

- 기존 `role == driver` 사용자에 `driverApproved`가 없으면 로그인 시 `true`로 업데이트한다.
- 신규 Kakao driver는 처음부터 `driverApproved: true`로 생성한다.
- `suspended === true`는 Kakao 로그인 시 거부한다.
- `driverApproved === false` 자체를 API 로그인 단계에서 거부하지 않는다.

따라서 “관리자 승인 전 driver 앱/API 접근 차단”은 현재 `main`의 강제된 서버 계약이 아니다.

### 목표 보안 계약 — Issue #37

출시 전 다음 상태로 remediation해야 한다.

- 신규 driver 기본 `driverApproved: false`
- 미승인/정지 driver의 API 요청을 최신 사용자 문서 기준으로 거부
- JWT/refresh/custom-token에서 stale 승인 상태가 잔존하지 않도록 재검증
- driver 승인 변경 후 세션·refresh token 무효화 범위를 검증

Issue #37 완료 전 현재 문서의 목표 계약을 “이미 구현 완료”로 읽지 않는다.

## 6. Access / Refresh token

현재 NextAuth 앱은 API가 발급한 `accessToken`과 `refreshToken`을 NextAuth JWT/session에 저장한다.

- 일반 access token은 앱에서 발급 후 약 55분 시점에 갱신 시도
- refresh endpoint: `POST /auth/refresh`
- 갱신 실패 시 session에 token error를 표시하고 유효 access token을 비운다.

서버 JWT 만료값은 환경 설정에 따라 달라질 수 있다.

현재 `AuthService.refresh()`는 refresh token signature와 Firestore의 최신 저장 token 일치를 검증하지만, Issue #37 완료 전에는 refresh 시 최신 driver 승인·정지 상태를 재검증하는 계약이 완전하다고 가정하지 않는다.

## 7. 현재 Auth API

### 공개/인증 진입

```text
POST /auth/register
POST /auth/login
POST /auth/kakao-login
POST /auth/refresh
```

`register`, `login`, `kakao-login`, `refresh`에는 인증 brute-force 방어용 throttle이 적용된다.

`/auth/login`과 `/auth/register`가 존재하더라도 현재 세 앱의 production 일반 이메일 로그인 provider라는 뜻은 아니다.

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

모두 `JwtAuthGuard`가 적용된다.

## 8. 사용자 프로필과 배송지

현재 shared `UserProfile`의 핵심 필드:

```ts
{
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

배송지는 자신의 `userId` 범위에서 API로 추가·수정·삭제·기본값 변경한다. 운영 Firestore에서 타인의 주소 배열을 troubleshooting 목적으로 직접 수정하지 않는다.

## 9. Firebase Custom Token과 현재 F-001 경계

`GET /auth/firebase-token`은 API JWT 사용자에게 Firebase client custom token을 발급한다.

현재 `AuthService.getFirebaseToken()`은 전달받은 `userId`, `role`, `storeId`를 기반으로 custom token을 만들며 현재 사용자 문서의 `driverApproved`/`suspended`를 별도 재확인하거나 claim에 넣지 않는다.

동시에 현재 Firestore Rules의 `orders` read는 `request.auth.token.role == 'driver'`이면 전체 주문을 허용한다.

따라서 Issue #37에서는 custom token 발급과 Rules 모두 최신 driver 승인·정지 상태를 재확인하도록 함께 remediation해야 한다. Firebase Rules를 공개 read/write로 완화하지 않는다.

## 10. FCM 필드 상태

`PATCH /auth/me/fcm-token`과 shared `fcmToken` 필드는 남아 있지만 현재 notifications 외부 발송 구현은 ALIGO/SMS이며 FCM send 구현은 없다.

## 11. OAuth URL 정책

- Production Kakao callback canonical URL은 `docs/URLS.md`를 따른다.
- Preview에서는 Kakao 로그인 완료 smoke를 acceptance criterion으로 두지 않는다.
- commit별 Vercel Preview URL을 Kakao Redirect URI에 누적하지 않는다.
- 상세 정책은 `docs/specs/ops/preview-auth-url-policy.md`를 따른다.

## 12. 보안 원칙

- Kakao identity는 서버에서 access token으로 재검증한다.
- password hash, refresh token, JWT, OAuth token, E2E shared secret을 문서·로그에 기록하지 않는다.
- Credentials provider를 E2E gate 없이 production 로그인으로 열지 않는다.
- role/storeId는 client 입력만으로 신뢰하지 않는다.
- driver E2E allowlist와 secret을 운영 driver 승인 모델로 사용하지 않는다.
- 미승인/정지 driver는 최종적으로 API와 Firebase 모두에서 최신 상태 기준으로 거부돼야 한다. 현재 이 항목은 Issue #37 P0다.

## 13. 검증 진입점

인증/driver 승인 변경 시 최소 확인:

- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/types/jwt-payload.type.ts`
- `apps/api/src/common/guards/*`
- `apps/api/src/driver/**`
- 세 앱 `src/auth.ts`
- `packages/shared/src/auth.types.ts`
- `firestore.rules`
- 관련 API unit/integration/E2E와 Rules emulator tests

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-23 | current main 재검증에서 F-001 driver 자동승인·stale Firebase 경계를 확인하고 목표 보안 계약과 현재 구현을 분리 |
| 2026-08-23 | Kakao 운영 OAuth, E2E Credentials, refresh/custom-token 계약 정합화 |
| 2026-07-01 | Kakao access token 서버 검증 계약 보강 |
| 2026-03-26 | 초기 auth 설계 초안 |
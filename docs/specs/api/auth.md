<!-- Language: ko -->

# Auth API / Domain Spec

> **최종 정합화**: 2026-08-23
> **상태**: Current
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

따라서 이메일/비밀번호 endpoint가 존재한다고 해서 production 일반 로그인 경로로 노출하지 않는다.

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

`storeId`는 seller/admin에서 존재할 수 있고 consumer/driver는 일반적으로 `null` 또는 미설정이다. 단순 역할만으로 모든 store 데이터 접근을 허용하지 않으며 endpoint/service의 소유권 검사를 추가로 적용한다.

## 5. Kakao 역할 진입

`KakaoLoginDto.targetRole` 허용값:

```text
consumer | seller | driver
```

각 앱은 자신이 의도한 targetRole을 API에 전달하고 callback 응답의 실제 role을 다시 제한한다.

- consumer: `consumer|admin`
- seller: `seller|admin`
- driver: `driver|admin`

Driver는 실제 role이 `driver`이면 `driverApproved`가 필요하며, 승인 전에는 정상 driver 앱 진입을 허용하지 않는다.

역할 승격·스토어 소유권을 단순 OAuth 로그인만으로 자동 부여한다고 가정하지 않는다.

## 6. Access / Refresh token

현재 NextAuth 앱은 API가 발급한 `accessToken`과 `refreshToken`을 NextAuth JWT/session에 저장한다.

- 일반 access token refresh 기준: 앱에서 발급 후 약 55분 시점에 갱신 시도
- refresh endpoint: `POST /auth/refresh`
- 갱신 실패 시 session에 token error를 표시하고 유효 access token을 비운다.
- driver E2E credentials session은 앱 레이어에서 더 짧은 access-token refresh 기준을 사용한다.

실제 서버 JWT 만료값은 환경 설정에 의해 달라질 수 있으므로 오래된 문서의 “항상 1시간/30일”을 외부 환경 현재값으로 단정하지 않는다.

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
- 일반 사용자에게 credentials 인증을 노출하려면 별도 제품·보안 결정이 필요하다.

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

`GET /auth/firebase-token`은 현재 API JWT 사용자에게 Firebase client용 custom token을 발급하는 경로다. 이 token은 Firestore/Storage Rules에서 서버가 부여한 identity/claims와 함께 사용될 수 있다.

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
- role/storeId는 client 입력만으로 신뢰하지 않는다.
- 타인 주문·스토어 접근은 endpoint별 service ownership 검사를 통과해야 한다.
- driver E2E allowlist와 secret을 실제 운영 driver 인증 모델로 사용하지 않는다.
- 실계정 email, 사용자 UUID, 테스트 비밀번호를 troubleshooting 문서에 정본으로 저장하지 않는다.

## 14. 검증 진입점

인증 변경 시 최소 확인:

- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/types/jwt-payload.type.ts`
- `apps/api/src/common/guards/*`
- 세 앱 `src/auth.ts`
- `packages/shared/src/auth.types.ts`
- 관련 auth unit/E2E tests
- OAuth URL 변경이면 `docs/URLS.md`, `docs/specs/ops/preview-auth-url-policy.md`

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-23 | Kakao 운영 OAuth, E2E 전용 Credentials, driver approval, refresh/custom-token 현행 계약에 맞춰 전면 정합화 |
| 2026-07-01 | Kakao access token 서버 검증 계약 보강 |
| 2026-03-26 | 초기 auth 설계 초안 |

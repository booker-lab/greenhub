<!-- Language: ko -->

# Auth API / Domain Spec

> **최종 정합화**: 2026-10-10
> **상태**: Current
> **공통 타입 정본**: `packages/shared/src/auth.types.ts`
> **API 정본**: `apps/api/src/auth/**`
> **앱 인증 정본**: `apps/consumer/src/auth.ts`, `apps/seller/src/auth.ts`, `apps/driver/src/auth.ts`
> **Preview OAuth 정책**: `docs/specs/ops/preview-auth-url-policy.md`

## Driver approval gate overlay — S4 initial gate

아래 approval-gate 하위 범위는 `main`에 반영돼 있다(최초 accepted source `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`).

- 공개 `POST /auth/register`의 driver user는 `driverApproved: false`로 생성되고, client가 `driverApproved: true`를 주입할 수 없다.
- 공개 `POST /auth/register` → `POST /auth/login`에서 승인값이 `false`이거나 누락된 driver는 JWT/refresh side effect 전에 거부된다. 승인된 driver는 정상 로그인하고 consumer/seller/admin 경로는 유지된다.
- Kakao 신규 driver는 자동 승인되지 않고, 기존 승인 필드 누락 driver도 로그인 side effect로 자동 승인되지 않는다.
- API `JwtStrategy`와 Firebase custom-token 경계가 현재 Firestore user의 role, `driverApproved`, `suspended`를 확인하며, stale/suspended/role-mismatch/missing-user/cross-driver 경계가 기존 candidate Rules/API 회귀로 확인됐다.
- 직접 근거: `apps/api/src/auth/auth.controller.spec.ts`, `apps/api/src/auth/auth.service.spec.ts`, `apps/api/src/auth/strategies/jwt.strategy.spec.ts`.

`AUTH-SESSION-CLAIM-REVOCATION`의 static/refresh 경계는 `IMPLEMENTED / PROVEN`이다. `AuthService.refresh()`는 rotation record 검증 뒤 authoritative user를 재조회해 `suspended`/`role`/`storeId`/`driverApproved` 불일치를 token/session write 없이 거부하고, `GET /auth/session`과 세 앱 `jwt` callback이 same-deployment session authority를 재검증한다. 직접 근거: `apps/api/src/auth/auth.service.spec.ts`의 `refresh current authority`, `getSession same-deployment authority`. revocation window는 2026-09-28 결정(D2)으로 **즉시(다음 요청)**로 확정했고, 2026-10-23 결정으로 API 데이터 요청은 즉시, 세 앱 Auth.js 세션은 최대 60초(같은 access token의 검증 성공 재사용, #627)로 나눴다(§6). Preview 브라우저 증거는 원격 회차 E2E run `36341189483`의 `auth-session-lifecycle.spec.ts` 12건이다(2026-10-10 변경 이전 source 기준, API 거절 즉시 끊김 시험은 다음 회차 E2E에서 확인). 로그아웃 시 서버 refresh token 폐기는 세 앱 Auth.js `events.signOut`에서 수행한다(§6).

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

`KAKAO_APP_ID`가 설정돼 있으면 API는 `/v1/user/access_token_info`의 `app_id`가 이 값과 같은지, 토큰 정보의 사용자 id가 사용자 정보와 같은지 확인하고, 다르거나 `app_id`가 없거나 조회가 실패하면 401로 거부한다. `KAKAO_APP_ID`가 없으면 `app_id` 비교 없이 로그인하며, 운영 runtime에서는 경고 로그만 한 번 남긴다(`apps/api/src/auth/kakao.client.ts`, `kakao.client.spec.ts` `토큰 발급 앱·사용자 확인`). Kakao API 호출에는 시간 상한이 있고, 넘기면 인증 실패로 끝난다.

`packages/shared`의 `AuthProvider`에는 과거 호환을 위해 `'naver' | 'email'`이 남아 있지만, **현재 세 앱의 NextAuth 운영 provider 목록에는 Naver가 없다.** Naver 로그인을 현재 지원 기능으로 문서화하지 않는다.

## 3. Credentials의 현재 용도

`Credentials` provider는 일반 사용자용 production 이메일 로그인 UI가 아니다. 앱별로 허용된 진입이 다르다.

세 앱 모두 테스트 전용 Credentials provider 자체를 운영 runtime에 등록하지 않는다(`packages/shared/src/auth-runtime.ts`의 `isTestCredentialsProviderEnabled`를 각 앱 `auth.ts`가 `process.env`로 부른다). `VERCEL_ENV` 또는 `RAILWAY_ENVIRONMENT_NAME`이 `production`이면 등록하지 않고, `VERCEL_ENV === 'preview'`(로컬 E2E 실행기 포함)이면 등록하며, 그 밖에는 `NODE_ENV !== 'production'`일 때만 등록한다. 등록돼도 아래 앱별 authorize 게이트를 그대로 통과해야 한다. 직접 근거: `packages/shared/src/auth-runtime.test.ts`(등록 조건), `apps/consumer/src/auth.contract.test.mjs`, `apps/seller/src/auth.contract.test.ts`, `apps/driver/src/auth.contract.test.ts`(게이트 연결).

### Consumer — E2E/test 전용

Consumer는 E2E-only Credentials다. `apps/consumer/src/auth.ts`에 Seller/Driver와 같은 `GREENHUB_LOCAL_RUNTIME` local credentials branch가 없다.

- `E2E_TEST_SECRET`이 없으면 credentials 요청을 모두 거부한다.
- request header `x-e2e-test-token`이 secret과 정확히 일치해야 한다.
- 이후 NestJS `POST /auth/login`을 호출한다.
- consumer는 `consumer|admin` 역할만 허용한다.
- Login UI(`apps/consumer/src/app/login/page.tsx`)는 `E2E_TEST === 'true'`일 때만 Credentials form을 노출한다.

### Seller — E2E/test + 명시적 non-production local-runtime

E2E/test 경로는 `E2E_TEST_SECRET` + `x-e2e-test-token` 헤더 게이트를 사용한 뒤 NestJS `POST /auth/login`을 호출하고 `seller|admin` 역할만 허용한다.

명시적 local-runtime admission(`isLocalCredentialRuntime`, `apps/seller/src/auth.ts`)은 다음을 모두 만족할 때만 E2E header gate를 생략한다.

- `GREENHUB_LOCAL_RUNTIME === 'true'`
- AND `NODE_ENV !== 'production'`
- AND `VERCEL_ENV !== 'production'`
- AND `RAILWAY_ENVIRONMENT_NAME !== 'production'`
- AND API base URL이 loopback(`localhost`·`127.0.0.1`·`[::1]`)

production indicator가 하나라도 존재하거나 API가 loopback이 아니면 fail-closed되어 기존 E2E header gate로 복귀한다.

local path는 인증을 bypass하지 않는다.

- 실제 `POST /auth/login`을 사용한다.
- 응답 role이 `seller|admin`인지 검증한다.
- `id`/`accessToken`/`refreshToken` 계약을 유지한다(`storeId` 포함).
- API binding 실패 시 인증 실패(`upstream-rejected` / `api-binding-failure`)한다.

Login UI(`apps/seller/src/app/login/page.tsx`)는 `E2E_TEST === 'true'` OR (`GREENHUB_LOCAL_RUNTIME === 'true'` AND `NODE_ENV !== 'production'`)일 때만 Credentials form을 노출한다. UI 노출 자체는 authorization control이 아니다.

### Driver — Preview/E2E + 명시적 non-production local-runtime

driver credentials는 Preview/E2E 경로와 local-runtime 경로가 분리돼 있다. 두 경로를 혼합하지 않는다.

Preview/E2E 경로는 더 좁게 제한한다.

- `VERCEL_ENV === 'preview'`
- `ROUND_DIRECT_E2E_ENABLED === 'true'`
- `x-round-direct-e2e-secret`이 공유 secret과 timing-safe 비교에서 일치
- email이 `ROUND_DIRECT_E2E_DRIVER_EMAILS` allowlist에 포함
- 실제 `POST /auth/login`을 사용하고 API 응답 role이 `driver`
- `driverApproved === true`

명시적 local-runtime admission(`isLocalCredentialRuntime`, `apps/driver/src/auth.ts`)은 Seller와 동일한 production fail-closed 조건을 사용한다.

- `GREENHUB_LOCAL_RUNTIME === 'true'`
- AND `NODE_ENV !== 'production'`
- AND `VERCEL_ENV !== 'production'`
- AND `RAILWAY_ENVIRONMENT_NAME !== 'production'`
- AND API base URL이 loopback(`localhost`·`127.0.0.1`·`[::1]`)

local path에서는 Preview/E2E gate(secret·allowlist)를 사용하지 않지만, 다음을 반드시 만족해야 한다.

- 실제 `POST /auth/login` 사용
- `role === 'driver'`
- `driverApproved === true`

즉 local-runtime은 Driver approval authorization을 우회하지 않는다.

Login UI(`apps/driver/src/app/login/page.tsx`)는 `GREENHUB_LOCAL_RUNTIME === 'true'` AND `NODE_ENV !== 'production'`일 때만 local Credentials form을 노출한다. 운영/Preview에서는 Kakao 로그인만 사용한다. UI 노출 자체는 authorization control이 아니다.

### Seller/Driver local Firebase · API binding safety

Seller/Driver local-runtime은 단순 UI flag가 아니라 로컬 runtime binding safety와 함께 사용된다. 아래는 현재 구현이 보장하는 범위다(`apps/seller/src/lib/firebase.ts`, `apps/driver/src/lib/firebase.ts`, `apps/seller/src/lib/api-base-url.ts`, `apps/driver/src/lib/api-base-url.ts`, 검사 규칙은 `packages/shared/src/api-base-url.ts`).

Firebase:

- local marker(`NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME === 'true'`)가 없으면 emulator binding을 거부한다. emulator host가 설정돼 있으면 throw하고 local이 아닌 경우 `false`를 반환한다.
- local runtime은 `NODE_ENV === 'development'`를 요구하고, `NODE_ENV`/`NEXT_PUBLIC_VERCEL_ENV`/`NEXT_PUBLIC_RAILWAY_ENVIRONMENT_NAME` 중 어느 하나라도 `production`이면 거부한다.
- local runtime에서 production identity를 거부한다. project `green-e4fe3`, storage bucket `green-e4fe3.appspot.com`·`green-e4fe3.firebasestorage.app`, auth domain `green-e4fe3.firebaseapp.com`이면 throw한다.
- local project identity만 허용한다. project `greenhub-local`, storage bucket `greenhub-local.appspot.com`이 아니면 throw한다.
- 허용된 emulator host만 허용한다. auth `127.0.0.1:9099`, firestore `127.0.0.1:8080`, storage `127.0.0.1:9199` 또는 미설정 외의 값이면 throw한다.
- public/production credential 오사용을 거부한다. `NEXT_PUBLIC_GOOGLE_APPLICATION_CREDENTIALS`·`NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_JSON`·`NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_PATH`가 설정돼 있으면 항상 throw한다.

API:

- production runtime에서 loopback API URL(`localhost`·`127.0.0.1`·`[::1]`)을 거부한다.
- production에서 `NEXT_PUBLIC_API_URL` 미설정, 비HTTP(S)·userinfo 포함, query/fragment 포함 URL도 거부한다.
- `localhost`라는 사실만으로 local auth가 자동으로 열리지 않는다. 명시적 local marker + non-production 조건 + 실제 API role/approval 검증을 모두 만족해야 한다.

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
- driver: `driver` (2026-10-04 사용자 결정)

기사 앱은 기사(driver) 역할만 받는다(2026-10-04 결정). 기사 API(`@Roles('driver')`)와 주문 권한 검사가 승인된 driver만 허용해 관리자는 기사 앱에 들어와도 쓸 수 있는 기능이 없었으므로, 진입 자체를 막는다.

- API `kakaoLogin`은 `targetRole: driver`에서 `driver`만 허용한다. 관리자 계정은 JWT/refresh 발급 전에 403으로 거절하고, 기사 앱이 일반 거절과 구분하도록 응답에 `code: KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT`를 붙인다. `targetRole: consumer|seller`의 관리자 허용은 그대로다.
- 기사 앱 카카오 `signIn` 콜백은 위 거절(또는 응답 role `admin`)을 세션 없이 `/login?error=AdminAccount` 안내("관리자 계정은 기사 앱을 쓸 수 없습니다 · 기사 계정으로 로그인해 주세요")로 보낸다. Credentials(Preview E2E·local runtime) `authorize`는 원래 `driver`만 허용한다.
- 이미 발급된 비driver 세션(이전에 허용되던 관리자 세션 등)은 기사 앱 `jwt` callback이 갱신 전에 `null`로 끝내고(쿠키 삭제), `GET /auth/session` 재검증의 앱 허용 role도 `driver`뿐이다. proxy도 `driver`가 아닌 세션을 기사 화면에 들이지 않는다(관리자면 `AdminAccount` 안내).
- 직접 근거: `apps/api/src/auth/auth.service.spec.ts`(기사 앱 관리자 거절·consumer/seller 앱 관리자 유지), `apps/driver/src/driver-dead-ends.test.mjs`(기사 앱 허용 역할 계약).

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

2026-08-24 `origin/main` 감사에서 신규/legacy Kakao 자동승인과 공개 email register/login 우회가 확인됐다. 다음 approval-gate 하위 범위를 직접 고정했고 현재 `main`에 반영돼 있다.

1. 신규 Kakao `targetRole: driver`는 `driverApproved: false`로 생성된다.
2. 기존 `driverApproved` 누락 driver는 Kakao 로그인 중 자동 승인되지 않는다.
3. 공개 `POST /auth/register`는 driver를 false approval 상태로 만들고 client-supplied approval을 거부한다. 이어지는 공개 `POST /auth/login`은 승인되지 않은 driver의 API JWT/refresh token 발급을 거부한다.

따라서 frontend Credentials UI 비노출에 의존하지 않는 API authorization boundary가 확인됐다. Firebase custom token도 현재 user의 승인·정지·역할 경계를 확인한다. refresh/session lifecycle은 §6에서 닫혔고, broad driver order read는 `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`에서 다룬다.

추적 umbrella: `docs/BACKLOG.md`의 `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`. 기술 finding 이름으로 `DRIVER-APPROVAL-GATE-BYPASS`를 사용할 수 있으나 별도 완료 항목으로 중복 추적하지 않는다.

확인된 조건(`main` 반영):

- [x] 공개 registration이 관리자 승인 전 usable driver authorization을 만들지 않음
- [x] email login이 미승인 driver에게 driver JWT/refresh token을 발급하지 않음
- [x] 미승인 driver의 Firebase driver custom claim 발급을 거부함
- [x] 신규 Kakao identity의 `targetRole: driver`가 관리자 승인 없이 `driverApproved: true`를 만들지 않음
- [x] 기존 `driverApproved` 누락 계정을 로그인 시 자동 승인하지 않음
- [x] admin 승인 전 driver API/Firebase/Rules 경계를 거부하는 candidate 회귀
- [x] admin 승인 후 driver 정상 경로 및 consumer/seller/admin role 진입 회귀

여전히 남은 조건:

- [ ] 과거 계정 migration이 필요하면 로그인 side effect가 아닌 명시적·감사 가능한 절차로 분리 — 로그인 자동 승인은 없고, 승인값이 없는 driver는 관리자 승인 대기 목록에 나타나 `PATCH /admin/drivers/:userId/approve`로만 승인된다(`apps/api/src/admin/admin.service.ts`). 다만 승인 처리는 감사 기록(`audit.log`)을 남기지 않으므로 이를 "감사 가능한 절차"로 볼지는 결정이 필요하다.
- [x] `AUTH-SESSION-CLAIM-REVOCATION`: refresh 시 authoritative 상태 재조회와 stale claim 재발급 차단(§6)
- [x] suspended/role/store/driver approval 변경의 session revocation SLA와 access-token window 결정(2026-09-28 D2, 즉시)
- [x] logout/refresh-token rotation을 포함한 session lifecycle 직접 회귀(`apps/api/src/auth/auth.service.spec.ts`)
- [x] `main` 통합

## 6. Access / Refresh token과 권한 변경 수렴

현재 NextAuth 앱은 API가 발급한 `accessToken`과 `refreshToken`을 NextAuth JWT/session에 저장한다.

- 일반 access token refresh 기준: 앱에서 발급 후 약 55분 시점에 갱신 시도
- refresh endpoint: `POST /auth/refresh`
- 갱신 실패 시 session에 token error를 표시하고 유효 access token을 비운다.
- driver Credentials session은 E2E 경로와 local-runtime 경로 모두 `credentials` provider를 경유하므로 앱 레이어에서 더 짧은 access-token refresh 기준(15분, `E2E_ACCESS_TOKEN_TTL`)을 사용한다. 일반 Kakao session 기준(약 55분, `ACCESS_TOKEN_TTL`)과 구분된다. TTL 값을 새로 결정하지 않으며 `apps/driver/src/auth.ts`의 분기를 그대로 기술한다.
- 세 앱 Auth.js 서버 쪽의 로그인·세션 확인·갱신 API 호출은 10초(`AUTH_UPSTREAM_TIMEOUT_MS`), 로그아웃 시 API 세션 폐기 전체는 5초(`AUTH_LOGOUT_TIMEOUT_MS`) 시간 제한을 쓴다(`packages/shared/src/auth-runtime.ts`). 시간 제한 초과는 각 호출자의 기존 일시 실패 경로로 처리한다.

실제 서버 JWT 만료값은 환경 설정에 의해 달라질 수 있으므로 오래된 문서의 “항상 1시간/30일”을 외부 환경 현재값으로 단정하지 않는다.

API가 발급하는 access/refresh token에는 `typ`(`access`/`refresh`)와 `aud`(`greenhub-api`)가 들어가고 HS256으로 서명한다. `JwtStrategy`와 `AuthService.refresh()`는 HS256만 받고, `typ`·`aud`가 있으면 기대값과 같아야 한다(refresh token을 Bearer로 쓰거나 access token을 refresh로 쓰면 401). 이 claim이 없는 이전 발급 token은 만료까지 계속 받는다(`apps/api/src/auth/auth.token-boundary.spec.ts`, `auth.service.spec.ts` `토큰 종류·수신자 claim`). refresh token 저장 형식(평문 단일 문서)은 바뀌지 않았다.

refresh token은 기기(로그인)별 세션으로 저장되고 세션마다 회전한다(2026-10-15 결정, #526). 로그인(email·Kakao)마다 새 세션 ID(`sid`, access·refresh token payload에 실음)를 만들고 `refreshTokens/{sub}.sessions[sid]`와 `users/{sub}.activeSessionIds`를 한 트랜잭션에서 함께 기록한다. 사용자당 세션은 최대 10개(`REFRESH_SESSION_MAX_COUNT`)이며, 넘치면 가장 오래 쓰이지 않은 세션(생성·회전 시각 중 늦은 쪽 기준)부터 지우고 `auth.session.evicted`를 서버 로그에 남긴다. 다른 기기의 로그인은 기존 세션을 건드리지 않는다. `POST /auth/refresh`는 token의 `sid` 세션에 저장된 최신 token이면 새 token으로 회전하면서 그 세션에 직전 token과 회전 시각을 함께 저장한다. 같은 세션의 동시 갱신·쿠키 반영 전 재요청으로 직전 token이 회전 후 60초(`REFRESH_ROTATION_GRACE_MS`) 안에 다시 오면 재회전 없이 현재 refresh token과 새 access token을 준다. 그 세션의 그 밖의 token은 재사용(탈취)으로 보고 **그 사용자의 모든 세션**을 끊는다: `refreshTokens/{sub}` 삭제, `activeSessionIds` 비움, `sessionsRevokedAt` 기록, Firebase refresh token 폐기, `auth.token.stolen`(`sessionId` 포함) 기록 뒤 401로 거부한다. `sid`가 없는 token(#526 이전 발급)이나 이미 없어진 세션(로그아웃·축출)의 token은 audit 없이 401(`만료된 리프레시 토큰`)로 거부해 다시 로그인하게 한다. 유예 안이어도 현재 권한 재조회를 통과해야 한다. 직접 근거: `apps/api/src/auth/auth.per-device-sessions.spec.ts`, `apps/api/src/auth/auth.service.spec.ts` `refresh current authority`.

### 현재 구현 한계 — stale authorization claims

~~현재 `AuthService.refresh()`는 refresh token 자체와 rotation record를 검증한 뒤 **기존 refresh JWT payload의 `sub/role/storeId`를 그대로 새 access/refresh token에 재사용**한다. 사용자 문서의 현재 `suspended`, `role`, `storeId`, driver 승인 상태를 refresh 시 다시 조회하지 않는다.~~

~~또한 `JwtStrategy.validate()`와 `RolesGuard`는 현재 JWT payload의 role/storeId를 사용하며 매 요청마다 user 문서의 suspension/권한 변경을 재검증하지 않는다.~~

위 두 문단은 과거 상태 기술이다. 현재 source에서는 `AuthService.refresh()`가
rotation record 검증 뒤 authoritative user를 재조회하고 payload `role/storeId`와
비교하여 stale claims 재발급을 거부하며(`apps/api/src/auth/auth.service.spec.ts`
`refresh current authority`), `JwtStrategy.validate()`도 매 요청마다 현재 user
문서의 `suspended/role/storeId/driverApproved`를 재검증한다
(`apps/api/src/auth/strategies/jwt.strategy.spec.ts`).

관리자가 계정을 정지하거나 role/store 연결·기사 승인을 바꾼 뒤 기존 세션의 **revocation window는 API 데이터 요청은 즉시(다음 요청), 세 앱의 Auth.js 세션은 최대 60초**다(2026-09-28 결정 D2를 2026-10-23 사용자 결정으로 조정, #627). 이미 발급된 API access token도 `JwtStrategy.validate()`가 요청마다 authoritative user를 재조회해 `suspended`·role 불일치·`driverApproved` 철회를 403으로 거부하고(`apps/api/src/auth/strategies/jwt.strategy.spec.ts`), Firestore Rules는 `get(users/{uid})`로 `suspended`·role·storeId를 실시간 확인한다. 다만 refresh 경로는 더 이상 stale claims를 재발급하지 않는다: `AuthService.refresh()`가 authoritative user를 재조회해 불일치를 거부하고(`refresh current authority`), `GET /auth/session`이 `JwtAuthGuard` 재검증 + authoritative user 재조회 + access token `sid` 세션 존재 검사로 same-deployment session authority를 확인하며(`getSession same-deployment authority`), 세 앱 `jwt` callback이 이를 확인한다. 같은 access token의 검증 성공은 60초(`SESSION_AUTHORITY_REUSE_MS`, `packages/shared/src/session-authority.ts`) 동안 재사용한다. 그래서 정지·철회 뒤 앱 세션은 화면의 API 요청이 거절(401/403)되면 그 자리에서 다시 검증해 끊기고(2026-10-24 보강, 아래 48A), API 요청이 없으면 그 구간이 끝난 다음 호출에서 끊긴다. 그동안 화면 틀은 보일 수 있지만 데이터 요청은 `JwtStrategy`가 즉시 거부한다.

판정:

- 신규 로그인에서 `suspended === true`를 거부하는 동작은 구현·테스트됨.
- refresh/session 경계의 stale-claim 재발급 차단과 `suspended`/`role`/`store`/`driverApproved` 변경 수렴은 `IMPLEMENTED / PROVEN`이다.
- revocation window는 즉시(다음 요청)로 결정됐고(D2), runtime/browser session lifecycle은 Preview에서 `RUNTIME_PROVEN`이다(run `36341189483`, 12건, 2026-10-10 로그아웃·token 변경 이전 source 기준).
- `POST /auth/logout`은 access token의 `sid` 세션 하나만 끊는다: `refreshTokens/{sub}.sessions[sid]`와 `activeSessionIds`의 그 `sid`를 지우고 `auth.logout`(`sessionId` 포함)을 기록한다. Firebase refresh token 폐기는 사용자 단위라 다른 기기까지 끊으므로 이때는 하지 않으며, `sessionsRevokedAt`도 기록하지 않는다. `sid`가 없는 access token(#526 이전 발급)의 로그아웃은 모든 세션을 끊는다(`refreshTokens/{sub}` 삭제, `activeSessionIds` 비움, `sessionsRevokedAt` 기록, Firebase 폐기, audit `scope: all`). 재사용 감지도 모든 세션을 끊는 같은 처리를 한다. Firebase 사용자 기록이 없으면(custom token 미사용) 폐기할 것이 없으므로 그대로 진행하고, 그 밖의 폐기 실패는 API 세션 폐기를 되돌리지 않고 서버 로그에만 남긴다. 이미 발급된 Firebase ID token은 만료(최대 1시간)까지 남는다.
- 모든 세션을 끊는 경로(`sid` 없는 로그아웃·재사용 감지)와 관리자 정지(`PATCH /admin/users/:userId/status`, `PATCH /admin/drivers/:userId/suspend`에서 `suspended: true`)는 `users/{uid}.sessionsRevokedAt`(Timestamp, 초 단위로 내린 시각)을 기록한다. `JwtStrategy`는 access token의 `iat * 1000`이 이 시각보다 이전이면 만료 전이어도 401로 거부한다(`iat` 없는 토큰·형식을 알 수 없는 기록도 거부). 같은 초에 새로 로그인해 받은 토큰은 통과한다. 또 `JwtStrategy`는 access token에 `sid`가 있으면 그 값이 `users/{uid}.activeSessionIds`에 있어야 통과시키고, 없으면 401(`폐기된 세션의 인증 토큰입니다.`)로 거부한다. 그래서 한 기기의 로그아웃·축출은 그 기기의 access token만 다음 요청부터 거부하고 다른 기기는 그대로 쓴다. `sid` 없는 access token은 `sessionsRevokedAt` 비교만 받으며 만료(최대 1시간)까지 남는다. 정지는 `refreshTokens/{uid}` 삭제와 Firebase refresh token 폐기(로그아웃과 같은 처리)도 함께 한다. 정지 해제는 폐기 시각을 지우지 않으므로 정지 전 토큰은 다시 쓰이지 않는다(`apps/api/src/auth/strategies/jwt.strategy.spec.ts`, `apps/api/src/admin/admin.service.spec.ts`).
- 세션 기록(`refreshTokens/{sub}.sessions[sid]`)의 `token`·`previousToken`은 refresh token 원문이 아니라 SHA-256(hex)이다. 회전 유예(60초) 동안 직전 토큰을 다시 보낸 요청에 현재 토큰을 돌려주기 위해, 현재 토큰을 직전 토큰에서 만든 키로 암호화한 `sealedToken`을 함께 둔다. #526 이전의 사용자당 단일 기록(원문 기록 포함)은 읽지 않으며, 그 기록에 묶인 token은 `sid`가 없어 refresh가 401로 끝나고 다시 로그인해야 한다.
- 세 앱 Auth.js 로그아웃은 쿠키 삭제와 함께 `events.signOut`에서 `POST /auth/logout`을 호출해 그 기기의 서버 세션(`sid`)을 폐기한다(`apps/{consumer,seller,driver}/src/auth.ts`, `packages/shared/src/auth-runtime.ts`의 `revokeApiSession`). access token이 401/403이면 refresh로 새 access token을 받아 한 번 더 호출하고, refresh도 401/403이면 이미 끝난 세션으로 본다. 폐기 실패·네트워크 오류·시간 제한(5초) 초과는 예외 없이 끝나 로그아웃 자체는 계속되며, 이 경우 서버 세션은 남는다. 직접 근거는 `packages/shared/src/auth-runtime.test.ts` 단위 테스트이며, `events.signOut` 연결은 소스 대조로만 확인한다. Preview E2E(`auth-session-lifecycle.spec.ts`)는 로그아웃 뒤 쿠키·세션 소멸만 확인하고 서버 token 폐기는 직접 확인하지 않는다.
- 다기기 정책(2026-10-15 결정, `docs/BACKLOG.md` `AUTH-MULTI-DEVICE-SESSION`): 같은 계정이 여러 기기에서 로그인해도 서로의 refresh를 재사용으로 판정하지 않고, 한 기기의 로그아웃은 그 기기만 끊는다. 재사용 감지·관리자 정지·`sid` 없는 로그아웃은 계속 모든 기기를 끊는다. 로그아웃 뒤 같은 계정이 다시 로그인해도 로그아웃한 기기 쿠키의 access token은 그 `sid`가 `activeSessionIds`에 없으므로 `GET /auth/session`을 포함한 API 요청에서 거부된다(`apps/api/src/auth/strategies/jwt.strategy.spec.ts`, `apps/api/src/auth/auth.per-device-sessions.spec.ts`).
- “정지된 계정이 refresh를 통해 계속 새 권한 토큰을 얻을 수 있음”은 현재 계약이 아니다.

Task 2F-A/2F-B의 public approval-gate와 current-user 경계 검증에 더해, 위 refresh/session 직접 회귀가 static/refresh 경계를 닫는다.

### Same-deployment session revocation closure (48A)

API access-token 검증만으로는 닫히지 않는 Auth.js same-deployment stale session
gap을 다음 최소 authority로 닫는다.

- canonical owner는 `GET /auth/session` 하나다. `JwtAuthGuard` 재검증 +
  authoritative user 재조회 + access token `sid` 세션 존재 검사를 수행하는
  read-only endpoint이며, `{ sub, role, storeId? }` projection만 반환한다
  (토큰·비밀값 반환 없음, write/rotation/deletion 없음).
- 세 앱 `src/auth.ts`의 `jwt` callback은 `accessTokenExpires` TTL과 무관하게
  `GET /auth/session`으로 권위를 확인한다(공용 `revalidateSessionToken`,
  `packages/shared/src/session-authority.ts`). 2026-10-23(#627)부터 검증 성공 시각과
  그 access token의 SHA-256 지문을 토큰에 적고, 같은 access token이면 60초 동안 API
  확인을 건너뛴다. access token이 바뀌면(refresh·재로그인) 지문이 달라 바로 다시
  확인하고, 화면의 `update()` 요청(판매자 가게 등록 직후 등)은 재사용하지 않는다. `401/403`은 명시적 폐기
  (logout·`suspended`·role/store mismatch·`driverApproved` 철회·앱 허용 role 밖)로
  fail-closed (`jwt`가 `null` 반환 → Auth.js cookie 삭제, `auth()`는 `null`).
  네트워크 throw·timeout·5xx·429는 transient으로 보존하고 다음 호출에 재시도하며
  전역 로그아웃으로 오인하지 않는다.
- revocation window(2026-10-23 결정, 2026-10-24 보강): API 데이터 요청은 `JwtStrategy`가 요청마다 검사하므로
  즉시(다음 요청) 거부된다. 웹 앱 화면 세션은 **화면의 API 요청이 `401/403`으로 거절되면 즉시**
  끝난다. 세 앱 `Providers`의 `SessionAuthorityRecheck`가 `watchApiAuthorityRejections`로 API
  origin의 Bearer 요청 거절을 보고 `update({})`(POST, trigger `update`)로 세션을 다시 받아
  재사용 없이 검증한다(같은 access token은 10초에 한 번). `update()`는 결과가 `null`이면 화면
  세션을 바꾸지 않으므로, `recheckSessionAfterRejection`이 세션 조회(`GET /api/auth/session`)가
  정상 응답인데 비어 있을 때만 `signOut`해 현재 탭을 로그인 화면으로 보낸다(네트워크 오류·5xx는
  로그아웃시키지 않는다). API 요청이 없는 화면 이동만 이어지면
  최대 60초 동안 화면 틀(데이터 없음)이 남을 수 있다.
- TTL 만료 단독은 폐기로 단정하지 않는다. verify가 `401/403`이어도
  `POST /auth/refresh`를 한 번 시도해 access 만료(refresh 성공, 새 토큰)인가
  실제 폐기(refresh도 명시적 거부, `null`)인가를 구분한다.
- `ACCESS_TOKEN_TTL` 단축으로 해결하지 않으며, firestore.rules 변경 없이
  `refreshTokens/{sub}.sessions` 바인딩을 재사용한다(2026-10-15 #526에서
  user 문서에 `activeSessionIds`가 추가됐다).

`AUTH-SESSION-CLAIM-REVOCATION` 최소 완료 조건:

- 계정 정지 시 기존 refresh token의 후속 갱신을 거부하는 정책을 정의·구현
- refresh 시 authoritative user 상태를 확인하고 현재 role/storeId/승인 상태와 충돌하는 stale claims를 재발급하지 않음
- role/storeId 변경 시 다음 refresh에서 이전 권한이 유지되지 않음
- access token 이미 발급분의 허용 revocation window를 명시적으로 결정하고 테스트함
- 즉시 차단이 요구되면 token version/session revocation 또는 동등한 서버 검증 경계를 사용
- logout/refresh-token rotation 동작 유지
- suspended/role-changed/store-changed/driver-approval-changed 시나리오 직접 회귀

현재 상태: authoritative refresh 재조회, stale claim 재발급 차단, `suspended`/`role`/`store`/`driverApproved` 회귀, logout/rotation 유지는 `IMPLEMENTED / PROVEN`이다(`apps/api/src/auth/auth.service.spec.ts`). revocation window는 즉시(다음 요청)로 결정됐고(2026-09-28 D2), 2026-10-24에 화면 세션만 "API 거절 즉시 또는 최대 60초"로 조정됐다(48A). Preview 브라우저 증거는 run `36341189483`의 세션 수명주기 12건(조정 전 기준)이며, 조정 뒤 기준은 `apps/e2e/tests/auth-session-lifecycle.spec.ts`가 정한다(폐기 뒤 API 요청 즉시 거부 → 화면 세션 종료).

## 7. 현재 Auth API

### 공개/인증 진입

```text
POST /auth/register
POST /auth/login
POST /auth/kakao-login
POST /auth/refresh
```

`register`, `login`, `kakao-login`, `refresh`에는 인증 brute-force 방어용 별도 throttle이 적용된다. `register`·`login`은 1분 10회다. `login`은 클라이언트 IP+정규화한 이메일 단위로 세고, 이메일과 무관한 클라이언트 IP 단위 1분 60회 상한을 함께 둔다. `kakao-login`·`refresh`는 세 앱의 Auth.js 서버(Vercel)가 대신 호출해 여러 손님이 같은 서버 IP를 나눠 쓰고, 유효한 카카오·리프레시 토큰이 있어야만 성공하므로 1분 120회다(`apps/api/src/auth/auth.controller.ts`). `refresh`는 서명 검증된 refresh token의 사용자 단위로 세고(검증 실패 시 IP 단위), 그 밖의 인증 요청은 서명 검증된 access token의 사용자 단위, 없으면 클라이언트 IP 단위로 센다. 집계 기준은 `ClientThrottlerGuard`가 정하고, 클라이언트 IP는 `trust proxy` 홉 수(`TRUST_PROXY_HOPS`, 미설정 시 Railway 런타임 2·그 밖 0, 단 Railway 밖 배포 환경(`GREENHUB_ENVIRONMENT_NAME` 있음)은 미설정이면 기동을 거부한다, `apps/api/src/config/runtime-config.ts` `resolveTrustProxyHops`, #605)로 해석한 Express `req.ip`다. 이 한도와 집계 기준은 `apps/api/src/common/guards/client-throttler.guard.spec.ts`가 검증한다.

주의:

- `/auth/login`과 `/auth/register`는 API 기능으로 존재하지만 현재 세 앱의 production 일반 이메일 로그인 provider라는 뜻은 아니다.
- **이 두 endpoint가 공개라는 사실 자체는 현재 보안 경계다. UI 미노출을 authorization control로 취급하지 않는다.**
- `role: driver` register→login 승인 우회는 해소됐다: 공개 `register`는 `driverApproved: false`를 저장하고 client 주입을 거부하며, 승인값이 false/누락인 driver의 `login`·`getFirebaseToken`은 token side effect 전에 거부된다(`apps/api/src/auth/auth.service.spec.ts`). 공개 endpoint라는 사실 자체는 계속 현재 보안 경계다.
- 일반 사용자에게 credentials 인증을 제품 기능으로 노출하려면 별도 제품·보안 결정이 필요하다.
- 운영 런타임(`isProductionRuntime`: 배포 환경 이름(`GREENHUB_ENVIRONMENT_NAME`, 없으면 `RAILWAY_ENVIRONMENT_NAME`, 둘이 다르면 기동 거부) → `VERCEL_ENV` → `NODE_ENV` 순으로 `production` 판정)은 이메일 `login`·`register`를 모두 받지 않는다(2026-10-18 결정, 운영 화면은 카카오 로그인만 사용. 판매자 초대 가입만 받던 2026-10-10 결정을 대체). `login`은 계정 조회·비밀번호 비교 전에 403(`이메일 로그인은 지원하지 않습니다.`)이고, `register`는 역할·초대 토큰과 관계없이 사용자·초대 문서를 읽기 전에 403(`이메일 회원가입은 지원하지 않습니다.`)이다. 계정 유무·상태와 관계없이 같은 응답이고 감사 기록·토큰 발급·초대 소모가 없다. 운영에서 새 판매자는 관리자가 보낸 초대 링크로 카카오 로그인해 가입한다(2026-10-21 결정, 아래 카카오 판매자 초대 가입). local·test·Preview·스테이징 런타임의 로그인·가입은 그대로다(E2E와 로컬 시드가 쓴다). 직접 근거: `apps/api/src/auth/auth.service.spec.ts` `이메일 로그인 운영 제한`·`이메일 가입 운영 제한·중복 방지`, `apps/api/src/auth/auth.production-email.spec.ts`.
- 운영이 아닌 런타임의 `login`은 계정 없음·비밀번호 불일치·비밀번호 없는(카카오 전용) 계정을 모두 같은 bcrypt 비교 비용을 거쳐 같은 401 메시지로 거부한다.
- 카카오 첫 로그인의 사용자 생성은 `kakaoIdentities/{kakaoId}`(`userId`)를 사용자 문서와 한 트랜잭션에서 함께 써서, 같은 카카오 계정의 동시 요청이 사용자 문서를 하나만 만들게 한다(`apps/api/src/auth/auth.kakao-signup-occ.spec.ts`). 이 연결 문서가 없는 기존 사용자는 지금처럼 `users.kakaoId` 조회로 찾는다.
- 운영이 아닌 런타임에서 판매자 가입의 초대 판정(`apps/api/src/auth/auth.service.ts` `assertInviteRedeemable`, #512): `inviteToken`이 없으면 403, 영숫자 1~64자가 아니면 404, 문서가 없으면 403이다. 그다음 취소(409 `already_revoked`) → 만료(410) → 사용(409) → 받는 사람(초대의 `recipientEmail`과 정규화한 가입 이메일이 다르면 409 `recipient_mismatch`. #518부터 새 초대는 받는 사람 이메일이 필수이고, 그 전에 발급된 `recipientEmail` 없는 초대만 이 확인을 건너뛴다) 순으로 확인한다. 같은 판정을 가입 트랜잭션 안에서 다시 해 만료·취소·동시 가입을 막고, 통과할 때만 `usedAt`·`usedBy`를 기록한다(받는 사람 불일치는 토큰을 소모하지 않는다). 초대 유효 기간은 72시간이다.
- 카카오 판매자 초대 가입(2026-10-21 결정, 모든 런타임): `POST /auth/kakao-login`의 `inviteToken`(선택, 영숫자 1~64자가 아니면 400)은 `targetRole: seller`일 때만 쓰고 다른 앱 요청에서는 무시한다. 판매자 첫 로그인(카카오 id로 찾은 사용자 없음)은 `inviteToken`이 없으면 지금처럼 403이고, 있으면 위 이메일 가입과 같은 사전 검사(형식 404·문서 없음 403·취소 409 `already_revoked`·만료 410·사용 409·받는 사람 409 `recipient_mismatch`)를 거친 뒤 `kakaoIdentities` 사용자 생성 트랜잭션 안에서 초대를 다시 판정하고 통과할 때만 `role: seller` 사용자와 초대의 `usedAt`·`usedBy`를 함께 기록한다(사전 검사와 트랜잭션 재판정은 이메일 가입과 같은 헬퍼). 받는 사람 대조는 카카오가 유효(`is_email_valid`)·인증(`is_email_verified`)으로 확인한 이메일이 있을 때만 하고, 이메일이 없거나 인증되지 않았으면 건너뛴다(관리자가 직접 전달하는 1회용·72시간 링크라서). 같은 카카오 계정이 이미 판매자·관리자가 아닌 역할(손님 등)로 가입돼 있으면 판매자로 바꾸지 않고 409 `kakao_account_in_use`(다른 카카오 계정으로 가입 안내)로 거부한다. 기존 사용자를 그대로 돌려주는 경우(이미 판매자·관리자, 동시 콜백으로 먼저 만든 사용자)에는 초대를 소모하지 않는다. 직접 근거: `apps/api/src/admin/admin-invite-revoke.spec.ts` `카카오 초대 가입`, `apps/api/src/auth/auth.service.spec.ts`. 판매자 앱은 `/invite/[token]` 화면에서 토큰 형식을 확인해 httpOnly·Secure·SameSite=Lax·10분 쿠키에 담고 카카오 로그인을 시작하며, `signIn` 콜백이 쿠키를 읽어 이 요청에 싣고 바로 지운다. 실패 사유는 `/login/error?error=…` 한국어 안내로 보인다(`apps/seller/src/lib/seller-invite.ts`).
- 이메일 가입은 정규화 이메일(trim·소문자)의 SHA-256(hex)을 키로 한 `emailIdentities/{key}`(`userId`·`email`)를 사용자 문서와 한 트랜잭션에서 `create`해, 같은 이메일의 동시 가입이 사용자 문서를 하나만 만들게 한다(나머지는 409). 이 연결 문서가 없는 기존 계정은 지금처럼 `users.email` 조회로 409가 된다. 로그인 경로는 바뀌지 않는다.
- Seller/Driver의 explicit local-runtime branch 역시 production indicator(`NODE_ENV`·`VERCEL_ENV`·`RAILWAY_ENVIRONMENT_NAME` 중 어느 하나라도 `production`)가 존재하면 fail-closed된다. local marker를 켜도 production runtime에서는 local admission이 열리지 않으며, Seller는 기존 E2E header gate로, Driver는 기존 Preview/E2E gate로 복귀한다. production에서 local marker를 켠다고 사용할 수 있는 것이 아니다.

### 인증 사용자

```text
GET    /auth/me
GET    /auth/session
PATCH  /auth/me
POST   /auth/me/addresses
PATCH  /auth/me/addresses/:addressId
DELETE /auth/me/addresses/:addressId
PATCH  /auth/me/addresses/:addressId/default
PATCH  /auth/me/fcm-token
GET    /auth/firebase-token
POST   /auth/logout
DELETE /auth/me
```

모두 `JwtAuthGuard`가 적용된다. `firebase-token`은 JWT 인증이 필요하고, 서명 검증된 access token의 사용자(`sub`) 단위로 1분 60회 throttle이 걸린다(`FIREBASE_TOKEN_THROTTLE`, `apps/api/src/auth/auth.controller.ts`, #488). 또 Firebase 클라이언트를 쓰는 `seller`·`driver`·`admin`만 받는다(`consumer`는 403).

### 소비자 회원 탈퇴 (`DELETE /auth/me`)

2026-10-20 사용자 결정: 진행 중인 주문이 있으면 탈퇴를 막고, 탈퇴하면 개인정보를 바로 지우며 같은 카카오 계정으로 바로 다시 가입할 수 있다. 판정 목록은 `apps/api/src/auth/account-withdrawal.ts`가 소유한다.

- `consumer`만 받는다(`RolesGuard`·서비스 양쪽에서 `seller`·`driver`·`admin`은 403). 1분 10회 throttle. 성공은 204.
- 409(진행 중 주문): `orders.where('userId','==',uid)`·`checkoutReservations.where('userId','==',uid)`를 트랜잭션 안에서 읽어 메모리에서 거른다(단일 필드 동등 조건이라 새 인덱스 없음). 막는 조건은 상태 `CANCELLABLE_ORDER_STATUSES`(PENDING·ACCEPTED·RECRUITING·CONFIRMED·PREPARING·DELIVERY_HELD) + DELIVERING·HUB_ARRIVED, 취소 진행 중(`isOrderCancellationInProgress`), 재배송비 미결제(`isCurrentRedeliveryPaymentRequired`), 만료 전 `HELD` 결제 예약이다.
- 한 트랜잭션: `revokeAllSessionsInTransaction`(refresh 문서 삭제·`activeSessionIds` 비움·`sessionsRevokedAt`), 사용자 문서의 `name`·`phone`·`email`·`savedAddresses`·`fcmToken`·`kakaoId`·`passwordHash`·`notificationPreferences` 필드 삭제와 `withdrawnAt` 기록(주문·결제가 uid를 참조하므로 문서는 남김), 이 사용자에게 연결된 `kakaoIdentities/{kakaoId}`·`emailIdentities/{key}` 삭제. 연결 문서와 `kakaoId`가 없으므로 같은 카카오로 다시 로그인하면 새 사용자 문서가 만들어진다.
- 트랜잭션 뒤: 그 사용자의 `restockSubscriptions`·`notifications`·`aiUsage` 문서 삭제(실패해도 탈퇴는 되돌리지 않고 error 로그). 주문(이름·전화·주소 스냅샷 포함)·결제·후기(작성 시 가려진 이름)·법정 보관 기록은 전자상거래법 보관 대상이라 남긴다.
- 카카오 연결 끊기: `KakaoClient.unlinkUser`가 Admin Key(`KAKAO_ADMIN_KEY`, 선택·운영에서 없으면 시작 시 경고)로 `POST /v1/user/unlink`(`target_id_type=user_id`)를 부른다. 키가 없거나 실패해도 탈퇴는 성공하고, 사용자 식별자 없는 고정 문구 운영 알림(`OpsAlertService`, 30분 중복 억제)만 보낸다.
- 감사 기록: `auditLogs`에 `auth.withdrawn`(`detail.kakaoUnlink` = `unlinked`·`not_configured`·`failed`·`not_linked`).
- 탈퇴한 문서(`withdrawnAt` 있음)는 `JwtStrategy`(401)·`getAuthoritativeUser`(refresh·session·firebase-token, 401)가 거부하고, 이메일·카카오 조회 필드가 지워져 로그인으로도 찾을 수 없다. 어드민 소비자 목록(`GET /admin/users`)에서는 빠진다.
- 직접 근거: `apps/api/src/auth/auth.withdraw.spec.ts`, `apps/api/src/auth/kakao.client.spec.ts` `회원 탈퇴 연결 끊기`, `apps/api/src/auth/strategies/jwt.strategy.spec.ts`, `apps/api/src/admin/admin.service.spec.ts` `소비자 목록`.

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

`POST /auth/register`와 `PATCH /auth/me`의 입력 제약(`RegisterDto`·`UpdateMeDto`):

- `name`: 20자 이하, 제어문자·줄바꿈·보이지 않는 서식 문자 금지, 링크·도메인 형태(`scheme://`, `www.`, `<문자>.<영문 2자 이상>`) 금지
- `phone`: 숫자·스페이스·하이픈·괄호·`+`로 된 8~20자 1개(쉼표 등으로 이은 여러 번호 금지)
- 직접 근거: `apps/api/src/auth/dto/profile-fields.dto.spec.ts`. Kakao 로그인 이름은 이 DTO를 거치지 않으며, 주문 복사(`buyerName`)와 알림 렌더링 단계에서 따로 정리된다.

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

입력 상한(`AddressDto`): `label` 50자, `address` 200자, `addressDetail` 100자, `zipCode` 10자. 한 사용자는 배송지를 20개까지 저장하고, 넘는 추가는 400이다. 추가·수정·삭제·기본값 변경은 `savedAddresses` 읽기와 쓰기를 한 트랜잭션에서 해 동시 요청이 서로의 변경을 덮어쓰지 않는다(`apps/api/src/auth/auth.addresses.spec.ts`).

## 10. Firebase Custom Token

`GET /auth/firebase-token`은 현재 API JWT 사용자에게 Firebase client용 custom token을 발급하는 경로다. controller는 `CurrentUser()`의 `sub`만 `AuthService.getFirebaseToken()`에 전달하고, service는 현재 user 문서를 다시 읽어(`suspended`·role·storeId·`driverApproved` 확인) 그 값으로 Firebase custom claims를 만든다(`apps/api/src/auth/auth.service.spec.ts` `getFirebaseToken`).

따라서 custom token 발급 시점의 claims는 JWT payload가 아니라 authoritative user 상태를 따른다. 이미 발급된 Firebase ID token은 만료(최대 1시간)까지 남으며, logout·refresh 재사용 감지 때 Firebase refresh token이 폐기된다(§6).

특히 Firestore Rules가 `role`/`storeId` claims를 데이터 접근의 근거로 사용하므로 auth claim lifecycle과 Rules authorization을 별개의 문제로 분리하지 않는다.

이 endpoint의 존재 때문에 Firebase Rules를 공개 read/write로 완화하지 않는다. Firebase 접근 계약은 현재 Rules와 해당 frontend 사용처를 함께 확인한다.

## 11. FCM 필드 상태

`PATCH /auth/me/fcm-token`과 shared `fcmToken` 필드는 현재 남아 있다. 그러나 현재 notifications API의 실제 외부 발송 구현은 ALIGO/SMS이며 FCM send 구현은 없다.

따라서 FCM token endpoint를 “현재 운영 push 알림이 활성화돼 있다”는 증거로 사용하지 않는다. 실제 FCM 재도입은 별도 Task에서 정의한다.

`PATCH /auth/me/fcm-token` 입력(`FcmTokenDto`): `fcmToken`은 4096자 이하 문자열 또는 `null`(지우기)이다. 누락·다른 타입·알 수 없는 필드는 400이다.

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
- local-runtime marker(`GREENHUB_LOCAL_RUNTIME`·`NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME`) 역시 production auth model이 아니다.
- Seller/Driver local path도 실제 API role/approval validation을 유지한다. Seller는 `seller|admin` role 검증을, Driver는 `driver` role + `driverApproved === true` 검증을 우회하지 않는다.
- production runtime에서는 local admission이 닫힌다. production indicator가 하나라도 존재하면 local-runtime 진입을 거부하고 기존 E2E/Preview gate로 복귀한다.
- Credentials UI 노출 여부는 authorization control 자체가 아니다. local UI가 보인다는 사실이 인증·승인 통과를 의미하지 않는다.
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
| 2026-10-24 | 강제 재검증 결과가 `null`이고 세션 조회도 비어 있으면 세 앱이 `signOut`해 현재 탭도 로그인 화면으로 바꾼다(`recheckSessionAfterRejection`). `auth-session-lifecycle.spec.ts`에 현재 탭 `/login` 전환 확인 추가 |
| 2026-10-24 | 화면의 API 요청이 401/403으로 거절되면 세 앱 `Providers`가 `update({})`로 세션을 재사용 없이 다시 검증해 그 자리에서 끊는다(`watchApiAuthorityRejections`). `auth-session-lifecycle.spec.ts` 정지·철회 시험을 "폐기 뒤 화면 API 거절 → 즉시 세션 종료" 확인으로 변경 |
| 2026-10-24 | 코드 대조: Railway 밖 배포 환경의 `TRUST_PROXY_HOPS` 필수(#605) 반영 |
| 2026-10-23 | 세 앱 `jwt` callback의 `GET /auth/session` 검증 성공을 같은 access token에 한해 60초 재사용(#627). revocation window를 API 데이터 요청 즉시·앱 세션 최대 60초로 조정(사용자 결정), `auth-session-lifecycle.spec.ts` 정지·철회 시험을 60초 뒤 끊김 확인으로 변경 |
| 2026-10-21 | 운영의 새 판매자 가입을 "관리자 초대 링크 → 카카오 로그인"으로 결정: `kakao-login`의 `inviteToken`, 사용자 생성 트랜잭션 안 초대 재판정·소모, 인증된 카카오 이메일만 받는 사람 대조, 다른 역할 기존 계정 409 `kakao_account_in_use`, 판매자 앱 `/invite/[token]`·`/login/error` |
| 2026-10-21 | 소비자 회원 탈퇴 `DELETE /auth/me`(W5): 진행 중 주문·결제 예약 409, 세션 폐기·개인정보 필드 삭제·`withdrawnAt`·연결 문서 삭제 한 트랜잭션, 부속 기록 정리, 카카오 Admin Key 연결 끊기(실패해도 성공·운영 알림), `auth.withdrawn` 감사, 탈퇴 문서의 토큰·refresh 거부 |
| 2026-10-18 | 운영 런타임의 이메일 `login`·`register`를 모두 403으로 거부(계정·초대 조회 전, 판매자 초대 가입만 받던 2026-10-10 결정을 대체). 운영이 아닌 런타임은 그대로 |
| 2026-10-15 | 기기별 refresh 세션(#526): 로그인마다 `sid`, `refreshTokens/{sub}.sessions`·`users.activeSessionIds`(최대 10개, LRU 축출), 세션별 회전·유예, 재사용 감지 시 전 세션 폐기, `sid` 로그아웃은 그 세션만 폐기, `JwtStrategy`의 `activeSessionIds` 확인, `sid` 없는 이전 refresh 401. 단일 문서 다기기 한계 해소 |
| 2026-10-12 | logout·관리자 정지의 `sessionsRevokedAt` 기록과 access token `iat` 비교, 정지 시 refresh 기록·Firebase 세션 폐기, refresh token 해시 저장(원문 기록 자동 전환), 운영 이메일 가입을 판매자 초대로 제한, `emailIdentities` 이메일 가입 단일화, fcm-token·배송지 입력 상한과 배송지 트랜잭션 반영 |
| 2026-10-10 | 코드 대조 정합화: 세 앱 로그아웃의 API 세션 폐기, refresh 회전 60초 유예·재사용 감지, 사용자당 단일 refresh 문서의 다기기 한계(`AUTH-MULTI-DEVICE-SESSION`), 운영 runtime의 테스트 전용 Credentials 미등록·local-runtime loopback 조건, `KAKAO_APP_ID` 토큰 발급 앱 확인, 앱 서버 쪽 API 호출 시간 제한, Firebase custom token의 현재 user 재조회, 요청 한도 미검증·IP 집계 의존(#404) 반영, candidate·출시 후 과제 표현 정리 |
| 2026-10-10 | access/refresh token `typ`·`aud`·HS256 검증(이전 발급 token 호환), logout·refresh 재사용 감지의 Firebase refresh token 폐기, `firebase-token` 역할 제한, email login 응답 균일화, 카카오 첫 로그인 사용자 생성 단일화 반영 |
| 2026-10-09 | 가입·프로필 수정의 `name`(20자·제어문자·링크 금지)과 `phone`(단일 번호 형식) 입력 제약 반영 |
| 2026-10-04 | 기사 앱 허용 역할을 `driver`·`admin`에서 `driver`로 좁힘(사용자 결정). API `targetRole: driver` 관리자 거절·구분 code, 기사 앱 signIn·jwt·proxy 차단과 로그인 안내 계약 반영 |
| 2026-09-28 | revocation window를 즉시(다음 요청)로 결정(D2)하고 JwtStrategy·Firestore Rules 실시간 확인 근거와 Preview 세션 수명주기 E2E 12건 증거를 연결, 로그아웃 서버 폐기는 출시 후 과제로 분리 |
| 2026-08-24 | Task 2F-B candidate에서 public driver register/login approval gate, Kakao 자동승인 방지, JWT/current-user 경계를 검증하고 `AUTH-SESSION-CLAIM-REVOCATION`은 OPEN으로 유지 |
| 2026-08-24 | 공개 email `register(role=driver) → login`이 승인 없이 driver JWT를 발급할 수 있는 추가 P0 우회를 반영하고 Kakao/refresh/Firebase claim과 하나의 driver authorization lifecycle로 정합화 |
| 2026-08-24 | 신규/legacy driver 자동 승인 경로를 P0 IMPLEMENTATION FINDING으로 분리하고, 정지·role/store 변경의 refresh/custom-token stale claims를 P0 revocation 결정·remediation으로 명시 |
| 2026-08-23 | Kakao 운영 OAuth, E2E 전용 Credentials, driver approval, refresh/custom-token 현행 계약에 맞춰 전면 정합화 |
| 2026-07-01 | Kakao access token 서버 검증 계약 보강 |
| 2026-03-26 | 초기 auth 설계 초안 |

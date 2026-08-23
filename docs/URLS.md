<!-- Language: ko -->

# Greenhub — URL 및 로컬 포트 레퍼런스

> 이 문서는 **서비스의 canonical URL과 알려진 설정 기준**을 관리한다. Vercel·Railway·카카오·DNS의 실제 현재 상태는 변경 작업 직전에 provider에서 다시 조회한다. 과거 확인일이 적힌 환경 변수 표를 현재 provider 상태로 간주하지 않는다.

## 1. Production canonical URL

| 서비스 | URL |
|---|---|
| Consumer | `https://greenlove.co.kr` |
| Seller | `https://seller.greenlove.co.kr` |
| Driver | `https://driver.greenlove.co.kr` |
| Railway API | `https://api-production-13e7.up.railway.app` |

- `greenlove.co.kr` 도메인은 가비아에서 관리한다.
- production URL을 바꾸는 경우 Vercel 도메인, `NEXTAUTH_URL`/`AUTH_URL`, Railway CORS, 카카오 Redirect URI 등 직접 의존 설정을 함께 재검토한다.
- 이 문서의 URL 기록만 바꿨다고 외부 provider 설정이 자동 반영되는 것은 아니다.

## 2. DNS 기록 — 마지막 문서 확인값

> 아래 값은 저장소에 기록된 마지막 확인값이다. DNS 변경 전 가비아의 현재 zone을 다시 조회한다.

| 타입 | 호스트 | 마지막 기록값 | TTL |
|---|---|---|---|
| A | `@` | `216.198.79.1` | 1800 |
| CNAME | `seller` | `8839be1a99af91d5.vercel-dns-017.com.` | 1800 |
| CNAME | `driver` | `fbf792e03b40869b.vercel-dns-017.com.` | 1800 |

과거 도메인 연결 작업은 2026-04-06 완료 기록이 있다. 만료일·등록자 정보처럼 시간에 따라 바뀌는 정보는 provider 조회를 우선한다.

## 3. 인증 URL 정책

`AUTH_URL`과 `NEXTAUTH_URL`은 같은 의미의 callback 기준 URL로 취급하며 서로 다른 값으로 운영하지 않는다.

Production 기준:

| 앱 | callback 기준 URL |
|---|---|
| consumer | `https://greenlove.co.kr` |
| seller | `https://seller.greenlove.co.kr` |
| driver | `https://driver.greenlove.co.kr` |

Preview 정책의 상세 정본은 `docs/specs/ops/preview-auth-url-policy.md`다.

현재 문서 정책:

- 커밋별 Preview URL을 카카오 Redirect URI에 추가하지 않는다.
- Preview 카카오 로그인 완료 smoke를 production OAuth 설정에 맞추기 위해 임의로 열지 않는다.
- `VERCEL_URL`을 production OAuth callback 기준으로 사용하지 않는다.
- 실제 Preview env 존재 여부는 변경 전 Vercel에서 재조회한다.

## 4. Railway CORS 기준

Production canonical origin은 다음 세 개다.

```text
https://greenlove.co.kr
https://seller.greenlove.co.kr
https://driver.greenlove.co.kr
```

API는 `CORS_ORIGIN`의 정적 origin과 코드에서 허용한 제한된 Vercel Preview origin 정책을 사용한다. 실제 Railway 변수의 현재 값을 문서의 과거 snapshot만 보고 덮어쓰지 않는다.

## 5. 카카오 Redirect URI 기준

Production canonical callback:

```text
https://greenlove.co.kr/api/auth/callback/kakao
https://seller.greenlove.co.kr/api/auth/callback/kakao
https://driver.greenlove.co.kr/api/auth/callback/kakao
```

기존 Vercel project alias와 localhost URI의 유지 여부는 카카오 설정 변경 시 실제 provider 목록과 현재 인증 정책을 함께 확인한다. 과거 등록 목록을 무조건 재등록하거나 삭제하지 않는다.

## 6. 로컬 포트 — 현재 실행 방식

로컬 포트는 **실행 명령에 따라 달라진다**. 하나의 고정표만 보고 서버를 띄우지 않는다.

### 코드 기본값

| 대상 | 현재 기본 동작 |
|---|---|
| API | `process.env.PORT ?? 3000` |
| consumer | `next dev --webpack` → Next 기본 포트(일반적으로 3000) |
| seller | `next dev --webpack` → Next 기본 포트(일반적으로 3000) |
| driver | package script에서 `--port 3003` 고정 |

### 루트 `dev.bat`

현재 `dev.bat`는 **프런트 3개만** 시작한다.

| 앱 | `dev.bat` 실행 포트 |
|---|---:|
| consumer | 3000 |
| seller | 3001 |
| driver | 3003 |
| API | 시작하지 않음 |

따라서 `dev.bat`의 consumer와 로컬 API를 동시에 기본 설정으로 실행하면 둘 다 3000을 사용하려 하므로 충돌할 수 있다.

### 전체 스택을 동시에 띄울 때 권장 포트 계획

다음은 충돌을 피하기 위한 **권장 계획**이며 현재 `dev.bat`가 자동 보장하는 계약은 아니다.

| 대상 | 권장 포트 |
|---|---:|
| API | 3000 |
| consumer | 3001 |
| seller | 3002 |
| driver | 3003 |

전체 스택 개발용 launcher를 사용하려면 각 앱에 포트를 명시적으로 전달하는지 먼저 확인한다. `dev.bat`를 이 권장 계획과 맞추는 작업은 코드/로컬 tooling 변경이므로 별도 Task로 다룬다.

## 7. URL 변경 체크리스트

URL 또는 도메인을 실제로 바꾸는 Task에서는 최소 다음을 확인한다.

- [ ] 현재 DNS provider와 zone 재조회
- [ ] Vercel project/domain 재조회
- [ ] 앱별 `NEXTAUTH_URL`/`AUTH_URL` 현재값 확인
- [ ] 공개 API URL 환경 변수 확인
- [ ] Railway `CORS_ORIGIN` 확인
- [ ] 카카오 Redirect URI 확인
- [ ] production / preview / development 적용 범위 구분
- [ ] 변경 전후 인증 callback smoke
- [ ] 비밀값을 문서나 command output에 기록하지 않음

외부 설정 변경은 사용자 승인 경계를 따른다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-23 | production URL과 provider snapshot을 분리하고, 현재 `dev.bat`/package/API 코드에 맞춰 로컬 포트 계약을 정합화 |
| 2026-07-05 | Preview Auth URL 정책 관련 환경 확인 기록 |
| 2026-04-06 | production 도메인 연결 기록 |

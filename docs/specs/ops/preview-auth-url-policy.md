<!-- Language: ko -->

# Preview Auth URL 정책

> **최종 정합화**: 2026-08-23
> **상태**: Current
> **범위**: consumer, seller, driver의 Vercel Preview와 Kakao OAuth callback 정책
> **canonical production URL**: `docs/URLS.md`

## 1. 결정

Greenhub은 **Preview에서 Kakao 로그인 완료 smoke를 지원하지 않는다.**

Preview의 목적은 UI/API 통합 검증과 Kakao authorize 진입 확인까지이며, Kakao callback을 거쳐 Auth.js session 발급까지 완료하는 OAuth smoke는 production canonical domain에서 검증한다.

이 선택의 이유:

- 카카오는 Redirect URI 정확 일치가 필요하다.
- 커밋별 Vercel Preview URL은 지속적으로 바뀐다.
- 커밋별 URL을 Kakao 콘솔에 누적하면 관리·보안 경계가 악화된다.
- Auth.js의 host/cookie/PKCE 흐름을 production callback과 Preview callback 사이에서 섞지 않는 편이 안전하다.

## 2. 환경별 URL 정책

| 환경 | `NEXTAUTH_URL` / `AUTH_URL` 정책 | Kakao 로그인 완료 |
|---|---|---|
| Production | 앱별 production canonical domain | 지원·검증 대상 |
| Preview | 둘 다 고정 production URL로 강제하지 않음 | 비지원 |
| Development | 명시적으로 승인된 localhost callback 기준 | 로컬 개발 범위에서 가능 |

`AUTH_URL`과 `NEXTAUTH_URL`은 같은 의미의 callback 기준 설정으로 취급한다. 같은 환경에서 서로 다른 값으로 두지 않는다.

실제 Vercel 변수의 현재 존재 여부는 외부 상태이므로 변경 Task 시작 시 provider에서 다시 조회한다. 2026-07의 env 조회 결과를 현재값으로 자동 승계하지 않는다.

## 3. Kakao Redirect URI 정책

### 유지 대상

- production canonical callback
- 실제 로컬 개발에 필요한 승인된 localhost callback
- 현재 별도 용도가 검증된 고정 alias가 있다면 그 용도와 필요성을 재검토한 뒤 유지

### 등록 금지

- commit hash가 포함된 일회성 Vercel deployment URL
- 매 build마다 달라지는 Preview URL
- 단순 테스트 편의를 위해 임시로 생성한 callback URL

stable branch Preview alias를 Kakao 로그인 완료 검증에 사용하고 싶다면 이 정책을 변경하는 별도 Task와 사용자 승인이 필요하다. 기존 정책에서는 사용하지 않는다.

## 4. Preview smoke 범위

### 허용

- `/login` 로드
- Kakao 로그인 버튼 노출
- 버튼 클릭 후 Kakao authorize endpoint 진입
- 생성된 authorize URL의 `redirect_uri`를 **관찰**
- callback 이전 단계에서 예상하지 않은 앱/도메인으로 향하지 않는지 확인

### 완료로 간주하지 않음

- Kakao 계정 인증 완료
- Preview callback 성공
- Preview Auth.js session 발급
- Preview에서 역할 기반 앱 진입 성공

위 항목은 이 정책에서 Preview acceptance criterion이 아니다.

## 5. Production smoke

Kakao 로그인 완료를 실제 검증할 때는 앱별 production canonical URL을 사용한다.

- consumer: `https://greenlove.co.kr`
- seller: `https://seller.greenlove.co.kr`
- driver: `https://driver.greenlove.co.kr`

실제 callback URI는 `docs/URLS.md`의 canonical 값과 Kakao provider 현재 등록 상태를 함께 확인한다.

Production smoke가 실제 계정·운영 상태를 바꿀 수 있으면 해당 Task의 승인 경계를 먼저 따른다.

## 6. Vercel 관련 규칙

- `VERCEL_URL`은 deployment 식별에 유용하지만 OAuth callback canonical URL의 정본으로 사용하지 않는다.
- Preview env를 production env와 같게 만들기 위해 `NEXTAUTH_URL`/`AUTH_URL`을 무조건 복제하지 않는다.
- env 값을 확인할 때 secret 원문을 문서·로그에 기록하지 않는다.
- env 삭제·추가·재배포는 외부 변경이므로 사용자 승인 없는 문서 정합성 작업에서 수행하지 않는다.

## 7. E2E와의 관계

자동 E2E는 Kakao OAuth 로그인 완료에 의존하지 않는 전용 인증/fixture 계약을 사용한다.

- Kakao provider 장애나 Preview Redirect URI 제약 때문에 전체 E2E를 production OAuth로 우회하지 않는다.
- E2E 인증 구조는 해당 workflow·fixture·auth gate 문서를 따른다.
- Preview authorize smoke와 Playwright 역할 인증은 별도 검증 축이다.

## 8. 변경이 필요한 경우

다음 요구가 생기면 이 정책을 별도 설계 Task로 재검토한다.

- Preview에서 실제 Kakao callback·session 완료 검증이 반드시 필요해짐
- stable branch Preview alias를 공식 인증 환경으로 운영하려 함
- Auth.js redirect proxy 또는 별도 OAuth test application을 도입하려 함
- Kakao provider가 Preview-friendly callback 기능을 새로 제공함

재검토 시 최소 비교 대상:

1. 현재 Kakao Redirect URI 제한
2. Vercel stable alias 동작
3. Auth.js host/PKCE/cookie 계약
4. 보안·운영 복잡도
5. production OAuth 설정 오염 가능성

## 9. 검증 체크리스트

- [ ] production canonical URL은 `docs/URLS.md`와 일치한다.
- [ ] Preview acceptance criterion에 Kakao 로그인 완료가 들어가 있지 않다.
- [ ] commit별 Preview URL을 Kakao Redirect URI로 요구하지 않는다.
- [ ] `AUTH_URL`과 `NEXTAUTH_URL`을 서로 다른 값으로 문서화하지 않는다.
- [ ] 실제 Vercel/Kakao 상태를 과거 snapshot만으로 단정하지 않는다.
- [ ] 외부 env·provider 변경은 별도 승인 게이트를 따른다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-23 | 완료된 2026-07 실행 Task·옛 PR handoff를 제거하고 현재 정책만 남김; provider snapshot과 canonical 정책 분리 |
| 2026-07-05 | Preview env 정책 A 실행 기록 |
| 2026-07-01 | Preview Kakao callback 정책 수립 |

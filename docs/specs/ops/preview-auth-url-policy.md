# Preview Auth URL 정책

> 작성일: 2026-07-01
> 상태: Draft
> 범위: consumer, seller, driver Preview 카카오 로그인 callback URL 정책

---

## 1. 배경

PR #7 수동 smoke에서 세 앱 모두 `/login` 로드와 카카오 authorize 진입은 확인됐지만, Preview 안에서 로그인 완료까지 검증할 수 없었다.

- consumer Preview: `redirect_uri`가 `https://greenlove.co.kr/api/auth/callback/kakao`로 잡힘
- seller Preview: `redirect_uri`가 커밋별 Preview URL로 잡혀 카카오 `KOE006` 차단
- driver Preview: `redirect_uri`가 `https://driver.greenlove.co.kr/api/auth/callback/kakao`로 잡힘

세 앱의 `auth.ts`는 모두 `trustHost: true`와 Kakao provider를 사용하며, 로그인 버튼은 상대 경로만 넘긴다. 따라서 차이는 앱 코드 분기가 아니라 Vercel 환경변수와 Auth.js host 판단 정책에서 발생한다.

## 2. 조사 결과

### 2-1. 코드 기준

세 앱은 모두 `NEXTAUTH_URL`, `AUTH_URL`, `VERCEL_URL`을 코드에서 직접 읽지 않는다.

- `apps/consumer/src/auth.ts`: `trustHost: true`, Kakao provider, `targetRole: 'consumer'`
- `apps/seller/src/auth.ts`: `trustHost: true`, Kakao provider, `targetRole: 'seller'`
- `apps/driver/src/auth.ts`: `trustHost: true`, Kakao provider, `targetRole: 'driver'`

Auth.js v5는 `AUTH_URL`을 `NEXTAUTH_URL` alias로 취급한다. `trustHost: true`는 요청 Host를 신뢰하도록 하며, stable URL이 없으면 현재 요청 Host 기반 callback이 만들어질 수 있다.

### 2-2. Vercel 환경변수 기준

`vercel env ls`로 변수명과 적용 환경만 확인했다. 값 자체는 내려받지 않았다.

| 앱 | `NEXTAUTH_URL` 적용 환경 | Preview smoke 결과와의 관계 |
| --- | --- | --- |
| consumer | Production, Preview, Development | Preview에서도 production consumer callback 사용 |
| seller | Production, Development | Preview에서 현재 요청 Host, 즉 커밋별 Preview callback 사용 |
| driver | Production, Preview, Development | Preview에서도 production driver callback 사용 |

### 2-3. 기존 운영 문서 기준

`docs/URLS.md`에는 production 도메인과 기존 Vercel project alias가 카카오 Redirect URI 목록에 함께 기록돼 있다. 반면 커밋별 Preview URL은 매 배포마다 바뀌므로 목록 관리 대상이 될 수 없다. branch Preview alias(`*-git-preview-*`)는 Preview 로그인 완료 smoke를 승인할 때만 별도로 추가한다.

기존 e2e 문서와 결정 로그에는 고정 branch Preview alias(`*-git-preview-*`)와 커밋별 deployment URL이 별개이며, Vercel이 성공한 커밋으로 branch alias를 재포인팅한다는 결정이 있다. 따라서 Preview 완료 smoke를 하려면 커밋별 URL이 아니라 stable branch Preview alias나 Auth.js redirect proxy를 기준으로 해야 한다.

## 3. 운영 정책 제안

### 3-1. 권장 결론

**기본 정책은 production callback만 안정적으로 유지하고, Preview 카카오 완료 smoke는 별도 승인된 stable branch Preview alias에서만 허용한다.**

그 이유는 카카오 Redirect URI가 정확 일치 기반이고, 커밋별 Preview URL은 무한히 늘어나며 운영 콘솔을 오염시키기 때문이다.

### 3-2. 카카오 Redirect URI 등록 정책

| 유형 | 정책 | 이유 |
| --- | --- | --- |
| Production 도메인 | 유지 | 실제 사용자 로그인 기준 |
| 로컬 개발 URL | 유지 | 수동 개발 smoke 기준 |
| Vercel project alias | 유지 또는 재검토 | 현재 문서에 등록돼 있으나 Preview 완료 smoke 기준과는 별개 |
| Vercel branch Preview alias | 승인 후 등록 | Preview 완료 smoke가 필요할 때만 사용 |
| 커밋별 Preview URL | 등록 금지 | 매 배포마다 변경되어 운영 불가 |

### 3-3. `NEXTAUTH_URL`/`AUTH_URL`/`VERCEL_URL` 정책

| 환경 | 정책 |
| --- | --- |
| Production | 앱별 production 도메인을 `NEXTAUTH_URL` 또는 `AUTH_URL`로 설정 |
| Preview 완료 smoke 비대상 | Preview `NEXTAUTH_URL`/`AUTH_URL`을 제거하거나 production callback 사용을 명시 |
| Preview 완료 smoke 대상 | Preview `NEXTAUTH_URL` 또는 `AUTH_URL`을 stable branch Preview alias로 설정 |
| 모든 환경 | `VERCEL_URL`을 OAuth callback 기준으로 사용하지 않음 |

`AUTH_URL`과 `NEXTAUTH_URL`은 같은 의미로 취급하므로 둘을 동시에 다른 값으로 두지 않는다. 신규 설정은 `AUTH_URL`로 통일하는 방안을 검토하되, 기존 프로젝트가 `NEXTAUTH_URL`을 쓰고 있으므로 전환은 별도 PR로 둔다.

### 3-4. Preview smoke 단계 정의

| 단계 | 허용 범위 | 조건 |
| --- | --- | --- |
| authorize 진입 smoke | 모든 Preview | 카카오 authorize URL 진입과 `redirect_uri` 관찰까지만 |
| 완료 smoke | stable branch Preview alias 또는 production | 카카오 Redirect URI 등록과 환경변수 정책이 일치할 때만 |
| k6 부하테스트 | 카카오 OAuth 제외 | seed email/password 또는 사전 발급 JWT만 사용 |

## 4. 아토믹 태스크

### T0. 현재 상태 고정

- 상태: 완료
- 목표: 앱별 Preview callback 차이 원인을 코드와 Vercel env 기준으로 분리한다.
- 결과: consumer/driver는 Preview `NEXTAUTH_URL` 존재, seller는 Preview `NEXTAUTH_URL` 부재라는 차이를 확인했다.
- 검증: `rg`로 앱 코드의 URL 직접 참조 부재 확인, `vercel env ls`로 변수 적용 환경 확인. 2026-07-01 재조회에서도 consumer/driver는 Preview `NEXTAUTH_URL` 존재, seller는 Preview `NEXTAUTH_URL` 부재 상태가 유지됐다.

### T1. 문서 정책 고정

- 상태: 완료
- 목표: `docs/URLS.md`와 본 문서에 production, stable branch Preview, commit Preview 정책을 분리한다.
- 결과: 커밋별 Preview URL 등록 금지와 stable branch Preview alias 승인 절차를 명시한다.
- 검증: 문서에서 `commit Preview`와 `stable branch Preview`가 같은 정책으로 섞이지 않는다.

### T2. Vercel 환경변수 정리안 확정

- 상태: 대기(현황 재확인 완료)
- 목표: consumer/seller/driver Preview의 `NEXTAUTH_URL` 또는 `AUTH_URL` 운영 방식을 하나로 맞춘다.
- 선택지:
  - A. Preview 완료 smoke 비대상: Preview `NEXTAUTH_URL` 제거 또는 production callback 사용 문서화
  - B. Preview 완료 smoke 대상: 세 앱 모두 stable branch Preview alias로 통일
- 검증: 변경 승인 후 `vercel env ls`에서 세 앱 Preview 적용 환경이 선택한 정책과 일치해야 한다.

### T3. 카카오 콘솔 Redirect URI 정리

- 상태: 대기
- 목표: 카카오 Redirect URI 목록을 운영 정책과 일치시킨다.
- 작업: production, local, 기존 project alias, 승인된 stable branch Preview alias만 남기고 커밋별 URL은 등록하지 않는다.
- 검증: 카카오 콘솔 목록에 `-<commit-hash>-jos-projects` 형태 URL이 없다.

### T4. Preview 완료 smoke 절차 문서화

- 상태: 대기
- 목표: Preview에서 어디까지 smoke 가능한지 체크리스트로 고정한다.
- 작업: authorize 진입 smoke와 완료 smoke를 분리하고, 완료 smoke는 stable branch Preview alias 기준으로만 허용한다.
- 검증: PR 본문에 "authorize 진입 확인"과 "로그인 완료 확인"이 섞이지 않는다.

### T5. 별도 PR 운영

- 상태: 대기
- 목표: PR #7의 보안 보강·k6 범위와 Preview auth URL 정책 범위를 분리한다.
- 작업: `codex/preview-auth-url-policy` 브랜치에서 문서 정책 PR을 만든다.
- 검증: `git diff origin/main...HEAD`가 문서 정책 파일만 포함한다.

## 5. 정합성 검토

| 항목 | 판정 | 근거 |
| --- | --- | --- |
| PR #7 분리 | 통과 | `origin/main`에서 별도 브랜치를 생성해 정책 문서만 다룸 |
| Production 쓰기 금지 | 통과 | Vercel env 목록 조회만 수행, env 값 변경 없음 |
| k6 baseline 금지 | 통과 | 부하테스트 실행 없음 |
| 카카오 반복 호출 금지 | 통과 | 카카오 authorize 재호출 없이 기존 smoke 결과와 설정만 분석 |
| 앱 역할 범위 | 통과 | consumer/seller/driver만 포함 |
| hub_staff 제외 | 통과 | main 기준 선행 기능이 아니므로 정책 대상에서 제외 |
| 커밋별 Preview URL 금지 | 통과 | 등록 금지 정책으로 명시 |
| Auth.js 기준 | 통과 | `AUTH_URL` alias와 `trustHost` 동작을 문서 기준으로 반영 |
| Vercel 기준 | 통과 | `VERCEL_URL`은 커밋별 deployment URL이므로 OAuth callback 기준에서 제외 |

## 6. 다음 대화 핸드오프 프롬프트

```text
C:\Develop\greenhub 작업을 이어서 해줘.

반드시 먼저 읽을 문서:
- docs/specs/ops/preview-auth-url-policy.md
- docs/URLS.md
- docs/CRITICAL_LOGIC.md
- docs/memory.md

현재 상태:
- PR #7(`codex/kakao-auth-k6-hardening`)은 Draft 상태로 유지한다.
- Preview auth URL 정책은 별도 브랜치 `codex/preview-auth-url-policy`에서 문서 PR로 분리한다.
- `.codex/` 비추적 파일은 로컬 산출물이므로 stage하지 말 것.

조사 결론:
- consumer와 driver는 Preview에도 `NEXTAUTH_URL`이 있어 Preview에서 production callback으로 잡힌다.
- seller는 Preview `NEXTAUTH_URL`이 없어 현재 요청 Host, 즉 커밋별 Preview callback으로 잡힌다.
- 세 앱의 `auth.ts` 구조는 본질적으로 동일하며, 차이는 코드 분기가 아니라 Vercel env 적용 환경이다.
- 커밋별 Preview URL은 카카오 Redirect URI에 등록하지 않는다.
- Preview 로그인 완료 smoke가 필요하면 stable branch Preview alias 또는 Auth.js redirect proxy 정책으로 별도 승인 후 진행한다.

이번 목표:
1. `docs/specs/ops/preview-auth-url-policy.md`의 아토믹 태스크와 정합성 검토를 최신 상태로 확인한다.
2. `docs/URLS.md`의 Preview auth URL 정책과 카카오 Redirect URI 목록이 충돌하지 않는지 검토한다.
3. 필요하면 Vercel env 변경안만 제안하고, 실제 env 변경은 사용자 승인 전 실행하지 않는다.
4. 카카오 콘솔 Redirect URI 변경도 사용자 승인 전 실행하지 않는다.
5. 문서 PR을 열 준비가 되면 검증 결과와 남은 승인 항목을 PR 본문에 정리한다.

금지:
- production 쓰기 요청
- production baseline 부하
- staging/preview k6 baseline 무승인 실행
- 카카오 OAuth 반복 호출
- 커밋별 Preview URL의 카카오 Redirect URI 등록
- PR #7 범위에 정책 문서를 섞는 것

최소 검증:
- git diff --check
- git diff --name-only origin/main...HEAD
```

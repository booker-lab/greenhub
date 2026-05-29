# Critical Logic archive — 2026-05-29

> Source: docs/CRITICAL_LOGIC.md active file trim. Archived range: #CL-19~#CL-39 (2026-05-08~2026-05-21).


## [결정 #CL-19] (SUPERSEDED by #CL-20, 2026-05-10) MVP 출시 전 이메일 로그인 코드 전면 제거 (2026-05-08)

**상태**: 세션22(2026-05-10)에 #CL-20 옵션 B 헤더 게이팅으로 대체. `E2E_TEST`/`NEXT_PUBLIC_E2E_TEST` 게이트는 production 보안 결함을 유발했고(폼 노출), 옵션 B는 폼 자체를 노출하지 않으면서 e2e 인증을 헤더 토큰으로 게이팅한다. MVP 출시 정리는 #CL-20을 따른다.

---

## [결정 #CL-20] 옵션 B — 헤더 게이팅 기반 E2E 인증 (2026-05-10, 세션22)

**배경**: `E2E_TEST=true` env 게이트는 Vercel Production env에 잘못 설정 시 일반 사용자에게 이메일 폼이 노출되는 결함이 있었다(세션19~20 부수효과). 게이트를 env 노출에서 **요청 헤더**로 옮기면 폼 자체가 노출되지 않는다.

**핵심 규칙**:

1. `apps/{seller,consumer}/src/auth.ts`의 Credentials Provider는 **상시 등록**하되 `authorize(credentials, request)`에서 `request.headers.get('x-e2e-test-token')`이 `process.env.E2E_TEST_SECRET`과 정확히 일치할 때만 통과. 그 외(헤더 부재·SECRET 미설정 포함) **즉시 null 반환**.
2. `login/page.tsx`의 `showCredentials` 플래그는 항상 false로 고정(env 미존재). 폼은 어떤 환경에서도 DOM에 렌더링되지 않는다.
3. `apps/e2e/playwright.config.ts`에 `extraHTTPHeaders`는 **의도적으로 없음**. 전역 주입 시 Firebase Identity Toolkit 등 third-party 도메인 요청에도 헤더가 따라가 CORS preflight 차단이 발생했기 때문(세션22 확인). 헤더는 `loginViaCredentials` 헬퍼 내부에서 CSRF 취득 · credentials POST 두 호출에만 명시적으로 주입한다.
4. e2e spec의 인증은 `apps/e2e/tests/_helpers/auth.ts`의 `loginViaCredentials(page, base, email, password)` 헬퍼로 통일. NextAuth `/api/auth/csrf` + `/api/auth/callback/credentials` 직접 호출. **UI 폼을 거치지 않는다.**

**로컬 개발 환경 주의사항**: `E2E_TEST=true` 설정 시 `/login` 페이지에 이메일 폼이 렌더링되지만 브라우저에서 폼을 제출하면 **항상 실패**한다. `next-auth/react`의 `signIn('credentials')`는 `x-e2e-test-token` 헤더를 주입하지 않으므로 `authorize()`가 즉시 null을 반환한다. 로컬에서 credentials 인증이 필요하면 `loginViaCredentials` 헬퍼를 e2e 스크립트로 실행하거나 카카오 로그인을 사용해야 한다. 이 동작은 의도된 트레이드오프다(폼은 시각적 잔재).
5. `E2E_TEST_SECRET`은 seller·consumer × Production·Preview·Development(총 6개) Vercel env에 동일값 + `apps/{seller,consumer}/.env.local`·`apps/e2e/.env`에 동일값. 32자(openssl rand -base64 24).

**MVP 출시 직전 정리 항목** (#CL-19 대체):

| # | 파일 | 정리 |
|---|------|------|
| 1 | `apps/{seller,consumer}/src/auth.ts` | Credentials Provider 블록 전체 제거 (Kakao만 남김) |
| 2 | `apps/{seller,consumer}/src/app/login/_form.tsx` | `showCredentials` prop·이메일 폼 분기 제거 |
| 3 | `apps/{seller,consumer}/src/app/login/page.tsx` | `showCredentials` 변수·전달 제거 |
| 4 | Vercel × 6환경 | `E2E_TEST_SECRET` 삭제 |
| 5 | `apps/{seller,consumer}/.env.local`·`apps/e2e/.env` | `E2E_TEST_SECRET` 삭제 |
| 6 | `apps/e2e/tests/_helpers/auth.ts`·`apps/e2e/playwright.config.ts` | helper·extraHTTPHeaders 제거 |
| 7 | `apps/e2e/tests/consumer-auth.spec.ts` | `skipEmailForm` 가드 + 폼 의존 테스트 3건 제거 |

**검증 시나리오** (세션22 통과 기준):
- `curl /login | grep -c 'type="email"'` = 0 (seller·consumer)
- `POST /api/auth/callback/credentials` 헤더 없이 → `Location: /login?error=CredentialsSignin&code=credentials`
- 정상 SECRET 헤더로 → `Location: <callbackUrl>` (성공)

---

## [결정 #CL-21] 옵션 A — Preview env 분리 완료 (2026-05-15, 세션26)

**의도**: 옵션 B는 production·preview에 동일 SECRET을 두므로 SECRET 유출 시 production 인증이 위험. 옵션 A는 Production env에 `E2E_TEST_SECRET` 자체를 두지 않고 Preview env에만 두어 attack surface를 줄인다.

**완료 작업** (4단계 다중 PR):
1. `preview` 브랜치 신설 → Vercel이 3개 앱의 안정적 branch Preview 배포(`{project}-git-preview-…vercel.app`) 자동 생성.
2. 21개 spec `const BASE` 하드코딩 → `process.env.SELLER_BASE/CONSUMER_BASE/DRIVER_BASE ?? fallback` 환경변수화. `apps/e2e/.env`에 Preview URL 추가.
3. `.github/workflows/e2e.yml` 신설 — `preview` 브랜치 push 시 Preview 대상 chromium e2e 실행.
4. Vercel seller·consumer Production env에서 `E2E_TEST_SECRET` 삭제 + 빈 커밋 재배포. Preview·Development만 유지.

**SSO 우회 설계 결정 (Step 3.5)**: Vercel은 Preview 배포를 Vercel Authentication(SSO)로 기본 보호 → e2e가 401을 받는다. Protection Bypass for Automation 시크릿을 3개 프로젝트에 발급(`VERCEL_AUTOMATION_BYPASS_SECRET`)해 우회. **헤더(`x-vercel-protection-bypass`)를 `extraHTTPHeaders`로 전역 주입하지 않는다** — 옵션 B `x-e2e-test-token`과 동일하게 Firebase 등 third-party 호출에 따라가 CORS preflight를 깨기 때문. 대신 `global-setup.ts`가 bypass 쿼리 파라미터로 1회 navigate → Vercel이 발급한 도메인 바인딩 `_vercel_jwt` 쿠키를 `storageState`(`apps/e2e/.bypass-state.json`, gitignore)에 저장 → 모든 spec이 재사용.

**검증 (옵션 B 4종)**: Production seller·consumer는 유효 `x-e2e-test-token` 헤더로도 `error=CredentialsSignin` 거부(세션 쿠키 미발급) — `auth.ts`의 `if (!expected) return null` fail-closed 동작. Preview seller·consumer는 정상 세션 발급. Playwright smoke: seller-orders 11/12·consumer-mypage 9/10 통과(잔여 1건씩은 #CL-23 인증 race 기존 flake).

**후속 필요**: GitHub repo Secrets 등록(`SELLER_BASE`·`CONSUMER_BASE`·`DRIVER_BASE`·`*_BYPASS_SECRET`·`E2E_TEST_SECRET`·`TEST_*`) 후에야 CI 동작. `preview` 브랜치는 `main`과 주기적 동기화 필요.

---

## [결정 #CL-22] 셀러 페이지 분할 — fatal constraint 해소 (2026-05-15, 세션23)

**배경**: CLAUDE.md §1 fatal constraint(단일 파일 500라인 한계)를 두 페이지가 위반했다.
- `apps/seller/src/app/orders/[id]/page.tsx` — 629라인
- `apps/seller/src/app/settlements/page.tsx` — 531라인

향후 UI/UX 리팩토링 진입 전, **동작 변경 없는 순수 구조 분할**로 한계를 해소했다.

**Track A — orders/[id] 분할 (629 → 217)**:
- `_lib.ts` — 유틸·상수 (`toDate`, `formatDeadlineCountdown`, `makePreparedAtOptions`, `READONLY_STATUSES`, `CANCELLABLE_STATUSES`)
- `_hooks/useOrderDetail.ts` — Firestore `onSnapshot` + `productName`·`groupConfig` 보조 fetch
- `_hooks/useOrderDetailActions.ts` — `handlePrepare`·`handleCancel` (detail 페이지 전용 시그니처)
- `_components/OrderInfoSection.tsx` — 상태 헤더 + 상품/공동구매/배송/취소사유 4 Paper
- `_components/PrepareForm.tsx` — 준비 시작 빠른 선택지 UI
- `_components/CancelOrderModal.tsx` — 취소 모달

**Track B — settlements 분할 (531 → 116)**:
- `_lib.ts` — `toKRW`, `toDateStr`, `downloadCSV`
- `_constants.ts` — 타입·`STATUS_LABEL`·`STATUS_COLOR`·`TABS`
- `_hooks/useSettlements.ts` — summary + list fetch + 자동 useEffect
- `_components/DailySummaryTab.tsx` / `PeriodTab.tsx` / `OrdersTab.tsx` / `SettlementListItem.tsx`

**기존 `useOrderActions` 훅과 통합하지 않은 이유**: detail 페이지는 모달 reason 입력 + ISO `preparedAt` + `apiFetch` 사용. 기존 훅은 `prompt()` reason + `datetime-local` 입력 + raw `fetch` 사용. 시그니처와 인증 경로 불일치로 단순 통합 시 동작 변경 위험. 향후 UI 리팩토링 사이클에서 양쪽을 한 번에 정비할 예정.

**정합성 검증**:
- `npx tsc --noEmit` 통과
- `npx next build --webpack` — TypeScript 컴파일 + tsc 통과. Prerender 단계에서 `/admin/banner`가 `auth/invalid-api-key`로 실패하나 admin/banner는 본 작업 범위 외이며 Firebase 환경변수 누락이 원인(사전 결함)
- Biome lint 실행 불가 — `biome.json:35:5`에 trailing comma 파싱 에러(사전 결함, 별도 처리 필요)
- e2e 텍스트 셀렉터("주문 상세", "상품명", "준비 시작" 등) 모두 보존

---

## [결정 #CL-23] e2e 인증 헬퍼 진단 강화 (2026-05-15, 세션24)

**배경**: 세션23 분할 리팩토링 회귀 검증을 위해 셀러 spec 3종(`seller-orders`, `seller-order-detail`, `seller-settlements`)을 chromium+mobile 2 projects로 실행한 결과, mobile 편중의 flake가 관측되었다. 페이지 스냅샷이 모두 카카오 로그인 페이지였는데, `loginViaCredentials`가 success를 반환한 직후의 케이스였다.

**진단**: `apps/e2e/tests/_helpers/auth.ts`에 set-cookie 헤더 카운트 + BrowserContext cookie jar 검증을 추가한 결과, 실패 케이스에서 `set-cookie count=0, body.url=null`이 일관되게 관측됨. NextAuth credentials POST가 200 OK + 빈 body + set-cookie 없음을 반환하는 케이스다.

**root cause 가설**: Vercel function 또는 Railway `/auth/login` 호출의 일시적 실패. 다음 정황 근거:
- mobile 단독 26/26 통과, chromium 단독 25/26 통과 (각 단독은 95~100%)
- chromium+mobile 합치면 44/52로 악화 (약 85%)
- workers=1로 직렬 실행해도 41/52 — 동시성 race 아님
- 시간에 따른 누적 효과로 추정 (rate limiting 또는 Railway cold-start)

**결정**: helper에서 명시적 throw로 가시화 (단일 시도). playwright test-level `retries: 1`이 의미 있게 동작하도록 cookie 누락을 즉시 throw한다. retry 루프를 helper에 넣으면 인증 호출 빈도가 늘어나 부하가 증가하므로 채택하지 않음(실험 검증: retry 3회 + 600ms wait → 19 fail로 악화).

**해소 보류 사유**: 분할 리팩토링과 무관한 인증 인프라 이슈이며, 본 세션의 1차 목적(세션23 회귀 검증)은 0건으로 완료되었다. 본격 해소는 다음 후속 작업에서 진행:
- `storageState` 패턴 도입 검토 — global setup에서 1회 로그인 + 모든 spec 재사용, Railway 인증 호출 N→1
- Railway `/auth/login` latency·실패율 계측
- Vercel function cold-start mitigation 검토

**helper 변경 요지**:
- credentials POST 후 `page.context().cookies(base)`에서 `authjs.session-token` 존재 검증
- 미발견 시 `set-cookie count`·`body.url`·`cookie names` 포함 throw
- retry 루프 미도입 (단일 시도, playwright 레벨 retry에 위임)

---

## [결정 #CL-25] 사전 결함 정리 및 메모리 정정 (2026-05-15, 세션25)

**배경**: 세션23·24 결과 보고서에서 "별도 처리 필요" 항목으로 분리됐던 작업 중 **e2e 무영향**인 것만 묶어 처리. e2e 영향이 큰 옵션 A 보강(#CL-21)은 별도 다단계 세션으로 보류.

**처리 항목**:
1. **biome.json:35 trailing comma 제거** — 셀러 앱 lint 실행 사각지대 해소. `npx biome check apps/seller/src` 정상 실행 확인 (55 errors는 import 정렬 등 사전 결함, 본 작업 범위 외).
2. **`.gitignore` 보강** — `.env.vercel.tmp`·`apps/*/.env.vercel.tmp` 패턴 추가로 Vercel CLI 임시 환경변수 파일의 우발 커밋 차단. `apps/seller/tsconfig.tsbuildinfo`는 `.gitignore:25` 패턴 존재에도 추적되고 있어 `git rm --cached`로 추적 해제. `apps/seller/public/sw.js`는 next-pwa 빌드 산출물이지만 Vercel 정적 서빙 보장 목적으로 의도적 추적 유지(.gitignore 주석 명시).
3. **메모리 정정** — `project_status.md`의 "driver app 옵션 B 헤더 게이팅 적용" 항목 제거. 검증 결과 `apps/driver/src/auth.ts`에 Credentials provider 자체가 없으므로(Kakao OAuth 전용) 게이팅 대상 부재.

**옵션 A 보강(#CL-21) 별도 처리 사유**: 현재 21개 spec의 `BASE`가 Production 도메인 하드코딩 상태. Production env에서 `E2E_TEST_SECRET`을 단순 제거하면 e2e 인증 전체가 깨짐. ① Preview alias 확보 → ② spec BASE 환경변수화 → ③ CI를 alias 대상으로 → ④ Production env 제거 4단계 다중 PR이 필요하므로 단일 세션 부적합.

**검증**:
- `git check-ignore -v` — 3개 패턴 모두 매치 확인
- `git status` — `.env.vercel.tmp` 미추적 확인
- `Grep "Credentials" apps/driver/src/` — 0 매치 재확인

---

## [결정 #CL-26] e2e CI 활성화 — repo Secrets + preview 자동 머지 (2026-05-16, 세션27)

**배경**: #CL-21(세션26)에서 `.github/workflows/e2e.yml`을 신설했으나 GitHub repo Secrets 미등록으로 미가동 상태였다. 이를 가동시키고 `preview` 브랜치 상시 동기화 체계를 확정.

**결정 1 — Secrets 등록 방식**: `gh secret set` CLI 사용. `apps/e2e/.env`(gitignore) 11개 값을 그대로 repo Secrets로 등록. gh CLI는 winget으로 설치(2.92.0), `booker-lab` 계정 인증(ADMIN).

**결정 2 — preview 동기화: 자동 머지 워크플로 채택** (수동 머지 대비):
- `.github/workflows/sync-preview.yml` — `main` push 시 `preview` 체크아웃 → `merge origin/main` → push.
- **GITHUB_TOKEN 재귀 방지 이슈**: GITHUB_TOKEN으로 만든 push는 다른 워크플로의 `push` 트리거를 발화시키지 않음 → `preview` push가 `e2e.yml`을 자동 실행하지 못함. 해소: sync 잡 마지막에 `gh workflow run e2e.yml --ref preview`로 명시 디스패치(`workflow_dispatch`는 재귀 방지 대상 아님).

**결정 3 — e2e.yml pnpm 버전**: `pnpm/action-setup`의 `version: 9` 고정 제거. `package.json` `packageManager`(pnpm@10.32.1)와 충돌(ERR_PNPM_BAD_PM_VERSION). 액션이 packageManager 필드를 자동 인식하도록 위임.

**가동 결과**: CI end-to-end 정상 (124 passed, 아티팩트 업로드). 37건 실패는 전부 셀러 인증 spec, `auth.ts:64` 진단이 잡은 `set-cookie count=0` → **#CL-23 인증 race**. 셀러앱 코드 무변경이므로 회귀 아님. CI 풀런은 spec별 독립 인증으로 race를 로컬 대비 증폭(4→37건) → #CL-23 storageState 도입 시급성 입증.

**잔여 운영 메모**: sync-preview가 e2e를 즉시 디스패치하므로 Vercel preview 재빌드 중 실행될 수 있음. #CL-23 해소 후 배포 readiness 대기 단계 추가 검토.

---

## [결정 #CL-27] e2e 인증 storageState 패턴 도입 — #CL-23 race 해소 (2026-05-16, 세션28)

**배경**: #CL-23 인증 race가 세션27 e2e CI 풀런(run 25926181316)에서 37건 실패로 재현. spec마다 `beforeEach(loginViaCredentials)`가 NextAuth credentials POST를 호출 → 인증 호출이 N×spec으로 누적, `set-cookie count=0`(200 OK + 빈 set-cookie) race가 시간 누적으로 증폭됐다.

**T0 — 실패 37건 증거 기반 재분류** (run 로그 + error-context 37개 page snapshot):
- **A 인증 race 23건** — `auth.ts` throw `set-cookie count=0`. seller-orders·product-create·products·settlements:30. → storageState 해소 대상.
- **B Railway API `Failed to fetch` 5건** — 페이지는 인증·렌더 정상, REST 호출만 실패. consumer-groupbuy·mypage, seller-onboarding ×2, seller-settlements:98.
- **C waitForLoadState 타임아웃 2건** — perf-css-regression ×2.
- **D 대시보드 realtime 미정착 8건** — seller-home-dashboard ×7 + seller-orders:65(인증 race에 가려져 있던 데이터 의존). Firestore 리스너가 `연결 중`에서 미정착.
- 진입 가이드의 「셀러 33건 = 전부 A」 가설을 반증 — A는 23건뿐.

**결정**: Playwright `globalSetup`에서 seller·consumer 1회씩 로그인 → `.auth-state.json` storageState 저장 → 인증 spec이 `test.use({ storageState })`로 재사용. 인증 호출이 풀런당 **67회(인증 테스트 수)+retry → 2회**로 감소.
- `.bypass-state.json`(SSO 우회 쿠키만)·`.auth-state.json`(우회 + 세션 쿠키) 2파일 분리 발급. 미인증 spec은 기본 `.bypass-state.json` 유지.
- driver 제외 — Credentials provider 부재(Kakao 전용, #CL-25).

**globalSetup 재시도 — #CL-23의 helper-retry 기각과 구분**: #CL-23은 helper 내 retry를 기각했다(spec×테스트마다 retry → N 증폭, 실험상 악화). 본 결정의 retry는 **globalSetup 단일 지점**에 둔다 — 최대 3회(2s 간격)여도 풀런당 2~6회로, N을 키우지 않는다. globalSetup이 풀런 단일 진입점이라 1회 race에 전체가 0건 중단되므로(T3 관측), 기저 race를 흡수하되 소진 시 throw로 fail-fast 유지.

**검증 — T4 e2e CI 2회 연속 풀런**:
- 베이스라인(s27) 124 passed / 37 failed → run 25951442053 **145/16**, run 25952075877 **146/15**.
- `set-cookie count=0` 두 풀런 모두 **0건** — 인증 race 23→0 해소 확정.
- 잔여 14~15건은 전부 B·C·D (storageState 무관). 두 풀런 차이는 `consumer-home:15`(Railway 데이터 flake) 1건뿐.

**잔여 후속**: B·C·D는 BACKLOG §12-2에 분리 기록. Railway `/auth/login` 로그 기반 latency 계측은 Railway 대시보드 접근 필요(미수행) — 인증 호출 N→1 감소는 e2e 구조상 확정(67+→2).

---

## [결정 #CL-28] Railway API CORS — Vercel preview origin 패턴 허용 (2026-05-16, 세션29)

### 결정: `main.ts` origin 콜백에 팀 스코프 한정 정규식 추가

**배경**: 세션29 T0에서 잔여 e2e 실패 B(5건)·D(8건)를 trace로 재조사한 결과 **단일 근본 원인**이 드러났다. 두 분류 모두 브라우저 콘솔에 동일 CORS 에러:
> `Access to fetch at 'https://api-production-13e7.up.railway.app/...' from origin 'https://greenhub-seller-git-preview-...vercel.app' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header`

- **B** = 앱 `apiFetch`(REST) 호출이 preview origin에서 CORS 차단 → `Failed to fetch`.
- **D** = `useFirebaseAuth`의 `/auth/firebase-token` fetch가 같은 CORS로 실패 → `signInWithCustomToken` 미실행 → `firebaseReady=false` → 대시보드 indicator가 `연결 중` 고착. **D는 독립 버그가 아니라 B의 하위 증상.**
- 진입 가이드의 cold-start 가설 반증: 실패가 풀런 04:24~04:34 전구간 분포(초반 편중 아님), `firestore.googleapis.com`은 정상 200 → Railway origin만 선택적 차단 = CORS 일치.

**원인**: `main.ts`의 `allowedOrigins.includes(origin)`는 정확 일치만 허용. Railway `CORS_ORIGIN` env에 프로덕션 도메인만 있고 Vercel preview 배포 도메인은 누락. preview URL은 브랜치/배포마다 달라 정적 목록으로 관리 불가.

**결정**: origin 콜백에 정규식 한 줄 추가 —
`/^https:\/\/[a-z0-9-]+-git-[a-z0-9-]+-jos-projects-d1cecc0c\.vercel\.app$/`
- `jos-projects-d1cecc0c` **팀 스코프로 한정** — 임의 `*.vercel.app` 전체 개방 아님(`credentials: true` 환경 보안 고려).
- `-git-` 필수 매칭 → 브랜치 preview만 허용, 프로덕션 Vercel alias는 비대상.
- 검증: seller·consumer·driver preview 3종 통과 / 프로덕션 도메인·타 팀·임의 vercel.app 거부.

**적용 조건**: 코드 머지만으로는 무효 — Railway API 재배포 필요. `c5ee52f` push가 Railway GitHub 자동 재배포를 트리거.

**검증 완료 (2026-05-16 세션29)**: 재배포 후 preview origin(`*-git-*-jos-projects-d1cecc0c.vercel.app`)에 `Access-Control-Allow-Origin` 발급·비매칭 origin(`evil.example.com`) 차단을 curl preflight로 확인. e2e 풀런 run 25957177092 결과 **167 passed / 0 failed / 11 skipped** — B 5건·D 8건 동시 해소, 인증 race 0건 유지. D spec은 변경하지 않음(완화 시 "정상 미연결"과 버그 구분력 상실 — 가이드 D 정합성 검토 준수).

---

## [결정 #CL-29] 누적 결정 로그 한도 정책 — 모듈화 예외 + 크기 기반 아카이브 (2026-05-16, 세션30)

### 결정: `CRITICAL_LOGIC.md`는 500라인 모듈화 한도의 예외, 단 1000라인 초과 시 종결 엔트리 아카이브

**배경**: 본 파일이 #CL-28까지 누적되어 1415라인에 도달, CLAUDE.md §1의 단일 파일 500라인 모듈화 한도와 충돌. 세부 옵션 3종(분기별 archive / 도메인별 분리 / 한도 예외 명시)을 검토.

**검토 결과**:
- 500라인 한도는 본질적으로 **코드 모듈의 리팩토링 트리거** — "단일 책임이 비대해졌으니 분리하라"는 신호다. 시계열 append-only 결정 로그는 분리해도 복잡도가 줄지 않고 **이력만 파편화**된다.
- 옵션 1(분기별): `#CL-xx` 연속 번호가 분기 경계로 끊기고, 타 문서의 앵커 참조가 다수 깨짐.
- 옵션 2(도메인별): 시계열 흐름 파편화 + 결정 기록 시마다 도메인 판단 비용 발생.
- 옵션 3(예외 명시): 규칙을 파일 성격에 맞게 정직하게 만듦. `BACKLOG.md`·memory 아카이브도 동일 부류.

**결정 (옵션 3 변형)**:
1. `CRITICAL_LOGIC.md`·`BACKLOG.md`·memory 아카이브는 누적 시계열 로그이므로 **500라인 모듈화 한도 예외**로 CLAUDE.md §1에 명시.
2. 무한 증가 방어: `CRITICAL_LOGIC.md`가 **1000라인 초과 시** 종결·SUPERSEDED 엔트리만 `docs/archive/`로 이관, 활성 파일 **~500라인**으로 축소. 캘린더가 아닌 **크기 기준** + 죽은 엔트리만 이관 → #CL 연속성·앵커 링크 보존.

**적용 (세션30)**: `#CL-19`(2026-05-08) 경계로 분할. 2026-03~04 #CL 이전 종결 엔트리 1208라인을 `archive/CRITICAL_LOGIC_archive_20260516.md`로 이관. 활성 파일 1415→229라인(헤더 + #CL-19~#CL-29 + 아카이브 포인터). 정합성 검토: #CL 참조 링크 무손상, 아카이브 이동 섹션 참조 2건(`BACKLOG.md` 거점 픽업·`orders.md` 판매자 취소 권한) 경로 정정.

---

## [결정 #CL-30] Railway throttler 전역 누수 수정 + /auth/login latency 계측 (2026-05-16, 세션31)

### 배경: P2-A 계측 — Railway에는 요청 로그가 없다

P2-A(Railway `/auth/login` latency 계측)는 세션28·29·30에 3회 이월된 항목. Railway CLI(4.35.0, `tazan1988`) 로그인으로 대시보드 없이 접근 가능 확인. 단 Railway 배포 로그에는 NestJS 부팅 로그만 있고 **요청 단위 로그·latency 계측이 전무**(`TimestampInterceptor`는 응답 직렬화 전용, 요청 로깅 인터셉터 없음) → 기존 로그에서 latency 추출 불가. synthetic 측정 스크립트 `scripts/measure-api-latency.mjs` 도입(60초 윈도우당 8회 페이싱).

### 발견: ThrottlerModule 전역 누수 (설정 버그)

측정 중 `/health`가 ~10~19회 후 429 반환. 429 응답 body `ThrottlerException` + 헤더 `retry-after-auth: 60`·`x-ratelimit-limit: 100`으로 확정 — NestJS `ThrottlerModule`은 등록된 **모든** named throttler를 **전 라우트에 전역 적용**한다. `app.module.ts`가 `default`(100/분)·`auth`(10/분) 2개를 등록 → 모든 엔드포인트가 binding 한도 10/분에 묶임. `@Throttle({ auth: {} })` 데코레이터는 throttler를 *스코프*하지 않고 옵션만 오버라이드하므로, `auth` throttler 등록 자체만으로 `/health`·`/products` 등 비인증 라우트까지 10/분 제한. 주석의 의도("일반 100, 인증 10")가 무효화된 상태였다.

영향 범위: throttler 스토리지 키는 라우트별로 분리돼 일반 사용자는 여러 엔드포인트로 분산 → 가시적 장애는 드물었으나, 단일 엔드포인트 >10/분 호출 시 429(Railway 헬스체크·실시간 폴링 등 잠재 위험).

### 결정: 단일 `default` throttler + 인증 라우트 @Throttle 오버라이드

- `app.module.ts`: `auth` throttler 제거, `default`(100/분) 단일 등록.
- `auth.controller.ts`: register·login·kakao-login·refresh의 `@Throttle({ auth: {} })` → `@Throttle(AUTH_THROTTLE)`, `AUTH_THROTTLE = { default: { limit: 10, ttl: 60000 } }` — 전역 `default`를 해당 라우트에서만 10/분으로 오버라이드.
- 일반 100/분·인증 10/분 의도 복원. `@SkipThrottle()`(firebase-token·payments webhook)은 단일 throttler에서도 정상.
- **적용 조건**: 코드 머지만으로 무효 — Railway 재배포 필요. 커밋 `23e3528` push가 Railway GitHub 자동 재배포 트리거.

### P2-A latency 계측 결과 (재배포 전, commit `c5ee52f` 기준)

측정 환경: Railway 리전 `asia-southeast1`(싱가포르) ↔ 측정 클라이언트.

| endpoint | n | min | p50 | p95 | p99 | 실패율 |
|----------|---|-----|-----|-----|-----|--------|
| GET /health | 60+ | 379ms | 409ms | ~440ms | (cold 1.0~1.1s) | 0% |
| POST /auth/login | 24 | 848ms | 922ms | 1551ms | 1687ms | 0% |

- `/health` 정상 구간 379~443ms — 순수 네트워크 왕복. 매 프로세스 첫 요청만 ~1.0s(DNS+TLS+undici 초기화).
- `/auth/login` 서버 작업 ≈ 922−410 ≈ **~510ms** (Firestore email 조회 + bcrypt factor-12 비교 + JWT 서명 + Firestore 토큰 set). bcrypt 12가 지배적.
- p95/p99(1.5~1.7s)는 62초 idle 후 첫 요청의 keep-alive 소켓 만료→TLS 재handshake 영향 — 서버 tail 아닌 측정 아티팩트.
- 0% 실패. #CL-23으로 인증 호출은 풀런당 2회로 구조상 확정 → ~0.9s steady latency는 e2e 차단 요인 아님(#CL-28 cold-start 반증 재확인). P2-B는 별도 데이터 불필요로 판단.

### 검증 (재배포 후, 2026-05-16)

커밋 `23e3528` Railway 자동 재배포 완료 후 응답 헤더로 확인:
- `GET /health` → `x-ratelimit-limit: 100` — fix 전 `auth`(10/분) → `default`(100/분) 회복.
- `POST /auth/login` → `x-ratelimit-limit: 10` — `@Throttle` 오버라이드 정상 동작, brute-force 방어 유지.
- 일반 100/분·인증 10/분 의도 복원 확인.

**부수 관측**: 응답 헤더 `x-ratelimit-remaining`이 연속 요청에 격번 감소(99→99→98→98) → Railway가 복수 컨테이너로 분산 처리 중. NestJS throttler 스토리지는 컨테이너별 in-memory라 단일 IP 실효 한도가 컨테이너 수만큼 배수가 된다(본 수정 이전부터의 특성, 신규 결함 아님). 엄격한 전역 제한이 필요하면 공유 스토리지(Redis) 백엔드가 필요 — 본 수정 범위 외, 필요 시 별도 항목으로 등재.

---

## [결정 #CL-31] seller Firebase SDK 지연 초기화 — `/admin/banner` prerender 실패 해소 (2026-05-17, 세션33)

### 결정: `getAuth`/`getStorage`를 모듈 로드 시점이 아닌 첫 사용 시점에 초기화

**배경**: #CL-22 세션23 빌드 검증에서 사전 결함으로 기록만 했던 `/admin/banner` prerender 실패(`auth/invalid-api-key`)를 본 세션에서 종결. 로컬 빌드(`pnpm build`)로 재현 — `Generating static pages` 단계에서 `/admin/banner` prerender가 `FirebaseError: auth/invalid-api-key`로 크래시하며 빌드 중단.

**원인**: `apps/seller/src/lib/firebase.ts`가 모듈 최상위에서 `getAuth(app)`를 평가. Firebase Auth의 `getAuth()`는 `apiKey`가 없으면 **동기적으로 `auth/invalid-api-key`를 throw**한다(`getStorage`·`initializeApp`·`getFirestore`는 미throw). Next.js 빌드는 prerender 단계에서 페이지 모듈 그래프를 평가 → firebase를 import하는 첫 페이지(`/admin/banner`, 알파벳 우선)가 throw → 빌드 전체 abort. `/admin/banner` 자체 버그가 아니라 firebase 모듈 로드 부수효과.

**Vercel 무영향 확인**: seller 앱은 Vercel에 정상 배포·동작 중(e2e 풀런 167/0). `NEXT_PUBLIC_*`는 빌드 시점 인라인이므로 Vercel 빌드 env에는 firebase 변수가 존재 → Vercel 빌드는 깨지지 않음. 실패는 firebase 변수가 비표준 파일 `apps/seller/.env.vercel.local`에만 있고 Next.js가 로드하는 `.env.local`엔 없는 **로컬·env 미주입 빌드 한정**. BACKLOG의 "Vercel 환경변수 점검" 항목은 데이터상 불필요 — Vercel 대시보드 조치 없이 코드로 종결.

**결정**: `getAuth`/`getStorage`를 지연 초기화 함수 `getFirebaseAuth()`/`getFirebaseStorage()`로 전환(메모이즈). 사용처(`useFirebaseAuth`·`useOrders`·`onboarding`·`ImageUpload`·`admin/banner`)가 전부 `useEffect`·async 핸들러 = 클라이언트 런타임이라 모듈 로드 시점 평가가 불필요. prerender(SSR)는 `useEffect`를 실행하지 않으므로 firebase 인증을 더 이상 평가하지 않는다. `db`(`getFirestore`)는 미throw이므로 즉시 초기화 유지. consumer 앱 `firebase.ts`는 `getAuth`/`getStorage` 미사용이라 무영향(수정 불필요).

**검증**: env 미주입 로컬 빌드 — 수정 전 `/admin/banner` prerender 크래시 재현, 수정 후 빌드 성공(전 라우트 정상 출력). 커밋 `32738fb`.


---

## [결정 #CL-32] seller 프론트엔드 리팩토링 — SDD 레이어 분리 (2026-05-17, 세션36)

### 결정: 셀러앱 프론트엔드를 5개 Phase로 구조 정비

**배경**: 사용자 요청으로 셀러앱 프론트엔드 전수 진단 후 리팩토링. `ProductForm.tsx` 705라인 = Fatal Constraint(500라인) 위반. API 호출 방식 3종 파편화, `useAdmin.ts` 462라인(거의 동일한 훅 7개 복붙), `useOrderActions`↔`useOrderDetailActions` 시그니처 불일치(BACKLOG P3), 페이지 셸/상태 UI 중복.

**Phase 1 — ProductForm 분리**: `ProductForm.tsx` 705→154라인. `useProductForm`(상태·draft·AI·검증·제출 240줄) 훅 + `productForm.types.ts`(타입·상수·defaultForm) + `Step1Basic`/`Step5Pricing` 스텝 본문 + `StepIndicator` + `FormPrimitives`(FieldCard·ChoiceRow 공유) 추출.

**Phase 2 — API 레이어 통일**: `lib/api.ts`에 `apiJson<T>()` + `ApiError` 추가. `res.ok` 검사·JSON 언래핑·서버 `message` 추출을 한 곳에 묶음. 기존 `apiFetch`(raw Response)는 유지. ProductForm·useOrderActions의 raw `fetch` 마이그레이션.

**Phase 3 — useAdmin 팩토리화**: 462→341라인. 제네릭 `useAdminList<T>`(data/loading/error + 토큰 가드 + 자동 로드) 코어 + `runAction`/`withQuery`/`pick` 헬퍼. 7훅이 코어 위 얇은 래퍼로 재작성. 부수 효과 — !res.ok·네트워크 오류 메시지가 `apiJson` 경유로 단일화("…조회 중 오류 발생").

**Phase 4 — 주문 액션 훅 통합 (BACKLOG P3 종결)**: 공통 코어 `useOrderStatusUpdate`(PATCH·loading·error) 신설. `useOrderActions`(OrderCard·prompt 취소)와 `useOrderDetailActions`(상세·모달 취소)가 코어를 공유 — fetch·에러 처리는 한 곳, 사유 입력 UI만 래퍼에서 분기. 시그니처는 `updateStatus(status, extra)`로 통일. 두 훅의 외부 반환 형태는 보존(소비처 무수정).

**Phase 5 — 공통 UI 컴포넌트**: `components/`에 `PageShell`·`PageHeader`(sticky prop)·`EmptyState`·`LoadingState` 신설. 표준 헤더·로딩·빈 상태를 쓰던 9개 페이지 치환(products·orders·order detail·product edit·settings·settlements·hubs×3 + ProductForm). 로딩 표시를 `LoadingState`(스피너)로 통일 — 일부 페이지의 "불러오는 중…" 텍스트 변형 제거.

**제외**: `app/page.tsx`(홈)는 `100dvh` 사용 — PageShell `100vh` 치환 시 모바일 뷰포트 회귀 우려로 미변환. admin `page.tsx`+`_client.tsx` 분리(#CL-31 패턴)는 의도된 설계라 유지.

**검증**: `pnpm --filter seller build` 성공 — TypeScript 통과, 22개 라우트 전부 생성. biome lint 신규 에러 0건(잔존 2건은 `VarietySelector`·`app/page.tsx` 사전 결함). e2e는 push 시 CI에서 검증(베이스라인 167 passed).


---

## [결정 #CL-33] 셀러앱 내비게이션 IA 재구성 — 홈 진입점 + 준비 탭 (2026-05-18, 세션39)

### 결정: BottomNav 5탭 재편 + 홈 대시보드 재구성

**배경**: #CL-32는 코드 구조 정비였고 내비게이션 IA는 미감사. 세션38 전체 페이지 UX 감사에서 3대 문제 도출 — ① 홈(`/`)이 고아 페이지(BottomNav에 홈 진입점 없음) ② 홈 대시보드 정보 밀도 얕음 ③ 준비 물량이 주문 건별로 흩어짐. 네이버 스마트스토어센터 벤치마크로 플랜 수립(`docs/specs/frontend/seller-home-dashboard-plan.md`), 세션39에서 8 아토믹 태스크로 구현.

**홈 진입점**: `PageHeader`에 `position:absolute` 정중앙 홈 아이콘 추가. `usePathname()`으로 홈 경로에서는 숨김. 좌측 뒤로가기와 분리 — 좌/우 zone 길이와 무관하게 위치 불변.

**BottomNav 재편**: `주문·상품·정산·거점·설정` → `주문·상품·정산·준비·설정`. 거점 탭 제거 — 거점 관리(`/hubs` 이하)는 한 번 맞추는 구성 작업이라 설정 하위로 이동(설정에 "거점" 섹션 신설). `/hubs` 라우트·로직은 불변, 진입 경로만 설정 경유로 변경. 준비(`/prep`) 탭 신설 — 셀러의 매일 핵심 업무라 하단 고정. **주문 탭=건별 처리, 준비 탭=상품별 집계**로 역할 분리.

**홈 대시보드**: "오늘 할 일" 카드(명령형 체크리스트 — 신규 주문/발송 지연/비활성 상품, 건수 0이면 줄 숨김) + 현황 카드 3개(주문 파이프라인 4칸·정산·상품). 카드 기준은 "변하는 현황이 있는 영역만" — 설정·거점은 구성이라 제외. 정산 summary만 신규 fetch(`useDashboardSummary`, `apiJson`), 나머지는 기존 Firestore 실시간 훅 재사용.

**준비 물량 집계**: 주문 1건=상품 1개 구조라 `productId`별 `quantity` 합산이 곧 픽업 리스트. 미발송 상태(`ACCEPTED`/`CONFIRMED`/`PREPARING`)만, `requestedDeliveryDate` 기준 오늘분(집계표)/지연분(섹션) 분리, 미래분 제외. **공동구매는 배송일이 `groupProductConfig` 별도 문서라 1차 범위 제외**(사용자 결정) — 후속 작업으로 BACKLOG 등재.

**원칙**: 기존 훅·API·비즈니스 로직 불변 — UI·내비게이션 레이어만. e2e 영향 점검 — 거점 관련 spec은 `/hubs` URL 직접 접근이라 BottomNav 탭 제거 무영향.

**검증**: T1~T8 각 1커밋, 타입체크·`pnpm --filter seller build`(23라우트) 성공, biome 신규 에러 0건. e2e 풀런 **170 passed / 0 failed / 11 skipped**(run 26017068777) — `seller-home-dashboard.spec.ts` 새 레이아웃으로 재작성·`seller-prep.spec.ts` 신설로 신규 베이스라인 170(기존 167+3). 커밋 `7a01168`~`fd34c65`.

---

## [결정 #CL-34] 일반 주문 슬롯 검증을 선택 배송일 기준으로 (2026-05-20, 세션49)

### 결정: `orders-create.service`의 `capId` 산출을 `new Date()` 당일 고정에서 `dto.requestedDeliveryDate`로 전환

**배경**: 세션48까지 소비자 측 배송일 선택 UI(T1)와 체크아웃·장바구니 전달(T2)이 완성되어 일반 주문은 `requestedDeliveryDate`를 가지고 API에 도달하지만, `orders-create.service.ts`는 여전히 `new Date()` 당일 기준으로 `capId`를 산출해 슬롯 검증·차감이 주문일에 묶여 있었다. 소비자가 미래 일자를 선택해도 검증 대상은 **오늘** 슬롯이라 UX(미래 일자 선택 가능)와 서버 측 검증(오늘만 검증)이 어긋났다. 세션49에서 마지막 고리를 잇는다.

**DTO 필수화**: `CreateOrderDto.requestedDeliveryDate`에 `@ValidateIf((o) => o.saleType === 'normal' && o.deliveryMethod !== 'parcel')` + `@Matches(/^\d{4}-\d{2}-\d{2}$/)` 적용. **분기 조건은 서비스 레이어의 슬롯 검증 가드(84줄)와 완전 동일** — 슬롯 검증 대상은 필수, 그 외(택배·공동구매)는 옵셔널 유지(null 저장). 입력 누락 시 400(BadRequest)으로 사전 차단.

**capId 산출 이동**: `dateStr`/`capId` 산출을 트랜잭션 바깥(`new Date()` 고정)에서 슬롯 검증 분기(`deliveryMethod !== 'parcel' && saleType !== 'group'`) 안으로 이동. `dateStr = dto.requestedDeliveryDate!`(non-null 단언은 ValidateIf 동치성으로 안전), `capId = ${storeId}_${dateStr}` 그대로. 택배·공동구매 분기는 `capId`를 산출하지 않으므로 어떤 영향도 없음.

**저장값 유지**: 163줄 `requestedDeliveryDate: dto.requestedDeliveryDate ?? null`은 변경 없음 — 택배·공구는 `null`, 일반 주문은 선택 일자가 저장되어 셀러 준비 탭(#CL-33) 집계에 그대로 활용 가능.

**원칙**: 비즈니스 로직 변경 최소화 — `usedSlots/totalCap` 차감 로직·에러 메시지 모두 기존 유지. 변경된 것은 "어느 날짜 슬롯을 보는가"뿐. 분기 조건이 DTO·서비스에서 일치하므로 회귀 표면이 작다.

**검증**: T3 1커밋(`4e1576a`), `apps/api` 타입체크 통과. 기존 jest 1건(`app.controller.spec.ts`)은 baseline에서도 실패하는 **사전 결함**(FirestoreService provider 누락) — T3 변경과 무관(`git stash`로 검증). 분기 일치성은 코드 리뷰로 확인:

- DTO `ValidateIf((o) => o.saleType === 'normal' && o.deliveryMethod !== 'parcel')`
- service 슬롯 검증 가드 `dto.deliveryMethod !== 'parcel' && dto.saleType !== 'group'`
- saleType=='group'인 경우 ValidateIf가 false라 옵셔널, 서비스에서도 슬롯 검증 분기 미진입 — 정합.
- saleType=='normal' && deliveryMethod=='parcel' → ValidateIf false 옵셔널, 서비스 슬롯 검증 미진입 — 정합.
- saleType=='normal' && deliveryMethod!='parcel' → DTO 필수, 서비스 슬롯 검증 진입 — 정합.

**미해결**: e2e 시드 슬롯 정비(T6, 세션50 이후)는 별건. T4·T5(셀러 주문 탭 IA 보강)는 세션50으로 이연.


---

## [결정 #CL-35] 셀러 주문 탭 IA 재구성 — 일반/공구 대칭 토글 + 공동구매 배송일 조인 (2026-05-20, 세션50)

### 결정: 셀러 주문 탭 최상단에 `SaleTypeToggle`을 두고 일반/공구를 1차 분기, 공구 분기에서는 `groupProductConfig.groupDeliveryDate`를 일괄 fetch해 날짜 그룹의 기준으로 사용

**배경**: 세션48~49로 일반 주문은 신규 생성 시점부터 `requestedDeliveryDate`가 채워지지만, 셀러 주문 탭의 IA는 일반/공구 비대칭이었다. 공구 주문은 `requestedDeliveryDate=null`이라 그 자리에서는 "날짜 미정"으로만 보였고, 실제 배송 예정일(`groupProductConfig.groupDeliveryDate`)은 별도 문서라 셀러가 같은 화면에서 동시에 다루기 어려웠다. 세션47 검토에서 토글 + 조인 패턴 확정.

**토글 1차 분기**: `apps/seller/src/app/orders/_components/SaleTypeToggle.tsx` 신설 — `data-testid="sale-type-toggle-{normal|group}"` 부여(e2e 라벨 충돌 회피). `PageHeader` 아래에 배치, `saleType` 상태(`'normal' | 'group'`, 기본 `'normal'`)로 `filteredOrders`의 가장 바깥 분기. 토글 전환 시 `datePreset='week'`·`customFrom/To=''`로 날짜 필터 초기화(공구는 칩 미노출이라 자연스럽게 무효화), 상태 탭은 유지.

**날짜 칩은 normal 전용**: 공구는 `groupDeliveryDate` 분포가 좁아 1차 미노출(세션47 확정). 코드상 `dateRange` 산출 자체를 `saleType==='normal'`에서만 수행 → 공구 토글에서 날짜 필터 절대 미적용.

**공구 배송일 조인**: 공구 토글 활성 시 `orders` 중 `saleType==='group' && STATUS_GROUP_MAP=activeTab`인 productId를 수집, 신규 훅 `useGroupConfigs(productIds, enabled)`가 Set으로 중복 제거 후 `Promise.all`로 `groupProductConfig` 문서를 일괄 fetch. 정렬된 join key로 의존성 안정화(매 렌더 새 배열 참조에 흔들리지 않음). Firestore Timestamp는 ISO 문자열로 정규화(`useGroupProduct`와 동일 패턴) — 셀러 경로는 `getDoc` 직접 호출이라 `onSnapshot` 자동 변환 없음을 고려.

**`getOrderDate`·`groupOrdersByDate` 시그니처 확장**: 선택 인자 `groupConfigMap?: GroupConfigMap` 추가, 기본 동작은 기존 호출과 동일. `saleType==='group'` 활성 탭에서 `groupConfigMap[productId]?.groupDeliveryDate`를 우선 사용, 미존재면 `null` → "날짜 미정" 그룹으로 안전 처리. 일반 주문 분기는 그대로 — 회귀 표면이 분기 격리로 작음.

**원칙**: 신규 fetch 경로는 공구 토글에서만, 일반 토글은 기존 실시간 구독만 사용. `useOrders` 자체는 불변 — 토글 인지 책임을 페이지로 격리해 훅 SoC 유지.

**검증**: T4 1커밋(`2c6c89d`), T5 1커밋(`bffce2a`). `apps/seller` 타입체크 통과(exit 0), biome 신규 에러 0건(baseline 3개 동일 유지: `page.tsx` 2개 + `_constants.ts` 1개), `pnpm --filter seller build` 통과(23라우트, `/orders` static prerender 영향 없음).

**미해결**: T6(e2e 시드 슬롯 + spec 보강 — 토글/공구 조인 회귀 가드)는 세션51로 이연. e2e에서 `data-testid="sale-type-toggle-group"` 클릭 후 `groupProductConfig` 시드 의존 시나리오 점검 필요.

### T6 후속 (2026-05-20, 세션51): e2e 회귀 가드

**시드 스크립트** `scripts/seed-e2e-orders.mjs` 신설 — `firebase-admin` SDK로 ① 활성 상품 보유 store에 14일치 `dailyCaps`(totalCap=10), ② 셀러 store(`9b2cb652`)에 일반 1건 + 공구 1건 주문(`e2e-` prefix · ACCEPTED), 공구 상품 `groupProductConfig.groupDeliveryDate`(오늘 +7일) 시드. 멱등 set으로 재실행 안전.

**신규 spec**: `apps/e2e/tests/consumer-delivery-date.spec.ts`(2건 — DeliveryDatePicker 활성 일자 노출 + 택배 분기 미노출). `seller-orders.spec.ts`에 T6 섹션(5건 — testid 노출, 토글 전환, 공구 카드 표시, groupDeliveryDate 헤더, datePreset 초기화). 토글 라벨은 `'이번 주' / '직접 입력'`(DATE_PRESETS와 일치).

**수동 검증 보조**: 로컬에서 seller 로그인 set-cookie race(#CL-23)로 풀런이 막힐 수 있어, `docs/specs/frontend/seller-refactor-visual-verify.md` D-T6 섹션(#89~#96)에 시드 후 육안 검증 항목 추가. preview 동기화 후 CI 풀런이 최종 검증 경로.

---

## [결정 #CL-36] 셀러앱 탭 스타일 단일화 — `SegmentedTabs` 공통 컴포넌트 (2026-05-20, 세션54)

**배경**: UX-07 — 셀러 주문 탭(검정 `--color-text` + active 700)과 상품·정산 탭(초록 `--color-primary` + medium)이 시각 패턴 2종으로 혼재. 동일 UI 어포던스를 다르게 표현해 앱 정체성·일관성을 떨어뜨림. 세션53 진단 + 사용자 결정으로 단일화 진입.

**핵심 규칙**:

1. **신설 컴포넌트** `apps/seller/src/components/SegmentedTabs.tsx` (~80라인) — 셀러앱의 모든 페이지 상위 탭은 본 컴포넌트로 통일. Props: `tabs: { key, label, count?, badgeColor? }[]` · `value` · `onChange` · `sticky?` (default false) · `topOffset?` (default `var(--header-height)`) · `layout?: 'flex' | 'scroll'` (default flex).
2. **시각 토큰**: active = `var(--color-primary)`(초록) + `fontWeight 700` + `borderBottom 2px solid var(--color-primary)`. inactive = `var(--color-text-secondary)` + `fontWeight var(--fw-medium)`. 폰트 사이즈는 `var(--font-size-sm)` 통일.
3. **카운트 Badge**: `count > 0`일 때만 Mantine `Badge size="xs"`로 렌더, `badgeColor: 'red' | 'gray'` (default gray). 카운트 0이거나 미정의면 미렌더. 카운트가 항상 있어야 하는 케이스(상품 탭 전체/판매중/비활성 0건도 표시)는 `label`에 인라인.
4. **레이아웃**: `layout='flex'` (균등 분할, 탭 3개 이하) vs `layout='scroll'` (탭 많아 모바일 가로 스크롤 필요, 주문 탭 5+). `flex`는 `flex: 1`, `scroll`은 `overflowX: auto + flexShrink: 0`.
5. **sticky 정책**: 페이지별 IA 결정에 위임 (주문·정산 sticky=true / 상품 sticky=false). sticky=true이면 `top` 기본값 `var(--header-height)`로 헤더 바로 아래에 부착. 매직넘버 직접 지정 금지.

**치환 대상**:
- `apps/seller/src/app/orders/page.tsx:160-195` → sticky + scroll + count + ACTION_REQUIRED 빨강
- `apps/seller/src/app/products/page.tsx:62-94` → flex, 카운트는 label 인라인
- `apps/seller/src/app/settlements/page.tsx:37-69` → sticky + flex, `top: 57` 매직넘버 동시 해소

**범위 외**:
- `apps/seller/src/app/orders/_components/SaleTypeToggle.tsx` 일반/공구 1차 분기 토글 — 다른 토큰(검정·pill 형태)으로 의도적 차별화. SegmentedTabs 적용 안 함.
- `apps/seller/src/app/admin/drivers/_client.tsx:89` admin 탭 — admin 영역은 별도 검토 후 결정 (다른 세션).
- `orders` 페이지의 `IN_DELIVERY` SubFilter row — pill 형태로 시각 의도 다름.

**검증**: seller 타입체크(exit 0) · `pnpm --filter seller build`(23라우트) · biome 신규 0건. e2e 회귀 풀런은 Railway 복구 후. 셀렉터 영향 — `getByRole('button')` + 텍스트 기반이면 영향 없음.

---

## [결정 #CL-37] 셀러앱 확인 모달 공통 컴포넌트 — `ConfirmModal` + native `confirm()` 금지 (2026-05-21, 세션55)

**배경**: UX-09 — 셀러앱 destructive/critical 액션(삭제·승인·정지·지급) 확인이 native `window.confirm()` 6곳에 잔존. native confirm은 모바일 PWA에서 OS chrome 의존이라 디자인 일관성·접근성·라벨 가변성 모두 떨어짐. 세션53 진단 → 세션55에서 공통 컴포넌트 + 일괄 교체.

**핵심 규칙**:

1. **신설 컴포넌트** `apps/seller/src/components/ConfirmModal.tsx` (~75라인) — 셀러앱의 모든 단순 확인 모달은 본 컴포넌트로 통일. Mantine `Modal` 직접 사용(`@mantine/modals` 의존성 추가 거절: 기존 패턴 일관성·번들 최소).
2. **Props 시그니처**: `opened: boolean` · `title: string` · `message: string | ReactNode` · `confirmLabel?: string` (default `'확인'`) · `cancelLabel?: string` (default `'취소'`) · `confirmColor?: string` (default `'red'`) · `loading?: boolean` · `onConfirm: () => void | Promise<void>` · `onClose: () => void`. message가 string이면 `whiteSpace: pre-line`으로 `\n` 처리.
3. **상태 관리 정책**: **페이지 단일 state + targetId/액션 메타** 패턴이 표준. 카드별 state는 prop drilling/메모리 누수 위험으로 지양. 단 ProductCard처럼 카드 자체가 자체 비동기 상태(`deleting`/`error`)를 이미 가진 경우는 **카드 내부 state 유지가 합리적 예외** (세션55 products 채택).
4. **다중 액션 통합**: 같은 페이지 내 confirm-type 액션이 여럿이면 액션 종류를 enum 타입으로 묶고 `ACTION_META: Record<Action, { title, message, confirmLabel, confirmColor }>` 룩업으로 ConfirmModal 1개에 매핑. 세션55 `admin/drivers/_client.tsx`가 `DriverAction = 'approve' | 'suspend' | 'unsuspend'`로 모범 사례.
5. **로딩 중 닫힘 차단**: `onClose`에서 `if (!loading)` / `if (processingId === null)` 가드 필수 — 비동기 처리 중 모달이 닫혀 race가 발생하지 않도록.
6. **native confirm 금지**: 셀러앱 코드에서 `window.confirm(`/`confirm(` 신규 사용 금지. PR/리뷰 시점 grep 검증 권장.

**치환 결과 (세션55)**:
- `hubs/page.tsx` 거점 삭제 (red, page state)
- `products/page.tsx` ProductCard 상품 삭제 (red, **card state 예외**, name 동적 메시지)
- `admin/drivers/_client.tsx` 승인/정지/해제 3액션 (green/red/gray, `PendingAction` 통합)
- `admin/settlements/_client.tsx` 지급 처리 (blue, 실패 시 `alert` 유지 — 별도 에러 패턴)
- `admin/users/_client.tsx` 정지/해제 가변 (red/green, currentlySuspended 기반)

**범위 외**:
- `apps/seller/src/app/orders/[id]/_components/CancelOrderModal.tsx` — 취소 사유 입력이 필수인 도메인 모달. ConfirmModal로 일반화하지 않음.
- 단순 알림(`alert()`)은 본 결정 범위 밖. Notification 패턴은 별도 검토.
- consumer/driver 앱 — 본 결정은 seller 한정.

**검증**: seller 타입체크(exit 0) · `pnpm --filter seller build`(23라우트) · biome baseline 72→68 errors(import 정렬 자동수정), 신규 0건. e2e 영향 없음 예상 — 백엔드 호출 경로 불변, 셀렉터는 텍스트 기반이면 모달 라벨로 매핑 가능(필요 시 Railway 복구 후 점검).

---

## [결정 #CL-38] 디자인 시스템 폰트 토큰 `--font-size-xs: 12px` 신설 (2026-05-21, 세션58)

**배경**: T-UX4b 셀러 본 화면 fontSize 토큰화 진행 중 `apps/seller/src/app/settings/daily-caps/page.tsx:277` 의 `fontSize: 10`(일일 캡 그리드 셀 내부 `usedSlots` 카운트 보조 인디케이터)을 처리할 때, 기존 토큰 최저값 `sm = 15px`로 흡수 시 +5px 큰 변화로 셀 비좁음·줄바꿈 위험. 한편 세션57 T-UX4a에서 12px·14px 보조 텍스트 17건을 모두 sm으로 통일했으나, 본 화면에서 시각적으로 의도적인 "작은 보조 텍스트"는 디자인 의도 보존이 더 적합.

**핵심 규칙**:

1. **신설 토큰**: `packages/ui/src/style.css` `:root` 에 `--font-size-xs: 12px` 추가. 정의 위치는 `--font-size-sm: 15px` 직전(작은→큰 순).
2. **사용 기준**: **셀 내부 보조 인디케이터·카운트 라벨 등 "의도적으로 작게 디자인된 시각 요소"** 에 한정. 일반 본문 텍스트는 계속 sm 이상 사용.
3. **세션57 정책과의 관계**: 세션57의 "12·14 → sm 통일"은 admin 데이터 표(저빈도 사용자 노출)의 보조 텍스트에 적용된 가독성 개선 정책으로 유지. 본 결정은 그것을 뒤집지 않고, **명시적으로 "작아야 하는" 자리에만 xs를 허용**하는 보완. 일반 보조 텍스트는 여전히 sm 권장.
4. **신설 토큰 부재 영역**: 9px·10px·11px 같은 sub-12px 값은 토큰 신설하지 않음(시각 잡음·접근성 하한 우려). 잔존 시 xs로 흡수하거나 sm으로 끌어올림.

**적용 (세션58)**:
- `apps/seller/src/app/settings/daily-caps/page.tsx:277` (usedSlots `↑` 카운트) — `fontSize: 10` → `fontSize: 'var(--font-size-xs)'` (+2px, 의도적 작은 보조 텍스트 유지).

**범위 외**:
- products `_components/ImageUpload.tsx` 의 `fontSize: 9` 4건은 T-UX4c(세션59)에서 본 정책으로 판단(흡수 vs 회피). 본 세션 미적용.
- AIPreviewPanel `styles.input.fontSize: 15` 같은 Mantine API 경로는 T-UX5 정합성 검토에서 별도 처리.

**검증**: seller 타입체크(exit 0) · `pnpm --filter seller build`(23라우트) · 본 세션 대상 폴더(settlements/hubs/settings) biome errors 0건 · 전체 seller baseline 50 errors(세션57 63→50 추가 자동수정 효과, 신규 0건). 시각 검증은 사용자 합의로 생략(정적 검증만).

## [결정 #CL-39] 셀러앱 알림 패턴 — `@mantine/notifications` 단일화, native `alert()` 금지 (2026-05-21, 세션63)

**배경**: 세션61 셀러앱 종합 점검에서 #CL-37 `ConfirmModal`로 native `confirm()` 6건은 0건으로 정리되었으나, native `alert()` 3건(admin/orders·settlements·stores)이 잔존. native alert는 ① 모바일 PWA에서 시스템 다이얼로그가 앱 컨텍스트를 깨고 ② 디자인 토큰 적용 불가 ③ a11y/role 미흡 ④ 자동 닫힘·다중 스택 처리 불가로 ConfirmModal 정책 일관성을 해침. 단일화 표준이 필요.

**핵심 규칙**:

1. **금지**: 셀러앱 코드 전역에서 native `alert()`·`confirm()`·`prompt()` 신규 도입 금지. 기존은 점진 치환 대상.
   - 예외: `confirm()` 형태의 "삭제·해제 등 액션 확정"은 [[#CL-37]] `ConfirmModal` 사용.
   - `prompt()`는 폼 컴포넌트로 분리(현재 admin/orders 환불 사유는 잔존 prompt — 본 결정 범위 외, 별건 평가).
2. **알림 컴포넌트**: `@mantine/notifications` 9.x. `apps/seller/src/app/providers.tsx`에서 `<Notifications position="top-right" autoClose={4000} />` 단일 등록. `apps/seller/src/app/layout.tsx`에서 `@mantine/notifications/styles.css` 1회 import.
3. **호출 패턴**:
   ```tsx
   import { notifications } from '@mantine/notifications';
   notifications.show({
     color: 'red',     // 실패=red, 경고=orange, 성공=green
     title: '간결한 제목',
     message: '한 문장 설명. 사용자가 다음 행동을 취할 수 있는 정보 포함.',
   });
   ```
4. **톤·색 규칙**:
   - `color: 'red'` — API 실패·서버 오류 등 사용자 책임 외 실패.
   - `color: 'orange'` — 입력 검증 실패·경고 (사용자가 수정 가능한 항목).
   - `color: 'green'` — 성공 알림. 본 세션은 도입하지 않음(별건). 신규 도입 시 본 정책으로 통일.
5. **위치·시간 결정 근거**: `position='top-right'`은 admin 페이지의 PC 사용 비중과 Mantine default 친화. `autoClose=4000ms`는 짧은 한글 메시지 가독에 충분. 변경 필요 시 본 결정 갱신.

**적용 (세션63 T-CLEAN2)**:
- `apps/seller/src/app/admin/orders/_client.tsx:44` (환불 실패) — red.
- `apps/seller/src/app/admin/settlements/_client.tsx:50` (지급 실패) — red.
- `apps/seller/src/app/admin/stores/_client.tsx:28` (수수료율 입력 검증) — orange.
- Grep `alert\(` apps/seller/src → **0건** 달성.

**범위 외**:
- consumer·driver 앱: 본 결정은 셀러앱 한정. 동일 정책 확장은 별건.
- 성공 알림(`color: 'green'`) 선제적 도입: 사용자 결정으로 본 세션 미도입.
- admin/orders `prompt('환불 사유...')`: 폼 UI로의 마이그레이션은 별건.

**검증**: 셀러 타입체크(exit 0) · `pnpm --filter seller build`(23라우트) · biome **0 errors / 2 warnings** (T-CLEAN1 baseline 동일, 회귀 0건) · `@mantine/notifications` 9.0.1 peer mismatch(9.0.0/9.0.1) 빌드 무영향 확인.

---

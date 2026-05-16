# Critical Logic — 설계 결정 이력

> 이 파일은 되돌리기 어려운 설계 결정과 그 이유를 기록합니다.
> 결정 변경 시 반드시 이유와 날짜를 함께 기록하세요.
> **누적 결정 로그** — 1000라인 초과 시 종결 엔트리를 `archive/`로 이관(활성 ~500라인 목표).
> 2026-03~04 #CL 이전 엔트리: [archive/CRITICAL_LOGIC_archive_20260516.md](archive/CRITICAL_LOGIC_archive_20260516.md)

---

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


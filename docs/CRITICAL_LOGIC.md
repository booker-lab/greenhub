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

## [결정 #CL-40] 택배(parcel) 발송 완료 — 셀러 `PREPARING → DELIVERED` 직행 + deliveryMethod 가드 (2026-05-22, 세션67)

**배경 (BUG-16)**: 택배 주문은 드라이버가 수거하지 않고 셀러가 택배사에 직접 발송한다. 그러나 기존 FSM(`SELLER_TRANSITIONS`)에는 셀러의 `PREPARING → DELIVERED` 경로가 없어 API가 전환을 거부 → 택배 주문이 PREPARING에 영구 고착되는 갭이 존재했다. 직접/허브 주문은 `PREPARING → DELIVERING`(드라이버)을 거치므로, 택배만 직행 경로가 필요하다.

**핵심 규칙**:

1. **FSM 확장**: `SELLER_TRANSITIONS`에 `PREPARING: ['DELIVERED']` 추가. 중간 `DELIVERING` 단계를 두지 않는 이유 — ① 택배는 드라이버 배차가 없어 `DELIVERING`이 무의미 ② `DELIVERING` 전환 시 `driverId = requesterId` 자동 기록 로직이 셀러 ID로 오염됨 ③ `DELIVERED` 직행 시 기존 정산 자동 생성(`createSettlement(order, 'DELIVERED')`) 로직을 그대로 활용.
2. **가드 (필수)**: FSM만으로는 셀러가 direct/hub 주문도 임의로 DELIVERED 마킹 가능 → `orders-lifecycle.service.ts`의 `updateStatus()`에서 `getAllowedTransitions` 통과 직후 가드 삽입:
   ```ts
   if (role === 'seller' && currentStatus === 'PREPARING' &&
       dto.status === 'DELIVERED' && order['deliveryMethod'] !== 'parcel') {
     throw new ForbiddenException('택배 발송 완료는 택배 주문에서만 가능합니다.');
   }
   ```
   admin은 본래 전 전환 권한 보유 → 가드는 `role === 'seller'`만 검사하여 admin 우회 허용.
3. **알림**: `NOTIFICATION_MAP`에 `PREPARING: { DELIVERED: 'ORDER_DELIVERED' }` 매핑 추가 — 기존 DELIVERING→DELIVERED 템플릿 재사용. 미추가 시 발송 완료 알림이 안 감.
4. **드라이버 보드 정합성**: parcel 주문이 드라이버 수거 대기 목록에 잘못 노출되지 않도록 `board/_client.tsx` 쿼리에 `where('deliveryMethod', 'in', ['direct', 'hub'])` 추가. **Firestore 복합 인덱스**(`status + deliveryMethod + preparedAt`) 첫 배포 시 자동 생성 필요 — Console 에러 링크 클릭.
5. **UI (#CL-37 일관성)**: 셀러 주문 상세의 "택배 발송 완료" 버튼은 무모달 — 명시적 버튼 클릭이 의도 표명이므로 ConfirmModal 불필요. `canShipParcel = deliveryMethod === 'parcel' && status === 'PREPARING'`.

**적용 (세션67, `2ad71e3`)**: `orders.helpers.ts`(FSM+알림) · `orders-lifecycle.service.ts`(가드) · `useOrderDetailActions.ts`(`handleShipParcel`) · `orders/[id]/page.tsx`(버튼) · `driver board/_client.tsx`(필터) · `seed-e2e-orders.mjs`(parcel 시드) · `seller-parcel-ship.spec.ts`(신규).

**범위 외**: 운송장 번호 입력·택배사 API 연동(MVP 외) · 드라이버 admin parcel 별도 조회(별건) · 발송 실패 재시도(별건).

**검증**: 셀러·드라이버·API 타입체크 exit 0 · API 단위 테스트 2/2 · 셀러 23라우트·드라이버 9라우트 빌드 · 셀러 biome 0e/2w(baseline 동일). e2e 풀런은 머지 후 dispatch.

---

## [결정 #CL-41] orderNumber 정책 — `YYYYMMDD-NNNNNN` 일자별 카운터 발급 + ID 폴백 (2026-05-22, 세션68~69)

**배경 (UX-11)**: 주문 식별자가 uuid(`order.id`)뿐이라 사용자·셀러가 UUID 일부를 읽어야 했다(`#id.slice(-8)`). 백로그 §12-1에 사람이 읽을 수 있는 주문번호 요구가 있었다.

**핵심 규칙**:

1. **패턴**: `YYYYMMDD-NNNNNN` — KST 일자 + 일별 6자리 시퀀스(`String(seq).padStart(6, '0')`). 예: `20260522-000001`.
2. **발급 위치 (동시성)**: `orders-create.service.ts`의 기존 `runTransaction` **내부**에서 발급. 카운터 문서 `orderCounters/YYYYMMDD`(`{ seq, updatedAt }` 단일 문서)를 트랜잭션 **첫 read**로 읽고(Firestore의 read-before-write 규칙), 모든 검증 후 write 단계에서 `t.set(counterRef, { seq }, { merge: true })`로 증가분을 커밋한 뒤 주문 문서에 `orderNumber` 주입. 자정 경계 동시 주문 충돌은 트랜잭션 재시도로 해결.
   - 단일 문서 write QPS ~1 한계는 MVP 트래픽에 충분. 고트래픽 전환 시 샤딩 카운터로 별건 검토.
3. **백필 안 함 (사용자 결정 ③)**: 기존 운영 주문은 `orderNumber` 부재 → shared `Order.orderNumber?: string`(optional). 프론트 표시 5곳 모두 `orderNumber ?? <ID 폴백>` 패턴:
   - 셀러 OrderCard·OrderInfoSection: `?? '#'+id.slice(-8).toUpperCase()`
   - 셀러 admin: `?? id.slice(0,12)+'…'` (AdminOrder 타입에도 필드 추가)
   - 소비자 mypage 상세·결제성공: `?? orderId`(전체 ID). 결제성공은 `useOrderStatus`가 응답 `orderNumber`를 자동 수신 → 리다이렉트 URL 변경 불필요.
   - 드라이버 OrderCard는 buyerName만 표시 → 변경 불필요.
4. **취소 시 보존**: 취소·환불돼도 orderNumber는 소멸·재사용하지 않고 그대로 유지(§UX-11 범위 외).
5. **e2e 시드 정합성**: `seed-e2e-orders.mjs`의 3주문에 고정 과거 일자 prefix `20260101-00000{1,2,3}` 주입 — 실데이터 카운터와 충돌 회피 + 폴백 분기를 안 타도록(`seller-parcel-ship.spec.ts`가 `주문 20260101-000003` 노출 회귀 가드).

**적용**: 세션68(`cf79560`) shared 타입·orders-create.service(발급+응답)·프론트 5곳 · 세션69 seed/spec·본 등재.

**범위 외**: 카운터 문서 TTL/정리 · 백필 스크립트 · 결제수단별 prefix 분기.

**연관**: [#CL-40] (BUG-16 parcel 직행 — 동일 세션 묶음).

---

## [결정 #CL-42] CI e2e seed step 신설 — 인증 규약 단일화 (`resolveCredential`) (2026-05-22, 세션70~71)

**배경 (3회 재발)**: `e2e.yml`에 **seed 단계가 없어** CI 러너가 stale/빈 Firestore로 spec을 실행 → 시드 의존 spec(주문 카드·parcel·orderNumber)이 자동 dispatch 1차에 깨지고, 매번 사람이 로컬에서 시드를 재주입하는 수동 루프가 세션61·67·69 3회 반복됨.

**치명 갭(GAP-1)**: seed step만 추가하면 즉시 크래시. `seed-e2e-orders.mjs:22`가 로컬 `apps/api/firebase-adminsdk.json`을 **하드코딩 require** → 그 파일은 gitignore 대상이라 CI 체크아웃에 부재 → `MODULE_NOT_FOUND`.

**핵심 규칙**:

1. **인증 규약 단일화**: seed·cleanup 두 스크립트 모두 `resolveCredential()` 사용 — ① `FIREBASE_SERVICE_ACCOUNT_JSON` env(CI, JSON 문자열, BOM trim) ② `apps/api/firebase-adminsdk.json` 로컬 폴백(개발자 머신). `cleanup-spec-residue.mjs:24-46`의 검증된 함수를 seed에 **이식**(중복 허용 — 2회 시점 YAGNI, 3번째 스크립트 생기면 공유 모듈 추출 재평가).
2. **CI 시크릿 재사용(신규 0건)**: e2e.yml에 이미 등록된 `FIREBASE_SERVICE_ACCOUNT_JSON`(cleanup용)을 seed step env로 재사용. 사용자 결정.
3. **step 배치**: `Install Playwright` 이후 · `Run E2E` 이전. seed `process.exit(1)`로 step fail → 후속 test 미실행(silent pass 방지).
4. **멱등·정리 무충돌**: seed는 `e2e-` prefix set 덮어쓰기, cleanup은 `e2e-` 시드 보존 → seed→test→cleanup 순서 충돌 0.

**적용**: 세션71 — `seed-e2e-orders.mjs` resolveCredential 이식(로컬 폴백 회귀 검증 통과) · `e2e.yml` seed step 신설 · 본 등재.

**범위 외(별건)**: B(stale preview race — sync-preview success≠Vercel 실배포) · seed 동적 일자 고정화 · 공유 인증 모듈 추출.

**연관**: [#CL-41] (seed 시드 정합성 — 동일 스크립트), `reference_e2e_preview_race`(B 별건).

---

## [결정 #CL-43] sync-preview 배포 게이트 — SHA-매칭 deployments 폴링 (2026-05-22, 세션71)

**배경 (B / stale preview race)**: `sync-preview.yml`이 success로 떨어진 직후 e2e를 dispatch하지만, Vercel 실배포는 2~4분 더 걸려 e2e가 **stale(이전 커밋) 배포본**을 검사함(세션39·60·61 재현, 자동 1차 실패→수동 재dispatch 루프). #CL-42(CI-SEED)에서 "범위 외 별건"으로 분리됐던 B를 트리거 단계에서 해소.

**핵심 규칙**:

1. **SHA-매칭(시각 비교 폐기)**: 폴링 종료 조건 = 3앱 각각 `deployment.sha == preview HEAD SHA`인 deployment의 최신 status `state == 'success'`. deployment.sha = preview HEAD commit SHA와 정확히 일치(실측). 시각(`created_at`) 비교는 시계 오차·재시도에 취약해 폐기(GAP-1).
2. **별칭 재포인팅 전제(T0 실측 확정)**: e2e BASE는 고정 별칭 `-git-preview-`, deployment URL은 커밋별 `-<hash>-`로 직접 다름. 그러나 Vercel은 커밋 빌드 success 시 별칭을 그 커밋으로 재포인팅 — 별칭/커밋 URL이 **동일 `/_next/static/chunks` 해시**를 서빙함을 bypass 쿠키로 대조 확인. 따라서 sha-매칭 success = e2e BASE가 새 커밋을 서빙하게 된 정확한 신호(GAP-4). 별칭 헬스체크 폴링 불요.
3. **권한**: `permissions:`에 `deployments: read` 추가 — `GITHUB_TOKEN`에 기본 부재라 `gh api .../deployments` 403 방지(GAP-2, 워크플로 run에서 실증).
4. **environment 이름 인코딩**: 3종 모두 구분자가 en-dash(U+2013 '–', 일반 hyphen 아님). consumer는 앱명에 하이픈 없음(`Preview – greenhubconsumer`, seller/driver와 표기 불일치). `encodeURIComponent`로 인코딩(GAP-3).
5. **timeout fail-fast**: 10분 폴링 초과 시 `exit 1` → e2e dispatch 차단 → stale e2e 헛수고 대신 배포 지연 원인 노출(사용자 결정). 미완 앱 로그 출력.

**적용**: 세션71 — `scripts/wait-preview-deploy.mjs` 신설(SHA-매칭 폴링, success/fail-fast 로컬 실측) · `sync-preview.yml` `deployments:read` + Trigger E2E 직전 폴링 step. **T4 검증(run 26279110149)**: 폴링이 ~5m30s 3앱 배포 완료 대기(driver 09:16:01·consumer 09:16:48·seller 09:17:49) → e2e dispatch 09:17:51(마지막 배포 후) → e2e run 26279363879 1차 success. CI-SEED와 결합해 자동 dispatch 1차 통과(시드+fresh 배포 양쪽 보장) — 세션39·60·61·67·69 race 루프 종결.

**범위 외(별건)**: e2e.yml 자체 헬스체크 · Vercel Deploy Hook/Checks API 연동 · seed 동적 일자 고정화 · 폴링 스크립트 공유 인증 모듈(GITHUB_TOKEN만 사용, 해당 없음).

**연관**: [#CL-42] (CI-SEED — B를 별건 분리한 결정, 본 #CL-43이 그 B 해소), `reference_e2e_preview_race`(수동 5분 대기 권장 → 게이트로 자동 해소).

---

## [결정 #CL-44] 정산 confirm 마감 배치 — pending→confirmed 자동 확정 (2026-05-22, 세션72~74)

**배경 (치명 갭 / A-1 워크플로 단절)**: `settlements.md §2`는 상태 흐름을 `pending → confirmed → paid`로 명시하나, **`pending → confirmed` 전이 코드가 코드베이스 전체에 부재**(Grep 실측). createSettlement는 항상 pending 생성([settlements.service.ts:41](../apps/api/src/settlements/settlements.service.ts#L41)), markAsPaid는 confirmed에서만 지급 허용([admin.service.ts:155](../apps/api/src/admin/admin.service.ts#L155)) → **전 정산 pending 영구 고착 → 어드민 "지급처리" 버튼이 confirmed에서만 렌더돼 영구 미노출**([_client.tsx:288](../apps/seller/src/app/admin/settlements/_client.tsx#L288)). 정산 핵심 워크플로 단절.

**핵심 규칙**:

1. **마감 배치로 confirm 전이(사용자 결정)**: 실시간 운영자 확인 대신 `@Cron('0 4 * * *')`(매일 04:00 KST) 배치가 `settledAt`이 마감 경계(`지금 - SETTLEMENT_CONFIRM_DELAY_DAYS일`, 기본 **1**) 경과한 pending을 confirmed 일괄 전이. payments `cleanupPendingOrders` cron 패턴 동형(쿼리→개별 처리). 신규 의존성 0(`@nestjs/schedule` 기설치).
2. **트랜잭션 멱등 + 취소 경합 차단(GAP-1)**: 쿼리 `status==pending AND settledAt<cutoff` 후 각 문서를 **트랜잭션 내 재확인(pending일 때만)** confirmed + confirmedAt set. cancelled는 절대 미덮어씀(cron 중복 실행·배치 중 주문 취소 경합 무해).
3. **KST 보정 필수(T0 실측)**: 서버 TZ 설정 전무(Grep) → UTC 기준. cutoff를 KST로 명시 보정하거나 `@Cron` `{ timeZone: 'Asia/Seoul' }` 옵션(@nestjs/schedule v6 지원, 우선).
4. **복합 인덱스 + 수동 배포(GAP-3, T0 정정)**: 배치 쿼리 `status+settledAt`(storeId 없음)는 신규 2필드 인덱스 필요(기존 `storeId+status+settledAt`은 storeId 필수라 부적용). **CI 자동 배포 부재 확정** → `firebase deploy --only firestore:indexes` 수동 실행 필수(미배포 시 `FAILED_PRECONDITION`).

**적용 결과(세션75 S1 구현 완료, 미커밋)**: B-1 = `confirmDueSettlements()` 신설([settlements.service.ts](../apps/api/src/settlements/settlements.service.ts)) — `@Cron('0 4 * * *', { timeZone: 'Asia/Seoul' })`(v6 `timeZone?: string` 정식 지원 실측 확인), 쿼리 후 `runTransaction`으로 문서별 재확인(pending일 때만 confirmed+confirmedAt) → cancelled 미덮어씀. createSettlement에 `confirmedAt: null` 추가. B-2 = `firestore.indexes.json`에 `status ASC + settledAt ASC` 2필드 인덱스 추가. N9 = 컨트롤러 클래스 레벨 `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin')`([admin.controller.ts:18-21](../apps/api/src/admin/admin.controller.ts#L18-L21))로 이미 보호 확인 → 메서드 레벨 추가 불필요. **DoD: `pnpm --filter api build` 통과(타입체크 포함).** 잔여: 인덱스 수동 배포(`firebase deploy --only firestore:indexes`)는 운영 배포 시점 실행.

**연관**: [#CL-45] (동일 정산 리팩토링의 정합 갭 묶음 — 본 #CL-44가 핵심 워크플로 복구, #CL-45가 부수 정합), `docs/specs/api/settlement-refactor-plan.md`(전체 플랜·태스크 분해).

---

## [결정 #CL-45] 정산 도메인 정합 갭 일괄 — 트랜잭션·역전이 가드·SSOT·UX (2026-05-22, 세션74)

**배경 (전수 검사 발견)**: 세션74 정산 탭 16파일 전수 검사에서 #CL-44(confirm)와 **독립된 정합 갭 다수 발견**(N1·N6~N11). #CL-44가 워크플로를 복구해도 이 갭들이 남으면 데이터 정합·회계·UX 신뢰가 깨짐. confirm과 별 축이라 분리 기록.

**핵심 규칙**:

1. **정산 write 3종 트랜잭션화(N1+N6, 치명 — 회계 경합)**: create·cancel·markAsPaid가 **전부 비트랜잭션 read→write**(confirm 배치만 트랜잭션이라 비대칭). markAsPaid 더블클릭 이중 paid(N1), createSettlement 동시 전이 시 중복확인 통과 후 2회 set 경합(N6). → 3종 트랜잭션 내 재확인 적용(B-5).
2. **cancelSettlement paid 역전이 가드(N7, 치명 — 회계 손실)**: 현 cancelSettlement는 status 무관 무조건 cancelled update → **이미 paid된 정산도 주문 취소 시 cancelled로 덮임**(지급 후 회계 불일치). #CL-44 GAP-1의 "cancelled 미덮어씀"과 **대칭으로 "paid 미덮어씀" 가드 신설**(B-6).
3. **타입 SSOT 4중→1(N3·N8)**: SettlementStatus/STATUS_LABEL/STATUS_COLOR가 백엔드·셀러·어드민·useAdmin **4곳** 정의 + 값 불일치(pending "정산 대기"/yellow vs "대기"/gray). `packages/shared`로 통합(셀러본 채택, API도 `@greenhub/shared` workspace 의존 확정 — T0). 앱별 필드 집합 불일치(셀러 Settlement가 storeId/paidAt/confirmedAt 누락)는 합집합 정의(F-1).
4. **어드민 화면 UX 정합(N10·N11)**: 어드민 합계가 status 무관 전건 합산 → cancelled/pending 포함 **지급액 과대 표시**(N11). 정산일시 컬럼 부재·정렬 방향 셀러와 반대(N10). 합계를 confirmed+paid 한정, 정산일시 표시(F-2).
5. **스테일 클레임 정정(세션72 §0)**: orders-lifecycle:144 인코딩 손상 = **사실 아님**(바이트 실측 정상, 정산 전 파일 mojibake 0건). 인코딩 태스크 불필요.

**적용 계획(세션74 확정)**: S2 = B-5+B-6(치명 정합 — confirm과 독립). S3 = B-3(SDD 분리)+B-4(status 필터+N2 hook 연결). S4 = F-1(SSOT). S5 = F-2(어드민 분리+N10·N11). N9(어드민 정산 엔드포인트 role 가드)는 S1에서 1줄 확인 흡수. 각 세션 DoD = 빌드+타입체크 통과, 검증(e2e·육안)은 S6 통합 세션 일괄.

**적용 결과(세션76 S2 구현 완료, 미커밋 — 규칙 1·2 해소)**: B-5 = 정산 write 3종 전부 `runTransaction` 적용. ① `createSettlement`([settlements.service.ts:30-57](../apps/api/src/settlements/settlements.service.ts#L30-L57)) — `get(exists)→set`을 트랜잭션으로 묶어 동시 전이 중복생성 경합 차단(N6). ② `markAsPaid`([admin.service.ts:146-170](../apps/api/src/admin/admin.service.ts#L146-L170)) — 트랜잭션 내 status 재확인 후 paid → 더블클릭 이중 paid 차단(N1). ③ `cancelSettlement`([settlements.service.ts:170-192](../apps/api/src/settlements/settlements.service.ts#L170-L192)) — 트랜잭션화 + cancelled 멱등 skip. B-6 = `cancelSettlement`에 **paid 역전이 가드** 신설 — `status==='paid'`면 cancelled 미적용·`logger.warn` 후 return(N7 회계 손실 차단). #CL-44 GAP-1 "cancelled 미덮어씀"과 대칭("paid 미덮어씀"). 결과: 정산 write 4종(create·cancel·markAsPaid·confirm 배치) **전부 트랜잭션**. **DoD: `pnpm --filter api build` 통과(타입체크 포함).** 잔여: S3(B-3·B-4).

**적용 결과(세션77 S3 구현 완료 — 규칙 5·6·9 일부 해소)**: B-3 = SDD 레이어 분리 — service.ts에서 ① 수수료 계산(`Math.floor(total×rate)`)을 `_lib/fee-calculator.ts`(`calcFee`) 순수 함수로, ② `getSummary`의 byStatus 집계 루프를 `_lib/settlement-aggregator.ts`(`aggregateSettlements`) 순수 함수로 추출(인프라/Firestore 의존 0 → 단위 테스트 용이). service 208→196행. B-4 = `QuerySettlementsDto`에 `status?`(`@IsIn(['pending','confirmed','paid','cancelled'])`) 추가 + `getSettlements`에 `status` where 절(`storeId==` 다음, `settledAt` range 앞 — 기존 `storeId+status+settledAt` 복합 인덱스 재사용, **신규 인덱스 불필요**). N2 = 셀러 [useSettlements.ts](../apps/seller/src/app/settlements/_hooks/useSettlements.ts) `fetchSettlements(f?,t?,status?)`가 status를 URLSearchParams로 전송(백엔드만 추가 시 무용 방지). `settlements.md` §2(`confirmedAt`)·§3-1(status 쿼리 파라미터)·§4-1(confirm 배치 신설)·§5(인덱스) 선설계 갱신. **DoD: `pnpm --filter api build` + 셀러 `tsc --noEmit` 통과.** 잔여: S4(F-1 SSOT)·S5(F-2)·S6(검증·기록).

**적용 결과(세션78 S4 구현 완료 — 규칙 3 해소: N3·N4·N8)**: F-1 = 상태 타입·라벨·색 SSOT **4중→1**. [packages/shared/src/settlement.types.ts](../packages/shared/src/settlement.types.ts) 신설 — `SettlementStatus`·`SETTLEMENT_STATUSES`·`STATUS_LABEL`·`STATUS_COLOR`(셀러본 채택: pending "정산 대기"/yellow)·공유 `Settlement` 인터페이스(필드 합집합 — `storeId`/`paidAt`/`confirmedAt` optional 포함, N8). `index.ts` export 추가. 통합처: ① 백엔드 [settlements.service.ts](../apps/api/src/settlements/settlements.service.ts) 로컬 `SettlementStatus` 제거 → shared import+re-export(DTO 경로 유지), ② aggregator 로컬 `SettlementStatusKey` 제거 → 공유 `SettlementStatus`+`SETTLEMENT_STATUSES`, ③ DTO 로컬 `SETTLEMENT_STATUSES` 배열 제거 → shared import, ④ 셀러 [_constants.ts](../apps/seller/src/app/settlements/_constants.ts) 로컬 정의 제거 → shared re-export(`_lib.ts`·components의 `from './_constants'` 경로 무변경 — N4 해소), ⑤ 어드민 [_client.tsx](../apps/seller/src/app/admin/settlements/_client.tsx) 로컬 `STATUS_LABEL`/`STATUS_COLOR`("대기"/gray) 제거 → shared import(셀러본 표기로 통일), ⑥ [useAdmin.ts](../apps/seller/src/hooks/useAdmin.ts) `AdminSettlement.status: string`→`SettlementStatus`·`confirmedAt?` 추가(N3). **DoD: `pnpm --filter @greenhub/shared build` + `pnpm --filter api build` + 셀러 `tsc --noEmit` 3종 통과.** 잔여: S5(F-2 어드민 분리+N10·N11)·S6(검증·기록).

**적용 결과(세션79 S5 구현 완료 — 규칙 7 해소: N10·N11)**: F-2 = 어드민 정산 화면 구조 분리. [admin/settlements/_client.tsx](../apps/seller/src/app/admin/settlements/_client.tsx) 311→92행 — `_components/{SettlementFilters,SummaryCards,SettlementTable}.tsx` + `_lib.ts`(`toDateStr`·`toKRW`·`sumPayable`) 추출(셀러 `_components/` 패턴 동형). **N10** = ① SettlementTable에 정산일시(`settledAt`) 컬럼 추가 — 어드민 표에 없던 컬럼(셀러는 보유), ② 셀러 백엔드 [settlements.service.ts](../apps/api/src/settlements/settlements.service.ts) `getSettlements` 정렬 `asc→desc`로 변경 → 어드민(`desc`)과 통일(양 화면 최신순). **N11** = `sumPayable`이 합계(`totalFee`/`totalNet`)를 `confirmed`+`paid` 정산만 집계 — 이전 status 무관 전건 합산은 pending·cancelled 포함해 지급액 과대 표시됐음(실제 지급 대상만 반영). `settlements.md` §3-1(정렬 desc 통일)·§6(어드민 화면 컴포넌트 구조·합계 기준·정산일시 컬럼) 선설계 갱신. **DoD: 셀러 `tsc --noEmit` + `pnpm --filter api build` 통과.** ⚠️ 셀러 정렬 `asc→desc` 변경은 S6 e2e/육안 회귀 확인 대상. 잔여: S6(검증·기록) — SETTLE-REFACTOR 구현 전부 완료, 검증만 남음.

**격자 재검토 결과(세션81 — S1~S5 구현 정합성 전수 확정, 코드 변경 0)**: S6 통합 검증 진입 직전, #CL-44·#CL-45 구현 6태스크(B-1~B-6·F-1·F-2) 전체를 **9개 정합성 체크포인트 × 14개 변경 파일 교차 검증**으로 재확인 — 전부 통과. ① **상태머신·역전이 가드 양방향 대칭**: create=pending→confirm배치=confirmed→markAsPaid=paid / cancel=cancelled. cancel은 `paid` 차단([settlements.service.ts:177](../apps/api/src/settlements/settlements.service.ts#L177))·confirm배치는 `status!==pending` skip([:150](../apps/api/src/settlements/settlements.service.ts#L150))·markAsPaid는 `confirmed`만 통과(pending 직행 차단)·이미 paid 거부([admin.service.ts:156-161](../apps/api/src/admin/admin.service.ts#L156-L161)). ② **트랜잭션 4종**: create·cancel·confirm배치 + markAsPaid([admin.service.ts:151](../apps/api/src/admin/admin.service.ts#L151)) 전부 runTransaction 내 재확인, 비트랜잭션 write 0. ③ **타입 SSOT 1곳**: Grep 전수 — 정산 SettlementStatus/STATUS_LABEL/STATUS_COLOR는 [settlement.types.ts](../packages/shared/src/settlement.types.ts) 단 1곳(나머지 grep 히트는 전부 Order 상태용·무관). ④ **백/프론트 연결**: [useSettlements.ts:87](../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L87) status→[service.ts:76](../apps/api/src/settlements/settlements.service.ts#L76) where 실연결(N2)·sumPayable confirmed+paid 한정(N11). ⑤ **정렬 desc 통일**: 셀러[service.ts:90]·어드민[admin.service.ts:137] 양쪽 desc(N10)(⚠️셀러 desc 육안만 잔여=선결②). ⑥ **SDD 분리**: fee-calculator·settlement-aggregator 순수함수, service는 인프라/인증만. ⑦ **라인≤500**: 14파일 전부 통과(최대 useAdmin 323·admin.service 231·settlements.service 173). ⑧ **인덱스**: status+settledAt 라이브 배포됨(선결① 세션80). ⑨ **빌드**: `pnpm --filter @greenhub/shared build`·`pnpm --filter api build`·셀러 `tsc --noEmit` 전부 에러 0. **결론: A-1 단절(pending 고착→지급 버튼 미표시)의 양끝(confirm 배치 pending→confirmed / 어드민 버튼 `status==='confirmed'` 노출)이 코드로 맞물림 확정.** 잔여 = S6 런타임 검증(e2e·육안·선결②·T-기록)뿐.

**S6 통합 검증 결과(세션82 — 자동 검증분 완료·런타임 검증 사용자 위임)**: SETTLE-REFACTOR 최종 게이트. ① **빌드 3종 통과**: `pnpm --filter @greenhub/shared build`·`pnpm --filter api build`·셀러 `tsc --noEmit` 전부 에러 0(S6 진입 재확인). ② **e2e 회귀 0건**: 라이브 preview(최신 main `185ae79` 반영, sync-preview→e2e 자동 디스패치 run `26297450405`) 풀런 **176 passed / 0 failed / 13 skipped**. `seller-settlements.spec.ts`는 비인증 1 + 인증 7 = chromium·mobile 전 케이스 통과 — **S5 셀러 정렬 `asc→desc` 변경(N10)에도 회귀 0**(spec이 순서를 단언하지 않아 예상대로 통과 → 선결② e2e 측면 통과, 육안만 잔여). ③ **육안 검증 문서화**: `seller-refactor-visual-verify.md` E 섹션(E-T1 셀러·E-T2 어드민·E-T3 전이 입증, 연번 211~223) 신설 — 사용자 직접 검증용. **④ 전이 입증 = 라이브 스크립트로 즉시 완료(세션82)**: 라이브 배치(@Cron 04:00 KST) 자연 대기 대신 `scripts/verify-settlement-transition.mjs`가 `confirmDueSettlements`·`markAsPaid` **실제 코드 로직을 그대로 재현**해 라이브 `green-e4fe3` Firestore에서 전 구간 즉시 입증 — **10 passed / 0 failed**. ① pending 시드(settledAt 2일 전) → ② 역전이 가드(pending에 markAsPaid → `NOT_CONFIRMED` 거부) → ③ confirm 배치 로직(pending→confirmed, confirmedAt 기록) → ④ markAsPaid(confirmed→paid, paidAt 기록) → ⑤ 멱등 가드(이미 paid → `ALREADY_PAID` 거부) → ⑥ 정리(격리 단일 문서 `verify-settle-001` 삭제, 실데이터 무관). **A-1 단절(pending 고착→지급 불가) 라이브 해소 입증 완료.** `status+settledAt` 복합 쿼리가 에러 없이 실행돼 선결① 인덱스 라이브 동작도 부수 입증(FAILED_PRECONDITION 0). **사용자 위임 잔여 = 프론트 화면 육안만**: (a) 셀러·어드민 화면 라벨/색/정렬 desc(E-T1·E-T2), (b) 어드민 "지급처리" 버튼이 confirmed 행에만 노출(E-T3 #221). 다음 04:00 라이브 배치는 동일 로직이라 추가 입증 불필요. **결론: S6 백엔드 전이·빌드·e2e·문서 전부 종결, 프론트 화면 육안만 사용자 확인 대기.**

**연관**: [#CL-44] (confirm 배치 — 본 #CL-45가 그 부수 정합 갭 묶음), `docs/specs/api/settlement-refactor-plan.md §2.7`(전수 검사 N1~N11 실측), `docs/specs/frontend/seller-refactor-visual-verify.md` E 섹션(육안 검증 211~223).

---

## [#CL-46] 정산 목록 desc 인덱스 부재 — S5 정렬 전환의 인덱스 미반영 (라이브 500 결함)

**발견(세션83 M-PATH M4 육안 검증)**: 셀러 정산 탭 [주문별 상세] 및 어드민 정산 목록이 **라이브에서 500(FAILED_PRECONDITION) 에러**로 빈 화면. 원인 — S5(세션79 N10)에서 정산 정렬을 `settledAt` **asc→desc**로 통일했으나([settlements.service.ts:90](../apps/api/src/settlements/settlements.service.ts#L90), [admin.service.ts:137](../apps/api/src/admin/admin.service.ts#L137)), `firestore.indexes.json`의 settlements 복합 인덱스는 **전부 `settledAt ASCENDING`** 으로만 존재 → `where(storeId==) + orderBy(settledAt desc)` 및 `+where(status==)` 쿼리가 매칭 인덱스 없어 실패. admin SDK 재현 시 에러 메시지 `The query requires an index` + 인덱스 생성 URL 동반(원인 100% 확정).

**왜 못 잡았나(#CL-45 격자 재검토의 모순 누락)**: 세션81 격자 재검토 ⑤항은 "정렬 desc 통일(셀러·어드민 양쪽 desc)"을 확인했고, ⑧항은 "인덱스 status+settledAt 라이브 배포됨(선결①)"이라 적었으나 — **그 인덱스는 ASC였다.** ⑤(desc 쿼리)와 ⑧(asc 인덱스)이 상호 모순인데 교차검증이 방향(order)까지 대조하지 않아 통과로 오판. 세션82 e2e 풀런(176/0)도 통과했는데, preview 환경에 우연히 해당 인덱스가 (다른 경로로) 존재했거나 e2e 시드 정산 부재로 빈 쿼리가 인덱스 없이도 통과한 것으로 추정(미확정). **교훈: 복합 인덱스 검증은 fieldPath뿐 아니라 order(ASC/DESC)까지 쿼리와 1:1 대조해야 한다.**

**조치(세션83)**: `firestore.indexes.json`에 desc 복합 인덱스 3종 추가 후 `firebase deploy --only firestore:indexes` 배포 — ① `storeId ASC, settledAt DESC`(셀러 목록·어드민 storeId) ② `storeId ASC, status ASC, settledAt DESC`(status 필터) ③ `status ASC, settledAt DESC`(대칭 보강). 검증: `scripts/test-settlement-query.mjs`로 동일 쿼리 admin SDK 실행 → 빌드 완료 후 정상 반환 확인.

**연관**: [#CL-45] ⑤·⑧항(모순 누락 지점), `firestore.indexes.json`(settlements desc 3종), `scripts/test-settlement-query.mjs`(재현·검증), `seller-refactor-visual-verify.md` M4 #243.

---

## [#CL-47] 정산일시 "Invalid Date" — TimestampInterceptor(ISO) vs 화면(`_seconds`) 직렬화 불일치

**발견(세션83 M-PATH M4, #CL-46 인덱스 해소 직후)**: 정산 목록(셀러 [주문별 상세]·어드민)이 뜨자 모든 행의 정산일시가 **"Invalid Date"**(셀러) / **"-"**(어드민)로 표시. 원인 — API 전역 `TimestampInterceptor`([apps/api/src/common/interceptors/timestamp.interceptor.ts:24](../apps/api/src/common/interceptors/timestamp.interceptor.ts#L24))가 모든 Firestore Timestamp를 **`toDate().toISOString()` ISO 문자열**로 변환해 응답하는데, 화면 코드는 **`settledAt._seconds`(객체)** 를 가정 → `undefined` → `new Date(undefined*1000)=Invalid Date`(셀러 [SettlementListItem.tsx](../apps/seller/src/app/settlements/_components/SettlementListItem.tsx)), 어드민은 `'_seconds' in ts` false라 `'-'` 반환([admin/settlements/_lib.ts](../apps/seller/src/app/admin/settlements/_lib.ts)).

**왜 못 잡았나**: 셀러 `Settlement` 타입([settlements/_constants.ts:15](../apps/seller/src/app/settlements/_constants.ts#L15))이 `settledAt: { _seconds: number }`로 **실제 응답(ISO 문자열)과 다르게 정의**돼 있었고, TS는 타입 정의를 신뢰하므로 컴파일 통과. e2e도 정산일시 텍스트값 단언이 없어 미검출. shared `Settlement.settledAt`은 `unknown`(직렬화 경로별 차이 허용 주석 있음)이라 셀러/어드민 로컬 타입에서 잘못 좁힌 게 근인.

**조치(세션83)**: 양 화면 `toDateStr`을 **ISO 문자열·`{_seconds}`·number 모두 방어적 파싱**(불가 시 '-')으로 통일. 셀러 `_constants.ts` 타입을 `string | { _seconds: number }`로 정정, `SettlementListItem`은 `s.settledAt`(통째) 전달, CSV는 `toISO` 헬퍼 신설. 셀러 `tsc --noEmit` 통과. **배포 필요**(운영=main 동기).

**연관**: [#CL-46](같은 정산 목록 화면 — 인덱스 해소 후 드러난 2차 결함), `apps/api/.../timestamp.interceptor.ts`(ISO 변환 출처), `seller-refactor-visual-verify.md` M4 #243.

---

## [#CL-48] `toISOString()` 날짜 추출 KST 미보정 — 자정~오전9시 하루 밀림

**발견(세션83 M-PATH M5)**: 사용자가 KST 5/24 00:52(자정 직후) 배송 슬롯 캘린더에서 **5/23이 "오늘"로 표시·과거 차단 오작동**. 원인 — `new Date().toISOString()`은 **UTC 기준**이라 KST(UTC+9)의 **00:00~08:59**에는 `split('T')[0]`/`slice(0,10)` 추출 날짜가 **전날**로 밀림.

**영향(세션84 실측, 전수 일치)**: 셀러 src 전역 `toISOString` 날짜추출 5곳 중 미보정 3곳 — ① [daily-caps/page.tsx:134](../apps/seller/src/app/settings/daily-caps/page.tsx#L134) `todayStr`(캘린더 isToday/isPast 직접 오판) ② [useSettlements.ts:36](../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L36)(일별요약 기본일) ③ [useDashboardSummary.ts:30](../apps/seller/src/hooks/useDashboardSummary.ts#L30)(홈 정산예정일). 보정됨 2곳은 [orders/[id]/_lib.ts:18~20](../apps/seller/src/app/orders/[id]/_lib.ts#L18)(라인18 `+9h`, 정상 패턴·결함 아님).

**결정(세션84)**:
1. **공통 util `todayKST()`/`toDateStrKST()`를 `@greenhub/shared`에 신설**(`packages/shared/src/date.ts`) — 사용자 결정. shared가 '타입 전용'→'런타임 함수 포함'으로 성격 확장(dual ESM/CJS 빌드 검증 필수). SSOT 원칙 우선.
2. 미보정 3곳 교체 + 정상 패턴 `_lib.ts` 인라인도 util로 흡수(중복 제거). **`daily-caps:53~55` `now`/`year`/`month`는 로컬시간(=KST) 기준이라 불변** — 라인134 추출만 교체.
3. **테스트 인프라 부재(셀러·shared `.test.ts` 0건) 확인** → `packages/shared`에 **vitest 신설**(프로젝트 첫 유닛테스트), `vi.setSystemTime`으로 KST 경계(UTC 15:00=KST 자정) 회귀 가드.

**플랜**: [timezone-kst-fix-plan.md](specs/frontend/timezone-kst-fix-plan.md) T1~T6 + 정합성 검토 §5-1(구현 전 완료).

**구현 완료(세션85)**: T1~T6 전부 완료. ① [date.ts](../packages/shared/src/date.ts) 신설 + index.ts export — dual ESM/CJS 빌드 검증(CJS require·ESM import 양쪽 해소). ② 미보정 3곳 `todayKST()` 치환. ③ `_lib.ts` 인라인 흡수(`todayKST()`+`toDateStrKST()`) — **신·구 수식 동등성 노드 실측(KST 자정 경계 today/tomorrow 일치)으로 ISO/라벨 불변 가드(C3)**. ④ **vitest 신설**([date.test.ts](../packages/shared/src/date.test.ts) 5케이스 통과, `vi.setSystemTime`으로 UTC 14:59→전날·15:30→당일 경계 가드) — 프로젝트 첫 유닛테스트. 정합성 C1~C7 전부 통과: 셀러 `tsc --noEmit` exit 0, biome 신규 0(기존 `<img>` 경고 2건 무관), 셀러 src KST 미보정 잔존 grep 0건. tsconfig(esm/cjs)에 `*.test.ts` exclude 추가로 빌드 산출물 미오염.

**통합 로직 재현 검증(세션85, 라이브 육안 대체)**: daily-caps `isToday=date===todayStr`·`isPast=date<todayStr` 추적 — 캘린더 셀 `date`는 `buildCalendar`가 `${year}-${mm}-${dd}` 제로패딩 `YYYY-MM-DD`로 생성(year/month는 로컬=KST), `todayStr`도 동일 포맷 → 사전식 비교가 날짜 비교로 성립. **KST 2026-05-24 00:30(원 결함 시점) 노드 시뮬레이션**: 수정 전 `todayStr=2026-05-23`(어제가 "오늘"로 강조·세션83 증상 일치) → 수정 후 `todayStr=2026-05-24`(5/24 isToday=true·isPast=false 입력가능, 5/23 isPast=true 차단). **결함 증상이 코드 경로 그대로 재현·해소 입증** — 라이브 자정 육안 불요 판정.

**연관**: [#CL-46]·[#CL-47](같은 세션83 M-PATH 발견 라이브 결함 계열), BACKLOG `[타임존-UTC]`.

---

## [#CL-49] BACKLOG 잔여 4건 정합성 검토 — BUG-16 stale 판정 + 3건 아토믹 플랜 수립 (2026-05-25, 세션86)

**배경**: 사용자가 BACKLOG 잔여 4건([BUG-16]·[정산-status필터UI]·[어드민-반응형]·[UI-버튼크기])을 각 독립 세션 아토믹 태스크로 분해 요청. 착수 전 4건 전수 코드 실측.

**핵심 발견 — 백로그 stale 2건(코드 변경 없이 표기 정정)**:
1. **[BUG-16] 택배 주문 상태 갭 = 이미 완료(세션67 `2ad71e3`)**. §1-3에 `[ ]`로 잔존했으나 실측상 셀러([orders/[id]/page.tsx:94](../apps/seller/src/app/orders/[id]/page.tsx#L94) `canShipParcel`·[:187](../apps/seller/src/app/orders/[id]/page.tsx#L187) 버튼·[useOrderDetailActions.ts:54](../apps/seller/src/app/orders/[id]/_hooks/useOrderDetailActions.ts#L54) "BUG-16 T3")·드라이버([board/_client.tsx:43](../apps/driver/src/app/board/_client.tsx#L43) `where('deliveryMethod','in',['direct','hub'])` "BUG-16 T4") **양쪽 모두 구현됨**. §3 P3 라인500에 종결 기록(e2e 176p/0f) 존재 — §1-3 `[ ]`만 stale. **사용자 결정: stale 정정만**(재검증 불요).
2. **[#CL-48 타임존] = 세션85 종결**인데 §1-1 `[ ]` 잔존 → `[x]` 정정.

**실착수 유효 3건(실측으로 결함·레퍼런스 확정)**:
- **[정산-status필터UI]**: hook([useSettlements.ts:29·88](../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L29))·백엔드는 status 지원, [OrdersTab.tsx](../apps/seller/src/app/settlements/_components/OrdersTab.tsx) UI만 부재 확정. 이식 레퍼런스=주문 탭 공통 `SegmentedTabs<T>`([orders/page.tsx:173](../apps/seller/src/app/orders/page.tsx#L173)), 상태 SSOT=`SETTLEMENT_STATUSES`/`STATUS_LABEL`([settlement.types.ts:13](../packages/shared/src/settlement.types.ts#L13)). 규모 소~중, 리스크 낮음.
- **[어드민-반응형]**: 어드민 `<table>` 5곳(settlements·orders·stores·invite·users) 모두 `overflowX` 래퍼 없음 확정. 정산 7컬럼 마지막 상태·지급처리버튼 모바일 잘림([SettlementTable.tsx:48·134](../apps/seller/src/app/admin/settlements/_components/SettlementTable.tsx#L48)). 카드형 vs 가로스크롤 A/B/C는 착수 시 확정. 규모 중~대(Phase 분할), 로드맵 §3 어드민 트랙 진입점.
- **[UI-버튼크기]**: 카드 `sm/md`([OrderCard.tsx:78](../apps/seller/src/app/orders/_components/OrderCard.tsx#L78)) vs 상세 footer `lg/xl`([orders/[id]/page.tsx:165](../apps/seller/src/app/orders/[id]/page.tsx#L165)) 2단계 차 확정. **버그 아닌 위계 설계 판단** — A(의도된 위계, 변경0) / B(단일화, footer `lg→md` 한 단계) 착수 전 사용자 확정 필수. 규모 소.

**산출물(세션86, 코드 변경 0 — 문서만)**: 플랜 3종 신설 — [settlement-status-filter-plan.md](specs/frontend/settlement-status-filter-plan.md)·[admin-responsive-plan.md](specs/frontend/admin-responsive-plan.md)·[button-size-unify-plan.md](specs/frontend/button-size-unify-plan.md). 각 아토믹 태스크 + 정합성 체크포인트 포함. BACKLOG 4건 모두 링크·표기 정정.

**연관**: BUG-16 종결=[#CL-40], 타임존=[#CL-48], 어드민 트랙=`app-refactor-roadmap.md` §3.

---

## [#CL-50] [UI-버튼크기] 단일화 — B(괴리 완화) 확정, footer `lg→md` 한 단계 (2026-05-25, 세션87)

**배경**: [#CL-49]에서 수립한 [button-size-unify-plan.md](specs/frontend/button-size-unify-plan.md)의 §2 A/B 설계 판단을 착수 도입부에 사용자에게 제시 → **B(단일화) 확정**. "준비 시작" 동일 액션이 목록 카드 `sm`과 상세 footer `lg`로 2단계 차여서 카드→상세 이동 시 시각 괴리.

**핵심 규칙(시각 회귀 정책)**:
1. **한 축만 변경** — footer 3버튼(준비 시작·택배 발송 완료·강제 취소)을 `size="lg"`→`size="md"` 한 단계만 하향. `radius="xl"`·`fullWidth`는 **유지**(두 축 동시 변경 시 회귀 추적 곤란, 터치 타깃 보존).
2. **카드 `sm` 유지** — 목록 밀도상 카드를 올리지 않음. 결과적으로 2단계→1단계 차로 괴리 완화(완전 동일화 아님 — 위계는 보존).
3. **부수 정합(설계 근거 강화)**: footer `md`가 [PrepareForm.tsx:80·89](../apps/seller/src/app/orders/[id]/_components/PrepareForm.tsx#L80)의 폼 버튼(이미 `md`/`xl`)과 일치 → 준비 시작 → 폼 진입 시 크기 점프도 함께 해소. `radius="xl"` 유지 판단도 PrepareForm과 일치해 정합.

**구현(세션87, 파일 1개 — 로직·API 불변)**: [orders/[id]/page.tsx:165·180·195](../apps/seller/src/app/orders/[id]/page.tsx#L165) footer 3버튼 `lg→md`. 정합성 C1~C5 전부 통과: A/B 확정(C1)·footer 3버튼 동일 size(C2, orders 내 `size="lg"` 잔존 grep 0)·한 단계·토큰 불변(C3)·풀폭 유지(C4)·`tsc --noEmit` exit0·biome 신규0·`npm run build`(`--webpack`) exit0(C5).

**빌드 주의**: 셀러는 `npm run build`(=`next build --webpack`)로 실행. 맨 `npx next build`는 Next16 Turbopack/webpack config 충돌로 실패(코드 무관).

**잔여**: 육안 검증 1건(카드→상세 크기 점프 완화) — 정산 status 필터 육안과 일괄 진행 정책. 통합 문서 [pending-visual-verify.md](specs/frontend/pending-visual-verify.md) §1-B에 항목 합류.

**연관**: 선행 정합성 검토=[#CL-49], 플랜=button-size-unify-plan.md, 다음 작업=어드민 반응형(`app-refactor-roadmap.md` §3).

---

## [#CL-51] [어드민-반응형] 5개 테이블 모바일 카드형 전환 — C-full 확정, `hiddenFrom`/`visibleFrom` 분기 도입 (2026-05-25, 세션88)

**배경**: [#CL-49]에서 수립한 [admin-responsive-plan.md](specs/frontend/admin-responsive-plan.md)의 §2 A(가로스크롤)/B(카드형)/C(하이브리드) 설계 판단을 착수 도입부에 제시. 어드민 콘솔(`apps/seller/src/app/admin`) 5개 테이블(settlements·orders·stores·invite·users)이 데스크톱 `<table>` 그대로라, 모바일 폭에서 마지막 컬럼(상태·지급처리/강제환불/정지·복구/수수료설정 버튼)이 잘리고 부모 `Paper`가 `overflow:hidden`이라 가로 스크롤도 불가 → 어드민이 모바일에서 핵심 액션 버튼에 접근 불가(#246/247).

**설계 결정**:
1. **C-full(5곳 전부 카드형) 사용자 확정** — A(가로스크롤)·C(정산만 카드)보다 가독성 최상. 5개 테이블 모두 모바일 카드 분기 적용.
2. **breakpoint = `sm`(768px) 사용자 확정** — 폰=카드, 태블릿·데스크톱=테이블. 어드민 콘솔 특성상 태블릿+에서는 테이블 가독성이 우위.
3. **분기 방식 = Mantine `hiddenFrom`/`visibleFrom` prop** — 셀러 앱 최초 반응형 분기 도입(기존 코드에 `useMediaQuery`·`@media`·`hiddenFrom` 전무 확인). prop 방식 채택 근거: SSR 안전(하이드레이션 미스매치 없음)·JS 불필요·데스크톱 회귀 리스크 최소. 모바일 카드=`<Stack hiddenFrom="sm">`, 데스크톱 테이블=`<Paper visibleFrom="sm">`로 기존 `<table>`을 감싸기만 함(테이블 DOM·스타일 완전 불변).

**핵심 규칙(시각 회귀 0 정책)**:
- 데스크톱 `<table>`은 `visibleFrom="sm"` Paper로 **감싸기만** — 내부 thead/tbody/td DOM·스타일 일절 미수정(C3 회귀 0 보장).
- 카드는 셀러 [SettlementListItem.tsx](../apps/seller/src/app/settlements/_components/SettlementListItem.tsx)(`Paper`+`Group justify="space-between"`+`Stack`) 패턴 재사용.
- Badge/라벨은 SSOT 재사용 — 정산=`STATUS_LABEL`/`STATUS_COLOR`(@greenhub/shared), 나머지는 각 파일 로컬 맵 그대로(기존 테이블과 동일 소스).
- **로직 불변** — hook(`useAdmin*`)·API·액션 핸들러(`onPay`/`forceRefund`/`toggleSuspend`/`setCommission`) 미수정.

**중복 제거**: stores는 수수료 표시/편집(`renderRate`)·설정 진입(`renderSetButton`)을 컴포넌트 내부 헬퍼로 추출해 테이블·카드 공용(편집 폼 중복 방지).

**구현(세션88, 파일 5개)**: [SettlementTable.tsx](../apps/seller/src/app/admin/settlements/_components/SettlementTable.tsx)·[orders/_client.tsx](../apps/seller/src/app/admin/orders/_client.tsx)·[stores/_client.tsx](../apps/seller/src/app/admin/stores/_client.tsx)·[invite/_client.tsx](../apps/seller/src/app/admin/invite/_client.tsx)·[users/_client.tsx](../apps/seller/src/app/admin/users/_client.tsx). 정합성 C1~C6 전부 통과: 모바일 지급처리 버튼 접근(C1)·5테이블 전수 카드 분기(C2)·데스크톱 테이블 DOM 불변(C3)·SSOT·셀러 카드 패턴 재사용(C4)·`tsc`0·biome 0·`npm run build` exit0·인라인 hex/fontSize 위반 0(C5)·전 파일 500라인 한도 내(최대 309, C6).

**e2e**: 미실행. 어드민 전용 e2e 부재(`*admin*.spec.ts` 0건) + 변경이 순수 표현 레이어(로직·DOM 데스크톱 불변)라 e2e 회귀 대상 없음. 본 검증=모바일 폭 카드 육안(운영 단일 DB·카카오 로그인·DevTools/실기기 PWA — 사용자 위임).

**잔여**: 모바일 폭 카드 레이아웃 육안 검증(5개 화면). 데스크톱 회귀는 DOM 불변이라 안전.

**연관**: 선행 정합성 검토=[#CL-49], 플랜=admin-responsive-plan.md, 로드맵=`app-refactor-roadmap.md` §3 어드민 트랙. 다음=어드민 반응형 잔여(헤더/필터 등) 또는 소비자앱 리팩토링.

---

## [#CL-52] 겸직 계정(admin+seller) 역할 분리 — "어드민=store 없음" 전제 무효화 해소 (2026-05-25, 세션89)

**배경**: 셀러앱 설정 탭 "사업자 프로필 수정"([settings/page.tsx:68](../apps/seller/src/app/settings/page.tsx#L68), `href="/onboarding"`) 클릭 시 어드민 계정은 프로필 수정 화면 대신 `/admin/stores`로 튕김. 사용자는 어드민이면서 동시에 디어 오키드 store의 판매자인 **겸직 계정**(`role==='admin'` + `storeId` 보유).

**근본 원인 — 깨진 전제**: 커밋 `63e56c2`(2026-04-07) "fix: seller proxy — admin role onboarding 리다이렉트 제외"가 **"admin은 storeId 없이 정상 운영되므로"**라는 전제로 [proxy.ts](../apps/seller/src/proxy.ts)에 `isAdmin && pathname==='/onboarding' → /admin/stores` 분기를 추가. 당시엔 참이었으나, 겸직 계정 등장으로 전제 무효화. 데이터 모델은 이미 겸직 지원(role·storeId 독립 필드, [auth.ts:67-68](../apps/seller/src/auth.ts#L67-L68)) — 문제는 가드·UI가 `isAdmin` 단일 boolean으로만 분기하는 점.

**설계 결정 — 방향 A(전제 보정) 채택, 방향 B(모드 전환 상태) 기각 (사용자 확정)**:
- **A=전제 보정+양방향 문**: 가드가 `role`+`storeId`를 함께 보게 하고, 두 영역(`/admin/*` ↔ 셀러 화면)에 링크 추가. **별도 "모드 상태" 없음 — URL 네임스페이스가 곧 모드.**
- **B=전환 설계 기각 근거**: ① `/admin/*`와 셀러 화면은 이미 독립 레이아웃·가드로 물리 분리 = URL이 이미 모드 신호. ② 부족한 건 "상태"가 아니라 "문(門)"(링크)일 뿐. ③ 겸직 계정 현재 사실상 1명·저빈도 전환(YAGNI). ④ A→B 확장은 쉬우나 역행은 어려움.
- **겸직 판정 SSOT**: `role==='admin' && !!storeId`. 로그인 수단(카카오/이메일) 무관 — 역할 조합으로만 판정(특정 계정 하드코딩 금지, 확장성·기존 권한판정 일관성).

**구현 범위(3변경)**:
1. [proxy.ts:22](../apps/seller/src/proxy.ts#L22) 가드 보정 — `isAdmin && !storeId && pathname==='/onboarding'`로 조건 강화(겸직은 `/onboarding` 정상 허용, 순수 어드민만 콘솔로).
2. 셀러→어드민 문 — 설정 탭에 "관리자 콘솔" 행 추가, 겸직(`role==='admin' && storeId`)일 때만 노출.
3. 어드민→셀러 문 — [admin/layout.tsx](../apps/seller/src/app/admin/layout.tsx) 헤더에 "셀러 화면으로" 링크, 겸직일 때만 노출.

**정합성 체크포인트**: C1 겸직 `/onboarding` 진입·프로필 수정 정상 / C2 순수 어드민은 기존대로 콘솔 귀결(회귀0) / C3 일반 셀러 무영향(링크 미노출) / C4 tsc0·biome0·build0 / C5 500라인 한도.

**커밋·배포(세션89)**: 커밋 `2d30296` main push → Vercel 운영 배포. **운영 육안 1차 통과** — `seller.greenlove.co.kr/settings`에서 겸직 계정(정연, kakaoId 4827841177)에 "관리자" 섹션 + "관리자 콘솔로 이동" 행 정상 노출(§3 #44). **데이터 진단 확정**: 운영 admin 계정은 정연 1명, 연결 store는 "디어 오키드"가 아니라 **난플렉스**(`80189070-...`) — "디어 오키드"는 onboarding placeholder 예시였을 뿐. 백엔드 체인(`kakaoLogin`→`sanitizeUser` storeId 전달) 정상 확인.

**보안 방어선 검증(사용자 질의 — 일반 셀러가 링크로 어드민 침투 가능?)**: **불가. 이번 변경의 보안 영향 0.** 추가물은 `<a href>` 링크 한 줄(UI 편의)일 뿐, 권한 판정은 백엔드가 담당. 방어 4겹 확인 — ① UI 노출 게이팅(`isDualRole`, 보안 아님) ② 프론트 서버가드 [admin/layout.tsx:8](../apps/seller/src/app/admin/layout.tsx#L8) `role!=='admin'→redirect('/orders')` ③ **API 가드 [admin.controller.ts:18-20](../apps/api/src/admin/admin.controller.ts#L18-L20) 클래스 전체 `@UseGuards(JwtAuthGuard,RolesGuard)`+`@Roles('admin')` → 셀러 토큰 403** ④ JWT 서명 [jwt.strategy.ts:13](../apps/api/src/auth/strategies/jwt.strategy.ts#L13) `JWT_SECRET` 검증·role은 [auth.service.ts:319](../apps/api/src/auth/auth.service.ts#L319) Firestore 실제 문서에서 주입(클라 위조 시 서명 깨져 401). 셀러가 `/admin/*` 주소 직접 입력해도 ②에서 redirect, 우회해도 ③에서 데이터 0(403). **권장(미실행, 사용자 충분 판단)**: 셀러 JWT→admin 컨트롤러 403 백엔드 단위테스트(첫 어드민 보안 테스트) — 카카오 storageState 부재로 e2e보다 단위테스트가 현실적.

**연관**: 원인 커밋=`63e56c2`. 커밋=`2d30296`. 육안 검증=`pending-visual-verify.md` §3(42~52). 잔여 육안=#42 프로필 폼 진입·#46~47 어드민→셀러 링크.

---

## [#CL-53] 어드민 판매자 "치우기"(아카이브) + 어드민 e2e 인프라 신설 (2026-05-25~26, 세션90)

**기능 배경**: 어드민 판매자 목록([stores/_client.tsx](../apps/seller/src/app/admin/stores/_client.tsx))에 시드·온보딩 테스트로 들어온 빈 판매자가 운영 판매자(난플렉스)와 섞여 지저분. 목록에서 치울 길이 없었음.

**설계 결정 — `/further`→`/grill-me` 확정안**: 주문·정산 기록 **없는 판매자만** "치우기"(`store.status='archived'`, **영구삭제 아님 — 법적 책임 대비 기록 보존**) → 평소 숨김, "정리된 판매자 보기" 토글로 표시+복구.

**grill-me가 막아낸 핵심 (왜 이 범위인가)**:
- **원래 안전장치 "정지된 판매자만 치우기"는 성립 불가** — `toggleSuspend`는 `users`(소비자·드라이버)만 대상, **판매자 정지 기능 자체가 코드베이스에 없음**.
- **셀러앱 가드 [proxy.ts](../apps/seller/src/proxy.ts)는 `storeId`만 봄**(store.status 무시) → store를 archived로 바꿔도 영업이 안 막힘. 그래서 **"빈 판매자만 치운다"**로 범위를 좁혀 "판매자 정지 시스템 신설"(큰 작업)을 회피.
- **실수 방지 = 기록 있으면 서버 400 차단**(난플렉스 등 운영 판매자는 주문 있어 자동 보호) + `window.confirm`.

**구현(T1~T5)**: T1 [admin.service.ts](../apps/api/src/admin/admin.service.ts) `archiveStore`(orders·settlements `.where('storeId','==',id).limit(1)` 기록 가드→`BadRequestException` 또는 `status='archived'`)/`restoreStore`(`FieldValue.delete()`로 archivedAt 제거 — 래퍼는 [firestore.service.ts:24-26](../apps/api/src/firestore/firestore.service.ts#L24-L26)에 노출 확인) · T2 controller `PATCH stores/:id/archive`·`/restore`(클래스 `@Roles('admin')` 상속) · T3 [useAdmin.ts](../apps/seller/src/hooks/useAdmin.ts) — 차단 사유 UI 전달 위해 `runAction`(에러 삼킴) 대신 `apiJson` 직접 호출로 `ApiError` 전파 · T4 `showArchived` 토글+`visible` 필터 · T5 `renderArchiveButton`(치우기/복구+notification)+`STATUS archived='정리됨'`. **데스크톱 테이블+모바일 카드 양쪽.** 정합성 C1~C6 통과(tsc0·biome0·build0·500라인 최대388·archived 기록조회 회귀0·기록가드400). 커밋 `d10c60f` push·배포.

**어드민 e2e 인프라 신설 (프로젝트 첫 어드민 e2e)**: 어드민 e2e는 3중 차단(admin 전용 스펙 0개·테스트 계정 seller role·백엔드 `@Roles('admin')` 403)으로 불가였음. **사용자 확정 = 전용 e2e admin 계정 + 읽기 전용 스모크(운영 DB 쓰기 0)**. 전용 계정 `e2e-admin@test.com`(role=admin·storeId 없는 순수 어드민·특수문자 없는 28자 비번), [admin-store-archive.spec.ts](../apps/e2e/tests/admin-store-archive.spec.ts) 8테스트(chromium·mobile×4) 통과. 커밋 `b72298b`+`20c8e7a`.

**⚠️ 라이브 실행에서 잡은 함정 3건 (다음 앱 e2e에도 재발 가능 — 규약화)**:
1. **admin 세션이 seller에 가려짐** — admin은 어드민 화면=셀러앱 `/admin/*` 경로라 `SELLER_BASE` 공유. NextAuth `authjs.session-token` 쿠키 슬롯이 **도메인당 1개**뿐 → 같은 BrowserContext에 seller·admin 누적 시 마지막 것만 남아 충돌(증상: admin인데 셀러 "주문 관리" 화면 노출). **해결 = admin 전용 컨텍스트에서 `.admin-state.json` 격리 발급**([auth.ts](../apps/e2e/tests/_helpers/auth.ts) `ADMIN_STATE_PATH`, [global-setup.ts](../apps/e2e/global-setup.ts) 별도 컨텍스트). `.gitignore` 추가(세션 토큰).
2. **`networkidle` 무한 대기** — 셀러/어드민 화면은 SSE "실시간 연결"이 상시 열려 networkidle에 도달 못 해 timeout. **해결 = `domcontentloaded` + 명시적 요소(`getByText`) 대기.**
3. **비번 `#` 문자가 dotenv에서 주석 처리** — `.env`의 `TEST_ADMIN_PASSWORD`에 `#` 포함 시 그 이후가 잘림(24→14자) → 로그인 거부(set-cookie 0, 인증 race 아님). **해결 = 특수문자 없는 비번**(또는 `.env`에서 따옴표). 진단 핵심 = bcrypt `compare=true`로 DB 데이터 무결을 먼저 확인해 원인을 인증경로로 격리.

**부수 발견**: `admin@test.com`이 이미 **카카오 consumer 계정**으로 운영 DB 실재(2026-04-06) → 로그인 `where('email').limit(1).docs[0]` 비결정성. 전용 계정을 `e2e-admin@test.com`으로 분리해 회피.

**연관**: 계획서=`docs/plans/admin-store-archive-plan.md`. 육안=`pending-visual-verify.md` §4(#53~59, 상태변경 클릭은 e2e 미수행→육안 전용). 커밋=`d10c60f`·`b72298b`·`20c8e7a`. 잔여=상태변경(치우기·복구·차단) 육안만.


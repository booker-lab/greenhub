# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/archive/memory_archive_20260425.md`

최종 수정: 2026-05-16 (세션29 — e2e 잔여 B·C·D 해소)

---

## ✅ 완료된 작업 (세션22까지)

| 항목 | 완료일 |
|------|--------|
| Consumer/Seller/Driver DS + 성능(53→99) + PWA/CORS + 상품등록 버그 | 2026-04-25~05-01 |
| DS 리팩토링·툴체인·a11y·e2e 전체 구축·OrderGroup 리팩토링 | 2026-05-02~06 |
| BUG-SEC 초대토큰·next-auth beta.31·G4 셀러 대시보드 | 2026-05-08 |
| **세션18**: G2 상품명·preparedAt UI·B1 pre-fill·B2 에러피드백·G3 날짜선택기 | 2026-05-08 |
| **세션19**: 보안 패치 — Next.js 16.2.5 + React 19.2.6 CVE, HTTP 보안헤더, auth.ts 강화 | 2026-05-09 |
| **세션20**: 루트 vercel.json 삭제·Railway CORS fix·login force-dynamic·E2E_TEST 값 수정 | 2026-05-10 |
| **세션21**: 세션20이 남긴 허위 BLOCKER 검증·정정 | 2026-05-10 |
| **세션22**: E2E 보안 결함 정리 — Vercel `E2E_TEST` Production 제거·약한비번 54건 일소·**옵션 B 헤더 게이팅 도입** | 2026-05-10 |
| **세션23**: 셀러 fatal constraint 해소 — `orders/[id]` 629→217·`settlements` 531→116 분할 (#CL-22) | 2026-05-15 |
| **세션24**: 세션23 e2e 회귀 검증 (회귀 0건) + 인증 헬퍼 진단 강화 (#CL-23) | 2026-05-15 |
| **세션25**: 사전 결함 정리 — biome.json 파싱 에러·`.env.vercel.tmp` gitignore·driver Credentials 부재 확인 (#CL-25) | 2026-05-15 |
| **세션26**: #CL-21 옵션 A 보강 — Production env `E2E_TEST_SECRET` 제거 + Preview SSO bypass 도입 | 2026-05-15 |
| **세션27**: #CL-21 후속 — repo Secrets 11개 등록 + `sync-preview.yml` 자동 머지 워크플로 + e2e CI 가동 | 2026-05-16 |
| **세션28**: #CL-23 인증 race 해소 — e2e storageState 패턴(T0~T5). CI 풀런 124/37→145/16·146/15, race 0건 | 2026-05-16 |
| **세션29**: e2e 잔여 B·C·D 전부 해소 — C(perf-css networkidle 제거)·B·D 단일 원인 CORS fix(#CL-28). 재배포 후 풀런 167/0 | 2026-05-16 |

---

## ✅ 세션22 — 보안 결함 정리 (BLOCKER 해소)

**트랙별 결과**:
- **트랙 1**: seller·consumer Vercel `E2E_TEST` Production env 삭제 + 재배포 → `/login` HTML에서 `type="email"`·`type="password"` 0건 확인
- **트랙 2**: `scripts/delete-test-accounts.mjs --apply`로 54건 user + 2건 refreshToken 삭제. seller@test.com만 보존 결정. 새 e2e consumer로 `consumer@test.com` 생성(test1234 — 사용자 결정, 강한비번 권장은 follow-up). `seller-auth-invite.spec.ts`에 `afterAll` cleanup + `scripts/cleanup-spec-residue.mjs` 헬퍼 추가
- **트랙 3 옵션 B**: `E2E_TEST_SECRET` 32자 6환경 적용. `auth.ts`(seller·consumer) Credentials Provider 상시 등록 + `request.headers.get('x-e2e-test-token')` 검증. `apps/e2e/tests/_helpers/auth.ts` + `playwright.config.ts extraHTTPHeaders` 도입. 12개 spec helper migration 완료
- **트랙 4 통합 검증 5종**: 폼 노출 0, 약한비번 401, 보존 200, Firestore email-provider 2건(seller·consumer), 헤더 없는 credentials 호출 → `error=CredentialsSignin` ✓

**상세 설계**: [docs/CRITICAL_LOGIC.md](CRITICAL_LOGIC.md) #CL-20 (옵션 B), #CL-21 (옵션 A 향후 과제)
**원본 가이드**: [docs/archive/sessions/session22-prep.md](archive/sessions/session22-prep.md)

---

## 세션26 — #CL-21 옵션 A 보강 완료

- `preview` 브랜치 신설 → Vercel branch Preview 배포(`{project}-git-preview-…vercel.app`) 자동화. 21개 spec `BASE` 환경변수화. `.github/workflows/e2e.yml` 신설.
- Vercel seller·consumer **Production** env `E2E_TEST_SECRET` 삭제 (Preview·Development 유지) + 빈 커밋 재배포.
- **Preview SSO 우회**: Preview는 Vercel Authentication(SSO) 기본 보호 → Protection Bypass for Automation 시크릿 3개 발급. `global-setup.ts`가 bypass 쿼리로 `_vercel_jwt` 쿠키 발급 → `storageState`(`apps/e2e/.bypass-state.json`) 재사용. bypass 헤더도 전역 주입 금지(Firebase CORS).
- 검증: Production 유효 헤더로도 거부 / Preview 정상. smoke seller-orders 11/12·consumer-mypage 9/10.
- **주의**: PowerShell `Get-Content -Raw`가 UTF-8을 CP949로 오독 → 한글 mojibake 손상. spec 일괄 편집 시 Python(명시적 utf-8) 또는 Edit 도구 사용.
- **잔여**: GitHub repo Secrets 등록 전 CI 미동작. `preview` ↔ `main` 주기 동기화 필요.

상세: [docs/CRITICAL_LOGIC.md](CRITICAL_LOGIC.md) #CL-21

---

## 세션27 — #CL-21 후속: e2e CI 활성화

- gh CLI 2.92.0 winget 설치(`C:\Program Files\GitHub CLI`) → `booker-lab` 인증(ADMIN).
- `gh secret set`으로 repo Secrets 11개 등록 (`apps/e2e/.env` 값 그대로).
- `.github/workflows/sync-preview.yml` 신설 — `main` push → `preview` 자동 merge·push → `gh workflow run e2e.yml` 디스패치. (GITHUB_TOKEN push는 재귀방지로 e2e push트리거 미발화 → workflow_dispatch로 우회.)
- `e2e.yml` `pnpm/action-setup version:9` 고정 제거 (packageManager pnpm@10.32.1 충돌).
- **e2e CI 가동 확인**: 124 passed / 37 failed. 37건 전부 셀러 인증 spec — `set-cookie count=0` = **#CL-23 인증 race** (CI는 spec별 독립 인증으로 race 증폭). 셀러앱 코드 무변경이므로 회귀 아님.

---

## 세션28 — #CL-23 인증 race 해소: storageState 패턴 (#CL-27)

- **T0 재분류**: s27 실패 37건을 run 로그 + error-context 37개 증거로 재분류 — A 인증 race 23 / B Railway `Failed to fetch` 5 / C waitForLoadState 2 / D realtime 미정착 7. 「셀러 33건 전부 A」 가설 반증.
- **T1~T3**: `global-setup.ts`가 seller·consumer 1회 로그인 → `.auth-state.json` 발급. 11개 인증 describe에 `test.use({ storageState })` 배선, spec 개별 `loginViaCredentials` 제거. globalSetup 로그인은 race 흡수용 재시도 3회 — #CL-23의 helper-retry 기각과 구분(globalSetup 단일 지점이라 N 미증폭).
- **T4 검증**: e2e CI 2회 연속 풀런 124/37 → **145/16 · 146/15**. `set-cookie count=0` 두 번 모두 0건 → 인증 race 23→0 확정.
- **잔여 14~15건**: B·C·D + flake, 전부 storageState 무관 → `BACKLOG.md §12-2` 분리 기록.
- 인증 호출 풀런당 67회+retry → 2회.

상세: [docs/CRITICAL_LOGIC.md](CRITICAL_LOGIC.md) #CL-27

---

## 세션29 — e2e 잔여 B·C·D 해소 (#CL-28)

- **T0 재확인**: 최신 풀런 run 25952638293 — B 5·C 2·D 8·flake 1 (세션28과 동일, 인증 race 0건 유지).
- **C 완료**: `perf-css-regression:87·:103` Seller 로그인 — `waitForLoadState('networkidle')`가 Vercel preview의 `vercel.live` 피드백 위젯 상시 연결로 30s 타임아웃. trace로 확정(리소스 ~2.7s 완료, Firebase 호출 0). `networkidle` 제거 → 폼 렌더 + 1.5s 정착. 로컬 perf-css 15/15 통과.
- **B·D 단일 원인**: trace 콘솔에서 CORS 에러 확정 — Railway API가 Vercel preview origin에 `Access-Control-Allow-Origin` 미발급. B = `apiFetch` 차단, D = `/auth/firebase-token` fetch 차단 → `firebaseReady=false` → 대시보드 `연결 중` 고착. **D는 B의 하위 증상.** cold-start 가설 반증(전구간 분포·firestore는 정상).
- **수정**: `apps/api/src/main.ts` origin 콜백에 팀 스코프(`jos-projects-d1cecc0c`) 한정 정규식 추가. D spec 무변경.
- **검증 완료**: `c5ee52f` push가 Railway 자동 재배포 트리거 → preview origin CORS 발급·비매칭 차단 curl 확인 → e2e 풀런 run 25957177092 **167 passed / 0 failed / 11 skipped**. B 5·D 8 + 인증 race 전부 해소(178→0 fail).

상세: [docs/CRITICAL_LOGIC.md](CRITICAL_LOGIC.md) #CL-28

---

## 후속 작업 — SSOT: `docs/BACKLOG.md` §12

다음 세션 진입점은 [docs/BACKLOG.md](BACKLOG.md) **§12 후속 인프라·보안 정비**. 우선순위 표 → 항목 상세 순으로 확인.

- ✅ #CL-21 옵션 A(세션26)·CI(세션27) / ✅ #CL-23 인증 race(세션28) / ✅ #CL-28 B·C·D 전부(세션29)
- 🟡 **P2 (다음 세션 최우선)**: Railway `/auth/login` 로그 계측 / Vercel cold-start / `CRITICAL_LOGIC.md` 한도 정책
- 🟢 P3: `useOrderActions`·`/admin/banner` env·G1 거점 수정·Driver Maps SDK·consumer 강한비번

---

## e2e 인증 패턴 (옵션 B 이후)

| 항목 | 값 |
|------|-----|
| 헬퍼 | `apps/e2e/tests/_helpers/auth.ts` `loginViaCredentials(page, base, email, password)` |
| 호출 패턴 | globalSetup이 seller·consumer 1회 로그인 → `.auth-state.json` storageState 발급(#CL-27). 인증 spec은 describe 상단 `test.use({ storageState: AUTH_STATE_PATH })`만 — spec 개별 `loginViaCredentials` 호출 없음. 헬퍼는 globalSetup이 사용 |
| 헤더 주입 | helper의 csrf GET + credentials POST 두 호출에만 명시적 (`headers: { 'x-e2e-test-token': SECRET }`) — **전역 extraHTTPHeaders 사용 금지** (Firebase Identity Toolkit 등 third-party API에 헤더가 따라가 CORS preflight 차단됨) |
| BASE | `process.env.SELLER_BASE/CONSUMER_BASE/DRIVER_BASE` (Preview branch URL) — `apps/e2e/.env` |
| Preview SSO 우회 | `global-setup.ts`가 `_vercel_jwt` bypass 쿠키 발급 → `storageState`(`apps/e2e/.bypass-state.json`) 재사용. bypass 시크릿은 `*_BYPASS_SECRET` env |
| 검증 통과 | e2e CI 2회 풀런 145/16·146/15, 인증 race 0건 (#CL-27). 잔여 B·C·D는 BACKLOG §12-2 |

---

## 툴체인·배포

| 항목 | 값 |
|------|-----|
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` |
| Vercel Seller | `https://seller.greenlove.co.kr` |
| next-auth | 5.0.0-beta.31 |
| Lighthouse Perf | 99 |

---

## 핵심 기술 특이사항

- **login/page.tsx (seller·consumer)**: `export const dynamic = 'force-dynamic'` — 옵션 B 도입 후 폼 노출은 항상 false지만 force-dynamic은 유지(런타임 env 평가 보장)
- **E2E_TEST_SECRET**: 세션26부터 Vercel seller·consumer는 **Preview·Development만** (Production 제거 — #CL-21). `apps/e2e/.env`에 동일값. 32자. **MVP 출시 시 #CL-20 정리표대로 Preview도 삭제**
- **VERCEL bypass**: Preview 배포는 SSO 보호 → 3개 프로젝트 Protection Bypass for Automation 시크릿. e2e는 `_vercel_jwt` 쿠키로 우회 (`global-setup.ts`)
- **Railway CORS**: no-origin 요청 허용(헬스체크) — `if (!origin) return callback(null, true)` 유지 필수. Vercel preview origin은 `main.ts` 팀 스코프 정규식으로 허용(#CL-28) — `CORS_ORIGIN` env는 프로덕션 도메인만
- **gemini-3-flash-preview**: 유효한 모델명, 변경 금지
- **aggressiveFrontEndNavCaching: false**: 변경 금지 (RSC CORS 재발)
- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수
- **useStoreProducts firebaseReady 가드 금지**: 이중 인스턴스 버그
- **DS 폰트 예외**: BottomNav/ProductTopBar(10px), 주문상태뱃지(12px), 카운트다운(13px)
- **공동구매 CONFIRMED**: 시스템 자동 (선착순+크론) — 셀러 수동 확정 없음
- **preparedAt**: 빠른 선택지 UI (오늘 2시/4시/내일 오전) 확정
- **seller register inviteToken**: seller role 가입 시 필수
- **Portone V2**: PORTONE_V2_SECRET·PORTONE_WEBHOOK_SECRET `apps/api/.env` 반영 완료
- **orders ?tab= 딥링크**: `window.location.search` 사용 (Suspense 빌드 에러 방지)
- **proxy.ts**: Next.js 16 미들웨어 컨벤션 파일명, 정상 동작
- **AUTH_SECRET**: 3앱 Vercel 설정 완료

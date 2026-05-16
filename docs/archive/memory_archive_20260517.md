# Green Love — 프로젝트 메모리 아카이브 (세션22~34)

> 아카이브 생성: 2026-05-17 (세션35 진입 시 `docs/memory.md` 200라인 한도 요약).
> 활성 SSOT: `docs/memory.md` · 이전 아카이브: `memory_archive_20260425.md`
> 본 파일은 세션22~34의 세션별 상세 narrative를 보존한다. 설계 결정 정본은
> `docs/CRITICAL_LOGIC.md` #CL-19~#CL-31.

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
| **세션30**: P2-C #CL-29 — 누적 결정 로그 한도 정책(500라인 예외+1000라인 트리거). CRITICAL_LOGIC.md 1415→229라인 아카이브 분리 | 2026-05-16 |
| **세션31**: P2-A Railway latency 계측(synthetic) + 계측 중 발견한 throttler 전역 누수 버그 수정 (#CL-30) | 2026-05-16 |
| **세션32**: e2e 안정성 2건 — consumer-groupbuy flake + cleanup-spec-residue CI 인증(env 전환·BOM 방어). 풀런 167/0 | 2026-05-17 |
| **세션33**: P3 `/admin/banner` prerender 실패 해소 — seller firebase `getAuth` 지연 초기화 (#CL-31) | 2026-05-17 |
| **세션34**: P3 consumer@test.com 강한비번 전환 — Firestore `passwordHash` + `.env`·repo Secret 동기 교체, 풀런 167/0 | 2026-05-17 |

---

## ✅ 세션22 — 보안 결함 정리 (BLOCKER 해소)

**트랙별 결과**:
- **트랙 1**: seller·consumer Vercel `E2E_TEST` Production env 삭제 + 재배포 → `/login` HTML에서 `type="email"`·`type="password"` 0건 확인
- **트랙 2**: `scripts/delete-test-accounts.mjs --apply`로 54건 user + 2건 refreshToken 삭제. seller@test.com만 보존 결정. 새 e2e consumer로 `consumer@test.com` 생성(test1234 — 사용자 결정, 강한비번 권장은 follow-up). `seller-auth-invite.spec.ts`에 `afterAll` cleanup + `scripts/cleanup-spec-residue.mjs` 헬퍼 추가
- **트랙 3 옵션 B**: `E2E_TEST_SECRET` 32자 6환경 적용. `auth.ts`(seller·consumer) Credentials Provider 상시 등록 + `request.headers.get('x-e2e-test-token')` 검증. `apps/e2e/tests/_helpers/auth.ts` + `playwright.config.ts extraHTTPHeaders` 도입. 12개 spec helper migration 완료
- **트랙 4 통합 검증 5종**: 폼 노출 0, 약한비번 401, 보존 200, Firestore email-provider 2건(seller·consumer), 헤더 없는 credentials 호출 → `error=CredentialsSignin` ✓

**상세 설계**: `docs/CRITICAL_LOGIC.md` #CL-20 (옵션 B), #CL-21 (옵션 A 향후 과제)
**원본 가이드**: `docs/archive/sessions/session22-prep.md`

---

## 세션26 — #CL-21 옵션 A 보강 완료

- `preview` 브랜치 신설 → Vercel branch Preview 배포(`{project}-git-preview-…vercel.app`) 자동화. 21개 spec `BASE` 환경변수화. `.github/workflows/e2e.yml` 신설.
- Vercel seller·consumer **Production** env `E2E_TEST_SECRET` 삭제 (Preview·Development 유지) + 빈 커밋 재배포.
- **Preview SSO 우회**: Preview는 Vercel Authentication(SSO) 기본 보호 → Protection Bypass for Automation 시크릿 3개 발급. `global-setup.ts`가 bypass 쿼리로 `_vercel_jwt` 쿠키 발급 → `storageState`(`apps/e2e/.bypass-state.json`) 재사용. bypass 헤더도 전역 주입 금지(Firebase CORS).
- 검증: Production 유효 헤더로도 거부 / Preview 정상. smoke seller-orders 11/12·consumer-mypage 9/10.
- **주의**: PowerShell `Get-Content -Raw`가 UTF-8을 CP949로 오독 → 한글 mojibake 손상. spec 일괄 편집 시 Python(명시적 utf-8) 또는 Edit 도구 사용.
- **잔여**: GitHub repo Secrets 등록 전 CI 미동작. `preview` ↔ `main` 주기 동기화 필요.

상세: `docs/CRITICAL_LOGIC.md` #CL-21

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

상세: `docs/CRITICAL_LOGIC.md` #CL-27

---

## 세션29 — e2e 잔여 B·C·D 해소 (#CL-28)

- **T0 재확인**: 최신 풀런 run 25952638293 — B 5·C 2·D 8·flake 1 (세션28과 동일, 인증 race 0건 유지).
- **C 완료**: `perf-css-regression:87·:103` Seller 로그인 — `waitForLoadState('networkidle')`가 Vercel preview의 `vercel.live` 피드백 위젯 상시 연결로 30s 타임아웃. trace로 확정(리소스 ~2.7s 완료, Firebase 호출 0). `networkidle` 제거 → 폼 렌더 + 1.5s 정착. 로컬 perf-css 15/15 통과.
- **B·D 단일 원인**: trace 콘솔에서 CORS 에러 확정 — Railway API가 Vercel preview origin에 `Access-Control-Allow-Origin` 미발급. B = `apiFetch` 차단, D = `/auth/firebase-token` fetch 차단 → `firebaseReady=false` → 대시보드 `연결 중` 고착. **D는 B의 하위 증상.** cold-start 가설 반증(전구간 분포·firestore는 정상).
- **수정**: `apps/api/src/main.ts` origin 콜백에 팀 스코프(`jos-projects-d1cecc0c`) 한정 정규식 추가. D spec 무변경.
- **검증 완료**: `c5ee52f` push가 Railway 자동 재배포 트리거 → preview origin CORS 발급·비매칭 차단 curl 확인 → e2e 풀런 run 25957177092 **167 passed / 0 failed / 11 skipped**. B 5·D 8 + 인증 race 전부 해소(178→0 fail).

상세: `docs/CRITICAL_LOGIC.md` #CL-28

---

## 세션30 — CRITICAL_LOGIC.md 한도 정책 (#CL-29)

- **P2-C 완료**: 누적 결정 로그(`CRITICAL_LOGIC.md`·`BACKLOG.md`·memory 아카이브)는 시계열 append-only — 분리 시 이력 파편화·#CL 연속성/앵커 손상. **500라인 모듈화 한도 예외**로 CLAUDE.md §1 명시. 단 무한 증가 방어로 **1000라인 초과 시 종결 엔트리 아카이브**(크기 기준, 죽은 엔트리만).
- **적용**: `#CL-19` 경계 분할 — 2026-03~04 종결 엔트리 1208라인을 `archive/CRITICAL_LOGIC_archive_20260516.md`로 이관. 활성 파일 1415→**229라인**. 참조 링크 정합성 검토 완료.
- 상세: `docs/CRITICAL_LOGIC.md` #CL-29.

---

## 세션31 — P2-A Railway latency 계측 + throttler fix (#CL-30)

- **P2-A 완료**: Railway 배포 로그에 요청 단위 로그가 전무 → synthetic 측정 스크립트 `scripts/measure-api-latency.mjs` 신설(Railway CLI로 대시보드 없이 접근, 60초 윈도우당 8회 페이싱). `/auth/login` p50 922ms·p95 1551ms·p99 1687ms·**0% 실패**, `/health` p50 409ms. 서버 작업 ≈ ~510ms(Firestore 조회+bcrypt factor-12+토큰 발급, bcrypt 지배적). ~0.9s steady는 e2e 차단 요인 아님 → P2-B(cold-start) 데이터상 불필요 종결(moot).
- **throttler 버그 발견·수정 (#CL-30)**: 측정 중 `/health`가 ~10~19회 후 429. `ThrottlerModule`의 named throttler는 전 라우트 전역 적용 → `auth`(10/분) 등록만으로 `/health` 등 비인증 라우트까지 10/분에 묶여 `default`(100/분) 무효화. 수정: `auth` throttler 제거 + 인증 라우트(register·login·kakao-login·refresh)에 `@Throttle({default:{limit:10}})` 라우트 한정 오버라이드. 커밋 `23e3528` 재배포 후 헤더 검증 — `/health` `x-ratelimit-limit:100`·`/auth/login` `:10`.

상세: `docs/CRITICAL_LOGIC.md` #CL-30

---

## 세션32 — e2e 안정성 2건 해소

- **consumer-groupbuy:14 flake**: `waitForSelector('모집 중').catch()` 후 `empty.isVisible()`가 false면 "모집 중"을 강제 단언 — 페이지 로딩 중이면 리스트도 empty-state도 미렌더라 오판. `list.or(empty)` 확정 렌더 대기 후 분기로 수정 (커밋 `abd2a13`).
- **cleanup-spec-residue CI 인증 실패**: 스크립트가 gitignore된 로컬 키 `apps/api/firebase-adminsdk.json`을 `require` → CI 러너 부재로 `exit=1`, seller-auth-invite `afterAll` 정리 무력화(세션22 이후 상존). `FIREBASE_SERVICE_ACCOUNT_JSON` env 우선·로컬 키 fallback(`firestore.module.ts`와 동일 규약) 전환 + `e2e.yml` env 주입 + repo Secret 등록 (커밋 `b095023`). 후속: Windows gh CLI 파이프 업로드 시 선두 BOM(U+FEFF) 혼입 → `JSON.parse` 실패 → BOM 제거 방어 + Secret no-BOM 재업로드 (커밋 `4934468`).
- **검증**: e2e 풀런 run 25965438455 **167 passed / 0 failed**, cleanup 로그 `users=2 tokens=0 skipped=0` (세션22 이후 처음으로 CI에서 잔여 계정 정리 동작).

---

## 세션33 — `/admin/banner` prerender 실패 해소 (#CL-31)

- **원인**: `apps/seller/src/lib/firebase.ts`가 모듈 최상위에서 `getAuth(app)` 평가 → `apiKey` 부재 시 `getAuth`가 동기 throw(`auth/invalid-api-key`). 빌드 prerender가 firebase를 import하는 첫 페이지(`/admin/banner`, 알파벳 우선)를 평가하다 크래시 → 빌드 abort. 페이지 자체 버그 아님.
- **Vercel 무영향**: 셀러 앱 정상 배포·e2e 167/0 → Vercel 빌드 env엔 firebase 변수 존재. 실패는 변수가 비표준 `.env.vercel.local`에만 있고 `.env.local`엔 없는 로컬·env 미주입 빌드 한정. BACKLOG의 "Vercel 환경변수 점검"은 불필요로 확정.
- **수정**: `getAuth`/`getStorage`를 지연 초기화 함수 `getFirebaseAuth()`/`getFirebaseStorage()`로 전환(메모이즈). 사용처(`useFirebaseAuth`·`useOrders`·`onboarding`·`ImageUpload`·`admin/banner`) 전부 클라이언트 런타임이라 모듈 로드 평가 불필요. `db`는 미throw로 즉시 초기화 유지.
- **검증**: env 미주입 로컬 빌드 — 수정 전 크래시 재현, 수정 후 빌드 성공(전 라우트). 커밋 `32738fb`.

---

## 세션34 — consumer 강한비번 전환

- **배경**: 세션22에 편의 우선으로 채택한 `consumer@test.com` 약한비번(`test1234!`)을 보안 follow-up으로 전환. 사용자가 보안 우선으로 정책 재확인.
- **처리**: `scripts/reset-user-password.mjs`로 Firestore `users` 문서 `passwordHash`를 30자 랜덤 비번(bcrypt-12)으로 갱신. `apps/e2e/.env`(gitignored)·repo Secret `TEST_CONSUMER_PASSWORD` 동기 교체(`gh secret set --body`로 BOM 회피). `/auth/login` 직접 curl — 새 비번 200·기존 401 확인.
- **검증**: e2e 풀런 run 25966655016 **167 passed / 0 failed / 11 skipped**. `seller@test.com`은 본 항목 범위 밖 — 약한비번 유지.

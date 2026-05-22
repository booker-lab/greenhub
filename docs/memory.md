# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `archive/memory_archive_20260425.md` · `archive/memory_archive_20260517.md` (세션22~34 상세)

최종 수정: 2026-05-21 (세션65 — T-CLEAN3-B 잔존 apiFetch 8파일 일괄 마이그레이션, #CL-32 P2 종결)

---

## 진행 현황

세션22까지 + 세션23~54 완료. 셀러 주문 탭 리팩토링(T1~T7) + 배송일 풀스택+셀러 IA(T1~T6) + P4 fontSize 토큰화 종결. 세션53부터 Railway Outage 지속으로 백엔드 무관 작업(UX 잔여 플랜)으로 전환.

**세션46~51 요약**: 배송일 풀스택+셀러 IA T1~T6. T1(`5281188`), T2(`35cf229`+`e4c376c`), T3(`4e1576a` #CL-34), T4(`2c6c89d`), T5(`bffce2a` #CL-35), T6(`ed2fc95` e2e 시드+신규 spec, 세션51).

**세션52 요약**: T7-A — Railway `api-production-13e7.up.railway.app` 전 엔드포인트 404. 원인은 GCP가 Railway 조직 계정 차단(Major Outage), 재배포 무효, 복구 ETA 없음. T7-B — P4 fontSize 토큰화 3곳(`var(--font-size-2xl)`).

**세션53~60 요약 (셀러 UX 잔여 T-UX1~5 시리즈 · #CL-36/37/38)**: Railway Outage 우회 백엔드 무관 작업으로 셀러 UX 5세션. T-UX1 `SegmentedTabs` 신설+3페이지(`#CL-36`), T-UX2 ProductCard Switch+Button 분리, T-UX3 `ConfirmModal` 신설+6건 교체(`#CL-37`), T-UX4a/b/c fontSize 토큰화(admin 17·본 화면 10·_components 7건, `--font-size-xs:12px` 신설 `#CL-38`), T-UX5 정합성 검토 0건 변경. 세션60 e2e 풀런 디스패치(누적 미검증 5세션 분량). `status.railway.com` 2026-05-21 Fully Operational 복구 확인. 상세는 `archive/memory_archive_*.md`와 `BACKLOG §12-1` 활동 로그 참조.

**세션61 (e2e 풀런 회귀 가드 fix, `f6c275b`)**:
- **세션60 dispatch 결과**: 자동 26203591175·수동 26203663981·로컬 시드 후 재dispatch 26204055994 — **3회 연속 동일 2건 실패** (`consumer-mypage.spec.ts:74` + `seller-orders.spec.ts:200`). 동일 실패 = stale 무관(`reference_e2e_preview_race` 유효) + 시드 누락도 아님(로컬 멱등 시드 재실행 후에도 동일).
- **스크린샷 아티팩트 직접 대조로 원인 확정 — 회귀가 아닌 누적 selector 불일치**:
  - consumer mypage: 주문 2건 정상 렌더링되었지만 OrderCard에 `data-testid="order-card"` 부재 → 테스트 `hasOrders=false`로 잘못 판정 → 실제 주문이 있어 빈 상태 텍스트도 미노출.
  - seller orders: 공구 토글 후 카드 렌더링됐지만 `주문 #RDER-001`(`id.slice(-8).toUpperCase()`)만 표시·productName 미노출 → `text=E2E 공구 상품` 매칭 실패.
- **누적 결함의 트리거**: `ed2fc95`(세션51) e2e 시드 추가 이후 노출 — 이전엔 Firestore에 시드 부재로 빈 상태 분기/카드 0개로 흘러 통과해온 운. UX4 fontSize 토큰화는 회귀 윈도우(2026-05-19 15:14~22:13) **이후** 머지로 무관 확정.
- **수정 적용 2건**:
  - `apps/consumer/src/app/mypage/_client.tsx:79` OrderCard `UnstyledButton`에 `data-testid="order-card"` 부여.
  - `apps/seller/src/app/orders/_components/OrderCard.tsx:42` 주문번호 라인 아래에 `{order.productName && <Text lineClamp={1}>}` 옵셔널 한 줄 추가(UX 개선 겸 e2e 가드). 사용자 결정 — UX 변경 옵션 채택.
- **검증**: consumer/seller 타입체크 exit 0·두 앱 빌드 통과. ① 자동 dispatch 26204659238(sync-preview success 7초 후) — `seller-orders.spec.ts:200 ✓` 통과로 seller fix 작동 확인, 하지만 `consumer-mypage:74`는 fail(Vercel 실배포 완료 전 stale). ② 수동 dispatch 26204985493(sync-preview 후 11분 차) — **success 전건 통과**.
- **`reference_e2e_preview_race` 메모리 보강 후보**: sync-preview workflow가 success로 떨어져도 Vercel 실배포 완료까진 시간이 더 필요 → **자동 dispatch는 stale 가능성 일관 재현**(세션60·세션61 양쪽 확인). 차기 dispatch는 sync-preview 종료 후 5분+ 대기 권장.
- **다음 세션 진입점**: BUG-16(택배 갭)·UX-11(주문번호 통합)·Driver Kakao Maps SDK·백엔드 단일 장애점 회고 중 선택. 진입 문서 미작성.

**세션61 후속 — 셀러앱 리팩토링 종합 점검 + 정리 플랜 수립 (코드 변경 없음)**:
- **점검**: 세션 28~60 셀러 프론트엔드 리팩토링 전수 검토 — 전반 양호(500라인 한도 0건 위반·#CL-27~38 9건 결정 일관·공통 컴포넌트 3종 깔끔·API 레이어 통일·디자인 토큰 100% 커버). 개선 필요 4건 도출 — P0 native `alert()` 3건(admin/orders·settlements·stores) / P1 biome 40 errors 16 warnings(organizeImports FIXABLE 약 25건·noNonNullAssertion 6·noArrayIndexKey 5 등) / P2 products ProductCard `apiFetch` 잔존(#CL-32 P2 미봉합) / P3 useGroupConfigs N회 fetch(스케일 시점 회고).
- **플랜 신설**: `docs/specs/frontend/seller-cleanup-plan.md` — T-CLEAN1(Lint 정리, 세션62) → T-CLEAN2(alert → Mantine notifications, 세션63, #CL-39 예정) → T-CLEAN3(products → apiJson, 세션64) 3 아토믹 세션. **각 세션 진입 시 사전 정합성 검토 후 진입**(이전 세션 머지/baseline/의존성/e2e/500라인 5항목).
- **사용자 결정 4건**: ① 진행 순서 = 회귀 표면 작은 것부터(Lint→alert→apiJson) ② Lint 범위 = FIXABLE 자동 + 명확한 수동 fix(목표 5건 이내·위험 케이스는 biome-ignore + 사유) ③ alert 대체 = `@mantine/notifications` 도입(신규 의존성·#CL-39 등재 예정) ④ 정합성 검토 시점 = 세션 진입 시 사전 검토.
- **BACKLOG §12-1**에 셀러앱 정리 작업 행 추가. **다음 세션 진입 = 세션62 T-CLEAN1**, 진입 문서 `docs/archive/sessions/session62-prep.md` 작성 완료 — 진입 시 사전 정합성 5항목 + 사용자 결정 2건(ImageUpload 키·auth.ts env 가드) 확인 후 Phase A/B/C 진행.

**세션62 (T-CLEAN1 완료, `2f100e1`+`09061df`)**:
- **사전 정합성 검토**: 5/5 통과 — 직전 세션 머지 OK·baseline 40e/16w 일치·`noNonNullAssertion`만 6→8 미세 drift(같은 카테고리, 동일 처리 방침)·pnpm-lock 정합·500라인 신규 위반 없음.
- **Phase A 자동 수정(`2f100e1`)**: `biome check --write`로 30파일 정리. organizeImports 26 + useTemplate 1 + noUnusedImports 1 자동 해소(기대 ~15건보다 큰 폭). 의미 변경 없음(import 정렬·destructuring 포맷팅). 40e/16w → 1e/16w.
- **Phase B+C 수동 fix(`09061df`)**: ① **ImageUpload 인덱스 키 → url 키**(setAsMain reorder 시 stale state 방지) ② 안정 키 4건(pickup OTP·AIPreviewPanel·daily-caps 캘린더 2건) biome-ignore + 사유 ③ VarietySelector groupBy 누적 패턴 biome-ignore ④ noNonNullAssertion 8건 모두 biome-ignore + 사유(auth.ts env 3건·useFirebaseAuth env 1건·banner cta1/cta2 spread fallback 4건) ⑤ Phase A에서 누락된 FIXABLE 2건은 warning 등급이라 수동(useSettlements 템플릿 리터럴·useOrders OrderStatus 미사용 import).
- **최종 baseline**: **0 errors / 2 warnings** (목표 5건 이내 초과 달성). 잔여 2 warnings는 `noImgElement`(onboarding:186·ImageUpload:96) — Next/Image 마이그레이션 별건(범위 외), **BACKLOG PERF-01로 등재**(Firebase Storage 도메인 화이트리스트·LCP 측정 동반 필요).
- **검증**: 셀러 타입체크 exit 0·`pnpm --filter seller build`(23라우트)·biome 신규 0건·e2e 영향 없음(정적 코드 변경만).
- **사용자 결정 채택**: ImageUpload url 기반 키(reorder 실재 시나리오 존재)·env 변수는 biome-ignore + 사유(가드 추가 대비 가독성 우위).
- **다음 세션 진입 = 세션63 T-CLEAN2** — `@mantine/notifications` 도입 + alert 3건 치환. 진입 시 사전 정합성 5항목 + Notifications 위치/자동 닫힘 시간/성공 알림 도입 여부 등 사용자 결정 3건 확인 필요.

**세션65 (T-CLEAN3-B 완료, `5f3d75f`)**:
- **사전 정합성 5/5 통과**: 직전 머지 `2291fc9` OK·잔존 8파일 grep 일치·`apiJson<T>`/`ApiError(status,message)` 시그니처 무변경·T-CLEAN1 baseline 0e/2w 유지·500라인 신규 위반 없음.
- **사용자 결정 2건 (전부 권장안)**: ① 범위 = **8파일 전부**(온보딩 회귀 표면 큼에도 1세션 봉합) ② daily-caps PATCH 실패 = `notifications.show({color:'red'})` 추가(#CL-39 일관성).
- **변경 8파일**: settlements/useSettlements 2건(summary/list `apiJson<T>` + ApiError catch)·daily-caps GET silent + PATCH notifications.show·delivery GET silent + PATCH setError·hubs/pickup ApiError.message로 서버 본문 자연 흡수·hubs/[id] Promise.all 단순화·hubs/new POST + 폴백·hubs/page GET silent + toggle notifications + delete setError·onboarding store GET silent + POST/PATCH 분기에서 `session.update({storeId})` 보존(신규 가입 패스 무변경).
- **검증**: 셀러 타입체크 exit 0·`pnpm --filter seller build` 23라우트·biome **0e/2w**(T-CLEAN1 baseline 동일·회귀 0건, `--write` 자동 포맷 2건 동반: hubs/[id]·onboarding)·**Grep `apiFetch` apps/seller/src → `lib/api.ts` 인프라 1파일만** (#CL-32 P2 완전 종결).
- **범위 외**: consumer/driver·멀티파트(ImageUpload firebase storage 직접 호출)·세션 내 수동 e2e 검증(타입체크/빌드/biome 정적 검증으로 갈음).
- **다음 세션 진입점**: BUG-16(택배 갭)·UX-11(주문번호 통합)·Driver Kakao Maps SDK·백엔드 단일 장애점 회고 중 사용자 선택. 진입 문서 미작성.

**세션64 (T-CLEAN3 Phase A 완료)**:
- **사전 정합성 검토 5/5 통과 (1 drift)**: 직전 머지 OK·plan baseline "잔존 19파일" → 실측 **9파일**(api.ts 제외)로 정정·`apiJson<T>`/`ApiError(status,message)` 시그니처 변경 없음·e2e 170p/0f/11s 유지·500라인 한도 안전(products/page.tsx 272→유사).
- **사용자 결정 2건 (전부 권장안)**: ① 에러 메시지 톤 = **useAdmin 계열 통일**(`ApiError.message` 우선 + 사용자 친화 폴백) ② Phase B 잔존 8파일 = **본 세션 미진행, BACKLOG `T-CLEAN3-B` 별건 등재** (회귀 표면·세션 아토믹성 우선).
- **변경**: `apps/seller/src/app/products/page.tsx` ProductCard. ① import `apiFetch` → `ApiError, apiJson` ② `handleToggleActive` PATCH — `await apiJson(...)` + `catch (e) { setError(e instanceof ApiError ? e.message : '상품 상태 변경에 실패했습니다') }` ③ `handleDelete` DELETE — 동일 패턴 + 폴백 "상품 삭제에 실패했습니다"·성공 시 `setConfirmOpen(false)` 보존. 자체 state(`toggling`/`deleting`/`error`/`confirmOpen`)는 #CL-37 §3 카드 내부 state 예외 유지. biome `--write` 자동 포맷 1건 동반(DELETE 호출 한 줄로 정리).
- **검증**: 셀러 타입체크 exit 0·`pnpm --filter seller build` 23라우트·biome **0 errors / 2 warnings**(T-CLEAN1 baseline 동일·회귀 0건).
- **범위 외 명시**: 잔존 `apiFetch` 8파일(hubs 4·settlements 훅·settings 2·onboarding) → `T-CLEAN3-B` 별건. 멀티파트/스트리밍은 raw `apiFetch` 유지(인프라 함수).
- **다음 세션 진입점**: `T-CLEAN3-B` / BUG-16(택배 갭) / UX-11(주문번호 통합) / Driver Kakao Maps SDK / 백엔드 단일 장애점 회고 중 사용자 선택. 진입 문서 미작성.

**세션63 (T-CLEAN2 완료, `80a7e51`+`35f8410`, #CL-39)**:
- **사전 정합성 검토 5/5 통과**: alert 3건 일치(settlements:50·orders:44·stores:28)·`@mantine/notifications` 미설치·core/hooks 9.0.0 존재·T-CLEAN1 baseline 0e/2w 일치·pnpm-lock 정합.
- **사용자 결정 3건 (전부 권장안)**: Notifications 위치 = **top-right** · autoClose = **4000ms** default · 성공 케이스 도입 = **안 함**(플랜 원안, 실패/경고만).
- **Phase A 도입(`80a7e51`)**: `pnpm --filter seller add @mantine/notifications` → 9.0.1 설치(peer 9.0.0/9.0.1 mismatch는 minor patch, 빌드 무영향 확인). `providers.tsx`에 `<Notifications position="top-right" autoClose={4000} />` MantineProvider 내부 등록. `layout.tsx`에 `@mantine/notifications/styles.css` import.
- **Phase B 치환(`35f8410`)**: ① `admin/orders:44` 환불 실패 → `color:'red'`·title="환불 처리 실패" ② `admin/settlements:50` 지급 실패 → `color:'red'`·title="지급 처리 실패" ③ `admin/stores:28` 수수료율 검증 → `color:'orange'`·title="입력 값을 확인하세요". 톤 통일: 실패=red, 경고=orange.
- **Phase C 결정 기록**: **#CL-39 등재** — 셀러앱 native `alert/confirm/prompt` 금지·`@mantine/notifications` 단일화 정책 + 호출 패턴 + 색 규칙. BACKLOG §12-1 T-CLEAN2 ✅ 마킹. (#CL-37 ConfirmModal과 정책 일관성 회복.)
- **검증**: 셀러 타입체크 exit 0·`pnpm --filter seller build`(23라우트)·biome **0 errors / 2 warnings**(T-CLEAN1 baseline 동일·회귀 0건)·Grep `alert\(` apps/seller/src **0건** 달성.
- **범위 외 명시**: consumer/driver 앱·성공 알림(`color:'green'`) 선제 도입·admin/orders `prompt('환불 사유...')` — 모두 별건 평가.
- **다음 세션 진입 = 세션64 T-CLEAN3** — products ProductCard `apiFetch` → `apiJson` 마이그레이션(#CL-32 P2 잔여분 봉합). 진입 시 사전 정합성 5항목 + `apiFetch` 잔존 19파일 grep 재확인·Phase B 확장 범위 사용자 결정 필요.

---

## e2e 인증 패턴 (옵션 B / storageState · #CL-27)

- **헬퍼**: `apps/e2e/tests/_helpers/auth.ts` `loginViaCredentials(page, base, email, password)`.
- **호출**: globalSetup이 seller·consumer 1회 로그인 → `.auth-state.json` storageState 발급. 인증 spec은 describe 상단 `test.use({ storageState })`만 — 개별 호출 없음.
- **헤더 주입**: csrf GET + credentials POST 두 호출에만 `x-e2e-test-token` 명시. **전역 extraHTTPHeaders 금지** (Firebase 등 third-party API CORS preflight 차단).
- **BASE**: `SELLER_BASE/CONSUMER_BASE/DRIVER_BASE` (Preview branch URL) — `apps/e2e/.env`.
- **Preview SSO 우회**: `global-setup.ts`가 `_vercel_jwt` bypass 쿠키 발급 → `.bypass-state.json` 재사용. 시크릿 `*_BYPASS_SECRET`. bypass 헤더도 전역 주입 금지.
- **#CL-23 set-cookie race**: 로컬·CI 모두 간헐적으로 set-cookie 누락. globalSetup은 3회 재시도. 로컬 풀런 막힐 시 시드 + 수동 육안 검증으로 보조.

---

## 툴체인·배포

- Railway API `https://api-production-13e7.up.railway.app` · Consumer `greenlove.co.kr` · Seller `seller.greenlove.co.kr`.
- next-auth 5.0.0-beta.31 · Lighthouse Perf 99 · pnpm@10.32.1 · gh CLI `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록).
- e2e CI: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml` (main push → preview merge → workflow_dispatch).

---

## 핵심 기술 특이사항

- **login/page.tsx (seller·consumer)**: `export const dynamic = 'force-dynamic'` 유지 (런타임 env 평가 보장).
- **seller firebase.ts**: `getAuth`/`getStorage`는 지연 초기화 함수 `getFirebaseAuth()`/`getFirebaseStorage()`로만 노출 — 모듈 최상위 호출 금지 (apiKey 부재 시 동기 throw → 빌드 prerender 크래시 #CL-31). `db`는 즉시 초기화 유지.
- **E2E_TEST_SECRET**: Vercel seller·consumer는 Preview·Development만 (Production 제거 #CL-21). `apps/e2e/.env` 동일값 32자. MVP 출시 시 #CL-20 정리표대로 Preview도 삭제.
- **Railway CORS**: no-origin 허용 유지 필수 (`if(!origin) return callback(null,true)`). Vercel preview origin은 `main.ts` 팀 스코프 정규식 허용(#CL-28). `CORS_ORIGIN` env는 프로덕션 도메인만.
- **Railway throttler**: `app.module.ts`는 `default`(100/분) 단일 등록 — named throttler 추가 시 전 라우트 전역 적용되므로 금지. 인증 라우트만 `@Throttle({default:{limit:10}})` 오버라이드(#CL-30).
- **cleanup-spec-residue 인증**: `FIREBASE_SERVICE_ACCOUNT_JSON` env 우선·로컬 키 fallback. gh CLI Secret 업로드 시 BOM 혼입 위험 → no-BOM UTF-8로 업로드.
- **변경 금지**: `gemini-3-flash-preview`(유효 모델명) · `aggressiveFrontEndNavCaching:false`(RSC CORS 재발) · `useStoreProducts` firebaseReady 가드(이중 인스턴스 버그).
- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수. DS 폰트 예외 — BottomNav/ProductTopBar(10px)·주문상태뱃지(12px)·카운트다운(13px).
- **도메인·기타**: 공동구매 CONFIRMED 시스템 자동(선착순+크론, 셀러 수동 확정 없음) · preparedAt 빠른 선택지 UI · seller register inviteToken 필수 · Portone V2 시크릿 `apps/api/.env` 반영 · orders `?tab=` 딥링크는 `window.location.search` · `proxy.ts` Next.js 16 미들웨어 컨벤션 · AUTH_SECRET 3앱 Vercel 완료.
- **Windows 인코딩**: 한글 파일 일괄 편집 시 PowerShell `Get-Content`/`Set-Content` 금지(UTF-8 손상) — Python(명시적 utf-8) 또는 Edit 도구 사용.
- **seller 프론트 구조(#CL-32)**: Railway API 호출은 `lib/api.ts`의 `apiJson<T>()`(에러 시 `ApiError` throw) 사용 — raw `fetch` 금지. 페이지 셸은 `components/`의 `PageShell`/`PageHeader`/`EmptyState`/`LoadingState` 재사용. 주문 상태 변경은 `useOrderStatusUpdate` 코어 경유. 관리자 목록 훅은 `useAdminList` 팩토리. ProductForm은 `useProductForm` 훅 + 스텝 컴포넌트로 분리.
- **e2e 시드 (T6)**: `scripts/seed-e2e-orders.mjs` — 활성 상품 store에 14일치 dailyCaps + 셀러 store에 `e2e-` prefix 일반/공구 주문 + groupProductConfig. 멱등 set. `cleanup-spec-residue.mjs` 보존 정책.

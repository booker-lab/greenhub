# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `archive/memory_archive_20260425.md` · `archive/memory_archive_20260517.md` (세션22~34 상세)

최종 수정: 2026-05-21 (세션59 — T-UX4c products `_components` fontSize 토큰화 7건, T-UX4 종결)

---

## 진행 현황

세션22까지 + 세션23~54 완료. 셀러 주문 탭 리팩토링(T1~T7) + 배송일 풀스택+셀러 IA(T1~T6) + P4 fontSize 토큰화 종결. 세션53부터 Railway Outage 지속으로 백엔드 무관 작업(UX 잔여 플랜)으로 전환.

**세션46~51 요약**: 배송일 풀스택+셀러 IA T1~T6. T1(`5281188`), T2(`35cf229`+`e4c376c`), T3(`4e1576a` #CL-34), T4(`2c6c89d`), T5(`bffce2a` #CL-35), T6(`ed2fc95` e2e 시드+신규 spec, 세션51).

**세션52 요약**: T7-A — Railway `api-production-13e7.up.railway.app` 전 엔드포인트 404. 원인은 GCP가 Railway 조직 계정 차단(Major Outage), 재배포 무효, 복구 ETA 없음. T7-B — P4 fontSize 토큰화 3곳(`var(--font-size-2xl)`).

**세션53 (UX-07~10 플랜 수립)**:
- **진단**: Railway Outage 미복구 확인 → 백엔드 무관 작업으로 전환. UX-07~10 현재 코드 상태 진단 — UX-07 탭 혼재 유지(주문 검정/700 vs 상품·정산 초록/medium), UX-08 상품 카드 Badge×3 유지, UX-09 native `confirm()` **6건 잔존**(hubs:61·products:171·admin/drivers:58,66·admin/settlements:43·admin/users:13), **UX-10 사실상 자연 해소**(세션41~45 리팩토링으로 sticky 1곳·`top: var(--header-height)` 토큰화 완료). 추가로 `fontSize` 하드코딩 ~30곳 발견(admin 9파일·settlements/hubs/settings 본 화면·products _components).
- **플랜 수립**: [seller-ux-residual-plan.md](specs/frontend/seller-ux-residual-plan.md) 147라인 — **T-UX1** 탭 단일화(`SegmentedTabs` 신설 + 3페이지 치환), **T-UX2** 상품 카드 Badge 분리(Switch+ActionIcon), **T-UX3** `ConfirmModal` 공통 컴포넌트 + 6건 교체, **T-UX4a/b/c** fontSize 토큰화 분할, **T-UX5** 정합성 검토. 각 태스크 단독 PR/세션 단위·상호 무관·결정 사항 명시.
- **코드 변경 없음**: 신규 문서 1건(플랜) + BACKLOG/memory 갱신만.

**세션54 (T-UX1 완료, #CL-36)**:
- **정합성 검토 OK**: 세션53 진단(UX-09 confirm 6건·UX-07 탭 3페이지·`top:57`·fontSize ~30곳)이 세션54 진입 시점과 완전 일치. 사용자 결정 — 색상 `--color-primary`·강조 medium+active 700·sticky·Badge·컴포넌트 위치 모두 권장안 채택.
- **신설**: `apps/seller/src/components/SegmentedTabs.tsx`(~80라인) — Props `tabs/value/onChange/sticky/topOffset/layout`. `count > 0` Badge·`layout='flex'|'scroll'`·sticky default `var(--header-height)`.
- **치환**: `orders/page.tsx`(sticky+scroll+count+ACTION_REQUIRED 빨강) · `products/page.tsx`(flex, 카운트 label 인라인) · `settlements/page.tsx`(sticky+flex, `top: 57` 매직넘버 → `var(--header-height)` 동시 해소).
- **검증**: seller 타입체크(exit 0)·`pnpm --filter seller build`(23라우트)·biome 자동 포맷 후 신규 0건. 미사용 import 정리(orders `Badge`·products `UnstyledButton`·settlements `Box/Group/UnstyledButton`).
- **문서**: BACKLOG §11-3 UX-07 ✅·§12 활동 로그·§12-1 우선순위 표 갱신, CRITICAL_LOGIC #CL-36 추가, visual-verify F-T-UX1 섹션 #97~107 추가.

**세션55 (T-UX3 완료, #CL-37)**:
- **사용자 결정**: 자체 컴포넌트(Mantine Modal 직접 사용)·페이지 단일 state(products는 ProductCard 내부 state 예외)·권장 props 시그니처 채택.
- **신설**: `apps/seller/src/components/ConfirmModal.tsx` (~75라인) — `opened/title/message(string|ReactNode)/confirmLabel/cancelLabel/confirmColor(default red)/loading/onConfirm/onClose`, `whiteSpace: pre-line`로 다행 메시지 지원.
- **치환 6건**: ① hubs 거점 삭제(red, page state) ② products ProductCard 상품 삭제(red, card state 예외) ③ admin/drivers 승인/정지/해제 3액션을 `PendingAction`+`ACTION_META` 룩업으로 통합(green/red/gray) ④ admin/settlements 지급 처리(blue, 실패 시 alert 유지) ⑤ admin/users 정지/해제 가변 라벨·색상.
- **검증**: 셀러 타입체크(exit 0)·`pnpm --filter seller build`(23라우트)·biome baseline 72→68 errors(import 정렬 4건 자동수정)·신규 0건.

**세션56 (T-UX2 완료)**:
- **사용자 결정**: 활성 토글 `Switch`(ActionIcon/Badge 거절)·수정·삭제 `Button subtle`·삭제 `color=red`·상품명 우측 Switch + 액션 row는 수정·삭제만 — 모두 권장안 채택.
- **변경**: `apps/seller/src/app/products/page.tsx` ProductCard ① Badge×3 제거 → ② 상품명 라인 `Group justify=space-between`에 `Switch size=sm color=green` ③ 액션 row `Button size=xs variant=subtle`로 수정(gray Link)·삭제(red loading) 2개. imports `Badge` 제거 + `Switch` 추가.
- **검증**: 셀러 타입체크(exit 0)·`pnpm --filter seller build`(23라우트)·biome 자동 포맷 후 자체 이슈 0건, 전체 baseline **68→64 errors**·신규 0건.

**세션57 (T-UX4a 완료)**:
- **매핑 재설계**: 진입점 권장 `12→xs, 14→sm`은 현 토큰 정의(`packages/ui/src/style.css`: sm=15·md=16·lg=18·xl=20·2xl=24, **xs 미정의·사용 0건**)와 불일치. 사용자 결정으로 **12·14 모두 sm(15px)로 통일** — 12px 보조 텍스트 6건은 +3px 가독성 개선, 14px 11건은 +1px 미세 확대. 정책 변경 아니므로 #CL 신규 등재 없음.
- **변경 17건/7파일**: `admin/layout.tsx:53`·`banner/_client.tsx:116`·`drivers/_client.tsx:122`·`invite/_client.tsx:144,224`·`settlements/_client.tsx:91,102,158,235`·`orders/_client.tsx:103,169,177`·`stores/_client.tsx:74,132,159`·`users/_client.tsx:63,119` 모두 `fontSize: 'var(--font-size-sm)'`.
- **검증**: 셀러 타입체크(exit 0)·`pnpm --filter seller build`(23라우트)·biome `--write` 7파일 자동 포맷 + 전체 baseline **64→63 errors**(자동수정 부수효과)·admin 폴더 errors 0건. 시각 검증은 사용자 합의로 생략(정적 검증만).

**세션58 (T-UX4b 완료, #CL-38)**:
- **사용자 결정 2건**: ① `daily-caps:277 fontSize:10`(셀 내부 usedSlots 카운트 보조) → **신규 토큰 `--font-size-xs: 12px` 신설** 후 `var(--font-size-xs)` 적용(+2px) ② `hubs/pickup:180 fontSize:20`(OTP 입력 박스 48×56) → `var(--font-size-xl)` 채택(변동 0). 검증 강도 — 정적 검증으로 갈음(스팟 체크 생략).
- **변경 10건/5파일**: `settlements/_components/{DailySummaryTab,OrdersTab,PeriodTab}.tsx` 5건(모두 sm) · `hubs/[id]/pickup/page.tsx:180`(xl) · `settings/daily-caps/page.tsx:277`(xs)·`:313`(sm) · `settings/delivery/page.tsx:181,244`(sm).
- **신규 #CL-38**: `--font-size-xs: 12px` 신설 + 사용 기준(의도적 작은 보조 인디케이터에 한정). 세션57 "12·14→sm 통일"은 유지, xs는 보완.
- **검증**: 셀러 타입체크(exit 0)·`pnpm --filter seller build`(23라우트)·biome `--write` 대상 폴더 errors 0건·warnings 3건(기존)·전체 baseline 63→**50 errors**(자동수정 부수효과)·신규 0건.

**세션59 (T-UX4c 완료 · T-UX4 시리즈 종결)**:
- **변경 7건/3파일**: `products/_components/ImageUpload.tsx` 5건(9·9·9·11·12→**xs**, 80×80 썸네일 오버레이 라벨·✕ 삭제 버튼·"사진 추가" 빈 박스 — #CL-38 "의도적 작은 보조 인디케이터" 정책 일관 적용) · `AIPreviewPanel.tsx:147` Mantine `styles.input.fontSize: 15`→`var(--font-size-sm)` · `SellerNoteInput.tsx:38` Mantine `styles.input.fontSize: 16`→`var(--font-size-md)`. Mantine `styles` prop도 emotion 통해 CSS 변수 통과 — 타입체크 exit 0으로 검증.
- **사용자 결정 4건**: 9px 4건 → **xs 흡수**(권장) · 11/12px 2건 → **둘 다 xs**(권장) · Mantine styles 2건 → **양쪽 토큰화**(권장) · 검증 강도 → **정적 검증만**(시각 검증 생략).
- **검증**: 셀러 타입체크 exit 0·`pnpm --filter seller build`(23라우트)·biome `--write` 대상 폴더 자체 errors 0건·전체 baseline 63(세션58 종료 시 stash 측정)→**1 error/3 warnings**(자동수정 부수효과 -62·잔여 1 error는 `VarietySelector.tsx:54 noAssignInExpressions` 기존 코드·작업 무관)·신규 0건.
- **잔여 `fontSize: <숫자>` grep 0건 확인 — T-UX4 시리즈(a/b/c) 종결**. #CL 신규 등재 불필요(#CL-38 정책 그대로 적용).

**다음 세션 진입점**: 세션60 = **T-UX5 정합성 검토** — `confirm(` 잔존 0건·인라인 `fontSize: <숫자>` 잔존 0건·신설 토큰 #CL 등재·visual-verify 완비 확인. 변경 없으면 0.5세션 종결 예상. 진입 문서 `archive/sessions/session60-prep.md`. Railway Outage 무관.

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

# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `archive/memory_archive_20260425.md` · `archive/memory_archive_20260517.md` (세션22~34 상세)

최종 수정: 2026-05-20 (세션51 — T6 e2e 회귀 가드: 시드 스크립트 + 신규 spec + 육안 검증 보강)

---

## 진행 현황

세션22까지 + 세션23~51 완료. 셀러 주문 탭 리팩토링(T1~T7) + 소비자 배송일 풀스택(T1~T3) + 셀러 IA 재구성(T4~T5) 종결.

**세션46~50 요약**: 소비자 배송일 풀스택 + 셀러 토글/공구 조인. T1(`5281188` DeliveryDatePicker), T2(`35cf229` 카트·체크아웃 배송일 전달, `e4c376c` CheckoutForm 추출),
T3(`4e1576a` 슬롯 검증 선택일자 기준, #CL-34), T4(`2c6c89d` SaleTypeToggle), T5(`bffce2a` useGroupConfigs/공구 배송일 조인, #CL-35).

**세션51 (T6 e2e 회귀 가드)**:
- 시드 스크립트 `scripts/seed-e2e-orders.mjs` 신설 — firebase-admin으로 ① 활성 상품 보유 store에 14일치 dailyCaps(totalCap=10), ② 셀러 store(`9b2cb652`)에 일반 1건+공구 1건 주문(`e2e-` prefix · ACCEPTED) + `groupProductConfig.groupDeliveryDate`(오늘 +7일). 멱등 set으로 재실행 안전.
- 신규 spec `consumer-delivery-date.spec.ts`(2건 — DeliveryDatePicker 활성 일자 노출 + 택배 분기 미노출).
- `seller-orders.spec.ts`에 T6 섹션 5건 추가 — testid 노출, 토글 전환 시 칩 미노출, 공구 카드 표시, groupDeliveryDate 헤더, datePreset week 초기화.
- 라벨 정합: `'이번 주' / '직접 입력'`(DATE_PRESETS 일치).
- 로컬 풀런이 #CL-23 set-cookie race로 막혀, 육안 검증 D-T6(#89~#96) 섹션을 `seller-refactor-visual-verify.md`에 추가 + 시드 안내. preview 동기화 후 CI가 최종 검증 경로.
- #CL-35에 T6 후속 fragment 등재(CRITICAL_LOGIC.md 396라인, 1000 한도 여유).

**다음 세션 진입점**: 세션52 = preview 동기화 후 CI 풀런으로 신규 spec 검증 + 잔여 백로그 진입. 진입 문서 `archive/sessions/session52-prep.md`.
잔여 백로그 — P3 Driver Kakao Maps SDK, P4 준비 물량 공동구매·픽업 코드 fontSize 토큰화, BUG-16 택배 주문 상태 전환 갭.

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

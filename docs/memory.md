# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `archive/memory_archive_20260425.md` · `archive/memory_archive_20260517.md` (세션22~34 상세)

최종 수정: 2026-05-19 (세션45 — 셀러 주문 탭 리팩토링 세션 D: T7 검증 완료)

---

## 진행 현황

세션22까지 + 세션23~45 완료. **셀러 주문 탭 리팩토링(플랜 T1~T7) 전부 완료** — 세션40 감사·플랜 →
41 정합성 검토 → 42(A) T1+T2 → 43(B) T3+T4 → 44(C) T5+T6 → 45(D) T7. 태스크당 1커밋.
- T1~T2(`2c4de86`·`20345eb`): 상태 색상 버그 수정 + 상수 통합 + 요약바 제거·sticky 단일화.
- T3~T4(세션43): OrderCard 경량화(`useOrderActions` 삭제·강제취소 제거) + 주문 상세 EmptyState·sticky footer.
- T5(`92886d7`): 날짜 범위 필터 — `DateRangePreset`/`getDateRange`/`getOrderDate`/`isArchiveTab`(활성 탭 requestedDeliveryDate·아카이브 탭 createdAt 기준).
- T6(`72b93d0`): 날짜 그룹 헤더 — `groupOrdersByDate`/`getGroupHeaderMeta` + `DateSection.tsx`(overdue/today danger 틴트).
- T7(세션45): 타입체크 0건·biome 클린·정합성 grep 통과. e2e CI run `26086973797` **169 passed / 0 failed / 11 skipped**(예상치 일치).
  잔여 1건 — 픽업 코드 `fontSize:24` 2곳 토큰 부재로 미치환 → BACKLOG §1-3 P4 등재.

**다음 세션 진입점**: 주문 탭 리팩토링 종료. 잔여 백로그 — P3 Driver Kakao Maps SDK,
P4 준비 물량 공동구매·당일 배송 컷오프·픽업 코드 fontSize 토큰화, BUG-16 택배 주문 상태 전환 갭.

---

## e2e 인증 패턴 (옵션 B / storageState · #CL-27)

- **헬퍼**: `apps/e2e/tests/_helpers/auth.ts` `loginViaCredentials(page, base, email, password)`.
- **호출**: globalSetup이 seller·consumer 1회 로그인 → `.auth-state.json` storageState 발급. 인증 spec은 describe 상단 `test.use({ storageState })`만 — 개별 호출 없음.
- **헤더 주입**: csrf GET + credentials POST 두 호출에만 `x-e2e-test-token` 명시. **전역 extraHTTPHeaders 금지** (Firebase 등 third-party API CORS preflight 차단).
- **BASE**: `SELLER_BASE/CONSUMER_BASE/DRIVER_BASE` (Preview branch URL) — `apps/e2e/.env`.
- **Preview SSO 우회**: `global-setup.ts`가 `_vercel_jwt` bypass 쿠키 발급 → `.bypass-state.json` 재사용. 시크릿 `*_BYPASS_SECRET`. bypass 헤더도 전역 주입 금지.

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

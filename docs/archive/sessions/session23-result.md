# 세션23 — 셀러 페이지 분할 결과 보고

> 작성: 2026-05-15 (세션23 종료 시점)
> 결정 문서: [../../CRITICAL_LOGIC.md](../../CRITICAL_LOGIC.md) #CL-22
> 다음 세션: e2e 회귀 검증 ([§ 다음 세션 준비](#-다음-세션-준비--e2e-회귀-검증))

---

## 결과 요약

| 항목 | 결과 |
|------|------|
| CLAUDE.md §1 fatal constraint 해소 | ✅ 500라인 한계 위반 2건 모두 해소 |
| Track A — `orders/[id]/page.tsx` | ✅ 629 → **217** (-65%) |
| Track B — `settlements/page.tsx` | ✅ 531 → **116** (-78%) |
| tsc 타입체크 | ✅ `npx tsc --noEmit` 통과 |
| Next 빌드 (TypeScript 컴파일 단계) | ✅ 통과 |
| 모든 신규 산출 파일 < 500라인 | ✅ 최대 200라인 (OrderInfoSection.tsx) |
| 동작 변경 | ✅ 0건 — 순수 추출 리팩토링, 텍스트·DOM 구조 보존 |
| docs/CRITICAL_LOGIC.md #CL-22 기록 | ✅ |
| docs/memory.md 최신화 | ✅ 88라인 (200 한계 통과) |

---

## 사용자 결정 사항

| # | 결정 | 결과 반영 |
|---|------|----------|
| 1 | UI/UX 리팩토링은 보류, 급한 리팩토링부터 | 본 세션은 fatal constraint 해소만 |
| 2 | 우선순위 | 주문 → 정산 → 상품 → 어드민 (이번엔 1·2 fatal 2건만) |
| 3 | DDD 유지, SDD는 오버엔지니어링 판정 | shared-domain으로 로직 이동 보류 |
| 4 | 트랙별 정합성 검토 + 통합 검증 | A8 → B9 → C 트랙 단계 진행 |

세션 중 추가 결정:
- 5. `useOrderActions` 훅 통합 보류 — detail용/OrderCard용 시그니처 불일치 (모달 reason vs `prompt()`, `apiFetch` vs raw `fetch`). UI 리팩토링 사이클에서 동반 정비
- 6. `products/page.tsx` 분리 보류 — 315라인 한계 내. UI 변경 시 다시 손볼 가능성
- 7. 공통 `PageShell`/`PageHeader` 추출 보류 — UI 변경 사이클에 통합

---

## Track A — `orders/[id]` 분할 (629 → 217)

| 작업 | 산출물 | 라인 |
|------|--------|-----|
| A1 | `_lib.ts` — `toDate`, `formatDeadlineCountdown`, `makePreparedAtOptions`, `READONLY_STATUSES`, `CANCELLABLE_STATUSES` | 37 |
| A2 | `_hooks/useOrderDetail.ts` — Firestore `onSnapshot(orders/:id)` + `productName` 보조 fetch + `groupProductConfig` Timestamp 변환 | 60 |
| A3 | `_hooks/useOrderDetailActions.ts` — `handlePrepare(preparedAt)`, `handleCancel(reason)`. `apiFetch` 기반, 모달용 reason 인자 | 93 |
| A4 | `_components/OrderInfoSection.tsx` — 상태 헤더 + 상품/공동구매/배송/취소사유 4 Paper | 200 |
| A5 | `_components/PrepareForm.tsx` — 준비 시작 빠른 선택지 UI (오늘 2시/4시/내일 9시) | 95 |
| A6 | `_components/CancelOrderModal.tsx` — 모달 + reason 5자 검증 | 70 |
| A7 | `page.tsx` 본체 — 헤더 + 가드 + 조립 | **217** |

---

## Track B — `settlements` 분할 (531 → 116)

| 작업 | 산출물 | 라인 |
|------|--------|-----|
| B1 | `_lib.ts` — `toKRW`, `toDateStr`, `downloadCSV` | 37 |
| B2 | `_constants.ts` — 타입 + `STATUS_LABEL`·`STATUS_COLOR`·`TABS` | 41 |
| B3 | `_hooks/useSettlements.ts` — summary + list fetch + 탭 자동 fetch useEffect | 129 |
| B4 | `_components/DailySummaryTab.tsx` — 일별 요약 카드 + 날짜 선택 | 121 |
| B5 | `_components/PeriodTab.tsx` — 기간 선택 + 조회 + CSV | 103 |
| B6 | `_components/OrdersTab.tsx` — 주문별 상세 리스트 | 56 |
| B7 | `_components/SettlementListItem.tsx` — B5·B6 공통 카드 | 43 |
| B8 | `page.tsx` 본체 — 헤더 + 탭 + 분기 | **116** |

---

## 정합성 검증 (C 트랙)

| # | 항목 | 결과 |
|---|------|------|
| C1 | `npx next build --webpack` TypeScript 컴파일 단계 | ✅ 통과 (19.9s) |
| C2 | 라인수 한계 — 모든 파일 < 500 | ✅ 최대 200라인 |
| C3 | e2e 텍스트 셀렉터 대조 (`seller-order-detail.spec.ts`) | ✅ "주문 상세", "상품명", "준비 시작", "주문 관리" 모두 보존 |
| C4 | docs/CRITICAL_LOGIC.md #CL-22 기록 | ✅ |
| C5 | docs/memory.md 최신화 (200라인 한계) | ✅ 88라인 |

### 분리된 사전 결함 (본 작업 범위 외)

1. **`biome.json:35:5` 파싱 에러** — trailing comma. 셀러 앱 lint 실행 불가. 본 세션 작업과 무관한 사전 결함. 별도 세션에서 처리 권장.
2. **`/admin/banner` prerender 실패** — Firebase `auth/invalid-api-key`. 환경변수 누락. admin/banner는 본 작업 범위 외. orders/[id]·settlements는 `'use client'` + 인증 가드라 SSG/SSR 영향 없음.

---

## 🎯 다음 세션 준비 — e2e 회귀 검증

### 검증 대상 spec

| spec | 검증 포인트 |
|------|------------|
| `apps/e2e/tests/seller-orders.spec.ts` | 주문 목록 → ACTION_REQUIRED 그룹 카운트 + 탭 전환 (본 세션 미수정 페이지지만 detail 진입 흐름 검증) |
| `apps/e2e/tests/seller-order-detail.spec.ts` | **핵심** — G2 상품명 라벨, preparedAt 빠른 선택지 3개, 강제 취소 모달 reason 검증 |
| `apps/e2e/tests/seller-settlements.spec.ts` | 일별 요약 카드, 기간별 조회 + CSV, 주문별 상세 |

### 실행 절차

```bash
cd apps/e2e

# 환경변수 확인 (.env)
# - TEST_SELLER_EMAIL=seller@test.com
# - TEST_SELLER_PASSWORD=test1234
# - E2E_TEST_SECRET=<32자 base64, Vercel과 동일값>

# 셀러 spec 3종만 실행
npx playwright test seller-orders.spec.ts seller-order-detail.spec.ts seller-settlements.spec.ts
```

### 회귀 판정 기준

본 세션은 **동작 변경 0**을 목표로 한 순수 추출. 따라서:
- ✅ **통과**: 세션22와 동일하게 12/12 또는 spec별 기존 통과 수치
- ❌ **회귀**: 텍스트 셀렉터 매칭 실패, preparedAt 옵션 3개 미렌더, 모달 동작 변경
- ⚠️ **분리 검토**: `/admin/banner` 관련 실패 — 본 작업 회귀 아님(사전 결함). Firebase 환경변수 점검 필요

### 검증 시 주의사항

1. **`loginViaCredentials` 헬퍼 사용** — `apps/e2e/tests/_helpers/auth.ts`. 헤더 게이팅 통과를 위해 필수 (#CL-20).
2. **`extraHTTPHeaders` 전역 주입 금지** — Firebase CORS preflight 차단 (세션22 트레일 참조).
3. **테스트 계정 보존** — `seller@test.com`/test1234, `consumer@test.com`/test1234! 모두 약한비번 의도 보존 (memory `feedback_security_convenience.md`).
4. **로컬 빌드 사전 결함 무시** — `/admin/banner` 빌드 실패는 본 작업 회귀 아님. Vercel 배포 환경에서는 환경변수 충족됨.

### 회귀 발견 시 대응 흐름

1. 텍스트 셀렉터 실패 → `OrderInfoSection.tsx` / `DailySummaryTab.tsx` 등 분할된 컴포넌트의 텍스트 확인
2. 액션 동작 실패 (준비 시작·취소) → `useOrderDetailActions.ts`의 `apiFetch` 호출 + 상태 토글 검증
3. 데이터 미표시 → `useOrderDetail.ts` / `useSettlements.ts`의 useEffect 의존성 배열 확인

---

## 후속 작업 (UI 리팩토링 사이클로 이월)

- `useOrderActions` ↔ `useOrderDetailActions` 통합 (시그니처 정비)
- `products/page.tsx` 315라인 → ProductCard·useProductActions 분리
- 공통 `PageShell`·`PageHeader`·`TabBar` 추출 (모든 페이지 sticky header 패턴 일괄화)
- `biome.json` 파싱 에러 수정 → lint 복구
- admin/banner Firebase 환경변수 점검 (빌드 prerender 복구)

---

## 산출 자산

**Track A** (apps/seller/src/app/orders/[id]/):
- `_lib.ts`
- `_hooks/useOrderDetail.ts`, `_hooks/useOrderDetailActions.ts`
- `_components/OrderInfoSection.tsx`, `PrepareForm.tsx`, `CancelOrderModal.tsx`
- `page.tsx` (축약)

**Track B** (apps/seller/src/app/settlements/):
- `_lib.ts`, `_constants.ts`
- `_hooks/useSettlements.ts`
- `_components/DailySummaryTab.tsx`, `PeriodTab.tsx`, `OrdersTab.tsx`, `SettlementListItem.tsx`
- `page.tsx` (축약)

**문서**:
- `docs/CRITICAL_LOGIC.md` #CL-22
- `docs/memory.md` 세션23 줄 추가
- `docs/archive/sessions/session23-result.md` (본 문서)

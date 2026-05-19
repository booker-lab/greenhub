# 세션44 진입 문서 — 셀러 주문 탭 리팩토링 세션 C

> 작성: 2026-05-19 (세션43) · 선행: 세션 A(T1+T2)·세션 B(T3+T4) 완료
> 목표: T5(날짜 범위 필터) + T6(날짜 그룹 헤더) 구현

---

## 컨텍스트

세션40 설계 → 세션41 정합성 검토 → 세션42(A) T1+T2 → 세션43(B) T3+T4 완료.
플랜 SSOT: `docs/specs/frontend/seller-orders-refactor-plan.md` (§T5·§T6)

세션 C는 **주요 신기능** — 규모가 크면 T5 단독 / T6 단독 세션으로 분리 가능.
T5 먼저 커밋 후 T6 진행. 각 태스크 = 1커밋.

---

## 세션 C 태스크

### T5 — 날짜 범위 필터 신설 (1커밋)

**변경 파일:** `orders/page.tsx`, `orders/_constants.ts`

플랜 §T5 그대로 진행:
- `DateRangePreset` 타입 + `datePreset`/`customFrom`/`customTo` 상태 추가 (기본 `'week'`)
- 필터 칩 UI — PageHeader 아래, sticky 탭 위 (`[오늘][이번 주][이번 달][직접 입력]`)
- `getDateRange(preset, tab)` 유틸을 `_constants.ts`에 추가
  - 활성 탭(ACTION_REQUIRED·WAITING·IN_DELIVERY): `requestedDeliveryDate` 기준
  - 아카이브 탭(DONE·CANCELLED): `createdAt` 기준
- `filteredOrders` 계산에 날짜 범위 적용
- 탭 전환 시 날짜 필터 유지 / from>to 유효성 / `requestedDeliveryDate=null`은 제외 안 함

### T6 — 날짜 그룹 헤더 + 임박 강조 (1커밋)

**변경 파일:** `orders/page.tsx`, `orders/_constants.ts`, `orders/_components/DateSection.tsx`(신설)

플랜 §T6 그대로 진행:
- `groupOrdersByDate(orders, activeTab)` + `getGroupHeaderMeta(dateKey, isArchiveTab)` 유틸을 `_constants.ts`에 추가
- 주문 목록을 날짜 그룹 섹션으로 교체, `DateSection` 컴포넌트 신설
- overdue/today 섹션 강조, 지연 최상단·날짜 미정 최하단

> **⚠ 플랜과 현 코드 불일치 (세션43 발견):**
> 플랜 §T6 예시는 `<DateSection ... storeId={storeId} />` / 내부 `OrderCard`에 storeId 전달로 적혀 있으나,
> **세션 B(T3)에서 `OrderCard`의 `storeId` prop은 제거됨**. `DateSection`·`OrderCard` 모두
> `storeId`를 받지 않도록 구현할 것 — `<OrderCard order={order} />` 시그니처 기준.

---

## 세션 C 완료 기준

- [ ] T5 커밋 완료 + 타입체크 통과
- [ ] T6 커밋 완료 + 타입체크 통과
- [ ] biome 신규 에러 0건

> e2e 풀런·브라우저 육안 검증은 세션 D(T7)에서 일괄 수행.

---

## 다음 세션 (세션 D) 예고

T7 — 타입체크 + e2e 풀런 + 정합성 최종 검토. 플랜 §T7.
sticky 액션 footer(T4) 육안 검증, 주문 상태 색상(T1) 육안 검증 포함.

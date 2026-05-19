# 세션42 진입 문서 — 셀러 주문 탭 리팩토링 세션 A

> 작성: 2026-05-19 (세션40) · 선행: 세션41 정합성 검토 통과 후 진입
> 목표: T1(상수 통합·색상 버그) + T2(요약바 제거·sticky 단일화) 구현

---

## 컨텍스트

세션40에서 셀러 주문 탭 전체 감사 + 설계 완료.
세션41에서 플랜 정합성 검토 완료 (검토 결과 반영분은 플랜 문서에 직접 수정됨).
플랜 SSOT: `docs/specs/frontend/seller-orders-refactor-plan.md`

세션 A 범위는 **버그 수정 + 구조 정리** — 기능 변경 없음, 빌드 리스크 낮음.

> ⚠️ 진입 전 확인: 세션41 검토에서 T1·T2 관련 수정 사항이 있었다면
> 아래 작업 순서보다 **플랜 문서 §T1·§T2를 우선**한다.

---

## 세션 A 태스크

### T1 — 상수 통합 + 색상 버그 수정 (1커밋)

**배경:** `_constants.ts`와 `OrderRow.tsx`에 동일 상수가 이중 선언되어 있고 색상이 다름.
목록 카드(ACCEPTED=blue, PREPARING=orange) vs 상세(ACCEPTED=orange, PREPARING=blue).

**올바른 색상 기준 (D1 결정):**
```
ACCEPTED / CONFIRMED / RECRUITING : 'orange'
PREPARING                          : 'blue'
DELIVERING / HUB_ARRIVED           : 'violet'
DELIVERED / PICKED_UP / REVIEWED   : 'green'
CANCELLED                          : 'red'
PENDING                            : 'gray'
```

**작업 순서:**
1. `apps/seller/src/app/orders/_constants.ts`
   - `STATUS_COLOR` ACCEPTED·CONFIRMED·RECRUITING → `'orange'`, PREPARING → `'blue'` 수정
   - `ACCENT_BORDER`(카드 좌측 보더)도 **동반 교정** —
     ACCEPTED·CONFIRMED·RECRUITING → `'var(--color-status-warning-text)'`, PREPARING → `'var(--color-status-info-text)'`
     (세션41 검토: 미교정 시 한 카드 안에서 뱃지 색 ≠ 좌측 보더 색)
   - `SUMMARY_BAR_ITEMS` 상수는 T2에서 제거 (지금은 건드리지 않음)

2. `apps/seller/src/app/orders/[id]/_components/OrderRow.tsx`
   - `STATUS_LABEL_MAP`, `STATUS_COLOR_MAP`, `DELIVERY_LABEL_MAP` 3개 상수 **삭제**
   - `_constants.ts`에서 `STATUS_LABEL`, `STATUS_COLOR`, `DELIVERY_LABEL` import 추가

3. `apps/seller/src/app/orders/[id]/_components/OrderInfoSection.tsx`
   - import 경로 수정: `OrderRow`에서 가져오던 상수 → `../../_constants`

4. `apps/seller/src/app/orders/_components/OrderCard.tsx`
   - 주문번호 표시: `order.id.slice(-6)` → `order.id.slice(-8)` (상세와 통일)

**정합성 확인 (커밋 전):**
```powershell
# 상수 중복 없음 확인
grep -r "STATUS_COLOR_MAP\|STATUS_LABEL_MAP\|DELIVERY_LABEL_MAP" apps/seller/src
# → 결과 없어야 함

# 타입체크
pnpm --filter seller tsc --noEmit
```

---

### T2 — 요약바 제거 + sticky 단일화 (1커밋)

**배경:** PageHeader + 요약바 + 탭 3중 sticky로 목록 가시 영역 ~170px 잠식.
요약바와 탭이 동일 정보·동일 동작으로 중복.

> ⚠️ 세션41 검토 정정: 기존 작업 순서에 "탭 블록 `top: 57` → `top: 0`"와
> "탭 sticky `top: 114` → 57"이 함께 적혀 같은 탭을 두 좌표로 지시하는 모순이 있었음.
> 실제 코드는 **요약바가 `top: 57`, 탭이 `top: 114`**. 요약바 삭제 후 탭은 헤더 바로 아래
> = `top: var(--header-height)` 하나로 단일화한다 (아래 순서 반영분이 정정본).

**작업 순서:**
1. `apps/seller/src/app/globals.css`
   - CSS 변수 신규 선언: `--header-height: 57px`, `--bottom-nav-height: 64px`
     (세션41 검토: `--header-height` 미존재 / `--bottom-nav-height`는 D4·BottomNav 하드코딩 통합용)

2. `apps/seller/src/app/orders/page.tsx`
   - 요약바 블록(`{/* Summary Bar */}` ~ 닫는 `</Box>`) 전체 삭제
   - `SUMMARY_BAR_ITEMS` import 제거
   - 탭 블록: `top: 114` → `top: var(--header-height)` (요약바 제거 후 헤더 바로 아래)
     — `--header-height` 57px이 실제 헤더 높이와 맞는지 브라우저 실측 확인
   - `fontSize: 14`, `fontSize: 13` → `var(--font-size-sm)` / `fontSize: 20` → `var(--font-size-xl)` 치환
     (세션41 검토: `--font-size-base`는 코드 미사용 토큰 — 쓰지 않음)

3. `apps/seller/src/app/orders/_constants.ts`
   - `SUMMARY_BAR_ITEMS` 상수 삭제

4. `apps/e2e/tests/seller-orders.spec.ts` (세션41 검토: 요약바 제거 시 회귀 확정)
   - "Summary Bar — 3항목 렌더링"(line 94)·"Summary Bar 클릭"(line 104) 테스트 2건 삭제
   - 탭 뱃지 건수 표시 검증 테스트 1건 신설

**정합성 확인 (커밋 전):**
```powershell
# SUMMARY_BAR_ITEMS 완전 제거 확인
grep -r "SUMMARY_BAR_ITEMS" apps/seller/src
# → 결과 없어야 함

# 하드코딩 fontSize 잔여 확인
grep -n "fontSize: [0-9]" apps/seller/src/app/orders/page.tsx
# → 결과 없어야 함

# 타입체크
pnpm --filter seller tsc --noEmit
```
- [ ] `seller-orders.spec.ts` Summary Bar 테스트 2건 삭제 + 탭 뱃지 테스트 신설 완료

---

## 세션 A 완료 기준

- [ ] T1 커밋 완료 + 타입체크 통과
- [ ] T2 커밋 완료 + 타입체크 통과
- [ ] 목록 카드 뱃지 색 = 상세 뱃지 색 (브라우저에서 육안 확인)
- [ ] 카드 좌측 보더 색 = 카드 뱃지 색 (`ACCENT_BORDER` 동반 교정 확인)
- [ ] sticky가 탭 1개 — 스크롤 시 헤더와 탭만 고정됨 확인

---

## 다음 세션 (세션 B) 예고

T3 OrderCard 경량화 (인라인 폼 제거·취소 버튼 제거·useOrderActions 훅 삭제)
T4 주문 상세 개선 (EmptyState·sticky bottom 액션 버튼)

플랜 상세: `docs/specs/frontend/seller-orders-refactor-plan.md` §T3, §T4

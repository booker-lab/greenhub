# 세션50 진입 문서 — T4 + T5 구현 (셀러 주문 탭 IA 토글 + 공구 배송일 조인)

> 작성: 2026-05-20 (세션49) · 선행: 세션49 T3 완료 (`4e1576a`)
> 목표: **셀러 주문 탭 IA 재구성** — 일반/공구 대칭 토글 신설 + 공동구매 배송일 조인
> SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (T1·T2·T3 ✅)

---

## 컨텍스트

세션48~49로 소비자 배송일 선택 UI + API 슬롯 검증 변경이 완료되어 **일반 주문은 이제 신규 생성 시점부터 `requestedDeliveryDate`가 채워진다.** 이제 셀러 주문 탭의 IA가 일반/공구 비대칭 문제를 해소할 차례.

### 세션47 검토에서 확인된 사항 (재확인)

- `groupDeliveryDate`는 `groupProductConfig` 문서에 저장(소비자 결정이 아닌 셀러 결정).
- `useGroupProduct`는 ISO 정규화하나 셀러 조인(T5)에서는 **Firestore Timestamp일 수 있으므로 정규화 필요**.
- `getOrderDate` 호출처 2곳 — 시그니처 확장은 T5에서 일괄 처리(T4에서는 건드리지 않음).
- T4는 `filteredOrders`의 `saleType` 1차 분기 + 토글 UI만. 공구 분기에서 `groupConfigMap` 의존이 발생하면 T5 영역.
- e2e 토글 라벨 `text=` 충돌 주의 → `data-testid` 부여.

---

## 세션50 태스크

### T4 — 셀러 주문 탭 일반/공구 대칭 토글

**변경 파일:** `apps/seller/src/app/orders/page.tsx`, `apps/seller/src/app/orders/_constants.ts`, 신규 `apps/seller/src/app/orders/_components/SaleTypeToggle.tsx`

1. `saleType` 상태 (`'normal' | 'group'`, 기본 `'normal'`) — `useState`로 관리.
2. `SaleTypeToggle` 컴포넌트 신설 — `PageHeader` 아래, 날짜 필터 칩 위에 배치. 두 옵션 버튼, 활성 상태 강조. **`data-testid="sale-type-toggle-normal"`·`"sale-type-toggle-group"` 부여** (e2e 라벨 충돌 회피).
3. `filteredOrders` 계산에 `saleType` 1차 분기 추가 — 토글이 normal이면 `o.saleType !== 'group'`, group이면 `o.saleType === 'group'`.
4. **날짜 필터 칩은 일반 토글에서만 노출** — 공구는 1차 미노출(세션47 확정).
5. 상태 탭·날짜 그룹은 토글 하위에서 기존대로 동작.
6. 토글 전환 시 상태 탭은 유지, 날짜 필터는 초기화(공구는 칩 미노출이라 자연스럽게 무효화).

**정합성 확인:**
- [ ] 토글 전환 시 `filteredOrders` 즉시 갱신
- [ ] 일반 토글 — 기존 T5(날짜 필터)·T6(날짜 그룹 헤더) 회귀 없음
- [ ] 탭/날짜 필터 상태가 토글 전환 시 합리적 처리
- [ ] 타입체크·biome 신규 에러 0건

### T5 — 공동구매 배송일 조인

**변경 파일:** `apps/seller/src/app/orders/page.tsx`, `apps/seller/src/app/orders/_constants.ts`, `apps/seller/src/hooks/useOrders.ts` 또는 신규 조인 훅

1. 공구 토글 활성 시 — 표시 중인 공구 주문들의 `productId` 집합(중복 제거)에 대해 `groupProductConfig` 문서 fetch. productId별 `groupDeliveryDate` 맵 (`groupConfigMap`) 생성.
2. **Timestamp 정규화 필수** — `useGroupProduct`와 달리 셀러 조인 경로의 Firestore 직접 fetch는 Timestamp 가능. `groupDeliveryDate.toDate?.()` 패턴으로 ISO 정규화.
3. `getOrderDate(order, tab, groupConfigMap)` 시그니처 확장 — `saleType === 'group'`이면 `groupConfigMap[productId]?.groupDeliveryDate`, 미존재 시 fallback("날짜 미정"). 호출처 2곳 동반 수정.
4. `groupOrdersByDate`도 `groupConfigMap` 인자 추가해 공구 주문이 실제 `groupDeliveryDate` 기준으로 그룹핑되도록.
5. fetch 횟수 최소화 — productId Set으로 중복 제거 후 `Promise.all`.
6. 공구 토글에서 날짜 필터 칩은 1차 미노출 유지(T4 결정).

**정합성 확인:**
- [ ] 공구 주문이 `groupDeliveryDate` 기준 날짜 그룹으로 묶임
- [ ] `groupProductConfig` 미존재 productId는 "날짜 미정" 안전 처리
- [ ] fetch 횟수 과다 없음
- [ ] 일반 토글 동작에 영향 없음 (`getOrderDate` 분기 격리)
- [ ] Timestamp 정규화 누락 없음 — `.toDate?.().toISOString()` 패턴
- [ ] seller 타입체크 통과

**커밋 후:**
```bash
cd apps/seller && pnpm tsc --noEmit
pnpm --filter seller build  # prerender 영향 확인
```

---

## 진행 규칙

- T4·T5는 각 1커밋. 규모가 큼 — T4 먼저 단독으로 끝내고 잠시 점검 후 T5 진입 권장.
- 설계 변경 #CL 등재 — T4·T5 합쳐 한 엔트리(#CL-35) 권장 (셀러 주문 IA 재구성).
- T6(e2e 포함 최종 검토)는 세션51로 이연.
- 한글 파일 편집 시 PowerShell `Get-Content`/`Set-Content` 금지 — Edit/Python.

## 세션50 완료 기준

- [ ] T4 1커밋(셀러 토글), seller 타입체크 통과
- [ ] T5 1커밋(공구 배송일 조인), seller 타입체크 + build 통과
- [ ] #CL-35 등재 (셀러 주문 IA + 공구 조인 정본)
- [ ] `docs/memory.md` 세션50 갱신 + `session51-prep.md` 작성 (T6 지시서)

## 참조

- 플랜 SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (T4·T5 섹션)
- 세션48 커밋: `5281188`(T1), `35cf229`(T2), `e4c376c`(checkout 리팩터)
- 세션49 커밋: `4e1576a`(T3)
- 미해결 — e2e 시드 슬롯·spec 보강(T6 착수 시 확정)

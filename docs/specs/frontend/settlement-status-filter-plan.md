# 정산 [주문별 상세] status 필터 UI 아토믹 플랜

> 작성: 2026-05-25 (세션86) · 출처: BACKLOG §1-5 `[정산-status필터UI]` (세션83 M-PATH #245 발견)
> 성격: **독립 세션 1건**으로 완결 가능한 소~중 규모. UI 레이어만 추가, 로직·API 불변.

---

## 1. 문제 정의 (정합성 검토 실측)

셀러 정산 [주문별 상세] 탭에 **status 필터를 조작할 UI가 없어** 화면에서 상태별 조회가 불가능하다. 백엔드·hook은 이미 status 필터를 지원하므로 **UI 한 겹만 비어 있는 상태**다.

### 실측 근거 (세션86)

| 레이어 | 상태 | 근거 |
|--------|------|------|
| 백엔드 | ✅ 지원 | `getSettlements` status query param |
| hook | ✅ 지원 | [useSettlements.ts:29](../../../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L29) `fetchSettlements(f?, t?, status?)` · [:88](../../../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L88) `params.set('status', status)` |
| UI | 🔴 **없음** | [OrdersTab.tsx](../../../apps/seller/src/app/settlements/_components/OrdersTab.tsx) — CSV 버튼 + 목록만, 필터 칩 없음 |
| 초기 호출 | status 미전달 | [useSettlements.ts:105](../../../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L105) `fetchSettlements()` (전체) |

### 이식할 레퍼런스 패턴

주문 탭이 공통 `SegmentedTabs`로 상태 탭을 이미 구현 — 그대로 재사용한다.
- [orders/page.tsx:173](../../../apps/seller/src/app/orders/page.tsx#L173) `<SegmentedTabs tabs={...} value={activeTab} onChange={...} sticky layout="scroll" />`
- [SegmentedTabs.tsx:6](../../../apps/seller/src/components/SegmentedTabs.tsx#L6) 제네릭 `SegmentedTabItem<T>` — `key`/`label`/`count?`/`badgeColor?`. `layout="scroll"`로 모바일 가로 스크롤 지원.

### SSOT 상태 정의 (재사용)

[settlement.types.ts:13](../../../packages/shared/src/settlement.types.ts#L13) — `SettlementStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled'`
- `SETTLEMENT_STATUSES` 배열·`STATUS_LABEL`(정산 대기/확정/지급 완료/취소)·`STATUS_COLOR` 모두 `@greenhub/shared`에 존재. **신규 정의 0.**

---

## 2. 아토믹 태스크

### T1 — 필터 탭 상수 정의
- `_constants.ts`에 status 필터 탭 배열 추가. `'all'` + `SETTLEMENT_STATUSES` 4종 = 5탭.
- 타입: `type SettlementFilterKey = 'all' | SettlementStatus`. 라벨은 `'all' → '전체'` + `STATUS_LABEL` 재사용.
- **신규 라벨/색 정의 금지** — shared SSOT만 참조.

### T2 — OrdersTab에 상태 탭 렌더 + 상태 보유
- `OrdersTab.tsx`에 `activeStatus` state(`useState<SettlementFilterKey>('all')`) 추가.
- 목록 위에 `<SegmentedTabs layout="scroll" value={activeStatus} onChange={...} tabs={...} />` 삽입.
- 주문 탭과 시각 일관성: `layout="scroll"` 사용(5탭 모바일 폭 대응).

### T3 — 탭 변경 → fetch 배선
- `onChange`에서 `fetchSettlements(undefined, undefined, key === 'all' ? undefined : key)` 호출.
- props 추가: `OrdersTab`이 `fetchSettlements`를 부모(`page.tsx` 또는 정산 client)로부터 받도록 시그니처 확장. 현재는 `settlements`/`listLoading`만 받음 → `fetchSettlements`·없으면 hook 결과 prop 전달 경로 확인 후 배선.
- 초기 `'all'` 진입 시 [useSettlements.ts:105](../../../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L105)의 기존 `fetchSettlements()` 동작 유지(회귀 0).

### T4 — count 배지(선택)
- 탭별 건수 배지는 현재 hook이 status별 집계를 주지 않으므로 **1차 범위 제외**(주문 탭은 클라 필터라 count 가능하나, 정산은 서버 필터 fetch라 전체 카운트 부재). 필요 시 별도 태스크.

### T5 — 정합성 검토 + 빌드
- 셀러 `tsc --noEmit` exit0, `next build` exit0.
- `biome` 신규 0건(baseline `0e/2w` 유지).
- 인라인 `fontSize`/hex 0 (토큰 SSOT 준수).

---

## 3. 정합성 체크포인트 (착수 세션에서 검증)

> **✅ 세션86 종결** — T1~T3 구현·자동 검증 통과. C4·C3·C6 시각 항목은 통합 [육안 검증 문서](pending-visual-verify.md) §1-V로 위임(다음 세션).

- [x] **C1** status 5탭이 SSOT(`SETTLEMENT_STATUSES`+`STATUS_LABEL`)에서만 파생되는가 (로컬 재정의 0) — `SETTLEMENT_FILTER_TABS`가 shared 배열·라벨 `.map`으로 파생, 로컬 정의 0 ✅
- [x] **C2** 탭 클릭 시 `fetchSettlements(_, _, status)`가 정확히 호출되는가 — `handleChange`에서 `key==='all'?undefined:key` 전달 ✅
- [x] **C3** `'all'` 탭이 기존 전체 조회와 동등한가 (회귀 0) — `'all'`→status undefined→`if(status)` 건너뜀→기존 쿼리 동일, 초기 state도 `'all'` ✅ (육안 V-T4 보강)
- [x] **C4** 모바일 폭에서 5탭이 `layout="scroll"`로 잘림 없이 스크롤되는가 — 코드상 보장(overflowX:auto·nowrap·flexShrink:0), **육안 V-T2 확인 위임**
- [x] **C5** 인라인 fontSize/hex 0, biome 신규 0, tsc/build exit0 — 셀러 tsc exit0·next build exit0·biome `0e/2w`(신규 0)·토큰만 사용 ✅
- [x] **C6** 빈 결과(`settlements.length === 0`) 시 기존 빈 상태 메시지가 탭 아래 정상 노출되는가 — early return→삼항 재배치로 탭 유지, 육안 V-T5 보강 ✅

---

## 4. 규모·리스크

- **규모**: 소~중 (파일 2~3개: `_constants.ts`·`OrdersTab.tsx`·필요 시 정산 client prop 배선).
- **리스크**: 낮음. hook·API 불변, UI·state만 추가. 최대 리스크는 T3 prop 배선 경로(현재 `OrdersTab`이 fetch 함수를 못 받음) — 착수 시 정산 page/client 구조 1회 확인 필요.
- **로직 불변 원칙 준수**: 훅/API 미수정, UI 레이어만.

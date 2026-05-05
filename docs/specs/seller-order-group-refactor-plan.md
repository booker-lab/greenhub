# Seller 주문 관리 UI — OrderGroup 리팩토링 계획서

> **작성일**: 2026-05-06
> **상태**: 계획 확정, 구현 대기
> **연관 파일**: `orders/_constants.ts`, `hooks/useOrders.ts`, `orders/page.tsx`
> **불변 파일 (수정 금지)**: `OrderCard.tsx`, `useOrderActions.ts`, API 호출 로직

---

## 목표

UI를 "데이터 나열"에서 "업무 중심 구조"로 전환한다.
현재 `OrderStatus` 값을 탭 이름으로 그대로 사용하는 얇은 매핑 구조를
`OrderGroup` 개념으로 재추상화하여 스마트스토어식 운영 경험을 제공한다.

---

## 핵심 설계 결정

### OrderGroup 정의 및 STATUS_GROUP_MAP

기존 `TAB_STATUSES` 그룹핑을 보존하여 공동구매 로직과의 정합성을 유지한다.

```
ACTION_REQUIRED  ←  [PENDING, RECRUITING, ACCEPTED, CONFIRMED]
WAITING          ←  [PREPARING]
IN_DELIVERY      ←  [DELIVERING, HUB_ARRIVED]
DONE             ←  [DELIVERED, PICKED_UP, REVIEWED]
CANCELLED        ←  [CANCELLED]
```

**RECRUITING → ACTION_REQUIRED 유지 근거**: 공동구매 주문 접수 시 판매자가
인지해야 하므로 현행 `pending` 탭 배치를 그대로 계승한다.

### SubFilter 범위 (IN_DELIVERY 탭 한정)

`DELIVERING`, `HUB_ARRIVED` 두 상태만 SubFilter로 제공한다.
`PREPARING`은 WAITING 그룹이므로 IN_DELIVERY SubFilter에서 제외한다.

### Summary Bar 항목

처리 필요(ACTION_REQUIRED) / 배송 중(IN_DELIVERY) / 대기 중(WAITING) 3가지만 표시한다.
DONE · CANCELLED는 현재 업무와 무관하므로 Summary Bar에서 제외한다.

---

## 영향 범위

| 파일 | 변경 유형 | 요약 |
|------|----------|------|
| `orders/_constants.ts` | 추가 | `OrderGroup` 타입, `STATUS_GROUP_MAP`, `GROUP_TABS`, `SUBFILTER_LABELS` 추가 |
| `hooks/useOrders.ts` | 수정 | `TAB_STATUSES` 제거, `counts` → `groupCounts` 교체 |
| `orders/page.tsx` | 수정 | 탭 재구성, Summary Bar 추가, SubFilter 상태 추가 |
| `orders/_constants.ts` | 유지 | `STATUS_LABEL`, `STATUS_COLOR`, `ACCENT_BORDER` 등 기존 상수 유지 |

---

## 세션별 구현 계획

---

### Session 1 — 타입 · 상수 레이어 정의

> **목표**: `_constants.ts`에 OrderGroup 관련 모든 상수를 추가한다.
> `useOrders.ts`, `page.tsx`는 이 세션에서 건드리지 않는다.

#### Task 1-1. `OrderGroup` 타입 선언 추가

**작업**

```ts
// _constants.ts 상단에 추가
export type OrderGroup =
  | 'ACTION_REQUIRED'
  | 'WAITING'
  | 'IN_DELIVERY'
  | 'DONE'
  | 'CANCELLED';
```

**정합성 검토**

- [ ] `StatusTab` 타입이 여전히 파일에 존재하는가? — 두 타입이 공존해도 이 세션에서는 무방. Session 2에서 `useOrders.ts` 수정 후 Session 3에서 제거.
- [ ] `OrderGroup`의 5개 값이 기존 `StatusTab`의 5개 값과 1:1 대응되는가?

---

#### Task 1-2. `STATUS_GROUP_MAP` 상수 정의

**작업**

```ts
export const STATUS_GROUP_MAP: Record<OrderStatus, OrderGroup> = {
  PENDING:    'ACTION_REQUIRED',
  RECRUITING: 'ACTION_REQUIRED',
  ACCEPTED:   'ACTION_REQUIRED',
  CONFIRMED:  'ACTION_REQUIRED',
  PREPARING:  'WAITING',
  DELIVERING: 'IN_DELIVERY',
  HUB_ARRIVED:'IN_DELIVERY',
  DELIVERED:  'DONE',
  PICKED_UP:  'DONE',
  REVIEWED:   'DONE',
  CANCELLED:  'CANCELLED',
};
```

**정합성 검토**

- [ ] `OrderStatus` 11개 값이 모두 매핑되어 있는가? (`packages/shared/src/order.types.ts` 기준)
- [ ] 기존 `TAB_STATUSES` 그룹핑과 동일한가?
  - `TAB_STATUSES.pending` = `[PENDING, RECRUITING, ACCEPTED, CONFIRMED]` → 모두 `ACTION_REQUIRED`
  - `TAB_STATUSES.preparing` = `[PREPARING]` → `WAITING`
  - `TAB_STATUSES.delivering` = `[DELIVERING, HUB_ARRIVED]` → `IN_DELIVERY`
  - `TAB_STATUSES.done` = `[DELIVERED, PICKED_UP, REVIEWED]` → `DONE`
  - `TAB_STATUSES.cancelled` = `[CANCELLED]` → `CANCELLED`
- [ ] TypeScript 컴파일 오류 없음 (Record key 누락 시 컴파일 에러로 즉시 감지)

---

#### Task 1-3. `GROUP_TABS` 배열 정의

**작업**

```ts
export const GROUP_TABS: { key: OrderGroup; label: string }[] = [
  { key: 'ACTION_REQUIRED', label: '처리 필요' },
  { key: 'WAITING',         label: '대기 중' },
  { key: 'IN_DELIVERY',     label: '배송 중' },
  { key: 'DONE',            label: '완료' },
  { key: 'CANCELLED',       label: '취소' },
];
```

**정합성 검토**

- [ ] 탭 순서가 업무 흐름(처리 필요 → 대기 → 배송 → 완료 → 취소) 순인가?
- [ ] 기존 `TABS` 배열의 label과 동일한 한국어 표기를 사용하는가?

---

#### Task 1-4. `SUBFILTER_LABELS` 정의 (IN_DELIVERY SubFilter 한정)

**작업**

```ts
export const IN_DELIVERY_SUBFILTERS: { key: 'ALL' | 'DELIVERING' | 'HUB_ARRIVED'; label: string }[] = [
  { key: 'ALL',         label: '전체' },
  { key: 'DELIVERING',  label: '배송 중' },
  { key: 'HUB_ARRIVED', label: '거점 도착' },
];
```

**정합성 검토**

- [ ] `PREPARING`이 SubFilter 목록에 없는가? (WAITING 그룹이므로 제외)
- [ ] `ALL` 키가 `OrderStatus`와 구별되는 별도 리터럴 타입인가?

---

#### Task 1-5. `SUMMARY_BAR_ITEMS` 정의

**작업**

```ts
export const SUMMARY_BAR_ITEMS: { group: OrderGroup; label: string }[] = [
  { group: 'ACTION_REQUIRED', label: '처리 필요' },
  { group: 'IN_DELIVERY',     label: '배송 중' },
  { group: 'WAITING',         label: '대기 중' },
];
```

**정합성 검토**

- [ ] `DONE`, `CANCELLED`가 포함되지 않았는가?
- [ ] 순서가 업무 우선도 기준인가? (처리 필요 → 배송 중 → 대기 중)

---

#### Session 1 완료 기준

- [ ] `_constants.ts` 라인 수가 500을 초과하지 않는가?
- [ ] 기존 상수(`STATUS_LABEL`, `STATUS_COLOR`, `ACCENT_BORDER`, `DELIVERY_LABEL`, `formatRelativeTime`)가 모두 유지되는가?
- [ ] 기존 `TABS`, `StatusTab` 타입이 아직 파일에 남아 있는가? (삭제는 Session 3)
- [ ] TypeScript `tsc --noEmit` 오류 없음

---

### Session 2 — useOrders 훅 수정

> **목표**: 훅의 반환 타입을 `groupCounts`로 교체하고 `TAB_STATUSES` export를 제거한다.
> `_constants.ts` Session 1 완료를 전제로 한다.

#### Task 2-1. `STATUS_GROUP_MAP` import 추가

**작업**

```ts
// useOrders.ts 상단
import { STATUS_GROUP_MAP } from '@/app/orders/_constants';
```

**정합성 검토**

- [ ] import 경로가 Next.js App Router 기준 올바른가? (`@/` 별칭 확인)

---

#### Task 2-2. `TAB_STATUSES` 상수 제거

**작업**

`useOrders.ts`의 `TAB_STATUSES` 상수 및 export를 완전히 삭제한다.

```ts
// 삭제 대상
export const TAB_STATUSES: Record<string, OrderStatus[]> = {
  pending: [...],
  preparing: [...],
  ...
};
```

**정합성 검토**

- [ ] `page.tsx`가 `TAB_STATUSES`를 import하는 라인이 존재하는가? → Session 3에서 제거 예정임을 확인
- [ ] `TAB_STATUSES`를 참조하는 다른 파일이 없는가? (Grep 검색)

---

#### Task 2-3. `counts` → `groupCounts` 교체

**작업**

```ts
// UseOrdersResult 인터페이스 수정
interface UseOrdersResult {
  orders: Order[];
  loading: boolean;
  error: string | null;
  groupCounts: Record<OrderGroup, number>;  // counts 제거, groupCounts 추가
  firebaseReady: boolean;
}

// useMemo 수정
const groupCounts = useMemo(() => {
  const result = {
    ACTION_REQUIRED: 0,
    WAITING: 0,
    IN_DELIVERY: 0,
    DONE: 0,
    CANCELLED: 0,
  } as Record<OrderGroup, number>;
  for (const order of orders) {
    result[STATUS_GROUP_MAP[order.status]] += 1;
  }
  return result;
}, [orders]);

// return 수정
return { orders, loading, error, groupCounts, firebaseReady };
```

**정합성 검토**

- [ ] `OrderGroup` 타입을 import했는가?
- [ ] `result` 초기값에 5개 그룹 키가 모두 있는가?
- [ ] 기존 `counts` 키를 참조하는 파일이 `page.tsx` 외에 없는가?
- [ ] `useMemo` 의존성 배열이 `[orders]`로 유지되는가?

---

#### Session 2 완료 기준

- [ ] `useOrders.ts` 라인 수가 500을 초과하지 않는가?
- [ ] `TAB_STATUSES`가 파일에서 완전히 제거되었는가?
- [ ] `counts`가 `groupCounts`로 교체되었는가?
- [ ] `page.tsx`는 아직 `counts`와 `TAB_STATUSES`를 참조하므로 **빌드 에러가 발생하는 상태가 정상** — Session 3에서 해소

---

### Session 3 — page.tsx UI 재구성

> **목표**: 탭 재구성, Summary Bar 추가, SubFilter 추가.
> Session 1, 2 완료를 전제로 한다.

#### Task 3-1. import 정리 및 상태 타입 교체

**작업**

```ts
// 제거
import { useOrders, TAB_STATUSES } from '@/hooks/useOrders';
import { TABS, type StatusTab } from './_constants';

// 추가
import { useOrders } from '@/hooks/useOrders';
import {
  GROUP_TABS,
  STATUS_GROUP_MAP,
  SUMMARY_BAR_ITEMS,
  IN_DELIVERY_SUBFILTERS,
  type OrderGroup,
} from './_constants';

// 상태 타입 교체
const [activeTab, setActiveTab] = useState<OrderGroup>('ACTION_REQUIRED');
const [subFilter, setSubFilter] = useState<'ALL' | 'DELIVERING' | 'HUB_ARRIVED'>('ALL');
```

**정합성 검토**

- [ ] `TAB_STATUSES` import가 완전히 제거되었는가?
- [ ] `StatusTab` 타입 참조가 모두 제거되었는가?
- [ ] `useOrders` 반환에서 `counts` 대신 `groupCounts`를 구조분해하는가?
- [ ] 초기 탭이 `'ACTION_REQUIRED'`인가? (처리 필요 탭이 기본 선택)

---

#### Task 3-2. `filteredOrders` 필터링 로직 교체

**작업**

```ts
// 제거
const filteredOrders = orders.filter((o) => TAB_STATUSES[activeTab].includes(o.status));

// 교체
const filteredOrders = orders.filter((o) => {
  if (STATUS_GROUP_MAP[o.status] !== activeTab) return false;
  if (activeTab === 'IN_DELIVERY' && subFilter !== 'ALL') {
    return o.status === subFilter;
  }
  return true;
});
```

**정합성 검토**

- [ ] `STATUS_GROUP_MAP[o.status]`가 항상 정의되는가? (Record 전체 매핑 보장)
- [ ] SubFilter가 `IN_DELIVERY` 탭이 아닐 때는 무시되는가?
- [ ] `subFilter !== 'ALL'` 조건으로 전체 표시가 정상 동작하는가?

---

#### Task 3-3. Summary Bar UI 추가

헤더와 탭 사이에 Summary Bar를 삽입한다.

**작업**

```tsx
{/* Summary Bar — 헤더 Box 바로 다음, 탭 Box 바로 위 */}
<Box style={{ backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', padding: '8px 0' }}>
  <Container size="sm">
    <Group gap="md">
      {SUMMARY_BAR_ITEMS.map((item) => (
        <UnstyledButton
          key={item.group}
          onClick={() => setActiveTab(item.group)}
          style={{ textAlign: 'center' }}
        >
          <Text style={{ fontSize: 20, fontWeight: 'var(--fw-bold)', color: 'var(--color-text)', lineHeight: 1 }}>
            {groupCounts[item.group]}
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)', marginTop: 2 }}>
            {item.label}
          </Text>
        </UnstyledButton>
      ))}
    </Group>
  </Container>
</Box>
```

**정합성 검토**

- [ ] Summary Bar 항목 클릭 시 해당 탭으로 이동하는가?
- [ ] `groupCounts`가 정의되어 있는가? (Session 2 완료 전제)
- [ ] sticky 헤더 레이어(`top` 값)가 Header, SummaryBar, Tabs 3단 적층에 맞게 조정되었는가?
  - Header: `top: 0`
  - SummaryBar: `top: 57` (기존과 동일, sticky 불필요 — 탭만 sticky)
  - Tabs: `top: 57 + SummaryBar 높이`로 업데이트 필요

---

#### Task 3-4. 탭 UI를 `GROUP_TABS` 기준으로 교체

**작업**

```tsx
// TABS → GROUP_TABS, tab.key 타입 StatusTab → OrderGroup
{GROUP_TABS.map((tab) => (
  <UnstyledButton
    key={tab.key}
    onClick={() => { setActiveTab(tab.key); setSubFilter('ALL'); }}
    style={{
      flexShrink: 0,
      padding: '12px 16px',
      fontSize: 14,
      fontWeight: activeTab === tab.key ? 700 : 400,
      borderBottom: `2px solid ${activeTab === tab.key ? 'var(--color-text)' : 'transparent'}`,
      color: activeTab === tab.key ? 'var(--color-text)' : 'var(--color-text-disabled)',
      transition: 'all 0.15s',
    }}
  >
    {tab.label}
    {groupCounts[tab.key] > 0 && (
      <Badge size="xs" ml={6} color={tab.key === 'ACTION_REQUIRED' ? 'red' : 'gray'}>
        {groupCounts[tab.key]}
      </Badge>
    )}
  </UnstyledButton>
))}
```

**정합성 검토**

- [ ] 탭 변경 시 `subFilter`가 `'ALL'`로 리셋되는가?
- [ ] `ACTION_REQUIRED` 탭 배지 색상이 `'red'`인가? (기존 `'pending'` 탭 동작 계승)
- [ ] `groupCounts[tab.key]`가 0일 때 배지가 렌더링되지 않는가?

---

#### Task 3-5. IN_DELIVERY SubFilter UI 추가

**작업**

탭 `Box` 하단에 조건부 렌더링으로 SubFilter를 추가한다.

```tsx
{/* SubFilter — IN_DELIVERY 탭 선택 시에만 렌더링 */}
{activeTab === 'IN_DELIVERY' && (
  <Box style={{ backgroundColor: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-border)', padding: '6px 0' }}>
    <Container size="sm">
      <Group gap={0}>
        {IN_DELIVERY_SUBFILTERS.map((sf) => (
          <UnstyledButton
            key={sf.key}
            onClick={() => setSubFilter(sf.key)}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              borderRadius: 99,
              backgroundColor: subFilter === sf.key ? 'var(--color-text)' : 'transparent',
              color: subFilter === sf.key ? 'var(--color-bg)' : 'var(--color-text-disabled)',
              transition: 'all 0.15s',
            }}
          >
            {sf.label}
          </UnstyledButton>
        ))}
      </Group>
    </Container>
  </Box>
)}
```

**정합성 검토**

- [ ] `activeTab !== 'IN_DELIVERY'`일 때 SubFilter가 완전히 제거되는가?
- [ ] SubFilter 선택 시 `filteredOrders`가 Task 3-2 로직대로 동작하는가?
- [ ] SubFilter의 `ALL` 선택 시 `DELIVERING`과 `HUB_ARRIVED` 모두 표시되는가?

---

#### Task 3-6. 기존 잔존 상수 정리

**작업**

`_constants.ts`에서 `TABS`, `StatusTab` 타입을 제거한다.

**정합성 검토**

- [ ] `TABS`를 참조하는 파일이 프로젝트 전체에 없는가? (Grep 필수)
- [ ] `StatusTab` 타입을 참조하는 파일이 없는가?
- [ ] `_constants.ts` 라인 수가 500을 초과하지 않는가?

---

#### Session 3 완료 기준

- [ ] `tsc --noEmit` 오류 없음
- [ ] `TAB_STATUSES`, `TABS`, `StatusTab`이 프로젝트 전체에서 제거되었는가?
- [ ] `page.tsx` 라인 수가 500을 초과하지 않는가?
- [ ] `OrderCard`, `useOrderActions`가 수정되지 않았는가?
- [ ] Summary Bar 3항목이 정상 렌더링되는가?
- [ ] IN_DELIVERY 탭 SubFilter가 조건부로 렌더링되는가?
- [ ] 탭 변경 시 SubFilter가 `ALL`로 리셋되는가?

---

## 전체 완료 정합성 체크리스트

### 타입 안전성

- [ ] `OrderGroup` 5개 값이 모두 `STATUS_GROUP_MAP`에 커버되는가?
- [ ] `STATUS_GROUP_MAP`이 `OrderStatus` 11개 값을 모두 매핑하는가?
- [ ] `groupCounts`의 키 타입이 `OrderGroup`인가? (`string` 아님)

### 공동구매 로직 보존

- [ ] `RECRUITING` 상태가 `ACTION_REQUIRED` 탭에 표시되는가?
- [ ] `OrderCard`의 `RECRUITING` 알림 배너가 그대로 렌더링되는가?
- [ ] `useOrderActions`의 `handleCancel`, `handlePrepare`가 변경 없이 동작하는가?

### 기존 동작 회귀 방지

- [ ] `PENDING` 상태 주문이 `ACTION_REQUIRED` 탭에 표시되는가?
- [ ] `PREPARING` 상태 주문이 `WAITING` 탭에 표시되고 IN_DELIVERY SubFilter에 나타나지 않는가?
- [ ] `HUB_ARRIVED` 주문의 픽업 코드 표시가 `OrderCard`에서 유지되는가?
- [ ] Firebase 실시간 연결 표시가 헤더에 유지되는가?
- [ ] 빈 탭 접근 시 빈 상태 화면이 정상 출력되는가?

### 코드 품질

- [ ] `TAB_STATUSES` 완전 제거 (useOrders.ts + 모든 import)
- [ ] `TABS`, `StatusTab` 완전 제거 (_constants.ts + 모든 import)
- [ ] 수정된 3개 파일 모두 500라인 이하

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-06 | 초안 작성 — OrderGroup 리팩토링 3세션 계획 확정 |

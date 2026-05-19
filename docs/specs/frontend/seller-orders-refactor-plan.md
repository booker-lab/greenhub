# 셀러앱 주문 탭 리팩토링 — 아토믹 태스크 플랜

> 작성: 2026-05-19 (세션40)
> 근거: 세션40 전체 페이지 감사 + 사용자 논의
> 원칙: **로직 불변** — 기존 훅/API/비즈니스 로직은 변경하지 않고 UI 레이어만 손댐 (단, T6 OrderCard 경량화는 훅 의존성 정리 포함).
> 진행: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 타입체크 통과 후 다음 진행.

---

## 배경

세션38 UX 감사(`seller-ux-audit.md`)에서 주문 탭 문제 5건이 식별됐고,
세션40 추가 코드 리뷰에서 3건이 더 발견됐다. 날짜 범위 필터 + 날짜 그룹핑은
사용자 요청으로 신규 기능으로 추가.

---

## 감사 결과 요약

### 버그 (즉시 수정)

| ID | 파일 | 내용 |
|----|------|------|
| **BUG-A** | `_constants.ts` vs `OrderRow.tsx` | 상태 뱃지 색상 이중 정의 + 불일치 — 목록 ACCEPTED=blue·PREPARING=orange, 상세 ACCEPTED=orange·PREPARING=blue |
| **BUG-B** | `OrderCard.tsx` + `useOrderActions.ts` | 강제 취소 시 `prompt()`/`alert()` 사용 — PWA에서 UX 단절 |
| **BUG-C** | `OrderCard.tsx` vs `OrderInfoSection.tsx` | 주문번호 길이 불일치 — 카드 6자 vs 상세 8자 (표시 일관성) |

### UX 문제

| ID | 파일 | 내용 |
|----|------|------|
| **UX-E** | `orders/page.tsx` | 3중 sticky — 헤더(57px) + 요약바 + 탭 → 목록 가시 영역 ~170px 잠식 |
| **UX-F** | `orders/page.tsx` | 요약바·탭 기능 중복 — 둘 다 탭 전환 + 건수 표시 |
| **UX-G** | `orders/page.tsx` | sticky 매직넘버 `top: 57`, `top: 114` + `fontSize: 14/20/13` 하드코딩 |
| **UX-H** | `orders/[id]/page.tsx` | not-found 화면 인라인 구현 — 공통 `EmptyState` 미사용 |
| **UX-I** | `orders/[id]/page.tsx` | 액션 버튼 inline — 긴 주문에서 스크롤해야 버튼 도달 |
| **UX-J** | `orders/page.tsx` | 날짜 범위 필터·날짜 그룹 헤더 없음 — 주문 증가 시 탐색 불편 |

### 중복 코드

| 위치 | 내용 |
|------|------|
| `_constants.ts` + `OrderRow.tsx` | `STATUS_LABEL`, `STATUS_COLOR`, `DELIVERY_LABEL` 각각 별도 선언 |
| `OrderCard.tsx` | 인라인 준비 시작 폼 — 이미 `PrepareForm` 컴포넌트 존재 |

---

## 설계 결정

### D1. 색상 기준 — `OrderRow.tsx` 채택 (상세 페이지 기준)

```
ACCEPTED / CONFIRMED / RECRUITING : orange  (처리 필요 — 주의)
PREPARING                          : blue    (진행 중 — 중립)
DELIVERING / HUB_ARRIVED           : violet  (배송 중)
DELIVERED / PICKED_UP / REVIEWED   : green   (완료)
CANCELLED                          : red     (취소)
PENDING                            : gray    (대기)
```

이 색 체계가 UX 의미론적으로 올바르다. `_constants.ts`를 `OrderRow.tsx` 기준으로 교정,
`OrderRow.tsx`의 중복 상수는 삭제하고 `_constants.ts`를 import.

### D2. 요약바 제거 — 탭 뱃지로 흡수

현재 요약바는 탭과 동일한 정보(건수)를 동일한 동작(탭 전환)으로 제공한다.
요약바를 제거하고 탭 뱃지(`Badge`)에 건수를 표시하는 것으로 통합.
sticky는 탭 1개만 남긴다. `top` 매직넘버는 CSS 변수로 대체.

```css
/* globals.css 또는 PageHeader 컴포넌트에서 선언 */
--header-height: 57px;
```

### D3. OrderCard 경량화 — 카드는 "탐색 + 이동"만

카드에서 준비 시작 폼이 열리는 구조는 상세 페이지와 중복이고,
강제 취소의 `prompt()`는 PWA UX 위반.

**결정:**
- "준비 시작" 클릭 → `router.push('/orders/[id]')` (상세로 이동, 상세에서 처리)
- "강제 취소" 버튼 카드에서 **제거** — 상세 페이지에서만 취소 가능
- `useOrderActions` 훅 사용처가 사라지므로 훅도 제거

> 운영상 셀러가 카드에서 바로 취소해야 할 긴급 니즈가 있다면 차기 논의.
> 현재는 상세 진입 1단계로 충분하다고 판단.

### D4. 주문 상세 액션 버튼 — sticky bottom footer

주문 상세 페이지는 긴 정보 카드 스택 구조. 액션 버튼이 인라인이면 스크롤해야 도달.
**"준비 시작" / "강제 취소" 버튼을 페이지 하단 sticky footer로 이동.**

```
┌────────────────────────┐
│ 주문 정보 카드 스택      │  ← 스크롤 영역
│ ...                    │
│                        │
├────────────────────────┤ ← sticky bottom (BottomNav 위)
│ [준비 시작]  [강제 취소]│
└────────────────────────┘
      [주문][상품][정산][준비][설정]  ← BottomNav
```

`PageShell paddingBottom` 값 확인 후 겹침 방지.

### D5. 날짜 범위 필터 — 배송일 / 생성일 탭별 분리

| 탭 | 필터 기준 | 이유 |
|----|----------|------|
| 처리 필요·대기 중·배송 중 | `requestedDeliveryDate` (배송 예정일) | 셀러의 핵심 질문 = "언제 보내야 하나" |
| 완료·취소 | `createdAt` (주문 생성일) | 이미 처리된 주문 = "언제 들어왔던 건가" |

**필터 칩:**
```
[오늘]  [이번 주]  [이번 달]  [직접 입력]
```

- 오늘: 해당 기준일 = 오늘
- 이번 주: 기준일 기준 오늘~오늘+6일 (처리 필요·대기) / 오늘-6일~오늘 (완료·취소)
- 이번 달: 기준 월 1일~말일
- 직접 입력: 두 개 date input (from · to)

> 필터 기본값: **"이번 주"** — 오늘만 보면 너무 좁고, 이번 달은 너무 넓음.

### D6. 날짜 그룹 헤더 + 임박 강조

필터 결과를 날짜 단위로 묶어 섹션 헤더로 표시.

**처리 필요·대기 중·배송 중 탭 (requestedDeliveryDate 기준):**
```
🔴 지연 · N건 (5/18 이전)   ← 배송일 경과, 최상단 고정
🔴 오늘 배송 · N건 (5/19)   ← 오늘, 빨간 헤더
  5월 20일 (화) · N건        ← 내일 이후, 회색 헤더
  5월 21일 (수) · N건
  날짜 미정 · N건            ← requestedDeliveryDate = null (공동구매 등)
```

**완료·취소 탭 (createdAt 기준):**
```
  오늘 · N건
  어제 · N건
  5월 17일 (토) · N건
  5월 16일 (금) · N건
```

**그룹 헤더 색 규칙:**
- 지연 섹션: `var(--color-danger)` 텍스트
- 오늘 섹션: `var(--color-danger)` 텍스트
- 이후 섹션: `var(--color-text-disabled)` 텍스트

> 세션41 검토 — "날짜 미정" 그룹의 의미: 공동구매 주문은 실제 배송일이 `groupConfig.groupDeliveryDate`에
> 존재하나, 목록 페이지(`page.tsx`)는 `useOrders` 데이터만 쓰고 `groupConfig`를 fetch하지 않는다.
> 즉 목록 단계에서 `order.requestedDeliveryDate`가 `null`이라 "미확인"이며, 별도 fetch는 과하므로
> "날짜 미정" 그룹으로 처리한다(상세 진입 시 실제 배송일 노출). `Order.requestedDeliveryDate`는
> `string | null` 타입(`@greenhub/shared`)으로 null 허용 확인됨.

---

## 데이터 소스

| 기능 | 데이터 | 변경 여부 |
|------|--------|----------|
| 날짜 범위 필터 | `useOrders` 기존 데이터 → 클라이언트 필터 | 없음 |
| 날짜 그룹 헤더 | `order.requestedDeliveryDate` / `order.createdAt` | 없음 |
| 공동구매 날짜 미정 | `order.requestedDeliveryDate === null` → "날짜 미정" 그룹 | 없음 |

백엔드 추가 없음. 클라이언트 필터·정렬·그룹핑만.

---

## 아토믹 태스크 목록

### [ ] T1 — 상수 통합 + 색상 버그 수정

**변경 파일:** `orders/_constants.ts`, `orders/[id]/_components/OrderRow.tsx`

- `_constants.ts`의 `STATUS_COLOR`를 D1 기준으로 교정
  - `ACCEPTED / CONFIRMED / RECRUITING: 'orange'`
  - `PREPARING: 'blue'`
- `_constants.ts`의 `ACCENT_BORDER`(카드 좌측 4px 보더)도 D1 기준으로 **동반 교정** — `STATUS_COLOR`와 hue 정렬
  - `ACCEPTED / CONFIRMED / RECRUITING: 'var(--color-status-warning-text)'`
  - `PREPARING: 'var(--color-status-info-text)'`
  - (미교정 시 `STATUS_COLOR`만 뒤집혀 한 카드 안에서 뱃지 색 ≠ 좌측 보더 색 불일치 발생 — 세션41 검토 발견)
- `OrderRow.tsx`에서 `STATUS_LABEL_MAP`, `STATUS_COLOR_MAP`, `DELIVERY_LABEL_MAP` 삭제
- `OrderRow.tsx`가 `_constants.ts`의 `STATUS_LABEL`, `STATUS_COLOR`, `DELIVERY_LABEL`을 import
- `OrderInfoSection.tsx`의 import 경로 수정 (`OrderRow` → `_constants`)
- 주문번호 표시 길이 통일: 카드 6자 → **8자** (`slice(-8)`)

**정합성 확인:**
- [ ] 카드 뱃지 색 = 상세 뱃지 색 (같은 상수 참조 확인)
- [ ] 카드 좌측 보더 색 = 카드 뱃지 색 (`ACCENT_BORDER`·`STATUS_COLOR` 동일 hue)
- [ ] `OrderRow.tsx`에 남은 상수 없음

---

### [ ] T2 — 요약바 제거 + sticky 단일화

**변경 파일:** `orders/page.tsx`, `orders/_constants.ts`, `app/globals.css`, `apps/e2e/tests/seller-orders.spec.ts`

- `globals.css`에 CSS 변수 신규 선언 — `--header-height: 57px`, `--bottom-nav-height: 64px`
  - 세션41 검토: `--header-height`는 globals.css에 **미존재**(신규 선언 필요).
    `--bottom-nav-height`는 `BottomNav.tsx`·`globals.css` body padding에 `64px`이 하드코딩돼 있어 D4와 공유할 변수로 통합.
- 요약바(`SUMMARY_BAR_ITEMS` 블록) 전체 삭제
- 탭 뱃지에 건수 표시 (기존 `groupCounts[tab.key] > 0` 조건 유지)
- `top: 57`, `top: 114` 제거 → sticky는 탭 1개, `top: var(--header-height)` 사용
- `fontSize: 14/13` 인라인 → `var(--font-size-sm)`, `fontSize: 20` → `var(--font-size-xl)` 치환
  - 세션41 검토: `--font-size-base`는 코드 어디서도 미사용 토큰 → 쓰지 않음. `sm`/`xl`만 사용.
- `SUMMARY_BAR_ITEMS` 상수 `_constants.ts`에서 삭제
- **e2e 동반 수정** (`seller-orders.spec.ts`) — 세션41 검토: 요약바 제거 시 회귀 확정
  - "Summary Bar — 3항목 렌더링"(line 94, `count >= 2` 단언) 테스트 **삭제** — 요약바 제거 시 실패 확정
  - "Summary Bar 클릭"(line 104) 테스트 **삭제** — 탭 클릭 검증은 "탭 클릭" 테스트가 이미 커버
  - 탭 뱃지 건수 표시를 검증하는 테스트 1개 **신설**

**정합성 확인:**
- [ ] `SUMMARY_BAR_ITEMS` 참조 잔여 없음
- [ ] sticky 탭이 PageHeader와 겹치지 않음 (`--header-height` 57px 실측 확인)
- [ ] 탭 뱃지 건수가 기존 요약바와 동일한 값 표시
- [ ] `seller-orders.spec.ts` Summary Bar 테스트 2건 삭제 + 탭 뱃지 테스트 신설 완료

---

### [ ] T3 — OrderCard 경량화

**변경 파일:** `orders/_components/OrderCard.tsx`, `hooks/useOrderActions.ts`

- `showPrepareForm` 인라인 폼 블록 제거
- "강제 취소" 버튼 제거
- "준비 시작" 버튼 — `router.push(\`/orders/${order.id}\`)` 로 교체 (상세 이동)
  - `canPrepare`가 true인 경우에만 버튼 노출 유지
- `useOrderActions` 훅 import 제거
- `useOrderActions.ts` 파일 삭제 (사용처 없어짐)
- 세션41 검토: `useOrderStatusUpdate.ts` 상단 주석이 `useOrderActions`를 언급 → 해당 주석도 동반 갱신
- `HUB_ARRIVED` 픽업 코드 표시 블록은 유지

**정합성 확인:**
- [ ] `useOrderActions` 파일 삭제 후 다른 import 참조 없음 (`grep` 확인)
- [ ] `useOrderStatusUpdate.ts` 주석에 `useOrderActions` 잔여 언급 없음
- [ ] 카드 클릭(전체) → 상세 이동 유지
- [ ] 준비 시작 버튼 클릭 → 상세 이동 (준비 폼 열림 아님)

---

### [ ] T4 — 주문 상세 개선

**변경 파일:** `orders/[id]/page.tsx`

- not-found 인라인 블록 → `<EmptyState>` 공통 컴포넌트 치환
  - icon: 돋보기 또는 클립보드 SVG
  - text: "주문을 찾을 수 없습니다"
  - 세션41 검토: `EmptyState`에 `children` prop **없음** — props는 `icon`·`text`·`action`.
    "돌아가기"는 기존 `UnstyledButton` 마크업을 `action` prop으로 전달
- 액션 버튼(`준비 시작` / `강제 취소`) → sticky bottom footer 이동
  - `position: fixed`, `bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom))`
  - 세션41 검토: `BottomNav`는 `app/layout.tsx`에서 **전역 렌더**(`/login`·`/onboarding`만 숨김) →
    주문 상세에도 BottomNav 존재. `bottom: 0` 불가, BottomNav 높이만큼 띄울 것
  - `PageShell paddingBottom`(현재 96) 조정 — sticky footer + BottomNav 합계를 덮는지 실측
  - `PrepareForm`은 페이지 인라인 `Paper`(모달 아님) — `showPrepareForm` 시 footer 숨김, 현재 구조 보존
- `fontSize: 14` 인라인 → `var(--font-size-sm)` 치환

**정합성 확인:**
- [ ] sticky 버튼이 BottomNav와 겹치지 않음
- [ ] 읽기 전용 상태(`READONLY_STATUSES`)에서 sticky footer 미노출
- [ ] `CancelOrderModal`이 sticky footer와 레이아웃 충돌 없음
- [ ] EmptyState 사용 후 "돌아가기" 동작 정상

---

### [ ] T5 — 날짜 범위 필터 신설

**변경 파일:** `orders/page.tsx`, `orders/_constants.ts`

- 날짜 범위 상태 추가
  ```ts
  type DateRangePreset = 'today' | 'week' | 'month' | 'custom';
  const [datePreset, setDatePreset] = useState<DateRangePreset>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');
  ```
- 필터 칩 UI — PageHeader 바로 아래, sticky 탭 위
  ```
  [오늘]  [이번 주✓]  [이번 달]  [직접 입력]
  ```
- `getDateRange(preset, tab)` 유틸 함수 — `_constants.ts`에 추가
  - 활성 탭(ACTION_REQUIRED·WAITING·IN_DELIVERY): `requestedDeliveryDate` 기준
  - 아카이브 탭(DONE·CANCELLED): `createdAt` 기준
- `filteredOrders` 계산에 날짜 범위 필터 적용
- 직접 입력 시 두 개 date input 노출 (Mantine `TextInput type="date"` 또는 `<input type="date">`)

**정합성 확인:**
- [ ] 필터 칩 전환 시 `filteredOrders` 즉시 갱신
- [ ] 탭 전환 시 날짜 필터 **유지** (탭 바꿔도 기간 선택 초기화 안 됨)
- [ ] `requestedDeliveryDate = null`인 주문은 날짜 필터에서 **제외되지 않고** "날짜 미정" 그룹으로 내려감 (T6 연동)
- [ ] 직접 입력: from > to 방지 유효성 처리

---

### [ ] T6 — 날짜 그룹 헤더 + 임박 강조

**변경 파일:** `orders/page.tsx`, `orders/_constants.ts`

- `groupOrdersByDate(orders, activeTab)` 유틸 함수 — `_constants.ts`에 추가
  ```ts
  // 반환: { dateKey: string → Order[] } 정렬된 Map
  // dateKey 규칙:
  //   'overdue'       : requestedDeliveryDate < 오늘 (활성 탭)
  //   'YYYY-MM-DD'    : 해당 날짜
  //   'undated'       : requestedDeliveryDate = null
  ```
- `getGroupHeaderMeta(dateKey, isArchiveTab)` 유틸
  ```ts
  // 반환: { label: string, urgency: 'overdue' | 'today' | 'normal' }
  ```
- 주문 목록 렌더링을 날짜 그룹 섹션으로 교체
  ```tsx
  {groupEntries.map(([dateKey, orders]) => (
    <DateSection key={dateKey} meta={...} orders={orders} storeId={storeId} />
  ))}
  ```
- 섹션 헤더 스타일
  - `overdue` / `today` → `var(--color-danger)` 텍스트 + 배경 틴트
  - 일반 → `var(--color-text-disabled)` 텍스트
- `DateSection` 컴포넌트 신설 (`orders/_components/DateSection.tsx`)
  - 헤더 + 하위 `OrderCard` 리스트

**정합성 확인:**
- [ ] "지연" 섹션이 최상단에 고정 (정렬 키 overdue = 최솟값)
- [ ] "날짜 미정" 섹션이 최하단
- [ ] 아카이브 탭(완료·취소)에서 그룹 기준이 `createdAt`으로 전환됨
- [ ] 필터 결과가 빈 탭에서 `EmptyState` 정상 표시
- [ ] 그룹 내 주문 정렬: 활성 탭은 `createdAt ASC`, 아카이브 탭은 `createdAt DESC`

---

### [ ] T7 — 타입체크 + e2e + 정합성 최종 검토

**실행 명령:**
```bash
pnpm --filter seller tsc --noEmit
pnpm --filter e2e exec playwright test --project=chromium
```

**코드 정합성 체크리스트:**
- [ ] `useOrderActions.ts` 파일 삭제 완료 — `grep -r useOrderActions apps/seller/src` = 0건
- [ ] `SUMMARY_BAR_ITEMS` 완전 제거 — `grep -r SUMMARY_BAR_ITEMS apps/seller/src` = 0건
- [ ] 색상 상수 단일 출처 — `STATUS_COLOR`가 `_constants.ts` 한 곳에만 존재
- [ ] `prompt(` / `alert(` — `grep -r "prompt\|alert(" apps/seller/src` = 0건 (seller 내)
- [ ] `fontSize: [0-9]` 인라인 하드코딩 — orders 관련 파일에 잔여 없음
- [ ] `top: 57` / `top: 114` 매직넘버 잔여 없음

**e2e 기준:**
- 세션39 베이스라인 170 passed → T2에서 Summary Bar 테스트 **2건 삭제 + 탭 뱃지 테스트 1건 신설**
  = **169 passed / 0 failed** 예상 (세션41 검토 반영)
- 주문 탭 관련 spec 우선 확인: `seller-orders.spec.ts`, `seller-order-detail.spec.ts`

---

## 세션 분배 계획

| 세션 | 태스크 | 예상 규모 | 비고 |
|------|--------|----------|------|
| **세션41 (검토)** | 플랜 정합성 검토 | 소 | 구현 전 플랜↔코드·문서 정합성 검토. 코드 변경 없음. 진입: `session41-prep.md` |
| **세션42 (세션 A)** | T1 + T2 | 소 | 버그 수정 + sticky 정리. 빌드 리스크 낮음. 진입: `session42-prep.md` |
| **세션 B** | T3 + T4 | 중 | 카드 경량화 + 상세 개선. 독립적 |
| **세션 C** | T5 + T6 | 대 | 날짜 필터 + 그룹 헤더. 주요 신기능. T5 먼저 커밋 후 T6 진행 |
| **세션 D** | T7 | 소 | 구현 후 정합성 검토 + 타입체크 + e2e 풀런 |

> 세션 C는 규모가 크면 T5 단독 세션 + T6 단독 세션으로 분리 가능.
> 세션41 검토는 **구현 전** 플랜 점검, 세션 D(T7)는 **구현 후** 결과 검증으로 역할이 다름.

---

## 진행 규칙

1. T1~T6은 순차 진행 — 각 태스크 = 한 커밋, 끝에 `pnpm --filter seller tsc --noEmit` 통과 확인.
2. 기존 훅·API·비즈니스 로직 코드 변경 금지 (UI 레이어만). 단 `useOrderActions.ts`는 T3에서 삭제.
3. 하드코딩 색·폰트 크기는 작업 중 만나는 범위에서 토큰으로 교체.
4. 설계 변경 발생 시 `docs/CRITICAL_LOGIC.md`에 #CL 기록.
5. 각 태스크의 **정합성 확인 체크리스트**를 커밋 전에 수동으로 점검.

---

## 별도 후속 태스크 (본 플랜 범위 외 — BACKLOG 등재 완료)

- **BUG-16**: 택배 주문 상태 전환 갭 (셀러 "발송 완료" 버튼 + 드라이버 보드 필터)
- **UX-11**: 주문번호 통합 (`orderNumber` 필드 백엔드 신설 + 소비자·셀러 앱 표시 일치)

# 세션48 진입 문서 — T1+T2 구현 (소비자 배송일 선택 UI)

> 작성: 2026-05-20 (세션47) · 선행: 세션47 플랜 정합성 검토 완료
> 목표: 배송일 선택 기능 **T1+T2 구현** — 소비자 앱 한정, 첫 코드 변경 세션
> SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (세션47 정정 반영본)

---

## 컨텍스트

세션47이 `delivery-date-selection-plan.md`를 실제 코드와 대조해 **5건의
중대한 정정**을 플랜에 반영했다. 세션48은 정정된 플랜대로 T1·T2를 구현한다.

### 세션47 검토에서 정정된 핵심 (구현 시 반드시 반영)

1. **REST API 아님 — Firestore 직접 쿼리.** `DailyCapsController`는
   `@Roles('seller','admin')` 가드라 소비자가 호출 불가. 소비자
   `useDailyCap`은 원래 `doc(db,'dailyCaps',docId)` `onSnapshot`. T1은
   이를 **월 범위 `collection('dailyCaps')` `where` 쿼리**로 확장.
2. **`usedSlots` 부재.** `updateDailyCap`은 `totalCap`만 저장 —
   `usedSlots`는 주문이 들어와 트랜잭션이 써야 생긴다. 잔여 계산은
   `totalCap - (usedSlots ?? 0)` 널 병합 필수. 기존 `useDailyCap.ts:54`
   `remainingSlots` 계산도 `NaN` 버그 소지라 동반 수정.
3. **Firestore 보안 규칙 확인.** 소비자가 `dailyCaps` 컬렉션 `where`
   쿼리를 하려면 규칙이 read 허용해야 함 — T1 착수 직전 `firestore.rules`
   확인. (단건 `doc()` 구독은 이미 동작 중이므로 열려 있을 가능성 높음.)
4. **`canBuy` 분기.** `ProductActions.tsx:76`
   `canBuy = isGroup ? groupConsent && !isFull : true` — 일반 분기
   `true`를 배송일 선택 여부로 교체.
5. **타입 변경 불필요.** `CreateOrderRequest.requestedDeliveryDate?`
   (`order.types.ts:76`)·`CreateOrderDto`(`create-order.dto.ts:55`)는
   이미 존재. `CartItem`(`useCart.ts:8`)에만 옵셔널 필드 추가.

---

## 세션48 태스크

### T1 — 소비자 배송일 선택 UI (상품 상세)

**변경 파일:** `consumer/src/hooks/useDailyCap.ts`(확장),
`consumer/.../products/[id]/_components/ProductActions.tsx`,
신규 `_components/DeliveryDatePicker.tsx`

1. `firestore.rules` 확인 — 소비자 `dailyCaps` 컬렉션 쿼리 read 허용 여부.
   불허 시 규칙 수정 PR 별도 필요(이 경우 사용자에게 보고).
2. `useDailyCap` 확장 (또는 신규 `useDeliverySlots(storeId, from, to)`):
   `query(collection(db,'dailyCaps'), where('storeId','==',id),
   where('date','>=',from), where('date','<=',to))`. 응답 항목은
   `{ totalCap, usedSlots? }` — `usedSlots ?? 0`.
3. `DeliveryDatePicker` 신규 — 셀러 `daily-caps` 캘린더의 소비자용 거울상.
   `totalCap - (usedSlots ?? 0) > 0`인 날짜만 활성. 과거·문서 없음·잔여 0
   disabled. 캘린더 월 이동은 당월+익월 2개월 권장(T1에서 최종 확정).
4. `ProductActions`에 picker 배치 — `saleType:'normal'`일 때만.
5. `canBuy` 일반 분기를 배송일 선택 여부로 교체.
6. 기존 "오늘 잔여 배송 가능 N건"(`ProductActions.tsx:218`) — picker와
   중복되므로 제거하거나 picker에 통합.
7. `useDailyCap.ts:54` `remainingSlots` 계산 `?? 0` 동반 수정.

**커밋 후:** `pnpm --filter consumer tsc --noEmit` 통과.

### T2 — 배송일을 체크아웃·장바구니로 전달

**변경 파일:** `ProductActions.tsx`, `checkout/page.tsx`,
`hooks/useCart.ts`, cart 관련 컴포넌트

1. `CartItem`(`useCart.ts:8~17`)에 `requestedDeliveryDate?: string` 추가.
2. `handleBuyNow`(`ProductActions.tsx:92`) — `URLSearchParams`에
   `requestedDeliveryDate` 추가.
3. `handleAddToCart`(`:78`) — `addItem`에 `requestedDeliveryDate` 전달.
4. `checkout/page.tsx` — URL 파라미터·장바구니 아이템에서 배송일을 읽어
   `orderRequest`(`:72`)·장바구니 분기(`:164` `satisfies CreateOrderRequest`)
   양쪽에 포함.
5. 장바구니에 여러 상품 시 각 아이템 배송일 독립 유지·표시.

**커밋 후:** `pnpm --filter consumer tsc --noEmit` 통과.

---

## 진행 규칙

- T1 → T2 순서 고정. 각 태스크 = 한 커밋.
- 각 태스크의 플랜 **정합성 확인 체크리스트**를 커밋 전 수동 점검.
- 하드코딩 색·폰트는 작업 범위에서 토큰(`var(--*)`)으로 교체.
- 한글 파일 편집 시 PowerShell `Get-Content`/`Set-Content` 금지 — Edit/Python.
- T3(API 슬롯 검증)는 세션49 — 세션48에서는 손대지 않음.

## 세션48 완료 기준

- [ ] T1·T2 각 1커밋, consumer 타입체크 통과
- [ ] `firestore.rules` 소비자 `dailyCaps` 쿼리 가능 확인(또는 수정)
- [ ] 정합성 확인 체크리스트 점검 완료
- [ ] `docs/memory.md` 세션48 갱신 + `session49-prep.md` 작성 (T3 지시서)

## 참조

- 플랜 SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (세션47 정정본)
- 세션47 검토: 본 문서 "정정된 핵심" + 플랜 내 ⚠️ 표시 항목
- 재사용: `seller/.../settings/daily-caps/page.tsx`(슬롯 캘린더 UI 참고)
- 미해결: 캘린더 월 이동 범위(T1 착수 시 확정)·e2e 시드 슬롯(T6)

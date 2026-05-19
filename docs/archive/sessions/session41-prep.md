# 세션41 진입 문서 — 셀러 주문 탭 리팩토링 플랜 정합성 검토

> 작성: 2026-05-19 (세션40)
> 목표: **구현 전** 세션40에서 수립한 플랜·문서·설계 결정의 정합성을 검토.
> 산출물: 검토 결과 + 발견된 불일치를 플랜 문서에 직접 수정 반영. **코드 변경 없음.**

---

## 이 세션의 성격

세션40은 셀러 주문 탭 리팩토링을 **논의·설계만** 했고 코드는 건드리지 않았다.
세션41은 그 설계가 **실제 코드와 맞는지, 문서끼리 모순이 없는지, 태스크가 빠진 게
없는지**를 검토한다. 검토 통과 후에야 세션42(세션 A, T1+T2 구현)로 진입한다.

**검토 대상 문서:**
- `docs/specs/frontend/seller-orders-refactor-plan.md` (플랜 SSOT)
- `docs/archive/sessions/session42-prep.md` (세션 A 구현 지시서)
- `docs/BACKLOG.md` (§1-3, §12 등재분)
- `docs/memory.md` (세션40 진행 현황)

**검토 대상 코드 (읽기 전용):**
- `apps/seller/src/app/orders/` 전체
- `apps/seller/src/app/orders/[id]/` 전체
- `apps/seller/src/hooks/useOrders.ts`, `useOrderActions.ts`, `useOrderStatusUpdate.ts`
- `apps/seller/src/components/` (PageShell·PageHeader·EmptyState·BottomNav)
- `apps/seller/src/app/globals.css` (CSS 변수)
- `apps/e2e/tests/seller-orders*.spec.ts`

---

## 검토 항목

### A. 플랜 ↔ 실제 코드 정합성

플랜이 인용한 코드 사실이 실제와 맞는지 한 줄씩 대조한다.

- [ ] **A1.** 플랜이 언급한 파일 경로가 전부 실존하는가
      (`OrderRow.tsx`, `OrderInfoSection.tsx`, `useOrderActions.ts`, `_constants.ts` 등)
- [ ] **A2.** D1 색상 기준표가 실제 `_constants.ts`의 `STATUS_COLOR`,
      `OrderRow.tsx`의 `STATUS_COLOR_MAP` 값과 정확히 대응하는가
      (플랜은 "목록 ACCEPTED=blue·PREPARING=orange / 상세 ACCEPTED=orange·PREPARING=blue"로 기술)
- [ ] **A3.** 이중 선언 상수명이 정확한가 — `STATUS_LABEL`/`STATUS_LABEL_MAP`,
      `STATUS_COLOR`/`STATUS_COLOR_MAP`, `DELIVERY_LABEL`/`DELIVERY_LABEL_MAP`
- [ ] **A4.** `OrderCard.tsx` 주문번호 `slice(-6)`, `OrderInfoSection.tsx` `slice(-8)`
      — 실제 값 확인
- [ ] **A5.** `orders/page.tsx`의 3중 sticky `top` 값(`57`, `114`)이 실제와 일치하는가
- [ ] **A6.** `useOrderActions`가 **`OrderCard.tsx` 외 다른 곳에서 import되지 않는지**
      재확인 (`grep -r useOrderActions apps/seller/src`) — T3에서 삭제 가능 여부의 근거

### B. 설계 결정 간 내부 정합성

- [ ] **B1.** D3(OrderCard 강제취소 버튼 제거)와 "셀러가 카드에서 바로 취소"
      니즈가 충돌하지 않는가 — 상세 1단계 진입이 수용 가능한지 재확인
- [ ] **B2.** D4 sticky bottom 액션 버튼이 `CancelOrderModal`·`PrepareForm`과
      레이아웃 충돌하지 않는가 — 현재 `PrepareForm`이 페이지 인라인인지 모달인지 확인
- [ ] **B3.** D4 sticky bottom의 `bottom` 좌표 — 주문 상세에 `BottomNav`가
      있는지 확인 (상세 페이지는 BottomNav 없을 수 있음 → `bottom: 0` 가능)
- [ ] **B4.** D5 날짜 필터 기준(`requestedDeliveryDate`)과 D6 그룹 기준이
      탭별로 일관되게 정의됐는가 (활성탭=배송일 / 아카이브탭=생성일)
- [ ] **B5.** D6 "날짜 미정" 그룹 — 공동구매 주문이 실제로
      `order.requestedDeliveryDate`가 `null`인지 `@greenhub/shared`의 `Order` 타입에서 확인

### C. 인프라·토큰 존재 확인

플랜이 "사용"하겠다고 한 CSS 변수·컴포넌트가 실제로 존재하는지.

- [ ] **C1.** D2의 `--header-height` CSS 변수 — `globals.css`에 이미 있는가,
      없으면 T2에서 신규 선언 필요 (플랜에 그 사실이 반영됐는가)
- [ ] **C2.** `EmptyState` 컴포넌트가 T4가 기대하는 props(`icon`, `text`,
      children)를 받는가 — `components/StateViews.tsx` 확인
- [ ] **C3.** `var(--font-size-sm)` 등 토큰이 실제 정의돼 있는가
- [ ] **C4.** `PageShell`의 `paddingBottom` prop이 존재하는가 (T4 sticky 겹침 방지용)

### D. e2e 회귀 리스크

- [ ] **D1.** `seller-orders` 관련 e2e spec이 실존하는가, 파일명 확인
- [ ] **D2.** 해당 spec이 **요약바**(T2 제거 대상)를 셀렉터로 쓰는가
- [ ] **D3.** 해당 spec이 **OrderCard의 준비 시작 인라인 폼·강제 취소
      버튼**(T3 제거 대상)을 셀렉터로 쓰는가
- [ ] **D4.** 위 D2·D3에서 영향이 발견되면 → 플랜에 "해당 태스크에서 spec
      동반 수정" 항목을 추가

### E. 문서 간 정합성

- [ ] **E1.** 태스크 번호(T1~T7)가 플랜·session42-prep·BACKLOG에서 일관
- [ ] **E2.** 세션 분배(A=T1+T2, B=T3+T4, C=T5+T6, D=T7)가 모든 문서에서 동일
- [ ] **E3.** BUG-16·UX-11이 본 플랜 범위에서 제외돼 있고 BACKLOG에 별도 등재됐는가
- [ ] **E4.** `memory.md` 세션40 기록이 실제 산출물과 일치

### F. 누락 점검

- [ ] **F1.** 감사에서 식별된 8개 이슈(BUG-A·B·C, UX-E~J)가 T1~T6에 전부
      매핑됐는가 — 어디에도 안 들어간 이슈가 없는가
- [ ] **F2.** `formatRelativeTime` 등 기존 유틸이 날짜 그룹핑(T6)과 중복되지 않는가
- [ ] **F3.** 날짜 그룹핑 시 정렬 — 그룹 간 정렬 + 그룹 내 정렬 규칙이
      플랜에 명시됐는가 (플랜 §T6 정합성 확인 항목 참조)

---

## 산출물

1. **검토 결과 요약** — 위 항목별 OK / 불일치 발견 표기
2. **플랜 문서 수정** — 발견된 불일치는 `seller-orders-refactor-plan.md`에 직접 반영
   (예: A2에서 색상 기술이 틀렸으면 D1 표 교정, C1에서 변수 부재면 T2에 선언 작업 추가)
3. **session42-prep.md 갱신** — T1·T2 작업 순서가 바뀌면 반영
4. 검토에서 새 태스크가 필요하다고 판단되면 플랜에 T 추가 또는 BACKLOG 등재

---

## 완료 기준

- [x] A~F 전 항목 점검 완료
- [x] 발견된 불일치가 전부 문서에 반영됨
- [x] 세션42(세션 A) 진입 시 플랜·지시서를 그대로 따라도 되는 상태

---

## 검토 결과 (세션41 실행 — 2026-05-19)

플랜의 코드 사실 인용(A·E)은 거의 정확. 구현 진입 전 **불일치 7건 발견 → 전부 문서 반영 완료**.

### 항목별 판정

| 항목 | 판정 | 비고 |
|------|------|------|
| A1 파일 경로 | ✅ | 4개 파일 전부 실존 |
| A2 색상 기준표 | ✅ | 플랜 기술 정확 (목록=`_constants`, 상세=`OrderRow`) |
| A3 이중 선언 상수명 | ✅ | `_LABEL`/`_COLOR`/`_DELIVERY` ↔ `_MAP` 정확 |
| A4 주문번호 slice | ✅ | 카드 -6 / 상세 -8 (둘 다 `.toUpperCase()` 동반) |
| A5 sticky top | ✅ | 요약바 57 / 탭 114 정확 |
| A6 useOrderActions 사용처 | ⚠️→반영 | OrderCard만 import. 단 `useOrderStatusUpdate.ts` **주석**이 언급 → T3에 주석 갱신 추가 |
| B1 카드 취소 제거 | ✅ | — |
| B2 PrepareForm 구조 | ⚠️→반영 | 모달 아닌 페이지 인라인 `Paper` → T4 문구 정정 |
| B3 상세 BottomNav | ❌→반영 | `layout.tsx` 전역 렌더 → `bottom:0` 불가, T4 좌표 정정 |
| B4 날짜 필터 기준 | ✅ | — |
| B5 공동구매 null | ✅→주석 | `Order.requestedDeliveryDate: string\|null` 확인. D6에 의미 주석 보강 |
| C1 `--header-height` | ⚠️→반영 | globals.css 미존재 → T2 작업항목으로 승격 |
| C2 EmptyState props | ❌→반영 | `children` 미지원, props는 `icon/text/action` → T4 정정 |
| C3 토큰 존재 | ⚠️→반영 | `--font-size-base` 미사용 토큰 → `sm`/`xl`로 통일 |
| C4 PageShell paddingBottom | ✅ | 존재 (상세 이미 96 사용) |
| D1 spec 실존 | ✅ | `seller-orders.spec.ts`·`seller-order-detail.spec.ts` |
| D2 요약바 셀렉터 | ❌→반영 | spec line 94 `count>=2` → 요약바 제거 시 **실패 확정** |
| D3 카드 폼·취소 셀렉터 | ✅ | 직접 사용 spec 없음 → T3 e2e 무영향 |
| D4 영향 반영 | ❌→반영 | T2에 spec 2건 삭제 + 뱃지 테스트 신설 추가 |
| E1·E2 태스크/세션 번호 | ✅ | 플랜·session42-prep·memory 일관 |
| E3 BUG-16·UX-11 등재 | ✅ | BACKLOG §12 등재 확인 |
| E4 memory 기록 | ✅ | 세션40 기록 일치 |
| F1 8개 이슈 매핑 | ✅ | BUG-A/B/C·UX-E~J 전부 T1~T6 매핑 |
| F2 유틸 중복 | ✅ | `formatRelativeTime`과 T6 그룹핑 기능 상이 |
| F3 정렬 규칙 | ✅ | T6 정합성에 명시됨 |

### 체크리스트 외 중대 발견

- **ACCENT_BORDER 동반 교정 누락** — T1이 `STATUS_COLOR`만 뒤집으면 카드 좌측 보더(`ACCENT_BORDER`)와
  뱃지 색이 한 카드 안에서 불일치. → T1·session42-prep T1에 `ACCENT_BORDER` 동반 교정 추가.
- **session42-prep T2 자기모순** — "탭 top:114→57"과 "탭 top:57→0"이 같은 탭을 두 좌표로 지시.
  실제 탭은 114, 57은 요약바. → 모순 줄 삭제, `top: var(--header-height)`로 단일화.

### 반영 위치 요약

- `seller-orders-refactor-plan.md` — T1(ACCENT_BORDER), T2(globals.css 변수·e2e·font-size),
  T3(주석 갱신), T4(EmptyState action·sticky bottom 좌표), D6(공동구매 주석), T7(베이스라인 170→169).
- `session42-prep.md` — T1(ACCENT_BORDER), T2(모순 해소·작업순서 4단계 정정), 완료 기준(보더 색 확인).
- 코드 변경 없음. e2e spec 실수정은 세션42 T2 커밋에서 수행(세션41은 "T2에 항목 추가"까지만).

**판정: 세션42(세션 A) 진입 가능 — 정정된 플랜·지시서를 그대로 따르면 됨.**

---

## 다음 세션 (세션42 = 세션 A) 예고

T1 상수 통합·색상 버그 수정 + T2 요약바 제거·sticky 단일화.
진입 문서: `docs/archive/sessions/session42-prep.md`

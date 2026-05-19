# 세션43 진입 문서 — 셀러 주문 탭 리팩토링 세션 B

> 작성: 2026-05-19 (세션42) · 선행: 세션 A(T1+T2) 완료
> 목표: T3(OrderCard 경량화) + T4(주문 상세 개선) 구현

---

## 컨텍스트

세션40 설계 → 세션41 정합성 검토 → 세션42(세션 A) T1+T2 구현 완료.
플랜 SSOT: `docs/specs/frontend/seller-orders-refactor-plan.md` (§T3·§T4)

세션 B 범위는 **카드 경량화 + 상세 개선** — T3·T4는 서로 독립적, 각각 1커밋.
T3는 훅 삭제(`useOrderActions.ts`)를 포함하므로 진행 규칙 §2 예외에 해당.

---

## 세션 B 태스크

### T3 — OrderCard 경량화 (1커밋)

**배경:** 카드의 인라인 준비 폼은 상세 페이지와 중복, 강제 취소 `prompt()`는 PWA UX 위반(D3).
카드는 "탐색 + 이동"만 담당하도록 경량화한다.

**변경 파일:** `orders/_components/OrderCard.tsx`, `hooks/useOrderActions.ts`

**작업 순서:**
1. `orders/_components/OrderCard.tsx`
   - `showPrepareForm` 인라인 폼 블록 제거 (datetime-local input 포함)
   - "강제 취소" 버튼 제거
   - "준비 시작" 버튼 → `onClick={() => router.push(\`/orders/${order.id}\`)}` 로 교체
     — `canPrepare`가 true인 경우에만 노출 유지
   - `useOrderActions` 훅 import 및 구조 분해 제거
   - `HUB_ARRIVED` 픽업 코드 표시 블록은 **유지**
   - 폼 제거로 미사용되는 `actionError`·`actionLoading` 등 참조 정리
2. `hooks/useOrderActions.ts` 파일 **삭제** (사용처 없어짐)
3. `hooks/useOrderStatusUpdate.ts`
   - 상단 주석에 `useOrderActions` 언급이 있으면 동반 갱신 (세션41 검토 발견)

**정합성 확인 (커밋 전):**
```powershell
# useOrderActions 잔여 참조 없음 확인
grep -r "useOrderActions" apps/seller/src
# → 결과 없어야 함

# prompt/alert 잔여 확인 (seller 내)
grep -rn "prompt(" apps/seller/src

pnpm --filter seller exec tsc --noEmit
```
- [ ] 카드 클릭(전체) → 상세 이동 유지
- [ ] 준비 시작 버튼 클릭 → 상세 이동 (준비 폼 열림 아님)

---

### T4 — 주문 상세 개선 (1커밋)

**배경:** not-found 화면이 인라인 구현, 액션 버튼이 인라인이라 긴 주문에서 스크롤 필요(D4).

**변경 파일:** `orders/[id]/page.tsx`

**작업 순서:**
1. not-found 인라인 `Box` 블록 → `<EmptyState>` 공통 컴포넌트 치환
   - `EmptyState` props는 `icon`·`text`·`action` (세션41 검토: `children` 미지원)
   - `text="주문을 찾을 수 없습니다"`, icon은 돋보기/클립보드 SVG
   - "돌아가기"는 기존 `UnstyledButton` 마크업을 `action` prop으로 전달
2. 액션 버튼(`준비 시작`·`강제 취소`) → sticky bottom footer 이동
   - `position: fixed`, `bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom))`
   - 세션41 검토: `BottomNav`는 `layout.tsx` 전역 렌더 → `bottom: 0` 불가, BottomNav 높이만큼 띄울 것
   - `--bottom-nav-height`는 세션42 T2에서 `globals.css`에 선언됨 (재사용)
   - `PageShell paddingBottom`(현재 96) — sticky footer + BottomNav 합계를 덮는지 실측 조정
   - `showPrepareForm` 시 footer 숨김 — `PrepareForm`은 페이지 인라인 `Paper`, 현재 구조 보존
   - `READONLY_STATUSES`(`isReadonly`)에서는 footer 미노출 — 기존 조건 유지
3. 인라인 `fontSize: 14`(돌아가기 버튼 등) → `var(--font-size-sm)` 치환

**정합성 확인 (커밋 전):**
```powershell
grep -n "fontSize: [0-9]" apps/seller/src/app/orders/[id]/page.tsx
# → 결과 없어야 함

pnpm --filter seller exec tsc --noEmit
```
- [ ] sticky 버튼이 BottomNav와 겹치지 않음 (육안 — 세션 D)
- [ ] 읽기 전용 상태에서 sticky footer 미노출
- [ ] `CancelOrderModal`이 sticky footer와 레이아웃 충돌 없음
- [ ] EmptyState 사용 후 "돌아가기" 동작 정상

---

## 세션 B 완료 기준

- [ ] T3 커밋 완료 + 타입체크 통과
- [ ] T4 커밋 완료 + 타입체크 통과
- [ ] `useOrderActions.ts` 삭제 + 잔여 참조 0건
- [ ] 주문 상세 액션 버튼이 하단 고정 footer로 이동됨

> e2e 풀런·브라우저 육안 검증은 세션 D(T7)에서 일괄 수행.

---

## 다음 세션 (세션 C) 예고

T5 날짜 범위 필터 신설 + T6 날짜 그룹 헤더. 규모가 크면 T5·T6 단독 세션 분리 가능.
플랜 상세: `docs/specs/frontend/seller-orders-refactor-plan.md` §T5, §T6

# 세션56 진입 문서 — T-UX2 상품 카드 Badge-as-button 분리

> 작성: 2026-05-21 (세션55 종료) · 선행: 세션55 T-UX3 `ConfirmModal` 완료(#CL-37)
> 목표: ① 머지 상태 가드(타입체크·biome 재확인), ② T-UX2 진입 — 상품 카드의 "판매중 토글 / 수정 / 삭제"를 시각·시맨틱이 명확한 컴포넌트로 분리

---

## 1. 세션55 컨텍스트 요약

T-UX3 완료. `apps/seller/src/components/ConfirmModal.tsx`(~75라인) 신설 + 6건 교체(#CL-37). 페이지 단일 state 표준 + ProductCard 내부 state는 합리적 예외. 셀러 타입체크 통과·`pnpm --filter seller build` 통과(23라우트)·biome baseline 72→68 errors(import 정렬 4건 자동수정)·신규 0건.

**플랜 권장 순서**대로 세션56은 T-UX2(Badge 분리) 진입. T-UX4 시리즈는 세션57+ 예정.

---

## 2. T-UX2 진입 — 결정 필요 사항 (사용자 확정)

플랜 SSOT [`seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX2 기준. 진입 전 사용자 합의:

- [ ] **활성 토글 패턴**: ① `Mantine Switch`(명시적 on/off, 라벨 가능) ② `ActionIcon`(눈/눈가림 아이콘 토글) ③ 현행 Badge 유지 + 별도 메뉴. 권장 **① Switch** — 모바일 터치 타깃·접근성·상태 가시성 모두 우수. lucide `Eye`/`EyeOff` 의 명시적 사용은 라벨이 비어 있는 경우 의미 전달이 약함.
- [ ] **수정·삭제 액션 패턴**: ① `Button size="xs" variant="subtle"` 텍스트 ② `ActionIcon` 아이콘 ③ 텍스트 + 아이콘 혼합. 권장 **① subtle Button**(현재 결과 동일 + 시맨틱 분명). ActionIcon은 라벨 부재로 신규 사용자에게 명확성 떨어짐.
- [ ] **삭제 버튼 색상**: `color="red"` subtle vs default gray. 권장 **red subtle** — destructive 어포던스 유지.
- [ ] **에러 메시지 위치**: 현행은 카드 내부 인라인. 유지하되 토글/액션 분리 후에도 동일 위치. 결정 그대로 권장.
- [ ] **레이아웃**: 활성 토글은 좌측 상단(상품명 라인) vs 액션 row 좌측. 권장 **상품명 우측에 Switch + 액션 row는 수정·삭제만**.

---

## 3. T-UX2 작업 계획

### 3-1. 변경 대상

`apps/seller/src/app/products/page.tsx` `ProductCard` 컴포넌트:

- 현행 라인 ~220-260 — `Badge` × 3 (판매중 토글 / 수정 / 삭제)
- 변경 후:
  - `판매 중` Badge → `Switch` (활성/비활성 토글)
  - `수정` Badge → `Button size="xs" variant="subtle" component={Link}`
  - `삭제` Badge → `Button size="xs" variant="subtle" color="red"`

### 3-2. 검증

```powershell
pnpm --filter seller exec tsc --noEmit
pnpm --filter seller build  # 23라우트
pnpm -w biome check --write apps/seller/src/app/products/page.tsx
```

dev 서버(`pnpm --filter seller dev`):
- [ ] 활성 토글 — Switch on/off로 isActive PATCH 호출, 처리 중 disabled, 에러 인라인 표시
- [ ] 수정 — `/products/[id]/edit`로 이동
- [ ] 삭제 — ConfirmModal(세션55) 열림 + 동작 동일
- [ ] 시각 회귀 — 카드 높이·정렬·여백 자연스러움 확인

e2e: products 관련 spec이 있다면 `getByRole('button', { name: '삭제' })`/`'수정'` 셀렉터 호환성 점검. Railway 복구 후.

### 3-3. 커밋·문서

- 커밋: `refactor(seller): UX-08 상품 카드 Badge → Switch+Button 분리 (T-UX2)`
- BACKLOG §11-3 UX-08 ✅ 마킹 + 세션·커밋 해시 + §12 활동 로그 세션56 추가, §12-1 우선순위 표 갱신
- memory.md 갱신
- CRITICAL_LOGIC #CL-38(상품 카드 액션 분리 정책) 추가 검토 — 패턴 정착이 다른 카드형 UI에도 영향 미친다면 등재
- visual-verify F-T-UX2 섹션 추가(#116~ 예상)
- 세션57 진입 문서 작성 (T-UX4a admin fontSize 토큰화)

---

## 4. 세션56 완료 기준

- [ ] §2 결정 사항 사용자 합의
- [ ] ProductCard 액션 row 분리(Switch + 2 Button)
- [ ] 타입체크·빌드·biome 통과
- [ ] BACKLOG·memory·visual-verify 갱신 + 세션57 진입 문서 작성
- [ ] 커밋 1건

---

## 5. 참조

- 플랜 SSOT: [`docs/specs/frontend/seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX2
- 세션55 결과: [`session55-prep.md`](session55-prep.md) (T-UX3 ConfirmModal)
- CRITICAL_LOGIC #CL-36(SegmentedTabs)·#CL-37(ConfirmModal)
- ProductCard 현황: `apps/seller/src/app/products/page.tsx:113-` (ProductCard 컴포넌트 시작)

---

## 6. 진행 규칙

- Railway Outage와 무관하게 진행. 백엔드 호출 경로 변경 없음.
- 사용자 명시 승인 후 진입.
- 액션 패턴이 결정되면 driver/admin 영역 다른 카드 UI에도 후속 적용 가능 — 본 세션은 products 한정.

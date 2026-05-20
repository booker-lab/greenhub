# 세션55 진입 문서 — T-UX3 ConfirmModal 공통 컴포넌트 + native confirm() 6곳 교체

> 작성: 2026-05-20 (세션54 종료) · 선행: 세션54 T-UX1 탭 단일화 완료(#CL-36)
> 목표: ① T-UX1 머지 상태 가드(타입체크·biome 재확인), ② T-UX3 진입 — `ConfirmModal` 신설 + native `confirm()` 6건 교체

---

## 1. 세션54 컨텍스트 요약

T-UX1 완료. `apps/seller/src/components/SegmentedTabs.tsx`(~80라인) 신설 + 주문·상품·정산 3페이지 치환 + `top: 57` 매직넘버 해소. 셀러 타입체크(exit 0)·`pnpm --filter seller build`(23라우트)·biome 신규 0건. #CL-36 기록.

**플랜 권장 순서대로** 세션55는 T-UX3(ConfirmModal) 진입. T-UX2(Badge 분리)는 세션56 예정.

---

## 2. T-UX3 진입 — 결정 필요 사항 (사용자 확정)

플랜 SSOT [`seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX3 기준. 진입 전 사용자 합의:

- [ ] **모달 구현 방식**: 자체 컴포넌트(Mantine `Modal` 직접 사용, `CancelOrderModal`과 동일 결) vs `@mantine/modals` 의존성 추가. 권장 **자체 컴포넌트** — 의존성 최소·기존 패턴 정착.
- [ ] **상태 관리**: 카드별 state vs 페이지 단일 state + `targetId`. 권장 **페이지 단일 state** — 메모리·prop drilling 최소.
- [ ] **컴포넌트 위치**: `apps/seller/src/components/ConfirmModal.tsx` (SegmentedTabs와 동일 폴더).
- [ ] **Props 시그니처**: `opened` · `title` · `message`(string|ReactNode) · `confirmLabel`(default '확인') · `cancelLabel`(default '취소') · `confirmColor`(default 'red' — 삭제·정지가 다수) · `onConfirm`(async 허용) · `onClose` · `loading?`.

---

## 3. T-UX3 작업 계획

### 3-1. 신설

`apps/seller/src/components/ConfirmModal.tsx` (~60라인 예상):

```tsx
'use client';
import { Button, Group, Modal, Text } from '@mantine/core';
import type { ReactNode } from 'react';

type Props = {
  opened: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  loading?: boolean;
};
```

### 3-2. 치환 대상 (6건)

| # | 파일 | 현재 호출 | 라벨/색상 |
|---|------|-----------|-----------|
| 1 | `apps/seller/src/app/hubs/page.tsx:61` | `confirm('거점을 삭제하시겠습니까?')` | 삭제·red |
| 2 | `apps/seller/src/app/products/page.tsx:171` (ProductCard 내부) | `confirm(\`"\${product.name}" 상품을 삭제하시겠습니까?\\n이 작업은 되돌릴 수 없습니다.\`)` | 삭제·red, 카드별 state(예외) |
| 3 | `apps/seller/src/app/admin/drivers/_client.tsx:58` | `confirm('이 드라이버를 승인하시겠습니까?')` | 승인·green |
| 4 | `apps/seller/src/app/admin/drivers/_client.tsx:66` | `confirm(msg)` (정지/해제 가변) | 정지/해제·red |
| 5 | `apps/seller/src/app/admin/settlements/_client.tsx:43` | `confirm('이 정산을 지급 완료 처리하시겠습니까?')` | 지급 완료·primary |
| 6 | `apps/seller/src/app/admin/users/_client.tsx:13` | `confirm(...)` (정지/해제 가변) | 정지/해제·red |

**products(2번)는 ProductCard 컴포넌트 내부**이라 카드별 state 유지가 자연. 페이지 단일 state로 끌어올리려면 ProductCard에 `onRequestDelete: (product) => void` prop 추가 + 페이지에 모달 1개. 권장: **products는 ProductCard 내부 state 유지**(예외), 나머지 5건은 페이지 단일 state.

### 3-3. 검증

```powershell
pnpm --filter seller exec tsc --noEmit
pnpm --filter seller build  # 23라우트 통과 기대
pnpm -w biome check --write apps/seller/src/components/ConfirmModal.tsx apps/seller/src/app/hubs/page.tsx apps/seller/src/app/products/page.tsx apps/seller/src/app/admin/drivers/_client.tsx apps/seller/src/app/admin/settlements/_client.tsx apps/seller/src/app/admin/users/_client.tsx
```

dev 서버(`pnpm --filter seller dev`):
- [ ] 거점 삭제 — 모달 열림·취소·확인 동작
- [ ] 상품 삭제 — 카드별 모달, name 표시 정확
- [ ] 드라이버 승인·정지·해제 — confirmColor 분기 확인
- [ ] 정산 지급 완료 — 모달 동작
- [ ] 사용자 정지·해제 — msg 가변·confirmColor

e2e: 백엔드 호출 경로 변경 없음 → Railway 복구 후 셀렉터 점검만(`getByText('삭제')` 등 텍스트 기반이면 영향 없음).

### 3-4. 커밋·문서

- 커밋: `refactor(seller): UX-09 ConfirmModal 공통 컴포넌트 + native confirm 6곳 교체 (T-UX3)`
- BACKLOG §11-3 UX-09 ✅ 마킹 + 세션·커밋 해시 + §12 활동 로그 세션55 추가
- memory.md 갱신
- CRITICAL_LOGIC #CL-37(ConfirmModal 정책) 추가 검토
- visual-verify F-T-UX3 섹션 추가(#108~114 예상)
- 세션56 진입 문서 작성 (T-UX2 Badge 분리)

---

## 4. 세션55 완료 기준

- [ ] §2 결정 사항 사용자 합의
- [ ] ConfirmModal.tsx 신설 + 6곳 치환
- [ ] 타입체크·빌드·biome 통과
- [ ] BACKLOG·memory·CRITICAL_LOGIC·visual-verify 갱신 + 세션56 진입 문서 작성
- [ ] 커밋 1건

---

## 5. 참조

- 플랜 SSOT: [`docs/specs/frontend/seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX3
- 세션54 결과: [`session54-prep.md`](session54-prep.md) (T-UX1 정합성 검토 + 진입)
- CRITICAL_LOGIC #CL-36 — SegmentedTabs 신설 정책
- 기존 모달 패턴 참고: `apps/seller/src/app/orders/_components/CancelOrderModal.tsx`

---

## 6. 진행 규칙

- Railway Outage와 무관하게 진행. 백엔드 호출 경로 변경 없음.
- products(2번)는 ProductCard 내부 state 유지(예외) — 페이지 단일 state 원칙의 합리적 예외.
- 사용자 명시 승인 후 진입.

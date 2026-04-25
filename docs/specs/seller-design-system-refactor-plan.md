# 셀러앱 디자인 시스템 리팩토링 플랜

> 작성: 2026-04-25  
> 대상: `apps/seller/src/` 전체 (43개 tsx 파일, 총 5,877줄)  
> 원칙: **로직 불변** — 훅·API·비즈니스 로직 일절 수정 금지. UI 레이어만 변경.  
> 선행 완료: `packages/ui/src/style.css` 시맨틱 토큰 (T0) — consumer 작업 시 추가됨

---

## 위반 카테고리

| 카테고리 | 설명 | 건수 |
|---------|------|------|
| **A** | `c="..."` / `fw={숫자}` / `fz=` Mantine prop | 178 + 77 + 21 = **276건** |
| **B** | `size="xs"` / `size="sm"` 폰트 15px 미만 | **222건** |
| **C** | `var(--mantine-color-*)` / `var(--green-primary)` | **153건** |
| **D** | `linear-gradient` / hex 하드코딩 | 포함 |

## 예외 규칙

- 카카오 버튼 색상 `#FEE500`, `#000000` → 유지 (브랜드 컬러)
- `color=` prop on Button/Badge → 유지 (Mantine 컴포넌트 테마, 위반 아님)
- `←` 텍스트 버튼 → Lucide `<ChevronLeft size={20} />` 교체
- 검색 커스텀 SVG → Lucide `<Search />` 교체

---

## var() 매핑표

| 기존 | 대체 토큰 |
|------|---------|
| `var(--mantine-color-white)` | `var(--color-bg)` |
| `var(--mantine-color-gray-0/1)` | `var(--color-surface-muted)` |
| `var(--mantine-color-gray-2/3)` | `var(--color-border)` |
| `var(--mantine-color-gray-4/5)` | `var(--color-text-disabled)` |
| `var(--mantine-color-gray-6/7)` | `var(--color-text-secondary)` |
| `var(--mantine-color-dark)` / `dark-7/8` | `var(--color-text)` |
| `var(--mantine-color-brand-*)` bg | `var(--color-primary-surface)` |
| `var(--mantine-color-brand-*)` text | `var(--color-primary)` |
| `var(--mantine-color-green-*)` | `var(--color-primary)` |
| `var(--mantine-color-red-*)` | `var(--color-danger)` |
| `var(--green-primary)` | `var(--color-primary)` |
| `c="dimmed"` | `style={{ color: 'var(--color-text-disabled)' }}` |
| `c="gray.5/6/7"` | `style={{ color: 'var(--color-text-secondary)' }}` |
| `c="gray.8/9"` / `c="dark"` | `style={{ color: 'var(--color-text)' }}` |
| `fw={500/600}` | `style={{ fontWeight: 'var(--fw-medium)' }}` |
| `fw={700/800/900}` | `style={{ fontWeight: 'var(--fw-bold)' }}` |
| `size="xs"` / `size="sm"` on Text | `style={{ fontSize: 'var(--font-size-sm)' }}` |
| `fz={12}` / `fz="xs"` | `style={{ fontSize: 'var(--font-size-sm)' }}` |

---

## 1단계 — 공통 기반 (layout · nav · auth)

> 모든 페이지에 공유되는 레이어. 가장 먼저 정합해야 전체가 일관됨.

### ✅ ST1 — `apps/seller/src/app/layout.tsx` (52줄)
- `var(--mantine-color-*)` / hex 하드코딩 → CSS var 전환
- `c=`, `fw=`, `size=` → style prop 전환

### ✅ ST2 — `apps/seller/src/components/BottomNav.tsx` (119줄)
- 아이콘 텍스트 문자 → Lucide 교체 여부 확인
- `c=`, `fw=`, `size=` / `var(--mantine-color-*)` → style var 전환
- active/inactive 색상 → `var(--color-primary)` / `var(--color-text-disabled)`

### ✅ ST3 — `apps/seller/src/app/login/page.tsx` (150줄)
- `c=`, `fw=`, `size=` → style var 전환
- 카카오 버튼 색상 유지 예외 적용

### ✅ ST4 — `apps/seller/src/app/onboarding/page.tsx` (252줄)
- `c=`, `fw=`, `size=` → style var 전환
- `var(--mantine-color-*)` → 매핑표 기준 전환

### ✅ ST5 — `apps/seller/src/app/page.tsx` (10줄) + `apps/seller/src/app/providers.tsx`
- 위반 항목 확인 후 전환

---

## 2단계 — 상품 관리

> ProductForm이 423줄로 500줄 경계. 로직 불변 원칙 하에 UI만 교체.

### ✅ ST6 — `apps/seller/src/app/products/page.tsx` (262줄)
- `c=`, `fw=`, `size=` / `var(--mantine-color-*)` → style var 전환

### ✅ ST7 — `apps/seller/src/app/products/_components/ProductForm.tsx` (423줄) ⚠️ 500줄 경계 → 유지
- `c=`, `fw=`, `size=` / `var(--mantine-color-*)` → style var 전환
- **작업 후 줄 수 확인 필수 — 500줄 초과 시 즉시 서브컴포넌트 분리**

### ✅ ST8 — `apps/seller/src/app/products/_components/` 소형 컴포넌트 묶음
대상 파일 (4개):
- `TouchSelector.tsx` (197줄)
- `ImageUpload.tsx` (213줄)
- `GroupConfigSection.tsx` (107줄)
- `AIPreviewPanel.tsx` (124줄)

### ✅ ST9 — `apps/seller/src/app/products/_components/` 초소형 + 편집 페이지
대상 파일 (3개):
- `VarietySelector.tsx` (68줄)
- `SellerNoteInput.tsx` (33줄)
- `apps/seller/src/app/products/[id]/edit/page.tsx`
- `apps/seller/src/app/products/new/page.tsx`

---

## 3단계 — 주문 · 정산 · 설정

> 셀러의 핵심 운영 화면. 상태 색상(주문 상태 뱃지 등) → 시맨틱 토큰 매핑 중요.

### ✅ ST10 — `apps/seller/src/app/orders/page.tsx` (412줄)
- 주문 상태 색상 → `var(--color-status-*)` / `var(--color-danger*)` 토큰
- `c=`, `fw=`, `size=` / `var(--mantine-color-*)` → style var 전환

### ✅ ST11 — `apps/seller/src/app/orders/[id]/page.tsx` (320줄) + `OrderRow.tsx`
- `←` → Lucide `<ChevronLeft size={20} />`
- `c=`, `fw=`, `size=` / `var(--mantine-color-*)` → style var 전환

### ✅ ST12 — `apps/seller/src/app/settlements/page.tsx` (378줄)
- `c=`, `fw=`, `size=` / `var(--mantine-color-*)` → style var 전환

### ✅ ST13 — `apps/seller/src/app/settings/` 3개 파일
대상:
- `settings/page.tsx` (121줄)
- `settings/daily-caps/page.tsx` (280줄)
- `settings/delivery/page.tsx` (214줄)
- `c=`, `fw=`, `size=` / `var(--mantine-color-*)` → style var 전환

---

## 4단계 — 허브 관리 · 어드민 · 검증

### ✅ ST14 — `apps/seller/src/app/hubs/` 4개 파일
대상:
- `hubs/page.tsx` (185줄)
- `hubs/new/page.tsx` (141줄)
- `hubs/[id]/page.tsx` (218줄)
- `hubs/[id]/pickup/page.tsx` (237줄)
- `←` → Lucide `<ChevronLeft size={20} />`
- `c=`, `fw=`, `size=` / `var(--mantine-color-*)` → style var 전환

### ✅ ST15 — `apps/seller/src/app/admin/` 어드민 공통 + banner
대상:
- `admin/page.tsx`
- `admin/layout.tsx`
- `admin/banner/_client.tsx` (173줄) — `var(--green-primary)` 포함

### ✅ ST16 — `apps/seller/src/app/admin/` 나머지 5개 _client
대상:
- `admin/drivers/_client.tsx` (142줄)
- `admin/invite/_client.tsx` (151줄)
- `admin/orders/_client.tsx` (138줄)
- `admin/settlements/_client.tsx` (161줄)
- `admin/stores/_client.tsx` (153줄)
- `admin/users/_client.tsx` (83줄)

### ✅ ST17 — 타입체크 + 검증
```bash
cd apps/seller && pnpm tsc --noEmit
# 결과: 0 errors 목표
```

---

## 진행 규칙

1. 로직(훅, API, 상태관리) 코드 절대 수정 금지
2. 각 ST 완료 즉시 체크박스 `✅` 표시
3. ST7 작업 중 500줄 초과 시 즉시 중단 → 서브컴포넌트 분리 선행
4. `lucide-react`는 이미 설치됨 (`apps/consumer`) — seller에 별도 설치 필요 여부 확인
5. 각 단계 완료 후 타입 오류 없는지 확인

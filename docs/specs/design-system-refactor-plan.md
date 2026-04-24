# 디자인 시스템 1~3단계 미수행 작업 플랜

> 작성: 2026-04-25  
> 대상: `apps/consumer/src/app/` 페이지 파일 전체 (components/ 는 4단계까지 완료)  
> 원칙: **로직 불변** — 훅/API/비즈니스 로직 일절 수정 금지. UI 레이어만 변경.

---

## 위반 카테고리 (4가지)

| 카테고리 | 설명 | 변환 예시 |
|---------|------|---------|
| **A** | Mantine `c=` / `fw=` prop 하드코딩 | `c="dark"` → `style={{ color: 'var(--color-text)' }}` |
| **B** | `size="xs/sm"` 15px 미만 폰트 | → `style={{ fontSize: 'var(--font-size-sm)' }}` |
| **C** | `var(--mantine-color-*)` 직접 사용 | → 디자인 시스템 var() |
| **D** | gradient + hex 하드코딩 | `linear-gradient`, `#fff` 등 → var() |

## var() 매핑표 (Mantine → 디자인 시스템)

| Mantine var | 대체 토큰 |
|-------------|---------|
| `--mantine-color-white` | `--color-bg` |
| `--mantine-color-gray-0/1` | `--color-surface-muted` (신규 T0) |
| `--mantine-color-gray-2/3` | `--color-border` |
| `--mantine-color-gray-4/5` | `--color-text-disabled` |
| `--mantine-color-gray-6` | `--color-text-secondary` |
| `--mantine-color-dark` / `dark-7/8` | `--color-text` |
| `--mantine-color-brand-*` (bg) | `--color-primary-surface` |
| `--mantine-color-brand-*` (text) | `--color-primary` |
| `--mantine-color-blue-0` | `--color-status-info-bg` (신규 T0) |
| `--mantine-color-blue-7` | `--color-status-info-text` (신규 T0) |
| `--mantine-color-orange-0` | `--color-status-warning-bg` (신규 T0) |
| `--mantine-color-orange-7` | `--color-status-warning-text` (신규 T0) |
| `--mantine-color-red-0` | `--color-danger-surface` (신규 T0) |
| `--mantine-color-red-5/7` | `--color-danger` |
| `--mantine-color-yellow-0` | `--color-caution-bg` (신규 T0) |
| `--mantine-color-yellow-3` | `--color-caution-border` (신규 T0) |
| `--green-primary` (잘못된 var명) | `--color-primary` |
| `fw={600/800/900}` | `var(--fw-bold)` (디자인 시스템 최대 700) |

---

## 태스크 목록 (진행 순서)

### T0 — `packages/ui/src/style.css` 시맨틱 토큰 보강 ✅
**선행 필수 — 이후 모든 태스크가 이 토큰을 참조함**

추가할 토큰:
```css
--color-surface-muted: #f8f9fa;
--color-status-info-bg: #e7f5ff;
--color-status-info-text: #1971c2;
--color-status-warning-bg: #fff4e6;
--color-status-warning-text: #e8590c;
--color-danger-surface: #fff5f5;
--color-caution-bg: #fffde7;
--color-caution-border: #ffd43b;
```

---

### T1 — `apps/consumer/src/components/GreenLoveBrandSection.tsx` (48줄) ✅
- `linear-gradient` 제거 → `var(--color-primary-surface)` 플랫 배경
- `var(--green-bg)` (존재하지 않는 var) → `var(--color-primary-surface)`
- `c="var(--green-primary)"` → `style={{ color: 'var(--color-primary)' }}`
- `borderRadius: 16` → `var(--radius)`
- `size="xs/sm"`, `fw=`, `c=` → style prop 전환

---

### T2 — `apps/consumer/src/app/login/page.tsx` (106줄) ✅
- `c="brand.6"` → `style={{ color: 'var(--color-primary)' }}`
- `size="sm"` → `style={{ fontSize: 'var(--font-size-sm)' }}`
- **`#FEE500`, `#000000` 카카오 버튼 색상 유지** (브랜드 컬러 예외)

---

### T3 — `apps/consumer/src/app/order/success/page.tsx` (116줄) ✅
- `c="gray.5/4"`, `c="brand.6"` → style var() 전환
- `fw=`, `size="xs/sm"` → style var() 전환

---

### T4 — `apps/consumer/src/app/search/page.tsx` (102줄) ✅
- `var(--mantine-color-white/gray-1)` → `var(--color-bg)` / `var(--color-border)`
- 커스텀 `<svg>` 검색 아이콘 → Lucide `Search` 컴포넌트 교체
- `c=`, `fw=`, `size=` → style var() 전환

---

### T5 — `apps/consumer/src/app/cart/page.tsx` (157줄) ✅
- `var(--mantine-color-gray-1)` → `var(--color-surface-muted)`
- `var(--mantine-color-dark-8)` → `var(--color-text)`
- `#fff` → `var(--color-bg)`
- `c=`, `fw=`, `size=` → style var() 전환

---

### T6 — `apps/consumer/src/app/category/page.tsx` (171줄) ✅
- `var(--mantine-color-dark-7)` → `var(--color-text)`
- `var(--mantine-color-gray-3/5)` → `var(--color-border)` / `var(--color-text-disabled)`
- `c=`, `fw=`, `size=` → style var() 전환
- **`COLOR_CHIPS` hex 배열 유지** (꽃 색상 데이터)

---

### T7 — `apps/consumer/src/app/checkout/page.tsx` (379줄) ✅
- `var(--green-primary)` → `var(--color-primary)`
- `var(--mantine-color-gray-3)` → `var(--color-border)`
- `c=`, `fw=`, `size=` → style var() 전환

---

### T8 — `apps/consumer/src/app/products/[id]/page.tsx` (495줄) ✅ ⚠️ 500라인 경계
- `linear-gradient` 공구 현황 박스 → 제거, `var(--color-primary-surface)` + border
- `var(--mantine-color-yellow-0/3)` → `var(--color-caution-bg/border)`
- `var(--mantine-color-brand-*)` → `var(--color-primary*)`
- `var(--mantine-color-gray-*)` → 매핑표 기준
- `c="var(--green-primary)"` → `style={{ color: 'var(--color-primary)' }}`
- `fw={800/900}` → `var(--fw-bold)`
- `c=`, `fw=`, `size=` → style var() 전환
- **500라인 초과 시 GroupStatusBox 서브컴포넌트 즉시 분리**

---

### T9 — `apps/consumer/src/app/mypage/_client.tsx` (225줄) ✅
- `STATUS_COLORS` 객체 전체 → 신규 status 토큰으로 교체
- `ACCENT_COLORS` 객체 전체 → 신규 status 토큰으로 교체
- `#fff` × 3 → `var(--color-bg)`
- `var(--mantine-color-gray-2)` → `var(--color-border)`
- `c=`, `fw=`, `size=` → style var() 전환

---

### T10 — `apps/consumer/src/app/mypage/notifications/_client.tsx` (197줄) ✅
- `#fff`, `#f0f0f0` → `var(--color-bg)`, `var(--color-border)`
- `#F0F7F4` (읽지 않은 알림 bg) → `var(--color-primary-surface)`
- `#e8f5e9` (아이콘 bg) → `var(--color-primary-surface)`
- `←` 텍스트 버튼 → Lucide `ChevronLeft`
- `c=`, `fw=`, `size=` → style var() 전환

---

### T11 — `apps/consumer/src/app/mypage/addresses/_client.tsx` (212줄) ✅
- `←` 텍스트 버튼 → Lucide `ChevronLeft`
- `c=`, `fw=`, `size=` → style var() 전환

---

### T12 — `apps/consumer/src/app/mypage/orders/[id]/_client.tsx` (265줄) ✅
- `var(--mantine-color-brand-4)` → `var(--color-primary)`
- `var(--mantine-color-dark-8)` → `var(--color-text)`
- `←` 텍스트 버튼 × 2 → Lucide `ChevronLeft`
- `c=`, `fw=`, `size=` → style var() 전환

---

### T13 — 타입체크 + e2e 검증 ✅
```bash
cd apps/consumer && pnpm tsc --noEmit
# 루트에서
pnpm test:e2e   # 28개 통과 기준
```

---

## 진행 규칙

1. **T0 완료 후** 나머지 태스크 착수
2. 각 태스크 완료 즉시 체크박스 `✅` → `✅` 변경
3. T8 작업 중 파일이 500라인 초과하면 즉시 중단 후 분리 선행
4. 로직(훅, API 호출, 상태 관리) 코드 절대 수정 금지
5. 각 태스크 완료마다 타입 오류 없는지 확인

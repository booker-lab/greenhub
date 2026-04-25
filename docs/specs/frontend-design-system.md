# Green Love 프론트엔드 디자인 시스템 — 통합 문서

> 최초 확정: 2026-04-25 | 리팩토링 완료: 2026-04-25  
> Consumer (T0~T13) · Seller (ST1~ST17) · Driver (DT1~DT11) 전 구간 ✅  
> 통합: 2026-04-25 — 기존 4개 문서 병합 (`design-system.md`, `design-system-refactor-plan.md`, `seller-design-system-refactor-plan.md`, `driver-design-system-refactor-plan.md`)

---

## 1. 핵심 원칙

- **프라이머리 컬러 1개 원칙** — 보조색 지정 없음
- **로직 불변 원칙** — 디자인 리팩토링 시 비즈니스 로직·훅·API 코드 일절 수정 금지. UI 레이어만 변경
- **var() 단일 출처 원칙** — 모든 스타일 값은 `packages/ui/src/style.css` CSS 변수로만 참조. 컴포넌트 내 hex·숫자 하드코딩 금지
- **Mantine prop 하드코딩 금지** — `c="brand.6"`, `fw={700}` 등 Mantine 인라인 prop 금지. `style={{ color: 'var(--color-primary)' }}` 형태로 통일
- **그림자(shadow) 금지** — 카드·컨테이너는 border 방식. `boxShadow` 사용 금지

---

## 2. CSS 토큰 (`packages/ui/src/style.css`)

### 컬러

```css
/* 프라이머리 */
--color-primary:         #2D6A4F;   /* 버튼, 링크, 강조 */
--color-primary-dark:    #1B4332;   /* hover, pressed */
--color-primary-light:   #52B788;   /* 보조 강조 */
--color-primary-surface: #F2FBF6;   /* 그린 틴트 배경 */

/* 베이스 */
--color-bg:              #FFFFFF;
--color-surface-muted:   #f8f9fa;
--color-border:          #E8E8E8;
--border: 1px solid var(--color-border);

/* 텍스트 */
--color-text:            #111111;
--color-text-secondary:  #555555;
--color-text-disabled:   #AAAAAA;

/* 상태 */
--color-danger:          #e03131;
--color-danger-surface:  #fff5f5;
--color-status-info-bg:       #e7f5ff;
--color-status-info-text:     #1971c2;
--color-status-warning-bg:    #fff4e6;
--color-status-warning-text:  #e8590c;
--color-caution-bg:           #fffde7;
--color-caution-border:       #ffd43b;
```

### 타이포그래피

```css
--font-family: 'Pretendard Variable', Pretendard, -apple-system, system-ui, sans-serif;
--fw-light:  300;
--fw-medium: 500;
--fw-bold:   700;

--font-size-sm:  15px;   /* 최솟값 — 캡션, 보조 텍스트 */
--font-size-md:  16px;   /* 본문 */
--font-size-lg:  18px;   /* 소제목 */
--font-size-xl:  20px;   /* 제목 */
--font-size-2xl: 24px;   /* 페이지 타이틀 */
```

### 레이아웃

```css
--radius:      16px;
--radius-sm:   8px;
--radius-full: 9999px;
```

### 파일 구조

```
packages/ui/src/style.css         ← 공통 토큰 SSOT
apps/consumer/src/app/globals.css ← @import + consumer body padding
apps/seller/src/app/globals.css   ← @import + seller body padding
apps/driver/src/app/globals.css   ← @import + driver body padding
```

---

## 3. var() 통합 매핑표

| 기존 (변환 전) | 대체 토큰 |
|--------------|---------|
| `var(--mantine-color-white)` | `var(--color-bg)` |
| `var(--mantine-color-gray-0/1)` | `var(--color-surface-muted)` |
| `var(--mantine-color-gray-2/3)` | `var(--color-border)` / `var(--border)` |
| `var(--mantine-color-gray-4/5)` | `var(--color-text-disabled)` |
| `var(--mantine-color-gray-6/7)` | `var(--color-text-secondary)` |
| `var(--mantine-color-dark)` / `dark-7/8` | `var(--color-text)` |
| `var(--mantine-color-brand-*)` bg | `var(--color-primary-surface)` |
| `var(--mantine-color-brand-*)` text | `var(--color-primary)` |
| `var(--mantine-color-red-*)` | `var(--color-danger)` |
| `var(--green-primary)` | `var(--color-primary)` |
| `var(--green-pale)` | `var(--color-primary-surface)` |
| `var(--green-dark)` | `var(--color-primary-dark)` |
| `"white"` / `#fff` / `#ffffff` | `var(--color-bg)` |
| `#9CA3AF` | `var(--color-text-disabled)` |
| `#ef4444` / `#e03131` | `var(--color-danger)` |
| `c="dimmed"` | `style={{ color: 'var(--color-text-disabled)' }}` |
| `c="dark"` / `c="gray.8/9"` | `style={{ color: 'var(--color-text)' }}` |
| `c="gray.5/6/7"` | `style={{ color: 'var(--color-text-secondary)' }}` |
| `c="brand.6"` / `c="blue"` (상태) | `style={{ color: 'var(--color-primary)' }}` |
| `c="red.4"` | `style={{ color: 'var(--color-danger)' }}` |
| `c="white"` | `style={{ color: 'var(--color-bg)' }}` |
| `fw={500/600}` | `style={{ fontWeight: 'var(--fw-medium)' }}` |
| `fw={700/800/900}` | `style={{ fontWeight: 'var(--fw-bold)' }}` |
| `size="xs"` / `size="sm"` on Text | size prop 제거 + `style={{ fontSize: 'var(--font-size-sm)' }}` |
| `fz={11/12}` / `fz="xs"` | `style={{ fontSize: 'var(--font-size-sm)' }}` |
| `fz={20}` / `fz="xl"` | `style={{ fontSize: 'var(--font-size-xl)' }}` |
| `Paper shadow="sm"` | shadow 제거 + `style={{ border: 'var(--border)' }}` |
| `boxShadow:` (카드·내비) | 제거 + `border: 'var(--border)'` |

---

## 4. 예외 규칙 (변경 금지 항목)

| 항목 | 위치 | 이유 |
|------|------|------|
| `#FEE500`, `#191919` | 모든 앱 로그인·프로필 | 카카오 브랜드 컬러 |
| `#000` / `backgroundColor: "#000"` | driver photo/page.tsx | 카메라 뷰파인더 배경 |
| `linear-gradient` (헤더·하단) | driver photo/page.tsx | 카메라 캡처 오버레이 |
| `viewport.themeColor: "#2D6A4F"` | driver layout.tsx | 브라우저 UI meta |
| `color=` prop on Button/Badge | 전체 | Mantine 테마 연동 |
| `COLOR_CHIPS` hex 배열 | consumer category/page.tsx | 꽃 색상 데이터 |

---

## 5. 아이콘

- **전용 세트**: `lucide-react` 단독 사용
- `←` 텍스트 버튼 → `<ChevronLeft size={20} />`
- 커스텀 검색 SVG → `<Search />`
- 다른 아이콘 라이브러리 추가 금지

---

## 6. 리팩토링 완료 현황

### Consumer — T0~T13 ✅ (2026-04-25)

| 태스크 | 대상 | 비고 |
|--------|------|------|
| T0 | `packages/ui/src/style.css` 시맨틱 토큰 보강 | 전 앱 공통 선행 |
| T1 | `components/GreenLoveBrandSection.tsx` | gradient → flat |
| T2 | `app/login/page.tsx` | 카카오 예외 적용 |
| T3 | `app/order/success/page.tsx` | |
| T4 | `app/search/page.tsx` | SVG → Lucide |
| T5 | `app/cart/page.tsx` | |
| T6 | `app/category/page.tsx` | COLOR_CHIPS 유지 |
| T7 | `app/checkout/page.tsx` | |
| T8 | `app/products/[id]/page.tsx` (495줄) | GroupStatusBox 분리 |
| T9 | `app/mypage/_client.tsx` | STATUS_COLORS 토큰화 |
| T10 | `app/mypage/notifications/_client.tsx` | `←` → Lucide |
| T11 | `app/mypage/addresses/_client.tsx` | `←` → Lucide |
| T12 | `app/mypage/orders/[id]/_client.tsx` | `←` → Lucide |
| T13 | tsc + e2e 검증 | 0 errors |

### Seller — ST1~ST17 ✅ (2026-04-25)

| 단계 | 태스크 | 대상 |
|------|--------|------|
| 1 공통 기반 | ST1~ST5 | layout · BottomNav · login · onboarding · root |
| 2 상품 관리 | ST6~ST9 | products 페이지 + 컴포넌트 7개 |
| 3 운영 화면 | ST10~ST13 | orders · settlements · settings 3개 |
| 4 허브·어드민 | ST14~ST16 | hubs 4개 · admin 6개 |
| 5 검증 | ST17 | tsc 0 errors |

### Driver — DT1~DT11 ✅ (2026-04-25)

| 단계 | 태스크 | 대상 |
|------|--------|------|
| 1 공통 기반 | DT1~DT3 | layout · BottomNav · OrderCard |
| 2 인증 | DT4~DT5 | login · providers |
| 3 배달 현황 | DT6~DT8 | board 탭 · 주문상세 · 카메라 |
| 4 지도·프로필 | DT9~DT10 | map · profile |
| 5 검증 | DT11 | tsc 0 errors · grep 잔존 0건 |

---

## 7. E2E 검증

```bash
# 전체 실행
pnpm test:e2e

# 앱별 실행
pnpm test:e2e -- --grep "컨슈머"
pnpm test:e2e -- --grep "셀러 디자인 시스템"
pnpm test:e2e -- --grep "드라이버 디자인 시스템"
```

| 스펙 파일 | 인증 조건 |
|----------|----------|
| `consumer-home.spec.ts` | 불필요 |
| `consumer-groupbuy.spec.ts` | 불필요 |
| `seller-design-system.spec.ts` | `TEST_SELLER_EMAIL` / `TEST_SELLER_PASSWORD` |
| `driver.spec.ts` | 없음 (Kakao OAuth) |
| `driver-design-system.spec.ts` | 공개 테스트 즉시 가능 · 인증 화면은 `DRIVER_SESSION_COOKIE` 필요 |

**DRIVER_SESSION_COOKIE 준비**: 브라우저 로그인 후 DevTools → Application → Cookies → `next-auth.session-token` 값 복사, JSON 배열로 구성.

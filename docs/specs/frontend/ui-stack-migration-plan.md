# Mantine → shadcn/ui + Tailwind CSS v4 + Base UI 교체 계획

> 작성 2026-10-28. 상태: **계획(미착수)**. 사용자가 비용을 감수하고 교체하기로 했다(2026-10-28).
> 화면을 어떻게 바꿀지는 `design-direction.md`(제안)를 따르고, 확정 전까지 시각 계약은 `design-standard.md`다.
> 이 문서는 `*-plan.md`이므로 교체가 끝나면 역사 자료가 된다. 끝난 뒤의 규칙은 `design-standard.md`와 `packages/ui`가 소유한다.

## 1. 대상 버전

2026-10-28 npm registry와 shadcn 문서 원본(github.com/shadcn-ui/ui `apps/v4/content/docs`, 2026-10-27 커밋)에서 직접 확인했다.

| 패키지 | 버전 | 비고 |
|---|---|---|
| `shadcn` (CLI) | 4.23.0 | `init -b base`(Base UI)·`--monorepo` 지원. `-b`는 `base`·`radix`·`aria` 중 하나 |
| `tailwindcss` / `@tailwindcss/postcss` | 4.3.3 | Tailwind v4. `components.json`의 `tailwind.config`는 비워 둔다 |
| `@base-ui/react` | 1.9.0 | 옛 이름 `@base-ui-components/react`는 deprecated |
| `tailwind-merge` / `class-variance-authority` | 3.7.0 / 0.7.1 | `cn()`·variant 정의 |
| `tw-animate-css` | 1.4.0 | shadcn 기본 애니메이션 |
| `sonner` | 2.0.8 | 알림(toast) |
| `lucide-react` | 1.63.0 | 이미 consumer·seller가 사용 중 |
| 비교: `@mantine/core` | 9.7.4 | 현행 |

이 세션에서는 `ui.shadcn.com`에 접근할 수 없어 GitHub의 문서 원본으로 확인했다. P1에서 `npx shadcn@latest init`을 실행할 때 실제 출력으로 다시 확인한다.

## 2. 현재 범위 (2026-10-28 `main` 기준 직접 집계)

- `@mantine/*`를 import하는 파일: consumer 51, seller 121(어드민 포함), driver 12, `packages/ui` 1. 합계 약 185개.
- 많이 쓰는 컴포넌트(import 횟수): Text 128, Stack 103, Box 84, Group 79, Button 75, Paper 55, Container 43, Title 35, TextInput 24, Badge 24, UnstyledButton 19, Textarea 11, Alert 10, SimpleGrid 8, Modal 7, Divider 6.
- 적게 쓰는 컴포넌트: Select·Radio·Checkbox·Loader·ActionIcon 각 4~5, PasswordInput 3, Card 3, Switch·Skeleton·Anchor 각 2, Stepper(consumer 주문 상세), Progress·NumberInput·List·Drawer·Autocomplete 각 1.
- `@mantine/notifications`: 16개 파일(seller·driver). `@mantine/hooks`: seller 어드민 2개 파일.
- 앱 설정: 세 앱의 `postcss-preset-mantine`·`postcss-simple-vars`, `globals.css`의 Mantine 선택 CSS import, `layout.tsx`의 `ColorSchemeScript`, `providers.tsx`의 `MantineProvider`.
- 공용: `packages/ui/src/theme.ts`(Mantine 테마·variant 색 보정), `style.css`(CSS 변수, Badge 한글 잘림 보정 `.m_5add502a`).
- E2E: `.mantine-*` 클래스 선택자를 쓰는 spec이 8개다. `admin-local-store-archive`, `admin-local-settlements`, `admin-local-invite`, `admin-local-orders`, `seller-orders`, `consumer-groupbuy`, `driver-design-system`, `perf-css-regression`. 나머지 spec은 `getByRole`·`getByText`·`getByLabel` 위주라 컴포넌트를 교체해도 깨지지 않는다.

## 3. 목표 구조

shadcn 모노레포 구성을 따르되, 패키지 이름은 지금처럼 `@greenhub/ui`로 둔다.

```txt
packages/ui
├── components.json          # style·iconLibrary(lucide)·baseColor를 앱과 같게
├── src/styles/globals.css   # Tailwind·토큰·@theme inline (§4)
├── src/components/*.tsx     # shadcn CLI가 설치한 Base UI 컴포넌트 + 우리 variant
├── src/lib/utils.ts         # cn()
├── fonts/                   # Pretendard (현행 유지)
└── brand/                   # 로고·아이콘 원본 (현행 유지)
apps/{consumer,seller,driver}
├── components.json          # aliases.ui = "@greenhub/ui/components", utils = "@greenhub/ui/lib/utils"
├── postcss.config.mjs       # { plugins: { "@tailwindcss/postcss": {} } }
└── src/app/globals.css      # @import "@greenhub/ui/styles/globals.css" + 앱 전용 규칙
```

- 컴포넌트는 앱 폴더에서 `npx shadcn@latest add <name>`을 실행해 설치한다. CLI가 `packages/ui`에 설치하고 import 경로를 맞춘다.
- Tailwind v4의 자동 클래스 탐색은 `node_modules` 아래(워크스페이스 링크 포함)를 보지 않는다. 앱 CSS에 `@source "../../../../packages/ui/src";`처럼 공용 컴포넌트 경로를 명시해야 한다. 정확한 상대 경로는 P1에서 빌드 결과로 확인한다.
- `packages/ui`의 `exports`에 `./components/*`, `./lib/*`, `./styles/globals.css`를 추가한다. 기존 `./fonts/pretendard.css`는 유지하고, `./theme`과 `./style.css`는 P5에서 제거한다.

## 4. 토큰 대응

P1에서는 **값을 하나도 바꾸지 않고 이름만 대응**시킨다. 기존 hex 값을 그대로 쓴다(shadcn 기본은 OKLCH이지만 hex도 유효하다). 값 변경은 `design-direction.md` 확정 뒤 별도 PR로 한다.

| 현행 변수 | shadcn 의미 변수 | Tailwind 예 |
|---|---|---|
| `--color-bg` `#FFFFFF` | `--background` | `bg-background` |
| `--color-text` `#111111` | `--foreground` | `text-foreground` |
| `--color-primary` `#00A65A` | `--primary` (+ `--primary-foreground` `#FFFFFF`) | `bg-primary` |
| `--color-primary-dark` `#007A43` | `--brand-ink` (추가) | `text-brand-ink` |
| `--color-primary-surface` `#E9F9EF` | `--brand-surface` (추가) | `bg-brand-surface` |
| `--color-surface-muted` `#F1F3F2` | `--muted` / `--secondary` | `bg-muted` |
| `--color-text-secondary` `#6B716E` | `--muted-foreground` | `text-muted-foreground` |
| `--color-border` `#ECEFED` | `--border`, `--input` | `border-border` |
| `--color-danger` / `-surface` | `--destructive` / `--destructive-surface` (추가) | `text-destructive` |
| `--color-deadline` / `-surface` / `-text` | `--deadline` / `--deadline-surface` / `--deadline-foreground` (추가) | `bg-deadline` |
| `--color-status-*` | `--status-info*`, `--status-warning*` (추가) | `bg-status-warning` |
| 초점 링 | `--ring` = `--color-primary-dark` | `ring-ring` |
| `--radius` 16px | `--radius` 16px | `rounded-lg`(= `--radius`) |
| `--radius-full` | Tailwind `rounded-full` | 버튼·칩·검색창 |
| `--font-family` | `--font-sans` | `font-sans` |
| `--font-brand` | `--font-brand` (추가) | `font-brand` |

**글자 크기 주의**: Tailwind 기본값은 `text-xs` 12px, `text-sm` 14px라 그대로 쓰면 15px 본문 기준보다 작아진다(Mantine 때도 같은 문제를 `fontSizes`로 막았다). `@theme`에서 다음처럼 덮어쓴다.

```css
@theme {
  --text-xs: 13px;   /* 굵은 태그·배지 전용 */
  --text-sm: 15px;   /* 설명·본문 */
  --text-base: 16px;
  --text-lg: 18px;
  --text-xl: 20px;
  --text-2xl: 24px;
}
```

shadcn의 반경 단계(`--radius-sm` = 0.6배 등)는 `--radius` 16에서 계산된다. 버튼은 shadcn 기본(`rounded-md`)이 아니라 `rounded-full`로 우리 variant에서 고정한다.

## 5. 컴포넌트 대응

| Mantine | 교체 대상 | 메모 |
|---|---|---|
| Stack · Group · Box · Container · SimpleGrid | `div` + Tailwind(`flex flex-col gap-4`, `grid grid-cols-2`) | 가장 많은 수를 차지하지만 기계적으로 바꿀 수 있다 |
| Text · Title | `p`·`h1~h3` + 글자 유틸리티 | 제목 단계(22/18/16)는 `design-standard.md` §3 |
| Paper · Card | `Card` 또는 바탕색 `div` | 테두리를 걷을지는 `design-direction.md` D2 |
| Button · UnstyledButton · ActionIcon | `Button`(variant: default·outline·ghost, size: default·sm·icon) | 완전히 둥글게, 아이콘 버튼은 `aria-label` 필수 |
| TextInput · Textarea · PasswordInput | `Field` + `Input` / `Textarea` / `InputGroup` | 오류 문구는 `FieldError`로 입력칸과 연결 |
| NumberInput | `Input type="number" inputMode="numeric"` 또는 Base UI NumberField | 사용처 1곳 |
| Select | 휴대폰 폼은 `NativeSelect`, 그 외는 `Select` | 휴대폰에서 OS 기본 선택기가 쓰기 쉽다 |
| Autocomplete | `Combobox` | 사용처 1곳 |
| Checkbox · Radio · Switch | `Checkbox` · `RadioGroup` · `Switch` | 결제 확인 체크박스는 E2E 계약 이름을 유지 |
| Badge | `Badge` + 주문 상태 variant | Badge 한글 잘림 보정은 Mantine 전용이라 사라진다. 교체 뒤 한글 배지를 눈으로 확인한다 |
| Alert | `Alert` | |
| Modal / Drawer | `Dialog` / `Drawer`·`Sheet` | 초점 이동은 컴포넌트에 맡기고 직접 `focus()`를 호출하지 않는다 |
| Loader · Skeleton · Progress | `Spinner` · `Skeleton` · `Progress` | |
| Divider | `Separator` | |
| Anchor | `next/link` + 링크 클래스 | |
| Stepper | 직접 만든다(`ol` + 단계 상태) | shadcn에 없다. consumer 주문 상세 1곳 |
| List | `ul`·`ol` | |
| `@mantine/notifications` | `sonner`(`Toaster` + `toast()`) | 16개 파일 |
| `@mantine/hooks` | 직접 작성하거나 React 기본 API | 2개 파일 |
| MantineProvider · ColorSchemeScript | 제거 | 다크 모드를 지원하지 않으므로 `next-themes`도 넣지 않는다 |

## 6. 단계

각 단계는 독립적으로 병합할 수 있는 PR(또는 PR 묶음) 하나다. 앞 단계가 병합된 `main`에서 다음 단계를 시작한다.

### P0. 사전 준비 (Mantine 상태에서)
- `.mantine-*` 선택자를 쓰는 E2E spec 8개(§2)를 역할·라벨·`data-testid` 선택자로 바꾸고, Mantine 화면에서 그대로 통과하는지 확인한다.
- `scripts/visual/`로 세 앱의 주요 화면 기준 스크린샷을 찍어 둔다.

### P1. 기반 (화면 변화 없음)
- `packages/ui`에 Tailwind v4와 shadcn(`-b base`)을 초기화하고 §4 토큰을 넣는다. 처음 쓸 컴포넌트(Button·Input·Field·Card·Badge·Dialog·Sheet·Sonner·Skeleton)를 설치한다.
- 세 앱의 PostCSS에 `@tailwindcss/postcss`를 추가한다. 교체 기간에는 Mantine과 같이 둔다.
- 같이 두는 동안의 CSS 우선순위: Mantine CSS를 cascade layer로 감싸(`@import "..." layer(mantine);`) Tailwind 유틸리티보다 아래에 둔다. Tailwind preflight와 Mantine baseline이 같은 요소를 다르게 초기화하지 않는지 확인한다. 실제 동작은 P1에서 빌드와 스크린샷으로 확인한다.
- 완료 기준: 세 앱의 스크린샷이 P0 기준과 같고, `pnpm build`가 통과하고, CSS 번들 크기 증가를 기록한다.

### P2. 기사 앱 (12개 파일)
- 가장 작은 앱으로 교체 방식(컴포넌트 대응, sonner, 휴대폰 레이아웃)을 먼저 검증한다.
- `design-direction.md` §6이 확정됐으면 같이 적용한다.

### P3. 소비자 앱 (51개 파일)
- 회차 구매 동선 순서(홈 → 상품 상세 → 장바구니 → 결제 → 주문 완료 → 내 주문)대로 나눠 진행한다. 그다음 마이페이지·법정 고지·예전 판매 화면을 바꾼다.
- 예전 판매(legacy·공동구매) 화면은 컴포넌트만 바꾸고 구성은 바꾸지 않는다(`design-standard.md` §5).

### P4. 판매자·어드민 (121개 파일)
- 여러 PR로 나눈다: 앱 틀(사이드바·상단바) → 회차·주문 → 상품·재고 → 정산·설정 → 어드민.

### P5. 정리
- 세 앱과 `packages/ui`에서 `@mantine/*`, `postcss-preset-mantine`, `postcss-simple-vars`, `theme.ts`, `style.css`의 Mantine 보정을 제거한다.
- `design-standard.md`의 값 정본 표기(`theme.ts`)를 새 위치로 바꾸고, 앱별 `AGENTS.md`의 글꼴 크기 예외 표를 새 컴포넌트 이름으로 갱신한다.
- `docs/specs/perf/mantine-treeshaking.md`는 역사 자료로 표시한다.

## 7. 화면 변경을 같이 할지

| 방법 | 내용 | 장단점 |
|---|---|---|
| A. 외형 유지 먼저 | 컴포넌트만 바꿔 같은 외형을 만든 뒤, 화면 방향은 다시 따로 적용한다 | 스크린샷 비교로 회귀를 잡기 쉽다. 같은 화면을 두 번 고친다 |
| B. 화면별로 한 번에 (권장) | 화면 하나를 교체할 때 `design-direction.md`도 같이 적용한다 | 작업이 한 번이다. 외형 회귀는 스크린샷 대신 §7 검수 기준으로 보고, 동작은 E2E로 지킨다 |

B를 고르려면 `design-direction.md` §8 결정이 해당 앱의 교체보다 먼저 확정돼야 한다.

## 8. 일정 제약

첫 회차는 주문이 2026-11-22 10:00에 열리고 12/1에 배송한다(2026-10-28 결정, `docs/BACKLOG.md`). 그 전에 카카오페이 연동 심사가 심사용 "11월 특별 회차"(10/28~11/11)로 진행 중이다. 다음을 제안한다.

- 심사 기간(~11/11)에는 소비자 결제 동선(상품 상세 → 장바구니 → 결제 → 주문 완료)의 교체를 운영에 배포하지 않는다. 심사자가 보는 화면이 바뀌지 않게 하기 위해서다.
- 소비자·기사 화면 교체를 주문 오픈 전에 운영에 내보내려면, 그 SHA로 회차 출시 E2E(chromium·mobile 52건)를 다시 통과해야 한다.
- 주문 오픈(11/22)부터 배송 완료(12/1)까지는 소비자·기사 화면 교체를 운영에 배포하지 않는다. 판매자 화면도 회차 운영 중이면 같은 기준을 둔다.
- 교체 작업과 병합은 계속하되, 배포는 회차 사이 기간에 모아서 한다.

## 9. 단계별 검증

- 로컬: `pnpm typecheck`, `pnpm lint`(Biome), 바뀐 앱의 단위 테스트, `pnpm build`, 필요하면 운영 빌드(`next start`)로 화면 확인.
- 화면: `scripts/visual/` 스크린샷(390·768·1440px, 기사는 390px)과 `design-direction.md` §7 검수 기준.
- E2E: 로컬 E2E로 바뀐 앱의 spec을 확인한다. 원격 Preview·E2E는 병합을 모은 최종 `main` SHA로 배포 직전에 1회만 실행한다(`AGENTS.md` §0-9).
- 성능: 앱별 JS·CSS 번들 크기를 교체 전후로 기록한다(`docs/specs/perf/bundle-optimization.md` 기준).

## 10. 결정이 필요한 것

| # | 결정 | 제안 |
|---|---|---|
| M1 | 화면 변경을 같이 할지(§7) | B. 화면별로 한 번에 |
| M2 | 배포 동결 기간(§8) | 카카오페이 심사 기간(~11/11)에는 소비자 결제 동선, 11/22 주문 오픈 ~ 12/1 배송 완료에는 소비자·기사 교체 배포 금지 |
| M3 | 교체 순서 | 기사 → 소비자 → 판매자·어드민 |
| M4 | 스킬을 저장소에 넣을지 | Taste Skill만 `.claude/skills/`에 넣어 클라우드 세션에서도 `inspect.mjs` 검수를 쓰게 한다. UI UX Pro Max는 함께 설치되는 shadcn 설치 스킬(`ui-styling`)과 외부 이미지 API 스킬이 섞여 있어 넣지 않는다 |

# Mantine → shadcn/ui + Tailwind CSS v4 + Base UI 교체 계획

> 작성 2026-10-28. 상태: **P0 완료(#684), P0.5 완료(#687), P1 완료(#689), P2a 로컬 증명 완료(병합 전)**. 사용자가 비용을 감수하고 교체하기로 했다(2026-10-28). M1~M4(§10)는 검토 3라운드(§11)를 거쳐 2026-10-30 사용자가 확정했고, 같은 날 M2·M3을 다시 정했다(§10).
> 요약: 첫 회차는 교체가 끝난 뒤로 미룬다. 교체는 지금부터 단계마다 증명이 끝나는 대로 `main`에 병합한다. 카카오페이 심사·LIVE 결제 전환·실결제 확인 전까지는 소비자 앱 화면만 묶는다.
> 화면을 어떻게 바꿀지는 `design-direction.md`(부분 확정)를 따르고, 그 문서에서 확정되지 않은 부분의 시각 계약은 `design-standard.md`다.
> 이 문서는 `*-plan.md`이므로 교체가 끝나면 역사 자료가 된다. 끝난 뒤의 규칙은 `design-standard.md`와 `packages/ui`가 소유한다.

## 1. 대상 버전

2026-10-28 npm registry와 shadcn 문서 원본(github.com/shadcn-ui/ui `apps/v4/content/docs`, 2026-10-27 커밋)에서 직접 확인했다.

| 패키지 | 버전 | 비고 |
|---|---|---|
| `shadcn` (CLI) | 4.23.0 | `init -b base`(Base UI)·`--monorepo` 지원. `-b`는 `base`·`radix`·`aria` 중 하나 |
| `tailwindcss` / `@tailwindcss/postcss` | 4.3.3 | Tailwind v4. `components.json`의 `tailwind.config`는 비워 둔다 |
| `@base-ui/react` | 1.9.0 | 옛 이름 `@base-ui-components/react`는 deprecated |
| `cn` / `class-variance-authority` / `shadcn` | P1에서 확인 / 0.7.1 / 4.23.0 | 2026-10-27 문서 원본의 수동 설치는 `shadcn class-variance-authority cn lucide-react tw-animate-css`다(`installation/manual.mdx`). `cn()`은 `tailwind-merge`가 아니라 `cn` 패키지를 쓰고, `shadcn` 패키지도 실행 의존성(`shadcn/tailwind.css`)이다. 실제 목록은 P1의 CLI 출력으로 확정한다 |
| `tw-animate-css` | 1.4.0 | shadcn 기본 애니메이션. `shadcn/tailwind.css`(열림·닫힘 변형)와 함께 import한다 |
| (알림) | — | `-b base`의 알림은 shadcn `toast`(Base UI Toast, `@base-ui/react`)다. Base UI 문서 목록에 `sonner`는 없다. radix·aria용 `sonner`는 `next-themes`를 같이 설치하므로 쓰지 않는다(§5 다크 모드 없음). 호출은 `toast.add(...)`다(`components/base/toast.mdx`) |
| `lucide-react` | 1.63.0 | 이미 consumer·seller가 사용 중 |
| 비교: `@mantine/core` | 9.7.4 | 현행 |

이 세션에서는 `ui.shadcn.com`에 접근할 수 없어 GitHub의 문서 원본으로 확인했다. P1에서 `npx shadcn@latest init`을 실행할 때 실제 출력으로 다시 확인한다.

## 2. 현재 범위 (2026-10-28 `main` 기준 직접 집계)

- `@mantine/*`를 import하는 파일: consumer 51, seller 121(어드민 포함), driver 12, `packages/ui` 1. 합계 약 185개.
- 2026-10-30 다시 세면 seller는 테스트를 뺀 ts/tsx 119개다. 단계별 범위는 각 PR에서 다시 센다.
- 많이 쓰는 컴포넌트(import 횟수): Text 128, Stack 103, Box 84, Group 79, Button 75, Paper 55, Container 43, Title 35, TextInput 24, Badge 24, UnstyledButton 19, Textarea 11, Alert 10, SimpleGrid 8, Modal 7, Divider 6.
- 적게 쓰는 컴포넌트: Select·Radio·Checkbox·Loader·ActionIcon 각 4~5, PasswordInput 3, Card 3, Switch·Skeleton·Anchor 각 2, Stepper(consumer 주문 상세), Progress·NumberInput·List·Drawer·Autocomplete 각 1.
- `@mantine/notifications`: 17개 소스 파일(seller 15·driver 2), 그 밖에 `next.config.ts` 2곳(P6 제거 대상). seller `layout.tsx`는 `@mantine/notifications/styles.css`를 JS에서 import한다. `@mantine/hooks`: seller 어드민 2개 파일.
- 앱 설정: 세 앱의 `postcss-preset-mantine`·`postcss-simple-vars`, `globals.css`의 Mantine 선택 CSS import, `layout.tsx`의 `ColorSchemeScript`, `providers.tsx`의 `MantineProvider`.
- 공용: `packages/ui/src/theme.ts`(Mantine 테마·variant 색 보정), `style.css`(CSS 변수, Badge 한글 잘림 보정 `.m_5add502a`).
- E2E: `.mantine-*` 클래스 선택자를 쓰는 spec이 8개다. `admin-local-store-archive`, `admin-local-settlements`, `admin-local-invite`, `admin-local-orders`, `seller-orders`, `consumer-groupbuy`, `driver-design-system`, `perf-css-regression`. 나머지 spec은 `getByRole`·`getByText`·`getByLabel` 위주라 컴포넌트를 교체해도 깨지지 않는다.

## 3. 목표 구조

shadcn 모노레포 구성을 따르되, 패키지 이름은 지금처럼 `@greenhub/ui`로 둔다.

```txt
packages/ui
├── components.json          # style·iconLibrary(lucide)·baseColor를 앱과 같게
├── src/styles/tokens.css    # 토큰·@theme inline만 (§4). `@import "tailwindcss"` 없음 — Mantine과 같이 쓰는 동안 앱이 import
├── src/styles/globals.css   # CLI가 만드는 파일(`@import "tailwindcss"` 포함). Mantine을 걷어낸 뒤(P6)부터 앱이 import
├── src/components/*.tsx     # shadcn CLI가 설치한 Base UI 컴포넌트 + 우리 variant
├── src/lib/utils.ts         # cn()
├── fonts/                   # Pretendard (현행 유지)
└── brand/                   # 로고·아이콘 원본 (현행 유지)
apps/{consumer,seller,driver}
├── components.json          # aliases.ui = "@greenhub/ui/components", utils = "@greenhub/ui/lib/utils"
├── postcss.config.mjs       # { plugins: { "@tailwindcss/postcss": {} } }
└── src/app/globals.css      # layer 순서 + Tailwind theme·utilities + tokens.css + 앱 전용 규칙 (P2 참고)
```

- 컴포넌트는 앱 폴더에서 `npx shadcn@latest add <name>`을 실행해 설치한다. CLI가 `packages/ui`에 설치하고 import 경로를 맞춘다.
- Tailwind v4의 자동 클래스 탐색은 `node_modules` 아래(워크스페이스 링크 포함)를 보지 않는다. 앱 CSS에 `@source "../../../../packages/ui/src";`처럼 공용 컴포넌트 경로를 명시해야 한다. 정확한 상대 경로는 P1에서 빌드 결과로 확인한다.
- `packages/ui`의 `exports`에 `./components/*`, `./lib/*`, `./styles/tokens.css`, `./styles/globals.css`를 추가한다. 기존 `./fonts/pretendard.css`는 유지하고, `./theme`과 `./style.css`는 P6에서 제거한다.
- CLI의 `globals.css`는 `@import "tailwindcss"`(preflight 포함)로 시작한다(`theming.mdx`). 같이 쓰는 동안 앱이 이 파일을 import하면 preflight가 Mantine 화면에 걸린다. 그래서 토큰만 담은 `tokens.css`를 따로 두고, 앱이 CLI `globals.css`를 import하지 않는지 검사한다.

## 4. 토큰 대응

P1에서는 **값을 하나도 바꾸지 않고 이름만 대응**시킨다. 기존 hex 값을 그대로 쓴다(shadcn 기본은 OKLCH이지만 hex도 유효하다). 값 변경은 Mantine과 같이 쓰는 동안 `theme.ts`·`style.css`와 새 `globals.css` 양쪽을 한 PR에서 바꿔야 하므로, 소비자 동결(§8)이 끝난 뒤에 한다.

**기존 변수와 이름이 겹친다.** 현행 `style.css`와 shadcn·Tailwind가 같은 이름을 다른 뜻으로 쓴다. 기존 변수를 쓰는 앱 파일(소비자 포함)을 고치지 않도록, 새 쪽이 기존 이름·값에 맞춘다.

| 이름 | 현행 | shadcn·Tailwind | 처리 |
|---|---|---|---|
| `--border` | 색이 아니라 `1px solid var(--color-border)` 묶음 값(`style.css`:37). 앱 코드 40곳이 `border: var(--border)`로 쓴다 | 테두리 **색**, `@theme inline { --color-border: var(--border) }` | 새 `globals.css`에서 `--border`를 정의하지 않는다. `--color-border`를 기존과 같은 `#ECEFED`로 직접 둔다. CLI가 `--border`를 써 넣으면 지우고, 그런 정의를 막는 검사를 P1에 둔다 |
| `--radius-sm` | 8px(`style.css`:34) | `calc(var(--radius) * 0.6)` = 9.6px | `@theme`에서 8px로 고정한다 |
| 반경 단계 | Mantine Card·Paper 16px | `--radius` 16에서 md 12.8px·xl 22.4px 등으로 계산(`theming.mdx`) | 우리 variant에서 Mantine 값으로 고정한다. shadcn 기본 반경에서 생긴 차이는 ①의 허용 사유가 되지 못한다(§7) |
| `--color-primary` | `#00A65A`(브랜드 초록, Mantine 쪽 사용처 다수) | `bg-primary`가 읽는 이름 | 버튼 면을 `#007A43`으로 바꿀 때 같은 이름에 두 값이 생긴다. `@theme inline`으로 유틸리티가 `--primary`를 직접 읽게 하고, Tailwind 출력의 `:root`에 기존 이름이 다른 값으로 나오지 않는지 P1 빌드 결과로 확인한다(출력 방식은 추측, P1에서 확인) |
| `--color-*` (`--color-primary`, `--color-bg` 등) | Mantine 쪽 값 | Tailwind 색 이름 공간 | 같은 이름은 같은 값으로만 정의한다. 값을 바꿀 때는 양쪽을 한 PR에서 바꾼다 |
| 줄 높이 | Mantine 기본 xs 1.4·sm 1.45·md 1.55·lg 1.6·xl 1.65(`@mantine/core` default theme, `theme.ts`는 덮어쓰지 않음) | Tailwind 기본(`text-sm` 1.4286 등) | `--text-*--line-height`를 Mantine 값으로 같이 고정한다 |

| 현행 변수 | shadcn 의미 변수 | Tailwind 예 |
|---|---|---|
| `--color-bg` `#FFFFFF` | `--background` | `bg-background` |
| `--color-text` `#111111` | `--foreground` | `text-foreground` |
| `--color-primary` `#00A65A` | `--primary` (+ `--primary-foreground` `#FFFFFF`) | `bg-primary` |
| (추가) 버튼 면 `#007A43` | P1 뒤 값 변경 PR에서 `--primary`를 `#007A43`으로 바꾸고, `#00A65A`는 `--brand`(머리띠·선택 표시·진행 막대)로 옮긴다 | `bg-primary`, `bg-brand` |
| `--color-primary-dark` `#007A43` | `--brand-ink` (추가) | `text-brand-ink` |
| `--color-primary-surface` `#E9F9EF` | `--brand-surface` (추가) | `bg-brand-surface` |
| `--color-surface-muted` `#F1F3F2` | `--muted` / `--secondary` | `bg-muted` |
| `--color-text-secondary` `#6B716E` | `--muted-foreground` | `text-muted-foreground` |
| `--color-border` `#ECEFED` | `--color-border`를 같은 값으로 직접 정의(`--border`는 쓰지 않음, 위 충돌 표), `--input` | `border-border` |
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

버튼은 shadcn 기본(`rounded-md`)이 아니라 `rounded-full`로 우리 variant에서 고정한다.

## 5. 컴포넌트 대응

| Mantine | 교체 대상 | 메모 |
|---|---|---|
| Stack · Group · Box · Container · SimpleGrid | `div` + Tailwind(`flex flex-col gap-4`, `grid grid-cols-2`) | 가장 많은 수를 차지하지만 기계적으로 바꿀 수 있다 |
| Text · Title | `p`·`h1~h3` + 글자 유틸리티 | 제목 단계(22/18/16)는 `design-standard.md` §3 |
| Paper · Card | `Card` 또는 바탕색 `div` | 테두리를 걷을지는 `design-direction.md` D2 |
| Button · UnstyledButton · ActionIcon | `Button`(variant: default·outline·ghost, size: default·sm·icon) | 완전히 둥글게, 아이콘 버튼은 `aria-label` 필수 |
| TextInput · Textarea · PasswordInput | `Field` + `Input` / `Textarea` / `InputGroup` | 오류 문구는 `FieldError`로 입력칸과 연결 |
| NumberInput | `Input type="number" inputMode="numeric"` 또는 Base UI NumberField | 사용처 1곳 |
| Select | 휴대폰 폼은 `NativeSelect`, 그 외는 `Select` | 휴대폰에서 OS 기본 선택기가 쓰기 쉽다. UI UX Pro Max `shadcn.csv`:21은 native select를 피하라고 하지만 이 결정을 유지한다 |
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
| `@mantine/notifications` | shadcn `toast`(Base UI Toast) | 17개 파일. `notifications.show(...)`를 `toast.add(...)`로 파일마다 바꾼다 |
| `@mantine/hooks` | 직접 작성하거나 React 기본 API | 2개 파일 |
| MantineProvider · ColorSchemeScript | 제거 | 다크 모드를 지원하지 않으므로 `next-themes`도 넣지 않는다 |

## 6. 단계

각 단계는 독립적으로 병합할 수 있는 PR(또는 PR 묶음)이다. 앞 단계가 병합된 `main`에서 다음 단계를 시작한다. 2026-10-30 결정(§10 M2·M3)으로 단계마다 증명이 끝나는 대로 병합한다. P1이 병합되면 P2(판매자)와 P3(기사)는 서로 다른 앱이라 브랜치를 나눠 병렬로 진행할 수 있다. P4는 P2a(판매자 연결) 뒤, P5(소비자)는 소비자 동결이 풀린 뒤다.

| 단계 | 내용 | `main` 병합 |
|---|---|---|
| P0 | E2E 선택자 정리 | 완료(#684) |
| P0.5 | 증명 도구(축소) | 완료(#687) |
| P1 | `packages/ui` 기반 | 증명이 끝나는 대로(세 앱 촬영 차이 0) |
| P2 | 판매자 앱 연결(P2a) → 판매자 비회차 화면(P2b) | P1 뒤 |
| P3 | 기사 앱 | P1 뒤(P2와 병렬) |
| P4 | 판매자 앱 틀·회차·주문·준비·재고·정산 | P2a 뒤 |
| P5 | 소비자 앱 | 소비자 동결이 풀린 뒤(§8) |
| P6 | 정리 | 마지막 |

### P0. 사전 준비 (Mantine 상태에서)
- `.mantine-*` 클래스로 요소를 찾던 E2E를 역할·이름 기반 선택자로 바꾼다. Mantine 클래스 이름은 교체와 함께 사라지기 때문이다.
  - 어드민 모바일 카드 목록(가게·초대 기록·주문)은 `role="list"`/`listitem`을 붙이고, 테스트는 `tests/_helpers/admin-local.ts`의 `rowOrListItem`(표의 행 또는 목록 항목)으로 찾는다.
  - 정산 합계 카드는 `정산 합계` group 안의 카드별 group으로 찾는다.
  - 판매자 주문 탭은 `SegmentedTabs`의 `ariaLabel`("주문 상태") group 안의 버튼 글자로 건수를 확인한다.
  - 공동구매 진행률은 `progressbar` 역할로, 성능 회귀의 Badge 확인은 홈 상품 상태 태그 글자로 찾는다.
- `driver-design-system.spec.ts`의 인증 화면 묶음(`--mantine-color-` 금지, Paper 테두리, 하단 바 `borderTop`)은 `DRIVER_SESSION_COOKIE`가 없으면 건너뛰고(:98) 쿠키 도메인이 운영으로 고정돼 있다(:106). 로컬에서는 실패가 아니라 건너뛰므로 지금은 증거가 되지 못한다. 그중 둘은 인라인 `style`을 읽어 Tailwind 클래스로 바꾸면 깨진다. P3에서 쿠키 도메인을 대상 주소에 맞추고 계산된 스타일 기준으로 바꾼다.
- 상태: 완료(2026-10-30, #684 병합).

### P0.5. 증명 도구 (Mantine 상태, 화면·동작 변화 없음)
검토에서 이 계획이 요구하는 증명을 지금 도구로는 실행할 수 없다고 확인됐다. 첫 회차 전 남은 기간에 맞춰 범위를 줄이고, 교체보다 먼저 만든다. 새 npm 의존성을 넣지 않는다(lockfile이 바뀌면 세 앱이 다시 빌드된다). 바꾸는 경로는 `scripts/`·`.github/`·문서뿐이라 프런트 빌드를 일으키지 않는다.

상태: 구현(2026-10-30). 쓰는 법은 `scripts/visual/README.md`·`apps/e2e/README.md`.

1. **화면 비교를 기계로 판정한다** (`scripts/visual`)
   - **기준 시각**(`clock.mjs`): `start.mjs`가 기준 시각을 정하고(기본 실행한 날의 한국 시간 0시, `--now`로 지정), `shots.mjs`가 브라우저 시계를 그 시각에 고정한다(`page.clock.setFixedTime`, 타이머는 돈다). 서버(next dev)는 실제 시각으로 그리므로 날짜가 같도록 기본값을 "오늘 0시"로 했다. fixture의 다가오는 회차 일정은 기준 시각 기준 상대값이다. 지난 회차·주문 날짜는 절대값 그대로다. CSS 애니메이션은 촬영에서 멈춘다(`animations: 'disabled'`).
   - **정상 촬영 판정**(`soundness.mjs`): fixture 없는 API 경로 0, 콘솔 오류 0, 누를 글자·입력칸 없음 0, 도착 주소 = 의도한 주소일 때만 정상이다. 정상이 아닌 캡처는 비교하지 않고 실패로 본다.
   - **픽셀 비교**(`diff.mjs`·`compare.mjs`·`png.mjs`): node 내장 zlib만으로 PNG를 읽어 픽셀 하나라도 다르면 차이로 본다. 의도한 차이는 허용 목록에 화면·폭·**영역(bbox)과 사유**로만 적을 수 있고, 그 영역 밖 차이는 0이어야 한다. 크기가 달라진 화면은 `"full"`로만 허용한다. 기준 시각·폭 목록이 다른 두 묶음은 비교하지 않는다.
   - **민감도 시험**: `compare.spec.mjs`가 1px 변화를 차이로 잡는지 CI에서 확인한다.
   - **폭**: 390·768·1280(`--viewports`로 고를 수 있다).
   - 하네스는 `next dev`로 띄운다. 운영 빌드에서는 로컬 로그인이 꺼진다(`apps/driver/src/auth.ts`:124, seller도 같다). 로그인 화면을 운영 빌드로 찍는 방법(하네스가 자기 `AUTH_SECRET`으로 세션 쿠키를 만들기 등)은 P2a 전에 정한다. 그 전까지 dev로만 찍은 화면은 "운영 빌드 미증명"으로 본다.
   - 판매자·어드민 촬영 목록을 채웠다: `admin/audit`·`hubs/[id]`(상세·수정·픽업)·`hubs/new`·`settings/option-stocks`·`settings/payout-account`·`invite/[token]`(정상·잘못된 링크)·`login/error`, 모달이 열린 상태 3개(주문 배송 보류·강제 취소, 회차 취소). `/admin`은 `/admin/stores`로 넘어가는 주소이고, 후기 관리·입점 문의·고객 반응·가게 소개는 기능 플래그가 꺼져 지금 404라 넣지 않았다(기능을 켠 모양은 `benchmarkScreens`). 기사(배송 보류 모달·사진 촬영·알림)와 소비자는 해당 단계 전에 채운다.
2. **로컬 E2E가 실제로 돌았는지 판정한다** (`apps/e2e`)
   - 회차 spec은 이미 `pnpm test:e2e:local`이 루프백 운영 빌드로 돌리고 64건 무건너뜀을 판정한다(`scripts/round-direct-e2e-local.mjs`). 다만 데이터는 원격 스테이징 API이고, E2E Firebase 키(`.env.local-target`)가 있어야 돈다.
   - 회차 밖 spec은 `BASE`를 주지 않으면 운영 주소를 치고(`tests/_helpers/target-url.ts`), 자격 정보가 없거나 데이터에 따라 건너뛴다(`seller-banner.spec.ts`:29는 무조건 건너뜀). 앱 전체 "건너뜀 0"은 spec 작업이 커서 P0.5에서는 하지 않는다.
   - 판매자·어드민 묶음: `node scripts/admin-local-e2e.mjs`가 `admin-local-*`를 dev:local(루프백 고정)에서 재시도 없이 돌리고, 실행 건수 20(spec 5개 × chromium·mobile)·실패 0·재시도 통과 0·건너뜀 0일 때만 통과시킨다. 대상 주소를 밖으로 바꾸면 실행하지 않는다. 다른 묶음은 그 앱 단계 전에 같은 방식으로 만든다. 기준을 맞추려고 판정을 완화하지 않는다(`AGENTS.md` §0-5).
   - 교체 PR은 `main`에서 같은 명령을 먼저 돌린 기준 결과와 비교한다.
3. **동결을 도구로 막는다** (`scripts/release/freeze-guard.mjs`)
   - 상태 파일 `docs/release/ui-migration-freeze.json`에 구간(`open`·`pre-candidate`·`candidate`)과 후보 SHA를 적는다. 구간 전환은 이 파일을 바꾸는 커밋으로 한다. 날짜로 자동 전환하지 않는다(§8은 상태 기준이다).
   - **PR 검사**(`ci.yml`의 `UI 교체 동결` job, `ci-ok`에 포함): 상태 파일을 PR 쪽이 아니라 **base SHA**에서 읽는다(PR이 파일을 같이 고쳐 동결을 풀지 못하게). `pre-candidate`·`candidate`에서는 교체 흔적을 막는다. 교체 전용 경로(`packages/ui/src/{components,styles,lib}/`, `components.json`, 앱 `postcss.config`, `.claude/skills/`)와, 프런트 소스·패키지 매니페스트에 새로 들어온 줄의 교체 흔적(`@greenhub/ui/{components,styles,lib}`, `tailwindcss`, `@base-ui/react`, `tw-animate-css`, `shadcn`)이다. `packages/ui/package.json`은 경로로 막지 않고 이 흔적 줄만 막는다. `candidate`에서는 프런트를 다시 빌드하게 하는 변경(판정은 `scripts/vercel/ignore-build.mjs` 그대로)에 수정·revert 라벨 `freeze-fix`를 요구한다. 라벨은 교체 흔적을 통과시키지 않는다. 라벨 변화에 다시 돌도록 `pull_request`에 `labeled`·`unlabeled`를 넣었다.
   - **배포 검사**(`production-deploy.yml`의 "UI 교체 동결 확인"): 10/24 사고는 병합이 아니라 동결 중 **배포**였다(`docs/memory.md`). `candidate` 구간에는 상태 파일의 후보 SHA이거나 그 뒤의 SHA만, 그 사이에 교체 흔적이 없을 때만 배포한다.
   - 필수 검사는 이미 `ci-ok`이고 branch protection이 strict라, 상태 파일이 바뀐 뒤 열린 PR은 최신 `main`을 반영해 다시 검사받는다. GitHub 설정은 바꾸지 않았다.
- Taste 실행 래퍼는 P0.5에서 빼고 M4(② 단계 시작 때)로 옮긴다.
- 완료 기준: `main`에서 만든 기준 촬영·기준 E2E 결과가 있다. 같은 커밋을 두 번 찍어 비교하면 차이 0이고, 민감도 시험의 1px 변화는 차이로 잡힌다. 경로 검사가 막힌 경로 PR을 실제로 실패시킨다.
- 로컬 증명(2026-10-30, P0.5 브랜치 = 앱 코드는 `main`과 같음):
  - 판매자 촬영 129장(43화면 × 390·768·1280) 전부 정상 촬영 판정 통과.
  - 같은 커밋 두 번 비교: 허용치 0에서 128장 같음·1장 차이(상품 수정 태블릿, 입력칸 둥근 모서리 4px 안티앨리어싱, 채널 차이 1). 허용치 1에서 129장 같음. 그래서 ①의 기계 판정은 `diff.mjs --tolerance 1`로 한다(`scripts/visual/README.md`).
  - 민감도: 실제 캡처 한 장의 1px을 채널 값 1(허용치 0)·2(허용치 1)만큼 바꿨을 때 둘 다 그 위치 1px만 차이로 잡혔다. 그 영역을 허용 목록에 사유와 함께 넣었을 때만 통과했다.
  - 판매자·어드민 로컬 E2E: `node scripts/admin-local-e2e.mjs`가 dev:local에서 20/20 통과·건너뜀 0. 대상 주소를 운영으로 바꾸면 실행하지 않았다. P0.5는 앱 코드를 바꾸지 않으므로 이 결과가 `main` 기준 결과다.
  - 동결 검사: 실제 커밋으로 pre-candidate 교체 흔적 차단, 일반 프런트 수정 통과, candidate에서 라벨 없는 프런트 수정 차단·`freeze-fix` 통과, 후보 이전 SHA 배포 차단을 확인했다.

### P1. 기반 (`packages/ui`)
- `packages/ui`에 Tailwind v4와 shadcn(`-b base`) 토큰·컴포넌트를 둔다. 처음 쓸 컴포넌트는 Button·Input·Field(+Label)·Card·Badge·Dialog·Sheet·Toast·Skeleton이다.
- 기존 `style.css`·`theme.ts`의 값은 바꾸지 않는다. 어느 앱에도 아직 연결하지 않는다.
- 검사: 새 CSS에 `--border` 색 정의가 없다. 같이 쓰는 동안 앱이 import할 파일에 `@import "tailwindcss"`(preflight)가 없다. Tailwind 출력의 `:root`에 기존 이름(`--color-*`, `--radius-sm`)이 다른 값으로 나오지 않는다(`scripts/ui/tokens.spec.mjs`).
- 우리 variant를 Mantine과 같은 모양(반경·글자·줄 높이·테두리 색)으로 먼저 만든다. 컴포넌트를 Mantine과 나란히 찍는 대조 화면은 컴포넌트를 실제로 그릴 앱이 연결되는 P2a에서 만든다(P1에는 그릴 앱이 없다).
- 완료 기준: 세 앱 `pnpm build` 통과, 세 앱 화면이 `main`과 같음(lockfile이 바뀌어 세 앱이 다시 빌드된다).

구현(2026-10-30):
- **shadcn CLI 대신 레지스트리 원본**: 이 실행 환경에서 `ui.shadcn.com`에 닿지 않아 `init`·`add`를 쓸 수 없다. shadcn 저장소의 Base UI 원본(`apps/v4/registry/bases/base/ui`, 2026-10-27 커밋 `96da9cc7`)을 구조·`data-slot`·export 그대로 쓰고, 자리표시 클래스(`cn-*`)를 `tokens.css`의 의미 유틸리티로 채웠다. `components.json`은 나중에 CLI를 쓸 수 있게 둔다.
- **의존성**(모두 2주 이상 된 버전): `@base-ui/react` 1.9.0, `class-variance-authority` 0.7.1, `cn` 0.4.0(shadcn 제작, clsx + tailwind-merge 대체), `tw-animate-css` 1.4.0, `lucide-react` ^1.61.0(앱과 같음). 개발용 `tailwindcss`·`@tailwindcss/postcss` 4.3.3. `shadcn` 패키지는 CLI 의존성 33개를 끌고 와 넣지 않고, 그 안의 `dist/tailwind.css`(열림·닫힘 변형, MIT)만 `src/styles/shadcn-tailwind.css`로 옮겼다.
- **기본값(① 외형 유지)**: 버튼 36/18px·완전 둥근 모서리·15px 600, 입력칸 36px·16px 모서리·gray-4 테두리, 카드 16px 모서리·16px 여백·gray-3 테두리, 배지 20px·11px 700 대문자(한글 잘림 보정 없이 `overflow-visible`). 값은 설치된 Mantine 9.7 CSS와 `theme.ts`에서 읽었다.
- **lockfile 부수 변화**: 새 패키지 외에 `jiti` 2.6.1→2.7.0(ESLint·vitest 같은 개발 도구), `workbox-build`(PWA 서비스워커 빌드)의 `@babel/runtime` 7.29.2→7.29.10(이미 있던 버전으로 합쳐짐)이 바뀐다.
- `scripts/check-css-vars.mjs`는 Base UI Toast 런타임 변수(`--toast-*`)와 Tailwind 테마 간격(`--spacing`)을 라이브러리 정의 변수로 넘긴다.
- CI 타입 검사에 `packages/ui`를 더했다.
- 로컬 증명: `packages/ui` 타입 검사 0 오류, Biome 오류 0, `tokens.spec` 5/5, CSS 변수 검사 통과. 세 앱을 CI build job과 같은 가짜 공개 설정으로 `main`과 P1에서 **같은 경로에** 빌드해 정적 산출물을 비교했다. JS·CSS 530개 파일(소비자 182·판매자 209·기사 139)의 내용 해시가 모두 같았다. 다른 것은 빌드마다 바뀌는 서비스워커(`public/sw.js`)뿐이다(같은 코드도 빌드마다 다르다). 앱이 받는 번들이 같으므로 세 앱 화면도 `main`과 같다. 촬영 비교보다 강한 증거라 P1은 이것으로 갈음한다. 다른 경로(worktree)에서 빌드하면 Next가 절대 경로로 모듈 번호를 만들어 해시가 달라지므로 같은 경로에서 비교해야 한다.

### P2. 판매자 앱 (P1 뒤)
- **P2a 연결만** (화면 교체 0)
  - 판매자 앱에 Tailwind를 연결한다. Mantine과 같이 쓰는 동안은 preflight 없이 연결한다.
    ```css
    @layer theme, base, mantine, components, utilities;
    @import "tailwindcss/theme.css" layer(theme);
    @import "tailwindcss/utilities.css" layer(utilities);
    @import "tw-animate-css";
    @import "shadcn/tailwind.css";
    @import "@greenhub/ui/styles/tokens.css";
    /* Mantine CSS는 모두 layer(mantine)으로 import */
    ```
  - 앱 CSS에는 지금 `@layer`가 하나도 없다. Mantine을 layer로 옮기면 layer 밖의 앱 규칙이 판매자 **모든** 화면(회차·주문 포함)에서 Mantine을 이기게 된다. 그래서 연결 PR의 판정 범위는 판매자 전체 화면과 모달이 열린 상태다.
  - `layout.tsx`가 JS로 import하는 `@mantine/notifications/styles.css`도 `globals.css`의 `layer(mantine)`으로 옮긴다. Mantine import가 모두 layer 안에 있는지 검사한다.
  - preflight 없이 남는 빈틈: 테두리 기본 색(`* { border-color }` 기본 규칙이 없으면 `currentColor`)과 button·input의 브라우저 기본 스타일. 초기화는 새 컴포넌트에만 걸리도록 범위를 좁힌다(예: `[data-slot]`, 추측). `postcss-preset-mantine`과 `@tailwindcss/postcss`의 순서도 이 PR에서 정한다.
  - 완료 기준: 판매자 전체 화면(로그인 화면은 운영 빌드 방법이 정해졌으면 운영 빌드로) 차이 0, 판매자·어드민 로컬 E2E 기준과 같음.
  - 구현(2026-10-31):
    - `globals.css`: 위 layer 순서. `tailwindcss/theme.css`·`utilities.css`, `tw-animate-css`, `@greenhub/ui/styles/shadcn-tailwind.css`·`tokens.css`를 import하고, Mantine CSS 전부(`layout.tsx`에서 옮긴 `@mantine/notifications/styles.css` 포함)와 `@greenhub/ui/style.css`를 예전 순서 그대로 `layer(mantine)`에 넣었다. `@source "../../../../packages/ui/src"`. 계약은 `src/app/globals-css.test.ts`가 검사한다.
    - preflight 빈틈: `@layer base`에서 `[data-slot]`(새 컴포넌트)에만 `box-sizing`·`margin`·`padding`·`border: 0 solid`, `button[data-slot]`·`input[data-slot]` 등에만 글꼴·색·배경·`appearance` 초기화. Mantine 요소에는 `data-slot`이 없다.
    - postcss 순서: `@tailwindcss/postcss`(`optimize: false`) → `postcss-preset-mantine` → `postcss-simple-vars`. Tailwind가 `@import`를 먼저 펼쳐야 Mantine 프리셋이 예전처럼 Mantine CSS 전체에 적용된다. `optimize`를 끈 것은 운영 빌드에서 Tailwind의 lightningcss가 펼친 Mantine CSS를 다시 쓰지 않게 하려는 것이다(압축은 예전처럼 Next). Tailwind 출력의 중첩 규칙은 Mantine 프리셋(postcss-nested)이 펼친다.
    - 대조 화면: 판매자 `/dev/ui-compare`(`?open=modal|dialog|drawer|sheet`). 운영 차단은 `src/lib/local-preview.ts`의 `GREENHUB_LOCAL_RUNTIME === 'true' && NODE_ENV !== 'production'`(로컬 로그인과 같은 조건)이 아니면 `notFound()`이고 `force-dynamic`이다. 운영 빌드는 `NODE_ENV`가 production으로 고정되므로 값을 넣어도 열리지 않는다(`local-preview.test.ts`). 하네스 `--set compare`와 `scripts/visual/compare-cells.mjs`로 판정한다(`scripts/visual/README.md`).
    - 대조 결과로 고친 `packages/ui` 값(① 외형 유지, Mantine 계산값): Button(줄 높이 1, 크기별 글자 xs·sm 13·md 16·lg 18, 모서리 32px·`overflow: hidden`, light·subtle brand-1·brand-9, secondary·ghost gray-1·gray-9, destructive red-6, 비활성 gray-2 면·gray-5 글자, 초점 주색 2px 외곽선, 테두리 밑까지 면), Badge(light·secondary·destructive 색, 모서리 1000px), Input(글자 검정, 자리표시 gray-5, 비활성·오류 색), Field(Mantine InputWrapper 흐름: 라벨 줄 높이 1.55·600, 설명·오류 13px·1.2·5px 간격, 세로 Field는 block), Card(글자 검정, 제목 줄 높이 1.55), Dialog·Sheet(Mantine Modal·Drawer 구조: 머리 60px·본문 `DialogBody`·`SheetBody` 추가, CloseButton 28px와 Mantine X 모양 `close-button.tsx`, 그림자 xl, Dialog 가운데 정렬은 flex, 폭 440px·90vw). 사용처가 아직 없어 앱 화면에는 영향이 없다.
    - 남은 대조 차이: 짝 30행은 390·768·1280에서 위치·계산된 스타일·픽셀(허용치 1)이 모두 같다. 열린 상태는 Modal↔Dialog가 768·1280에서 0, 390에서 닫기 버튼 초점 외곽선 66픽셀(2배율), Drawer↔Sheet가 390에서 0, 768·1280에서 모서리·초점 외곽선 59픽셀이다. 값(위치·크기·색·모서리)은 같고 안티앨리어싱만 다르다. 판매자 화면은 Sheet를 쓰지 않고, Dialog는 `ConfirmModal`을 바꿀 때 그 화면 촬영으로 다시 판정한다.
    - 같은 Mantine 요소도 가로 위치가 다른 칸에 그리면 모서리 안티앨리어싱이 달라진다(Mantine 버튼을 복제해 오른쪽 칸에 놓아도 15픽셀). 그래서 `compare-cells.mjs`는 같은 자리에서 비교한다.
  - 로컬 증명(2026-10-31, dev 하네스·기준 시각 2026-10-31T00:00+09:00):
    - 판매자 촬영 129장(43화면 × 390·768·1280, 모달 열린 상태 3개 포함) 모두 정상 촬영 판정 통과, `diff.mjs --tolerance 1` 129장 같음(허용치 0으로도 129장 같음). 로그인 화면은 dev 촬영이다(운영 빌드 로그인 촬영은 아직 없음, 운영 빌드 미증명).
    - 운영 빌드 대신 확인한 것: `main`과 P2a를 같은 경로에서 CI build 설정으로 빌드했다. consumer(91개)·driver(48개) 정적 JS·CSS는 내용 해시가 모두 같다(빌드 ID 폴더 이름만 다름). seller 운영 CSS는 `main`의 규칙 691개가 모두 그대로(`layer(mantine)` 또는 layer 밖) 들어 있고, 더해진 것은 토큰 `:root`, Drawer(대조 화면용), Tailwind·tw-animate 규칙과 keyframes뿐이다.
    - 번들: seller CSS 4개 파일 174,094B(gzip 합 32,720B) → 1개 파일 213,050B(41,228B). JS 합 2,730,051B → 2,911,180B(gzip 899,067B → 960,489B). Base UI 청크는 `/dev/ui-compare`만 참조한다(`page_client-reference-manifest`).
    - 판매자·어드민 로컬 E2E(`node scripts/admin-local-e2e.mjs`, dev:local) 20/20·건너뜀 0(`main` 기준 P0.5와 같음). 판매자 단위 테스트 871개 통과, `packages/ui`·seller 타입 검사, Biome, CSS 변수 검사, `tokens.spec` 5/5, scripts spec 통과.
- **P2b 회차 운영과 무관한 화면**: 설정 → 상품(옵션 재고 제외) → 어드민. 어드민에는 기사 승인(`admin/drivers`)·환불(`admin/orders`의 환불 모달)이 있으므로, 다음 회차가 잡혀 있으면 이 둘은 회차 운영 화면과 같이 다룬다(P4 규칙).
- 1단계(외형 유지, §7)만 한다.
- 설정 묶음 구현(2026-10-31, P2a 위에 쌓음): `settings`(첫 화면)·`settings/payout-account`·`settings/delivery`·`settings/daily-caps`의 `@mantine/core`를 걷었다. `settings/option-stocks`(옵션 재고)와 기능 플래그가 꺼진 `settings/store-profile`은 뒤로 미룬다.
  - Mantine Text·Paper·UnstyledButton·Container·Group·Stack·SimpleGrid·Title은 같은 값의 요소+Tailwind로(예: Text = `p` + `m-0 p-0 text-base`, Paper = `rounded-[16px] bg-white` + Mantine 그림자). Mantine 그림자 xs·sm은 판매자 `globals.css`의 `@theme`(`shadow-mantine-xs`·`shadow-mantine-sm`)에 두었다.
  - `packages/ui` 추가: `Switch`(Mantine Switch sm), `Autocomplete`(Base UI Autocomplete, 입력칸은 `Input`과 같은 클래스 `inputClassName`), Button `outline-gray` 변형(Mantine outline gray). 대조 화면에 Switch·ActionIcon 28px·outline gray 행을 더해 같음을 확인했다.
  - Button은 클래스 없는 svg를 16px로 줄이므로 아이콘 버튼의 svg에는 크기 클래스(`size-5`)를 준다.
  - `@mantine/notifications`(저장 알림)는 앱 전체 공급자를 바꾸는 일이라 이 묶음에서 남겼다. Mantine Button `loading`은 `disabled`·`aria-busy`로 바꿨다(저장 중 회전 표시 없음).
  - 로컬 증명: 판매자 촬영 129장 `main`과 같음(`--tolerance 1`, 바꾼 4화면 12장 포함), 판매자·어드민 로컬 E2E 20/20·건너뜀 0, 판매자 단위 테스트 871개 통과. 배송 슬롯 편집 패널(날짜를 누른 뒤)은 촬영 목록에 없어 대조 화면의 `outline-gray` 행으로만 확인했다.
- 판매자 단위 테스트 중 Mantine 컴포넌트 자체에 묶인 것(`SegmentedTabs.test.tsx`의 `Group` 탐색, `ReviewCard.test.tsx`)은 그 화면을 바꿀 때 같이 고친다.

### P3. 기사 앱 (12개 파일)
- 기사 앱을 연결하고 1단계만 한다(`design-direction.md` D4 미확정). 연결 방식은 P2a와 같다.
- `driver-design-system.spec.ts`의 인증 화면 묶음을 로컬에서도 돌게 고친다(P0 참고).
- 병합 전에 실제 휴대폰에서 기사 계정으로 확인한다(도착 사진·완료 처리·서비스워커). 휴대폰은 클라우드 컨테이너의 `next start`에 붙을 수 없고, 운영 빌드에서는 로컬 로그인이 꺼진다. 확인 방법(Preview 테스트 로그인 등)은 이 단계 시작 때 정한다.

### P4. 판매자 앱 틀·회차·주문·준비·재고·정산
- 앱 틀(사이드바·상단바) → 회차·주문·준비 → 재고 → 정산 순서로 나눈다.
- 다음 회차가 잡혀 있으면, 회차 운영 동선 묶음(어드민 기사 승인·환불 포함)은 끝까지 교체된 상태로만 그 회차의 마지막 출시에 넣는다. 판매자 대표가 실제 계정으로 한 번 끝까지 써 보고, 직전 seller 배포 ID를 롤백 대상으로 기록한다.

### P5. 소비자 앱 (51개 파일)
- 첫 PR에서 소비자 앱을 연결한다(P2a 방식).
- 결제와 무관한 화면(홈·검색·마이페이지·법정 고지) → 결제 동선(상품 상세 → 장바구니 → 결제 → 주문 완료 → 내 주문) 순서로 나눈다.
- 결제 동선은 실제 결제·환불 1건으로 확인한다. 로컬 E2E는 PortOne을 stub으로 막아 결제창 호출 경로를 확인하지 못한다(`consumer-round-direct.spec.ts`).
- 결제·장바구니 단위 테스트(`checkout/page.test.mjs` 등)는 허용한 모듈 밖의 import에서 예외를 던진다. 새 `@greenhub/ui` import마다 허용 목록을 같이 고친다.
- 예전 판매(legacy·공동구매) 화면은 컴포넌트만 바꾸고 구성은 바꾸지 않는다(`design-standard.md` §5).

### P6. 정리
- 세 앱과 `packages/ui`에서 `@mantine/*`, `postcss-preset-mantine`, `postcss-simple-vars`, `theme.ts`, `style.css`의 Mantine 보정, 두 앱 `next.config.ts`의 `@mantine/notifications` 설정을 제거한다. 앱 CSS를 CLI `globals.css`(preflight 포함)로 바꾸고, §4에서 기존 이름에 맞춰 둔 값(`--border` 묶음 값 등)을 shadcn 방식으로 정리한다.
- `design-standard.md`의 값 정본 표기(`theme.ts`)를 새 위치로 바꾸고, 앱별 `AGENTS.md`의 글꼴 크기 예외 표를 새 컴포넌트 이름으로 갱신한다.
- `docs/specs/perf/mantine-treeshaking.md`는 역사 자료로 표시한다.

## 7. 화면 변경을 같이 할지

| 방법 | 내용 | 장단점 |
|---|---|---|
| A. 외형 유지 먼저 | 컴포넌트만 바꿔 같은 외형을 만든 뒤, 화면 방향은 나중에 따로 적용한다 | 회귀를 잡기 쉽다. 같은 화면을 두 번 고치고, 개편이 한참 뒤로 밀린다 |
| B. 화면별로 한 번에 | 화면 하나를 교체할 때 `design-direction.md`도 같이 적용한다 | 작업이 한 번이다. 의도한 변화가 전후 비교를 덮어 회귀가 묻힌다 |
| C. 화면별 2단계 (제안) | 화면마다 ① 외형 유지 교체 ② 확정된 방향 적용을 따로 한다 | A의 회귀 검출과 B의 진행 속도를 같이 얻는다. ①은 버리는 작업이 아니다 |

C의 규칙:
- **① 외형 유지 교체**
  - 끝나는 조건: P0.5의 정상 촬영 판정을 통과한 화면에서 기계 비교(`--tolerance 1`) 차이가 0이거나, 남은 차이마다 PR에 영역과 사유가 있고 사람이 확인판에서 승인했으며 그 영역 밖 차이는 0이다. 정상 촬영 판정·시각 고정·픽셀 비교 중 하나라도 없으면 끝난 것으로 보지 않는다.
  - 다음 차이는 사유로 넘기지 못하고 맞춘다: Mantine 보정이 사라져 생긴 차이(Badge 한글 잘림 등), shadcn 기본값에서 생긴 차이(반경 단계, Input 글자 크기 등).
  - 이 단계에는 Taste Skill을 쓰지 않는다. Taste의 redesign 절차는 스택 교체가 없는 개편을 전제하고(taste `SKILL.md`:493), lint FAIL을 고치면 외형이 바뀌기 때문이다.
- **② 방향 적용**
  - `design-direction.md`에서 해당 D 결정이 확정됐고 동결(§8)에 걸리지 않을 때만 한다. 소비자 화면과 전체 값(버튼 색 등)은 소비자 동결이 풀린 뒤다.
  - Taste 절차가 말하는 방향은 `design-direction.md`다. Taste 원문은 기존 브랜드가 있어도 `draw.mjs --keep palette,type`로 구성을 받으라고 하지만(`SKILL.md`:478-481), 우리는 방향을 이미 세 차례 시안 검수로 정했으므로 `draw.mjs`를 쓰지 않는다. 의도한 이탈이다.
  - 개편 전 기록 → 적용 → 결과 증명(`SKILL.md`:485·502)을 따른다. 로그인해야 보이는 화면은 `inspect.mjs`가 열지 못하므로 개편 전후 기록을 `shots.mjs` 촬영으로 대신한다.
  - ①과 ②는 별도 PR이라 전후 비교의 원인이 하나씩이다.
- 버튼 `#007A43`처럼 전체에 걸리는 확정 값은 화면마다 넣지 않는다. 토큰·variant를 고치는 PR 하나로 적용하되, Mantine과 같이 쓰는 동안은 `theme.ts`와 새 토큰을 같이 바꾼다(§4 `--color-primary`). 소비자 앱도 바뀌므로 소비자 동결이 끝난 뒤에 한다.
- 구성을 통째로 바꾸는 화면(소비자 홈 도감 타일, 판매자 주문 화면 등)은 ①을 건너뛸 수 있다. 단 그 앱 spec 묶음이 P0.5 방식의 로컬 실행기에서 건너뜀 0으로 돌 때만이다. 판매자 주문 spec은 자격 정보가 없으면 건너뛰므로, 지금 상태로는 건너뛸 수 없다.

## 8. 일정 제약

**2026-10-30 사용자 결정**: 첫 회차를 교체가 끝난 뒤로 미룬다(회차 일정 변경은 운영 데이터라 사용자가 한다). 교체는 지금부터 단계마다 증명이 끝나는 대로 `main`에 병합한다.

카카오페이 가맹점 심사는 심사용 "11월 특별 회차"(10/28~11/11)와 심사용 계정으로 진행 중이고, 심사자는 소비자 앱의 구매 동선(상품 상세 → 장바구니 → 결제 → 주문 완료)과 사업자 정보·약관 같은 공개 화면을 본다(`docs/BACKLOG.md` PORTONE-CHANNEL-CHECK). 그래서 **소비자 동결**만 둔다.

- **소비자 동결**: 심사 결과·LIVE 채널 전환·실결제 1건 확인이 모두 끝날 때까지 소비자 앱 화면을 바꾸는 변경을 병합하지 않는다.
  - 막는 것(동결 검사 `consumer-freeze`): `apps/consumer`의 교체 흔적(Tailwind 연결·`@greenhub/ui` 새 컴포넌트 import 등), 소비자 화면 값을 바꾸는 공용 파일(`packages/ui/src/theme.ts`·`style.css`) 수정. 버튼 색 `#007A43` 같은 전체 값 변경(§7 ②)도 여기에 걸린다.
  - 막지 않는 것: 판매자·기사·어드민 교체, `packages/ui`에 새 파일 추가, 교체와 무관한 소비자 수정(결제 수정 등).
  - P1처럼 lockfile·`packages/ui`가 바뀌어 소비자 앱이 다시 빌드되는 변경은, 소비자 화면 촬영이 `main`과 차이 0일 때만 병합한다(§9).
  - 풀기: 사용자가 심사·LIVE·실결제 확인이 끝났다고 알려 주면 상태 파일을 `open`으로 바꾸는 커밋을 병합한다.
- **운영 배포**: 병합은 배포가 아니다. 운영 배포는 지금처럼 사용자 승인으로만 한다(`production-deploy.yml`). 배포 직전 최종 `main` SHA로 원격 회차 E2E를 1회 돌린다(`AGENTS.md` §0-9). 소비자 동결 중의 배포는 소비자 빌드가 바뀌지 않았는지(빌드 생략 또는 촬영 차이 0) 확인한다.
- **다음 회차**: 교체가 끝나고 회차 일정을 다시 잡으면, 그 회차 기준으로 `pre-candidate`(교체 코드 병합 금지)·`candidate`(후보 SHA 계열만 배포) 구간을 다시 쓴다. 이 구간 규칙은 아래 "회차 기준 동결"을 따른다.

**회차 기준 동결**(다음 회차에 다시 쓰는 규칙, 2026-10-30 처음 결정)

운영 배포는 `main`에 있는 SHA 하나로 프런트 세 앱을 차례로 내보내고, 바뀐 것이 없는 앱은 빌드를 생략한다(`production-deploy.yml`, `scripts/vercel/ignore-build.mjs`). 다음 변경은 소비자 앱을 다시 빌드하게 한다: `apps/consumer`, 의존 패키지 `packages/ui`·`packages/shared`, 루트 `package.json`·`pnpm-lock.yaml`·`pnpm-workspace.yaml`·`tsconfig.base.json`·`.vercelignore`·`scripts/vercel/`, 빌드 생략 규칙이 분류하지 않은 경로(`.md`는 문서로 분류돼 생략). 앱 하나만 골라 동결할 수 없으므로 동결은 **무엇을 `main`에 병합하는가**로 정한다.

- 마지막 출시는 LIVE 출시 하나로 보고, 후보 확정은 "출시 후보 SHA를 정할 때"와 "주문 오픈 3일 전" 중 이른 쪽이다.
- 후보 확정 전(`pre-candidate`): 교체 코드를 병합하지 않는다. 후보 확정 ~ 배송 완료 다음 날(`candidate`): 수정·revert만 병합하고(프런트 재빌드 변경은 `freeze-fix` 라벨), 배포는 후보 SHA 계열만 한다.
- LIVE 키처럼 환경 변수만 바꾼 배포는 같은 SHA면 소비자 빌드가 생략된다. #681부터 `production-deploy.mjs vercel --require-build=true`가 생략 규칙을 건너뛰는 배포를 요청한다. workflow 입력과 배포 뒤 소비자 번들의 결제 채널 확인은 별도 작업이다.
- 롤백하면 `main`에 원인 코드가 남으므로 revert PR을 병합한다(동결 중에도 허용).
- 회차가 다시 미뤄지면 구간이 함께 움직인다. 이미 정한 후보 SHA는 무효로 하고 새 후보로 원격 E2E를 다시 돌린다.

강제: P0.5-3의 상태 파일·PR 경로 검사·배포 검사(`scripts/release/freeze-guard.mjs`). 현재 상태는 `docs/memory.md`의 "현재 release residual"에도 적는다.

## 9. 단계별 검증

- 로컬: `pnpm typecheck`, `pnpm lint`(Biome), 바뀐 앱의 단위 테스트, `pnpm build`.
- 화면: P0.5의 촬영·기계 비교(390·768·1280px, 시각 고정, 정상 촬영 판정)와 `design-direction.md` §7 검수 기준. `packages/ui`나 루트 설정을 바꾸는 PR은 세 앱을 모두 찍는다.
- E2E: 교체 PR마다 바뀐 앱의 spec 묶음을 P0.5 방식의 로컬 실행기로 돌린다(대상 루프백, 기대 건수 고정, 건너뜀 0, `main` 기준 결과와 비교). 회차 spec은 `pnpm test:e2e:local`로 돌린다. 원격 회차 E2E는 `consumer-round-direct`·`seller-sale-rounds`·`driver-direct-delivery`와 세션 spec만 돌기 때문에(`.github/workflows/e2e-round-direct.yml`), 장바구니·결제·어드민·design-system spec은 로컬 실행이 유일한 증거다. 원격 Preview·E2E는 병합을 모은 최종 `main` SHA로 배포 직전에 1회만 실행한다(`AGENTS.md` §0-9).
- 디자인 검수(② 단계만): Taste `inspect.mjs`는 로그인 없이 열리는 화면만 검사할 수 있다. 앱 화면 lint는 `lint.mjs --app`을 명시한다(`.taste-skill/direction.json`이 없으면 page 모드가 되어 `h-px` 구분선 등이 FAIL로 나온다). 결과는 권고로 쓰고 병합 게이트로 쓰지 않는다. 컨테이너에서는 `inspect.mjs`가 `--no-sandbox`를 넘기지 않으므로(`inspect.mjs`:70) `CHROME_PATH`에 `--no-sandbox`를 붙여 Chromium을 띄우는 셸 래퍼를 준다.
- 성능: 앱별 JS·CSS 번들 크기를 교체 전후로 기록한다(`docs/specs/perf/bundle-optimization.md` 기준).

## 10. 결정

2026-10-30 사용자가 아래 네 가지를 확정했다.

| # | 결정 | 확정 내용 |
|---|---|---|
| M1 | 화면 변경을 같이 할지(§7) | C. 화면별 2단계. ①은 정상 촬영 판정·시각 고정·픽셀 비교·영역 사유로 판정하고, Mantine 보정이나 shadcn 기본값에서 생긴 차이는 사유로 넘기지 않으며, Taste를 쓰지 않는다. ②는 `design-direction.md`를 방향으로 삼아(`draw.mjs` 미사용은 의도한 이탈) 첫 회차 배송 뒤에만 한다 |
| M2 | 동결(§8) | **2026-10-30 다시 정함**: 첫 회차를 교체 뒤로 미루고, 카카오페이 심사·LIVE 결제 전환·실결제 확인 전까지 소비자 앱 화면만 묶는다(상태 `consumer-freeze`). 다음 회차부터는 회차 기준 동결(`pre-candidate`·`candidate`)을 다시 쓴다. 처음 확정안(첫 회차 전 P0·P0.5만, 12/2부터 P1)은 §11에 남긴다 |
| M3 | 교체 순서(§6) | **2026-10-30 다시 정함**: P1 `packages/ui` → P2a 판매자 연결 → P2b 설정·상품·어드민 → P4 판매자 틀·회차·주문·준비·재고·정산, P1 뒤 P3 기사는 P2와 병렬, P5 소비자는 소비자 동결이 풀린 뒤, P6 정리. 단계마다 증명이 끝나는 대로 병합한다 |
| M4 | 스킬을 저장소에 넣을지 | Taste Skill만, ② 단계(방향 적용)를 시작할 때 넣는다(`evals` 제외, `.taste-skill/`은 `.gitignore`, `--no-sandbox` 셸 래퍼 포함). 쓰임은 ② 단계의 권고 검수로 한정한다. UI UX Pro Max는 넣지 않는다: `ui-styling` 하위 스킬이 Radix `asChild`·Tailwind v3 설정·HSL 값을 전제하고, 핵심 `shadcn.csv`도 모든 base에 `sonner`를 권해(:32-34) `-b base`의 Toast와 어긋나며, native select 금지(:21)·다크 모드 필수(:7)가 우리 결정과 다르다. `design` 스킬은 외부 이미지 API 키를 쓰고, `--persist`는 두 번째 디자인 기준 문서를 만든다 |

## 11. 검토 기록

### 1라운드 (2026-10-30)

검토자 셋이 각자 저장소와 두 스킬 원문만 보고(위 제안은 보지 않고) M1~M4의 후보를 매겼다. 가중치는 회귀 위험 40%·비용 30%·일정·운영 20%·스킬 규칙 10%. 관점은 A 회귀·증명, B 출시·운영, C 디자인 시스템·스킬이다.

| # | 당시 제안 (A / B / C) | 검토자 선택 (A / B / C) | 결과 |
|---|---|---|---|
| M1 | B 한 번에: 4.7 / 5.4 / 5.3 | 2단계: 7.5 / 6.9 / 7.0 | 셋 다 2단계 → C로 변경 |
| M2 | 날짜 기준: 5.5 / 5.6 / 5.8 | 상태·병합 기준: 7.5 / 6.9 / 7.1 | 셋 다 상태·병합 기준 → 변경 |
| M3 | 기사→소비자→판매자: 6.3 / 5.6 / 5.8 | 기사→판매자→소비자 계열: 7.7 / 6.7 / 7.2 | 셋 다 소비자를 마지막에 → 변경 |
| M4 | Taste만: 6.8 / 6.6 / 7.5 | Taste만(A·C), 둘 다 안 넣음(B 7.2) | UI UX Pro Max 제외는 셋 다 같음. Taste는 조건을 붙여 유지 |

- 당시 제안에서 틀린 사실: 카카오페이 심사가 11/11에 끝난다고 가정했다(실제로는 아직 심사중). 앱별로 배포를 동결할 수 있다고 가정했다(실제로는 `main` SHA 하나로 세 앱이 함께 나간다). `driver-design-system.spec.ts`가 교체 뒤에도 유효하다고 했다(인라인 스타일 검사 3개는 깨진다). 화면 촬영 폭을 390·768·1440으로 적었다(실제 390·1280).
- 검토자 주장 중 틀린 것: A·C가 "이 컨테이너에 Chrome이 없어 `inspect.mjs`를 못 쓴다"고 했으나 `/opt/pw-browsers/chromium`이 있고 시안 검수 1~3라운드에서 실제로 썼다.
- 검토자 제안 중 채택하지 않은 것: 동결 중 핫픽스를 운영 SHA 태그에서 딴 브랜치로 내보내자는 안. 배포 workflow가 SHA가 `origin/main` 이력에 있는지 확인하므로 쓸 수 없다. 대신 병합 기준 동결로 `main`을 깨끗하게 둔다.

### 2라운드 (2026-10-30)

새 검토자 셋(관점은 1라운드와 같음)이 1라운드 반영안을 그대로 실행한다고 보고 채점하고, 각자 가장 강한 대안과 비교했다.

| # | 반영안 (A / B / C) | 대안 (A / B / C) | 판정 |
|---|---|---|---|
| M1 | 5.3 / 6.6 / 6.1 | 7.0 / 7.15 / 7.05 | 셋 다 수정 |
| M2 | 6.8 / 5.8 / 6.8 | 7.3 / 6.9 / 7.1 | 수정 2, 보완 1 |
| M3 | 5.7 / 6.5 / 6.5 | 6.7 / 7.2 / 7.2 | 셋 다 수정 |
| M4 | 6.5 / 7.25 / 6.8 | 7.3 / 7.9 / 7.35 | 셋 다 수정 |

반영한 지적(원본에서 직접 확인함):
- ①의 "차이 0"을 잴 수단이 없다: 픽셀 비교 없음, 촬영 시각 고정 없음, fixture 회차 시각이 2026-11-01 절대 시각, 카운트다운, `next dev` 촬영 → P0.5 신설.
- 이름 충돌: `--border`가 묶음 값이고 40곳에서 쓴다, `--radius-sm` 8px 대 9.6px, 줄 높이, layer 순서 미지정 → §4 표, P2 layer 순서.
- 소비자 동결의 구멍: `packages/ui`·lockfile·분류되지 않은 경로가 소비자를 다시 빌드한다. 11/19 이후 병합 금지와 E2E 실패 수정이 모순된다. LIVE 출시 자리가 없다. revert 규칙이 없다. 환경 변수만 바꾼 배포의 빌드 생략 → §8.
- 기사 앱 실기기 확인은 운영 빌드에서 로컬 로그인이 꺼지고 Preview 규칙과도 맞지 않아 첫 회차 전에 증명할 수 없다 → 기사·판매자 회차 동선·소비자를 12/2 이후로.
- 로컬 E2E가 기본으로 운영 주소를 치고 자격 정보가 없으면 건너뛴다. `driver-design-system` 인증 묶음은 운영 도메인 쿠키가 없으면 건너뛴다 → P0.5 로컬 실행기, P0·P3 정정.
- `inspect.mjs`는 로그인 화면을 열지 못하고 `--no-sandbox`를 넘기지 못한다. `lint`는 `--app`이 필요하다 → §9, M4.
- 틀린 사실 정정: `sonner`(Base UI에는 Toast), `init --dry-run` 없음, "세 앱을 함께 내보낸다"(바뀌지 않은 앱은 빌드 생략), 핫픽스 확인 경로 목록 누락, `design-direction.md` "(제안)" 표기, P0 `main` 미병합, seller 119·notifications 17개, Mantine에 묶인 판매자 단위 테스트, `memory.md` 절 이름, UI UX Pro Max 제외 근거(핵심 `shadcn.csv`는 Base UI 기준).
- 채택하지 않은 것: P1에서 기사 앱도 연결하는 안(1라운드 반영안). 판매자 앱 하나로 연결 방식을 먼저 검증한다.

### 3라운드 (2026-10-30)

새 검토자 셋(관점은 앞 라운드와 같음)이 2라운드 반영안을 채점하고 가장 강한 대안과 비교했다.

| # | 반영안 (A / B / C) | 대안 (A / B / C) | 판정 |
|---|---|---|---|
| M1 | 6.4 / 6.4 / 6.0 | 7.05 / 6.8 / 6.9 | 셋 다 수정 |
| M2 | 6.4 / 5.9 / 6.3 | 7.25 / 7.45 / 6.6 | 셋 다 수정 |
| M3 | 5.3 / 5.3 / 5.8 | 7.6 / 7.55 / 6.9 | 수정 2, 교체 1 |
| M4 | 6.9 / 6.85 / 7.05 | 8.0 / 7.45 / 7.7 | 셋 다 수정(12/2 이후에만) |

반영한 지적(원본에서 직접 확인함):
- 첫 회차 전 범위: 11/19까지 약 14영업일에 P0.5·P1·P2를 끝내기 어렵다. 판매자 앱 연결이 회차·주문 화면의 CSS 우선순위까지 바꾼다(앱 CSS에 `@layer` 없음). P1·P2는 첫 회차에 주는 이득이 없다 → 첫 회차 전에는 P0·P0.5만.
- `--require-build=true`는 빌드를 강제하지 않는다(생략을 실패로 바꿀 뿐) → §8 정정, LIVE 키 반영을 별도 선행 작업으로 분리. 같은 날 #681이 도구 쪽 강제를 고쳤고, §8에는 남은 workflow 입력·번들 확인만 적었다.
- 정상 촬영 판정 없음(`shots.mjs`:252는 오류·누락에도 계속), 민감도 시험 없음, CSS 애니메이션 → P0.5-1.
- CI 경로 검사의 구멍: 상태 파일을 PR 쪽에서 읽음, `labeled` 트리거 없음, 날짜 기준 전환, 10/24 사고는 배포였음, `packages/ui/package.json`의 불가피한 수정 → P0.5-3.
- CLI `globals.css`의 `@import "tailwindcss"`가 preflight를 끌고 옴, `shadcn/tailwind.css`·`tw-animate-css` 누락, `@mantine/notifications/styles.css`의 JS import가 layer 밖에 남음 → §3 `tokens.css`, P2a.
- 로컬 E2E 실행기는 이미 있다(`pnpm test:e2e:local`, 원격 스테이징 데이터). 앱 전체 건너뜀 0은 spec 작업이 큼(`seller-banner.spec.ts`:29 무조건 건너뜀 등) → P0.5는 판매자·어드민 묶음만.
- 틀린 사실 정정: `cn()`은 `cn` 패키지, `shadcn`은 실행 의존성, `shadcn.csv`는 모든 base에 sonner 권장, §4 안의 `--border` 대응 모순, `@mantine/notifications` 17개와 `next.config.ts` 2곳, preflight 없을 때의 빈틈(선 모양이 아니라 테두리 기본 색과 브라우저 기본 스타일), `inspect.mjs` 인자 설명, 반경 단계 차이.
- 채택하지 않은 것: 없음. 다만 "로그인 화면의 운영 빌드 촬영 방법"과 "기사 실기기 확인 방법"은 해당 단계 시작 전에 정하는 것으로 남겼다.

### 검토 종료

세 라운드 동안 방향(2단계 교체, 상태·병합 기준 동결, 소비자 마지막, UI UX Pro Max 제외)은 바뀌지 않았고, 지적은 점점 각 단계 PR의 실행 세부로 옮겨갔다. 사용자 지시(2026-10-30)로 3라운드에서 검토를 마쳤고, 같은 날 사용자가 §10의 M1~M4를 확정했다. 남은 세부는 각 단계 PR의 증명으로 다룬다.

### 결정 변경 (2026-10-30)

3라운드 뒤 확정한 M2·M3은 "첫 회차(11/22 주문, 12/1 배송)를 지킨다"를 전제로 했다. 사용자가 같은 날 "회차를 생각하지 않고, 심사에 지장이 없다면 교체를 먼저 끝낸 뒤 회차를 진행한다"로 전제를 바꿨다. 심사자가 보는 화면은 소비자 앱이므로 소비자 앱만 심사·LIVE·실결제 확인 전까지 묶고, 나머지는 단계마다 증명이 끝나는 대로 병합하기로 했다. P2·P3은 브랜치를 나눠 병렬로 진행한다. 회차 일정 변경 자체는 운영 데이터라 사용자가 한다.


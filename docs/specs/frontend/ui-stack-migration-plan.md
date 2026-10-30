# Mantine → shadcn/ui + Tailwind CSS v4 + Base UI 교체 계획

> 작성 2026-10-28. 상태: **P0 작업 브랜치 완료(`main` 미병합), P0.5 전**. 사용자가 비용을 감수하고 교체하기로 했다(2026-10-28). M1~M4(§10)는 1·2라운드 검토(§11)를 반영한 제안이고 아직 확정 전이다.
> 화면을 어떻게 바꿀지는 `design-direction.md`(부분 확정)를 따르고, 그 문서에서 확정되지 않은 부분의 시각 계약은 `design-standard.md`다.
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
| (알림) | — | `-b base`의 알림은 shadcn `toast`(Base UI Toast, `@base-ui/react`)다. Base UI 문서 목록에 `sonner`는 없다. radix·aria용 `sonner`는 `next-themes`를 같이 설치하므로 쓰지 않는다(§5 다크 모드 없음) |
| `lucide-react` | 1.63.0 | 이미 consumer·seller가 사용 중 |
| 비교: `@mantine/core` | 9.7.4 | 현행 |

이 세션에서는 `ui.shadcn.com`에 접근할 수 없어 GitHub의 문서 원본으로 확인했다. P1에서 `npx shadcn@latest init`을 실행할 때 실제 출력으로 다시 확인한다.

## 2. 현재 범위 (2026-10-28 `main` 기준 직접 집계)

- `@mantine/*`를 import하는 파일: consumer 51, seller 121(어드민 포함), driver 12, `packages/ui` 1. 합계 약 185개.
- 2026-10-30 다시 세면 seller는 테스트를 뺀 ts/tsx 119개, `@mantine/notifications`는 17개 파일이다. 단계별 범위는 각 PR에서 다시 센다.
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

P1에서는 **값을 하나도 바꾸지 않고 이름만 대응**시킨다. 기존 hex 값을 그대로 쓴다(shadcn 기본은 OKLCH이지만 hex도 유효하다). 값 변경은 Mantine과 같이 쓰는 동안 `theme.ts`·`style.css`와 새 `globals.css` 양쪽을 한 PR에서 바꿔야 하므로, 소비자 동결(§8)이 끝난 뒤에 한다.

**기존 변수와 이름이 겹친다.** 현행 `style.css`와 shadcn·Tailwind가 같은 이름을 다른 뜻으로 쓴다. 기존 변수를 쓰는 앱 파일(소비자 포함)을 고치지 않도록, 새 쪽이 기존 이름·값에 맞춘다.

| 이름 | 현행 | shadcn·Tailwind | 처리 |
|---|---|---|---|
| `--border` | 색이 아니라 `1px solid var(--color-border)` 묶음 값(`style.css`:37). 앱 코드 40곳이 `border: var(--border)`로 쓴다 | 테두리 **색**, `@theme inline { --color-border: var(--border) }` | 새 `globals.css`에서 `--border`를 정의하지 않는다. `--color-border`를 기존과 같은 `#ECEFED`로 직접 둔다. CLI가 `--border`를 써 넣으면 지우고, 그런 정의를 막는 검사를 P1에 둔다 |
| `--radius-sm` | 8px(`style.css`:34) | `calc(var(--radius) * 0.6)` = 9.6px | `@theme`에서 8px로 고정한다 |
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
| `@mantine/notifications` | shadcn `toast`(Base UI Toast) | 17개 파일. 호출 방식이 달라 파일마다 바꾼다 |
| `@mantine/hooks` | 직접 작성하거나 React 기본 API | 2개 파일 |
| MantineProvider · ColorSchemeScript | 제거 | 다크 모드를 지원하지 않으므로 `next-themes`도 넣지 않는다 |

## 6. 단계

각 단계는 독립적으로 병합할 수 있는 PR(또는 PR 묶음)이다. 앞 단계가 병합된 `main`에서 다음 단계를 시작한다. 첫 회차 배송(12/1) 전에 `main`에 넣는 것은 P0~P2뿐이고, 나머지는 브랜치에서 작업하다 동결(§8)이 풀린 뒤 병합한다.

| 단계 | 내용 | `main` 병합 |
|---|---|---|
| P0 | E2E 선택자 정리 | 지금(PR 필요) |
| P0.5 | 증명 도구 | 마지막 출시 전 |
| P1 | `packages/ui` 기반(새 파일만) | 마지막 출시 전 |
| P2 | 판매자 앱 연결 + 회차 운영과 무관한 판매자 화면 | 마지막 출시 전 |
| P3 | 기사 앱 | 12/2 이후 |
| P4 | 판매자 앱 틀·회차·주문·준비·재고 | 12/2 이후 |
| P5 | 소비자 앱 | 12/2 이후 |
| P6 | 정리 | 마지막 |

### P0. 사전 준비 (Mantine 상태에서)
- `.mantine-*` 클래스로 요소를 찾던 E2E를 역할·이름 기반 선택자로 바꾼다. Mantine 클래스 이름은 교체와 함께 사라지기 때문이다.
  - 어드민 모바일 카드 목록(가게·초대 기록·주문)은 `role="list"`/`listitem`을 붙이고, 테스트는 `tests/_helpers/admin-local.ts`의 `rowOrListItem`(표의 행 또는 목록 항목)으로 찾는다.
  - 정산 합계 카드는 `정산 합계` group 안의 카드별 group으로 찾는다.
  - 판매자 주문 탭은 `SegmentedTabs`의 `ariaLabel`("주문 상태") group 안의 버튼 글자로 건수를 확인한다.
  - 공동구매 진행률은 `progressbar` 역할로, 성능 회귀의 Badge 확인은 홈 상품 상태 태그 글자로 찾는다.
- `driver-design-system.spec.ts`의 인증 화면 묶음(`--mantine-color-` 금지, Paper 테두리, 하단 바 `borderTop`)은 `DRIVER_SESSION_COOKIE`가 없으면 건너뛰고(:98) 쿠키 도메인이 운영으로 고정돼 있다(:106). 로컬에서는 실패가 아니라 건너뛰므로 지금은 증거가 되지 못한다. 그중 둘은 인라인 `style`을 읽어 Tailwind 클래스로 바꾸면 깨진다. P3에서 쿠키 도메인을 대상 주소에 맞추고 계산된 스타일 기준으로 바꾼다.
- 상태: 작업 브랜치에서 끝났다(`d947a78`). `main`에 병합해야 P0.5를 시작할 수 있다.

### P0.5. 증명 도구 (Mantine 상태, 화면·동작 변화 없음)
2라운드 검토에서 이 계획이 요구하는 증명을 지금 도구로는 실행할 수 없다고 확인됐다. 교체보다 먼저 만든다.
1. **화면 비교를 기계로 판정한다** (`scripts/visual`)
   - `shots.mjs`가 Playwright `page.clock`으로 시각을 고정하고, fixture의 회차 시각(`orderCloseAt` 등, 지금은 2026-11-01 같은 절대 시각)을 고정 시각 기준 상대값으로 바꾼다. 1초마다 바뀌는 카운트다운도 고정 시각에서 멈춘다.
   - 768px 폭을 추가한다(판매자 1100px 이하 배치, `design-direction.md` §5).
   - before/after PNG를 픽셀로 비교해 "차이 난 화면 목록"과 차이 영역을 내는 비교 명령을 추가한다. 의도한 차이는 PR에 화면별 사유로만 허용한다.
   - 하네스는 `next dev`로 띄운다. 운영 빌드에서는 로컬 로그인이 꺼지므로(`apps/driver/src/auth.ts`:124) 로그인 화면은 dev로 찍는다. CSS 우선순위가 dev와 다를 수 있으므로 공개 화면은 `next build && next start`로도 찍는다.
   - 촬영 목록에 없는 화면을 채운다. 기사 배송 보류 모달·사진 촬영·알림, 판매자 `admin/audit`·`admin/reviews`·`hubs/[id]`·`invite/[token]`·`option-stocks`·`payout-account` 등이다.
2. **로컬 E2E가 실제로 돌았는지 판정한다** (`apps/e2e`)
   - 지금은 `BASE`를 주지 않으면 운영 주소를 치고(`tests/_helpers/target-url.ts`), 자격 정보가 없으면 많은 spec이 건너뛴 채 통과로 보인다.
   - 앱별 spec 묶음을 로컬 대상(`dev:local` 또는 운영 빌드)으로만 돌리는 실행 명령을 만든다. 대상이 루프백이 아니면 실패시키고, 원격 게이트처럼 기대 건수·건너뜀 0을 판정한다(`e2e-round-direct.yml`의 "64건 무건너뜀 판정" 참고).
   - 교체 PR은 `main`에서 같은 명령을 먼저 돌린 기준 결과와 비교한다.
3. **동결을 CI로 막는다**: PR CI에 경로 검사를 넣어 §8 구간에 막힌 경로를 바꾸는 PR을 실패시킨다. 수정·revert PR은 표시(라벨 등)로 통과시킨다. 구간 날짜는 한 파일에서 읽는다.
4. **Taste 실행 래퍼**: `inspect.mjs`는 `CHROME_PATH`의 실행 파일을 인자 없이 띄워(`inspect.mjs`:70, `scripts/lib/cdp.mjs`) 컨테이너에서 필요한 `--no-sandbox`를 넘길 수 없다. 래퍼 스크립트를 저장소에 두거나 M4를 따른다.
- 완료 기준: `main`에서 만든 기준 촬영·기준 E2E 결과가 있고, 같은 커밋을 두 번 찍어 비교하면 차이 0이 나온다.

### P1. 기반 (`packages/ui`에 새 파일만 추가)
- `packages/ui`에 Tailwind v4와 shadcn(`-b base`)을 초기화하고 §4 토큰을 넣는다. 처음 쓸 컴포넌트(Button·Input·Field·Card·Badge·Dialog·Sheet·Toast·Skeleton)를 설치한다. `add`는 `--dry-run`으로 바뀔 파일을 먼저 본다(`init`에는 이 옵션이 없다).
- 기존 `style.css`·`theme.ts`는 고치지 않는다(첫 회차 배송 전까지 추가만). 어느 앱에도 아직 연결하지 않는다.
- §4의 이름 충돌 처리를 넣고, 새 `globals.css`에 `--border` 색 정의가 들어오면 실패하는 검사를 둔다.
- 완료 기준: 세 앱 `pnpm build` 통과, 세 앱 촬영(P0.5)이 `main`과 차이 0. lockfile이 바뀌어 세 앱이 다시 빌드되기 때문이다.

### P2. 판매자 앱 연결 + 회차 운영과 무관한 화면
- 판매자 앱에 Tailwind를 연결한다. Mantine과 같이 쓰는 동안은 preflight 없이 연결한다.
  ```css
  @layer theme, base, mantine, components, utilities;
  @import "tailwindcss/theme.css" layer(theme);
  @import "tailwindcss/utilities.css" layer(utilities);
  /* Mantine CSS는 layer(mantine)으로 import */
  ```
  preflight가 없으면 Tailwind `border` 유틸리티가 선 모양(`border-style`) 없이 폭만 준다. 새 컴포넌트에 필요한 최소 초기화는 Mantine 화면에 닿지 않게 범위를 좁혀 둔다. 실제 동작은 이 PR에서 판매자 전체 화면 비교로 확인한다.
- 교체 화면: 어드민 → 설정 → 상품(옵션 재고 제외). 회차·주문·준비·재고와 앱 틀(사이드바·상단바)은 P4다.
- 1단계(외형 유지, §7)만 한다.
- 판매자 단위 테스트 중 Mantine 컴포넌트 자체에 묶인 것(`SegmentedTabs.test.tsx`의 `Group` 탐색, `ReviewCard.test.tsx`)은 그 화면을 바꿀 때 같이 고친다.

### P3. 기사 앱 (12개 파일, 12/2 이후 병합)
- 기사 앱을 연결하고 1단계만 한다(`design-direction.md` D4 미확정).
- `driver-design-system.spec.ts`의 인증 화면 묶음을 로컬에서도 돌게 고친다(P0 참고).
- 병합 전에 실제 휴대폰에서 기사 계정으로 확인한다(도착 사진·완료 처리·서비스워커). 휴대폰은 클라우드 컨테이너의 `next start`에 붙을 수 없고, 운영 빌드에서는 로컬 로그인이 꺼진다. 확인 방법(Preview 테스트 로그인 등)은 이 단계 시작 때 정한다.

### P4. 판매자 앱 틀·회차·주문·준비·재고 (12/2 이후 병합)
- 앱 틀(사이드바·상단바) → 회차·주문·준비 → 재고 → 정산 순서로 나눈다.
- 다음 회차가 잡혀 있으면, 회차 운영 동선 묶음은 끝까지 교체된 상태로만 그 회차의 마지막 출시에 넣는다. 판매자 대표가 실제 계정으로 한 번 끝까지 써 보고, 직전 seller 배포 ID를 롤백 대상으로 기록한다.

### P5. 소비자 앱 (51개 파일, 12/2 이후 병합)
- 첫 PR에서 소비자 앱을 연결한다.
- 결제와 무관한 화면(홈·검색·마이페이지·법정 고지) → 결제 동선(상품 상세 → 장바구니 → 결제 → 주문 완료 → 내 주문) 순서로 나눈다.
- 결제 동선은 실제 결제·환불 1건으로 확인한다. 로컬 E2E는 PortOne을 stub으로 막아 결제창 호출 경로를 확인하지 못한다(`consumer-round-direct.spec.ts`).
- 결제·장바구니 단위 테스트(`checkout/page.test.mjs` 등)는 허용한 모듈 밖의 import에서 예외를 던진다. 새 `@greenhub/ui` import마다 허용 목록을 같이 고친다.
- 예전 판매(legacy·공동구매) 화면은 컴포넌트만 바꾸고 구성은 바꾸지 않는다(`design-standard.md` §5).

### P6. 정리
- 세 앱과 `packages/ui`에서 `@mantine/*`, `postcss-preset-mantine`, `postcss-simple-vars`, `theme.ts`, `style.css`의 Mantine 보정을 제거한다. §4에서 기존 이름에 맞춰 둔 값(`--border` 묶음 값 등)은 이때 shadcn 방식으로 정리한다.
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
  - 끝나는 조건: P0.5의 기계 비교에서 차이 난 화면이 0이거나, 남은 차이마다 PR에 화면별 사유가 있고 사람이 확인판에서 승인했다. 시각 고정·픽셀 비교·화면별 사유 중 하나라도 없으면 끝난 것으로 보지 않는다.
  - Mantine 보정이 사라져 생기는 차이(Badge 한글 잘림 등)는 사유로 넘기지 말고 맞춘다.
  - 이 단계에는 Taste Skill을 쓰지 않는다. Taste의 redesign 절차는 스택 교체가 없는 개편을 전제하고(taste `SKILL.md`:493), lint FAIL을 고치면 외형이 바뀌기 때문이다.
- **② 방향 적용**
  - `design-direction.md`에서 해당 D 결정이 확정됐고 동결(§8) 구간이 아닐 때만 한다. 첫 회차 배송 전에는 하지 않는다.
  - Taste 절차의 "dealt direction"은 `design-direction.md`다. `draw.mjs`로 방향을 새로 뽑지 않는다. 개편 전 기록 → 적용 → 결과 증명(`SKILL.md`:485·502)을 따른다. 로그인해야 보이는 화면은 `inspect.mjs`가 열지 못하므로 개편 전후 기록을 `shots.mjs` 촬영으로 대신한다.
  - ①과 ②는 별도 PR이라 전후 비교의 원인이 하나씩이다.
- 버튼 `#007A43`처럼 전체에 걸리는 확정 값은 화면마다 넣지 않는다. 토큰·variant를 고치는 PR 하나로 적용하되, Mantine과 같이 쓰는 동안은 `theme.ts`와 새 `globals.css`를 같이 바꾼다. 소비자 앱도 바뀌므로 소비자 동결이 끝난 뒤에 한다.
- 구성을 통째로 바꾸는 화면(소비자 홈 도감 타일, 판매자 주문 화면 등)은 ①을 건너뛸 수 있다. 단 그 앱 spec이 P0.5 로컬 실행기에서 건너뜀 0으로 돌 때만이다. 판매자 주문 spec은 자격 정보가 없으면 건너뛰므로, 지금 상태로는 건너뛸 수 없다.

## 8. 일정 제약

첫 회차는 주문이 2026-11-22 10:00에 열리고 12/1 00:00~09:00에 배송한다(2026-10-28 결정, `docs/BACKLOG.md` PORTONE-CHANNEL-CHECK). 카카오페이 가맹점 심사는 심사용 "11월 특별 회차"(10/28~11/11)로 진행 중이지만 8/31 신청 뒤 아직 "심사중"이다. 승인 뒤에도 카드사 심사가 남고, PortOne 접수 90일 자동 철회 기한이 약 11/29다. 심사 뒤 LIVE 채널 전환·운영 배포·실결제 확인이 11/22 전에 끝나지 않으면 회차를 다시 미룬다. 따라서 동결은 날짜가 아니라 **상태**로 정한다.

운영 배포는 `main`에 있는 SHA 하나로 프런트 세 앱을 차례로 내보내고, 바뀐 것이 없는 앱은 빌드를 생략한다(`production-deploy.yml`, `scripts/vercel/ignore-build.mjs`). 다음 변경은 소비자 앱을 다시 빌드하게 한다.
- `apps/consumer`, 의존 패키지 `packages/ui`·`packages/shared`
- 루트 `package.json`·`pnpm-lock.yaml`·`pnpm-workspace.yaml`·`tsconfig.base.json`·`.vercelignore`·`scripts/vercel/`
- 빌드 생략 규칙이 분류하지 않은 경로(예: `.claude/`). 분류되지 않은 경로가 바뀌면 세 앱 모두 다시 빌드한다

앱 하나만 골라 동결할 수 없으므로, 동결은 **무엇을 `main`에 병합하는가**로 정한다. `main`에 들어간 코드는 그 뒤의 모든 배포에 실린다.

**마지막 출시**: 첫 회차 전 마지막 출시는 LIVE 채널 전환과 #426을 담은 출시 하나로 본다. 교체 병합은 "LIVE 출시 후보 SHA를 정할 때"와 "주문 오픈 3일 전(11/19)" 중 이른 쪽에 멈춘다.

| 구간 | 병합할 수 있는 것 |
|---|---|
| 지금 ~ 마지막 출시 후보 확정 | P0~P2. 단 소비자 앱을 다시 빌드하게 하는 변경(위 목록)은 세 앱 촬영이 `main`과 차이 0일 때만. `apps/consumer`와 `packages/ui`의 기존 파일 수정은 금지 |
| 후보 확정 ~ 첫 회차 배송 완료 다음 날(12/2) | 수정과 revert만. 교체·도구·스킬 병합은 금지. 후보 SHA의 원격 E2E가 실패하면 그 수정은 병합할 수 있다 |
| 12/2 이후 | P3~P6을 순서대로 병합한다 |

- 롤백: 운영을 직전 배포 ID로 되돌리면 `main`에는 원인 코드가 남는다. 다음 배포에 다시 실리지 않게 revert PR을 병합한다(동결 중에도 허용).
- 수정 배포 직전에는 운영 SHA와 비교해 위 목록의 경로 차이가 수정분뿐인지 확인한다.
- LIVE 채널 키처럼 환경 변수만 바꾼 배포는 같은 SHA면 소비자 빌드가 생략되면서 성공으로 기록된다. 이때는 `production-deploy.mjs vercel --require-build=true`로 새 빌드를 강제하거나, 생략을 실패로 보고 다시 배포한다.
- 회차가 다시 미뤄지면 구간이 함께 움직인다("마지막 출시 = 주문 오픈 3일 전", "병합 재개 = 배송 완료 다음 날"). 소비자 동결이 한없이 길어지면(카카오페이 심사 철회 등) 그 시점에 이 표를 사람이 다시 정한다.
- 강제: P0.5의 CI 경로 검사가 막는다. 문서 규칙만으로는 10/24에 동결 중 배포가 있었다(`docs/memory.md`). M2를 확정하면 `docs/memory.md`의 "현재 release residual"에 구간을 적어 릴리스 세션이 배포 전에 확인하게 한다.

## 9. 단계별 검증

- 로컬: `pnpm typecheck`, `pnpm lint`(Biome), 바뀐 앱의 단위 테스트, `pnpm build`.
- 화면: P0.5의 촬영·기계 비교(390·768·1280px, 시각 고정)와 `design-direction.md` §7 검수 기준. `packages/ui`나 루트 설정을 바꾸는 PR은 세 앱을 모두 찍는다.
- E2E: 교체 PR마다 바뀐 앱의 spec 묶음을 P0.5 로컬 실행기로 돌린다. 대상은 루프백, 건너뜀 0, `main` 기준 결과와 비교한다. 원격 회차 E2E는 `consumer-round-direct`·`seller-sale-rounds`·`driver-direct-delivery`와 세션 spec만 돌기 때문에(`.github/workflows/e2e-round-direct.yml`), 장바구니·결제·어드민·design-system spec은 로컬 실행이 유일한 증거다. 원격 Preview·E2E는 병합을 모은 최종 `main` SHA로 배포 직전에 1회만 실행한다(`AGENTS.md` §0-9).
- 디자인 검수(② 단계만): Taste `inspect.mjs`는 로그인 없이 열리는 화면만 검사할 수 있다. 앱 화면 lint는 `lint.mjs --app`을 명시한다(`.taste-skill/direction.json`이 없으면 page 모드가 되어 `h-px` 구분선 등이 FAIL로 나온다). 결과는 권고로 쓰고 병합 게이트로 쓰지 않는다. 컨테이너에서는 `--no-sandbox` 래퍼가 필요하다(P0.5).
- 성능: 앱별 JS·CSS 번들 크기를 교체 전후로 기록한다(`docs/specs/perf/bundle-optimization.md` 기준).

## 10. 결정이 필요한 것

| # | 결정 | 제안 (2라운드 반영) |
|---|---|---|
| M1 | 화면 변경을 같이 할지(§7) | C. 화면별 2단계. ①은 시각 고정·픽셀 비교·화면별 사유로 판정하고 Taste를 쓰지 않는다. ②는 `design-direction.md`를 방향으로 삼아 첫 회차 배송 뒤에만 한다 |
| M2 | 동결(§8) | 상태·병합 기준. 마지막 출시 = LIVE 출시, 후보 확정(늦어도 11/19) 뒤로는 수정·revert만 병합. 소비자를 다시 빌드하게 하는 변경은 세 앱 촬영 차이 0일 때만. P0.5의 CI 경로 검사로 강제 |
| M3 | 교체 순서(§6) | 첫 회차 전: P0 → P0.5 증명 도구 → P1 `packages/ui`(새 파일만) → P2 판매자 연결(preflight 없음) + 어드민·설정·상품. 12/2 이후: P3 기사 → P4 판매자 회차·주문·준비·재고 → P5 소비자 → P6 정리 |
| M4 | 스킬을 저장소에 넣을지 | Taste Skill만 넣는다(`evals` 제외, `.taste-skill/`은 `.gitignore`, `--no-sandbox` 래퍼 포함). 넣는 시점은 12/2 이후이거나, 그 전이면 빌드 생략 규칙에 `.claude/`를 등록하는 변경과 함께 마지막 출시 전에 넣는다. 쓰임은 ② 단계의 권고 검수로 한정한다. UI UX Pro Max는 넣지 않는다. 핵심 `shadcn.csv`는 Base UI 기준이라 참고할 수 있지만, `ui-styling` 하위 스킬이 Radix `asChild`·Tailwind v3 설정·HSL 값을 전제하고, `design` 스킬이 외부 이미지 API 키를 쓰며, `--persist`가 두 번째 디자인 기준 문서를 만든다. 우리 결정과 다른 규칙(native select 금지 `shadcn.csv`:21, 다크 모드 필수 :7)도 있다 |

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


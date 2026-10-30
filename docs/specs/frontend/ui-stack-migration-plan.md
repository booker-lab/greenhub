# Mantine → shadcn/ui + Tailwind CSS v4 + Base UI 교체 계획

> 작성 2026-10-28. 상태: **P0 완료, P1 전**. 사용자가 비용을 감수하고 교체하기로 했다(2026-10-28). M1~M4(§10)는 1라운드 검토(§11)를 반영한 제안이고 아직 확정 전이다.
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
- `.mantine-*` 클래스로 요소를 찾던 E2E를 역할·이름 기반 선택자로 바꾼다. Mantine 클래스 이름은 교체와 함께 사라지기 때문이다.
  - 어드민 모바일 카드 목록(가게·초대 기록·주문)은 `role="list"`/`listitem`을 붙이고, 테스트는 `tests/_helpers/admin-local.ts`의 `rowOrListItem`(표의 행 또는 목록 항목)으로 찾는다.
  - 정산 합계 카드는 `정산 합계` group 안의 카드별 group으로 찾는다.
  - 판매자 주문 탭은 `SegmentedTabs`의 `ariaLabel`("주문 상태") group 안의 버튼 글자로 건수를 확인한다.
  - 공동구매 진행률은 `progressbar` 역할로, 성능 회귀의 Badge 확인은 홈 상품 상태 태그 글자로 찾는다.
  - `driver-design-system.spec.ts`의 `--mantine-color-` 검사는 인라인 스타일에 Mantine 색 변수를 쓰지 말라는 규칙이라 교체 뒤에도 그대로 유효하다. 같은 파일의 카카오 버튼 색(:24-33)·Paper 테두리(:57-69)·하단 바 `borderTop`(:142-158) 검사는 인라인 `style`을 읽으므로 Tailwind 클래스로 바꾸면 동작이 같아도 실패한다. 이 셋은 P2에서 계산된 스타일(`getComputedStyle`) 기준으로 바꾼다.
- 기준 스크린샷은 따로 보관하지 않는다. `scripts/visual/README.md` 절차대로 각 교체 PR에서 main을 `--label before`, 작업 브랜치를 `--label after`로 찍어 비교한다(에뮬레이터 포트가 `dev:local`과 같아 둘을 동시에 띄우지 않는다).

### P1. 기반 (`packages/ui`와 기사 앱만 연결)
- `packages/ui`에 Tailwind v4와 shadcn(`-b base`)을 초기화하고 §4 토큰을 넣는다. 처음 쓸 컴포넌트(Button·Input·Field·Card·Badge·Dialog·Sheet·Sonner·Skeleton)를 설치한다. CLI는 먼저 `--dry-run`으로 바뀔 파일을 확인한다.
- 앱 연결(PostCSS의 `@tailwindcss/postcss`, `globals.css`의 공용 CSS import)은 **기사 앱에만** 한다. Tailwind preflight가 앱 전체에 걸려 "화면 변화 없음"이 보장되지 않기 때문이다. 판매자·소비자 앱은 각자 교체 단계의 첫 PR에서 연결한다.
- 같이 두는 동안의 CSS 우선순위: Mantine CSS를 cascade layer로 감싸(`@import "..." layer(mantine);`) Tailwind 유틸리티보다 아래에 둔다. Tailwind preflight와 Mantine baseline이 같은 요소를 다르게 초기화하지 않는지 확인한다.
- 옛 CSS 변수(`--font-size-sm`, `--radius-sm`, `--fw-bold`, `--font-size-md`, `--color-text-disabled` 등)는 P5까지 남긴다. `consumer-design-system.spec.ts` 등이 이 변수를 읽는다.
- 완료 기준: 기사 앱 스크린샷이 main과 차이 0, 세 앱 `pnpm build` 통과, CSS 번들 크기 증가 기록.

### P2. 기사 앱 (12개 파일)
- 가장 작은 앱으로 교체 방식(컴포넌트 대응, sonner, 휴대폰 레이아웃)을 먼저 검증한다.
- `design-direction.md` D4가 미확정이므로 1단계(외형 유지, §7)만 한다.
- `driver-design-system.spec.ts`의 인라인 스타일 검사 3개를 계산된 스타일 기준으로 바꾼다(P0 참고).
- 운영 배포 전에 운영 빌드(`next build && next start`)를 실제 휴대폰에서 기사 계정으로 확인한다(도착 사진·완료 처리·서비스워커). 확인하지 못하면 첫 회차 배송(12/1) 뒤로 미룬다.

### P3. 판매자·어드민 (121개 파일)
- 첫 PR에서 판매자 앱을 Tailwind에 연결한다.
- 여러 PR로 나눈다: 앱 틀(사이드바·상단바) → 회차·주문·준비 → 상품·재고 → 정산·설정 → 어드민.
- 회차·주문·준비 묶음은 끝까지 교체된 상태로만 첫 회차 전 마지막 출시(§8)에 넣는다. 다 끝내지 못하면 그 묶음은 12/1 배송 뒤로 미룬다. 반쯤 바뀐 준비 화면으로 회차를 운영하지 않기 위해서다.
- 첫 회차 전에 내보내면 판매자 대표가 실제 계정으로 회차·주문·준비 화면을 한 번 끝까지 써 보고, 직전 seller 배포 ID를 롤백 대상으로 기록한다.

### P4. 소비자 앱 (51개 파일)
- 첫 회차 배송이 끝나기 전에는 main에 병합하지 않는다(§8). 작업은 브랜치에서 할 수 있다.
- 첫 PR에서 소비자 앱을 Tailwind에 연결한다.
- 결제와 무관한 화면(홈·검색·마이페이지·법정 고지) → 결제 동선(상품 상세 → 장바구니 → 결제 → 주문 완료 → 내 주문) 순서로 나눈다. 결제 동선은 실제 결제·환불 1건으로 확인한다. 로컬 E2E는 PortOne을 stub으로 막아 결제창 호출 경로를 확인하지 못한다.
- 결제·장바구니 단위 테스트(`checkout/page.test.mjs` 등)는 허용한 모듈 밖의 import에서 예외를 던진다. 새 `@greenhub/ui` import마다 테스트 허용 목록을 같이 고친다.
- 예전 판매(legacy·공동구매) 화면은 컴포넌트만 바꾸고 구성은 바꾸지 않는다(`design-standard.md` §5).

### P5. 정리
- 세 앱과 `packages/ui`에서 `@mantine/*`, `postcss-preset-mantine`, `postcss-simple-vars`, `theme.ts`, `style.css`의 Mantine 보정을 제거한다.
- `design-standard.md`의 값 정본 표기(`theme.ts`)를 새 위치로 바꾸고, 앱별 `AGENTS.md`의 글꼴 크기 예외 표를 새 컴포넌트 이름으로 갱신한다.
- `docs/specs/perf/mantine-treeshaking.md`는 역사 자료로 표시한다.

## 7. 화면 변경을 같이 할지

| 방법 | 내용 | 장단점 |
|---|---|---|
| A. 외형 유지 먼저 | 컴포넌트만 바꿔 같은 외형을 만든 뒤, 화면 방향은 나중에 따로 적용한다 | 회귀를 잡기 쉽다. 같은 화면을 두 번 고치고, 개편이 한참 뒤로 밀린다 |
| B. 화면별로 한 번에 | 화면 하나를 교체할 때 `design-direction.md`도 같이 적용한다 | 작업이 한 번이다. 의도한 변화가 전후 비교를 덮어 회귀가 묻힌다 |
| C. 화면별 2단계 (제안) | 화면마다 ① 외형 유지 교체 ② 확정된 방향 적용을 따로 한다 | A의 회귀 검출과 B의 진행 속도를 같이 얻는다. ①은 버리는 작업이 아니다 |

C의 규칙:
- ① 외형 유지 교체: `scripts/visual` before/after에서 **차이가 난 화면 목록이 0**이어야 끝난다. 차이가 남으면 ②로 넘어가지 않는다. 이 단계에는 Taste Skill의 redesign 절차를 적용하지 않는다(그 절차는 스택 교체가 없는 개편을 전제한다, taste `SKILL.md`:493).
- ② 방향 적용: `design-direction.md`에서 해당 D 결정이 확정됐을 때만 한다. Taste 절차대로 개편 전 기록 → 적용 → 결과 증명(같은 `SKILL.md`:485·502)을 거친다. ①과 ②는 별도 PR이고, 원인이 하나씩이라 전후 비교가 성립한다.
- 버튼 `#007A43`처럼 전체에 걸리는 확정 값은 ②에서 화면마다 넣지 않고 variant·토큰을 고치는 PR 하나로 적용한다.
- 구성을 통째로 바꾸는 화면(소비자 홈 도감 타일, 판매자 주문 화면 등)은 ①을 빼고 바로 ②로 갈 수 있다. 이 경우 그 앱 spec을 로컬 E2E로 돌리고, 옛 시각 계약을 검사하는 design-system spec은 같은 PR에서 이유를 적어 고친다.

## 8. 일정 제약

첫 회차는 주문이 2026-11-22 10:00에 열리고 12/1 00:00~09:00에 배송한다(2026-10-28 결정, `docs/BACKLOG.md` PORTONE-CHANNEL-CHECK). 카카오페이 가맹점 심사는 심사용 "11월 특별 회차"(10/28~11/11)로 진행 중이지만 8/31 신청 뒤 아직 "심사중"이다. 심사 뒤 LIVE 채널 전환·운영 배포·실결제 확인이 11/22 전에 끝나지 않으면 회차를 다시 미룬다. 따라서 동결은 날짜가 아니라 **상태**로 정한다.

운영 배포는 `main`에 있는 SHA 하나로 프런트 세 앱을 함께 내보낸다(`production-deploy.yml`의 SHA 확인과 "프런트 3개 배포" 단계). 앱 하나만 골라 동결할 수 없으므로, 동결은 **무엇을 `main`에 병합하는가**로 정한다. `main`에 들어간 교체 코드는 그 뒤의 모든 배포(결제 핫픽스 포함)에 실린다.

| 구간 | 소비자 교체 | 판매자·기사 교체 |
|---|---|---|
| 지금 ~ 첫 회차 배송 완료(12/1 09:00, 환불 처리 여유를 두고 12/2) | `main` 병합 금지(브랜치 작업만) | 아래 두 구간을 따른다 |
| 지금 ~ 첫 회차 전 마지막 출시(11/19) | — | 병합 가능. 단 병합하는 순간 어느 배포에든 실릴 수 있으므로, 병합 전에 로컬 증명(§9)을 모두 끝낸다 |
| 11/19 마지막 출시 이후 ~ 배송 완료 | — | 병합 금지. 수정 배포만 한다 |

- 11/19 출시: 그 SHA로 원격 회차 E2E를 통과한 뒤 배포한다. 실패하면 로컬에서 고쳐 1회 다시 돌릴 여유로 11/20~21을 남긴다.
- 회차가 다시 미뤄지면 구간이 함께 움직인다: "마지막 출시 = 주문 오픈 3일 전", "병합 재개 = 배송 완료 다음 날".
- 수정 배포 직전에는 운영 SHA와 비교해 `apps/consumer`·`packages/ui`·`pnpm-lock.yaml` 차이가 수정분뿐인지 확인한다. lockfile은 세 앱을 모두 다시 빌드하게 하는 입력이다(`scripts/vercel/ignore-build.mjs`).
- 이 동결은 문서 규칙일 뿐 도구가 막지 않는다(10/24에 동결 중 배포가 있었다, `docs/memory.md`). M2를 확정하면 `docs/memory.md`의 현재 릴리스 상태에 동결 구간을 적어, 릴리스 세션이 배포 전에 확인하게 한다.

## 9. 단계별 검증

- 로컬: `pnpm typecheck`, `pnpm lint`(Biome), 바뀐 앱의 단위 테스트, `pnpm build`, 필요하면 운영 빌드(`next start`)로 화면 확인.
- 화면: `scripts/visual/` before/after 스크린샷과 `design-direction.md` §7 검수 기준. `shots.mjs`는 지금 390·1280px만 찍는다. 판매자의 1100px 이하 배치(`design-direction.md` §5)를 보려면 P3 전에 768px 촬영을 추가한다. 판정은 사람이 확인판에서 눈으로 하며 픽셀 자동 비교는 없다.
- E2E: **교체 PR마다 바뀐 앱의 spec 전체를 로컬 E2E로 돌린다.** 원격 회차 E2E는 `consumer-round-direct`·`seller-sale-rounds`·`driver-direct-delivery`와 세션 spec만 돌기 때문에(`.github/workflows/e2e-round-direct.yml`), 장바구니·결제·어드민·design-system spec은 로컬 실행이 유일한 증거다. 원격 Preview·E2E는 병합을 모은 최종 `main` SHA로 배포 직전에 1회만 실행한다(`AGENTS.md` §0-9).
- 디자인 검수: Taste `inspect.mjs`는 Chromium이 필요하다. 클라우드 컨테이너에는 `/opt/pw-browsers/chromium`이 있어 `CHROME_PATH`로 넘기면 돈다(`--no-sandbox` 필요).
- 성능: 앱별 JS·CSS 번들 크기를 교체 전후로 기록한다(`docs/specs/perf/bundle-optimization.md` 기준).

## 10. 결정이 필요한 것

| # | 결정 | 제안 (1라운드 반영) |
|---|---|---|
| M1 | 화면 변경을 같이 할지(§7) | C. 화면별 2단계: ① 외형 유지 교체(전후 차이 0) ② 확정된 방향 적용 |
| M2 | 동결(§8) | 상태·병합 기준. 소비자 교체는 첫 회차 배송 완료까지 `main` 병합 금지. 판매자·기사 교체는 11/19 마지막 출시까지만 병합 |
| M3 | 교체 순서(§6) | P1(`packages/ui`+기사 연결) → 기사 → 판매자·어드민 → 소비자(결제 외 → 결제 동선) |
| M4 | 스킬을 저장소에 넣을지 | Taste Skill만 `.claude/skills/`에 넣는다(`evals` 제외, `.taste-skill/`은 `.gitignore`). 확정 방향은 `design-direction.md`이고, 교체 PR에서는 `lint`·`inspect`·`critique`만 쓰며 `draw.mjs`로 방향을 새로 뽑지 않는다는 규칙을 함께 둔다. UI UX Pro Max는 넣지 않는다: `ui-styling`이 Radix `asChild`·Tailwind v3 설정·HSL 값을 전제해 `-b base`와 어긋나고, `design` 스킬이 외부 이미지 API 키를 쓰며, `--persist`가 두 번째 디자인 기준 문서를 만든다 |

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

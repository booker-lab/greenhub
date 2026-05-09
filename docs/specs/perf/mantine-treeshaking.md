# 성능 최적화 6순위 — Mantine CSS Treeshaking

> 작성: 2026-04-27 / 수정: 2026-04-28
> 목표: Consumer/Seller/Driver 전체 CSS 번들 -20~30KB + Pretendard 폰트 self-hosting (PWA SW 에러 해소)

---

## 정합성 검토

### 현황 파악

```css
/* apps/consumer/src/app/globals.css (동일 패턴 seller, driver) */
@import '@mantine/core/styles.css';   /* ← 전체 Mantine CSS 로드 */
@import '@greenhub/ui/style.css';
```

- `@mantine/core/styles.css`는 Mantine v7의 **모든 컴포넌트 CSS**를 포함
- 실제로 consumer 앱이 사용하지 않는 컴포넌트(DatePicker, RichTextEditor, Carousel 등) CSS도 포함됨
- Mantine v7은 컴포넌트별 개별 CSS 파일 제공: `@mantine/core/styles/Button.css` 등

### Mantine v7 CSS 구조

```
@mantine/core/styles.css          → 전체 (~100KB raw, ~30KB gzip)
@mantine/core/styles/Button.css   → Button만 (~2KB)
@mantine/core/styles/Text.css     → Text만 (~1KB)
...
```

### 각 앱 사용 컴포넌트 조사 필요 (T0)

| 앱 | 확인 방법 |
|----|-----------|
| Consumer | `grep -r "from '@mantine/core'" apps/consumer/src` |
| Seller | `grep -r "from '@mantine/core'" apps/seller/src` |
| Driver | `grep -r "from '@mantine/core'" apps/driver/src` |
| @greenhub/ui | `grep -r "from '@mantine/core'" packages/ui/src` |

### 주의사항

- `@greenhub/ui` 패키지도 Mantine 컴포넌트 사용 → **공유 패키지 포함 조사 필수**
- Modal, Notification, Drawer 등 **동적으로 렌더링되는 컴포넌트** CSS 누락 위험
- `postcss-preset-mantine`은 CSS 변수 처리용 → **삭제 금지**
- Mantine 내부에서 다른 컴포넌트를 참조하는 경우 (예: Select → Combobox) → 의존 CSS도 함께 import 필요
- `ColorSchemeScript`는 CSS 없이 JS만 사용 → 무시

---

## 아토믹 태스크

### T0 — 사용 컴포넌트 전체 목록 추출 (착수 전 필수)

```bash
# 싱글/더블쿼트 모두 잡기 위해 mantine/core 패턴 사용
# Consumer
grep -rh "mantine/core" apps/consumer/src --include="*.tsx" --include="*.ts" \
  | grep -o '{[^}]*}' | tr ',' '\n' | sed 's/[{ ]//g' | sort -u

# Seller
grep -rh "mantine/core" apps/seller/src --include="*.tsx" --include="*.ts" \
  | grep -o '{[^}]*}' | tr ',' '\n' | sed 's/[{ ]//g' | sort -u

# Driver
grep -rh "mantine/core" apps/driver/src --include="*.tsx" --include="*.ts" \
  | grep -o '{[^}]*}' | tr ',' '\n' | sed 's/[{ ]//g' | sort -u

# 공유 UI 패키지
grep -rh "mantine/core" packages/ui/src --include="*.tsx" --include="*.ts" \
  | grep -o '{[^}]*}' | tr ',' '\n' | sed 's/[{ ]//g' | sort -u
```

결과에서:
1. 컴포넌트 목록 정리
2. 각 컴포넌트의 CSS 파일 존재 여부 확인: `ls apps/consumer/node_modules/@mantine/core/styles/`
3. **Mantine v9 주의**: `Select.css` 없음 → `Combobox.css`로 통합됨. CSS 내부 @import 없음 → 의존 CSS 직접 import 필요

**이 목록 없이 T1 진행 금지.**

---

### T1 — @mantine/core/styles.css → 선택적 import 전환

T0 결과를 바탕으로 각 앱의 `globals.css` 수정.

**예시 (T0 결과 기반으로 실제 목록 채워야 함)**:

```css
/* globals.css — 전체 import 제거 후 컴포넌트별 import */

/* Core (항상 필요) */
@import '@mantine/core/styles/global.css';
@import '@mantine/core/styles/ScrollArea.css';
@import '@mantine/core/styles/UnstyledButton.css';
@import '@mantine/core/styles/VisuallyHidden.css';
@import '@mantine/core/styles/Paper.css';
@import '@mantine/core/styles/Notification.css';
@import '@mantine/core/styles/Overlay.css';
@import '@mantine/core/styles/ModalBase.css';
@import '@mantine/core/styles/CloseButton.css';

/* 실제 사용 컴포넌트 (T0 결과로 채울 것) */
@import '@mantine/core/styles/Button.css';
@import '@mantine/core/styles/Text.css';
/* ... */

@import '@greenhub/ui/style.css';
```

**정합성 주의**:
- `global.css`는 필수 (CSS 변수, 기본 reset)
- Modal/Drawer/Popover 계열은 `ModalBase.css`, `Overlay.css`, `CloseButton.css` 의존
- Select/Combobox는 `Combobox.css` 필요
- `@greenhub/ui/style.css`가 어떤 Mantine CSS에 의존하는지 확인 필요

---

### T2 — @greenhub/ui 패키지 style.css 확인 및 Pretendard self-hosting 전환

```bash
cat packages/ui/src/style.css
```

**Mantine 중복 확인**:
- ui 패키지가 자체 `@import '@mantine/core/styles.css'`를 포함 시 → 중복 로드
- 중복 시: ui 패키지의 Mantine CSS import 제거, 각 앱이 직접 관리

**Pretendard self-hosting 전환** (PWA SW `ERR_FAILED` 해소):
- 현재: `packages/ui/src/style.css`에서 jsdelivr CDN `@import` 사용
- 문제: `aggressiveFrontEndNavCaching` 서비스워커가 외부 CDN 캐싱 실패 → 폰트 로드 오류
- 해결: Pretendard Variable 폰트 파일을 `packages/ui/public/fonts/` 또는 각 앱 `public/fonts/`에 복사 후 `@font-face` 직접 선언
- 참고: `pretendard` npm 패키지 또는 직접 다운로드 가능

```bash
# pretendard 패키지 설치 여부 확인
cat pnpm-lock.yaml | grep pretendard
```

---

### T3 — 3개 앱 모두 동일하게 적용

Consumer 검증 후 Seller, Driver에도 동일한 선택적 import 패턴 적용.

---

### T4 — 시각적 회귀 검사 (필수)

빌드 후 각 앱의 주요 페이지 직접 확인:
- Consumer: 홈, 상품 목록, 상품 상세, 장바구니, 마이페이지
- Seller: 대시보드, 상품 등록, 주문 목록
- Driver: 대시보드, 배송 목록

CSS 누락으로 인한 스타일 깨짐 여부 확인. 깨진 컴포넌트 발견 시 해당 CSS 추가.

---

### T5 — tsc + 빌드 + CSS 크기 비교

```bash
pnpm --filter consumer exec tsc --noEmit
pnpm --filter seller exec tsc --noEmit
pnpm --filter driver exec tsc --noEmit

# CSS 번들 크기 비교
ls -la apps/consumer/.next/static/css/
```

T0 기준선 대비 CSS 크기 개선 수치 기록.

---

### T6 — Lighthouse 재측정

```bash
curl -I https://www.greenlove.co.kr  # 5순위 완료 후 병행
```

Performance 점수 + CSS 관련 감사 항목 개선 확인.

---

## 기대 효과

| 항목 | 현재 | 목표 |
|------|------|------|
| Mantine CSS | ~30KB (gzip) | ~15~20KB |
| CSS 파싱 시간 | — | -10~20ms TBT |
| 전체 앱 적용 시 | 3앱 × 30KB | 각 앱 맞춤 CSS |

---

## 실행 순서

```
T0(컴포넌트 목록 추출) → T1(Consumer globals.css) → T2(ui 패키지 확인) 
→ T3(Seller·Driver) → T4(시각적 회귀) → T5(빌드 검증) → T6(재측정)
```

---

## 한계 및 주의

- Mantine CSS 파일 구조는 버전마다 다름 → **`node_modules/@mantine/core/styles/` 실제 파일 목록 기준으로 작업**
- 개선 효과가 예상보다 작을 수 있음 (CSS는 gzip 압축 효율이 높아 실제 전송 크기 차이 적음)
- 시각적 회귀 위험이 있으므로 **T4 생략 금지**

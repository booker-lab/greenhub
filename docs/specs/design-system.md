# Green Love 디자인 시스템 지침

> 최초 확정: 2026-04-25  
> 대상 앱: consumer → seller → driver (순차 적용)

---

## 1. 핵심 원칙

- **프라이머리 컬러 1개 원칙** — 보조색 지정 없음
- **로직 불변 원칙** — 디자인 리팩토링 시 비즈니스 로직·훅·API 호출 코드 일절 수정 금지. UI 레이어만 변경
- **var() 단일 출처 원칙** — 모든 스타일 값은 `packages/ui/src/style.css` 의 CSS 변수로만 참조. 컴포넌트 내 hex·숫자 하드코딩 금지
- **Mantine prop 하드코딩 금지** — `c="brand.6"`, `fw={700}` 등 Mantine 인라인 prop 금지. `style={{ color: 'var(--color-primary)' }}` 형태로 통일

---

## 2. 컬러 토큰

```css
--color-primary: #2D6A4F;        /* 포레스트 그린 — 버튼, 링크, 강조 */
--color-primary-dark: #1B4332;   /* hover, pressed 상태 */
--color-primary-light: #52B788;  /* 보조 강조 (아이콘, 뱃지 배경) */
--color-primary-surface: #F2FBF6; /* 그린 틴트 배경 */

--color-bg: #FFFFFF;             /* 앱 전체 배경 */
--color-surface: #FFFFFF;        /* 카드 배경 */
--color-border: #E8E8E8;         /* 카드·입력 테두리 */
--color-text: #111111;           /* 본문 텍스트 */
--color-text-secondary: #555555; /* 보조 텍스트 */
--color-text-disabled: #AAAAAA;  /* 비활성 텍스트 */
```

---

## 3. 타이포그래피

- **패밀리**: Pretendard (CDN dynamic-subset)
- **허용 weight**: Light(300) / Medium(500) / Bold(700) — 3개만 사용
- **최소 폰트 사이즈**: 15px

```css
--font-family: 'Pretendard Variable', Pretendard, -apple-system, system-ui, sans-serif;
--fw-light: 300;
--fw-medium: 500;
--fw-bold: 700;

--font-size-sm: 15px;   /* 최소값 — 캡션, 보조 텍스트 */
--font-size-md: 16px;   /* 본문 */
--font-size-lg: 18px;   /* 소제목 */
--font-size-xl: 20px;   /* 제목 */
--font-size-2xl: 24px;  /* 페이지 타이틀 */
```

---

## 4. 레이아웃 & 형태

```css
--radius: 16px;                         /* 카드, 버튼, 입력 기본 반경 */
--radius-sm: 8px;                       /* 뱃지, 소형 요소 */
--radius-full: 9999px;                  /* 알약형 */
--border: 1px solid var(--color-border); /* 카드·입력 테두리 */
```

- **카드 스타일**: 보더(border) 방식 — 그림자(shadow) 사용 금지
- **그라디언트**: 금지 — 플랫 미니멀 디자인

---

## 5. 아이콘

- **전용 세트**: [lucide-react](https://lucide.dev) 단독 사용
- **다른 아이콘 세트 추가 금지**

---

## 6. style.css 구조

```
packages/ui/src/style.css         ← 공통 토큰 (색상·폰트·반경 등) + Badge 한글 fix
apps/consumer/src/app/globals.css ← @import + consumer 전용 body padding만
apps/seller/src/app/globals.css   ← @import + seller 전용 body padding만
apps/driver/src/app/globals.css   ← @import + driver 전용 body padding만
```

---

## 7. 진행 단계

| 단계 | 내용 | 상태 |
|------|------|------|
| 1 | 비주얼 방향 결정 | ✅ 2026-04-25 |
| 2 | 디자인 시스템 정비 (`style.css` + `theme.ts`) | ✅ 2026-04-25 |
| 3 | 컴포넌트 구조 개선 | ✅ 2026-04-25 |
| 4 | 모바일 UX 개선 | ✅ 2026-04-25 |

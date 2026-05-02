# a11y 접근성 수정 계획

> 작성일: 2026-05-03
> 발견 경위: Biome 2.4.14 도입 시 신규 검출 (기존 ESLint 미체크 상태였음)
> 총 38건 — 현재 biome.json에서 `warn` 수준으로 설정됨

---

## 우선순위 1 — `useButtonType` (5건)

`<button>` 요소에 `type` 속성이 없으면 폼 안에서 기본값 `type="submit"`으로 동작하여 의도치 않은 폼 제출이 발생할 수 있습니다.

### 대상 파일

```
apps/consumer/src/components/ProductTopBar.tsx  (3건: line 40, 71, 89)
```

나머지 2건은 seller/driver에 있을 수 있음 — 아래 명령으로 확인:

```bash
pnpm biome lint apps/consumer/src apps/seller/src apps/driver/src --max-diagnostics=500 2>&1 | grep useButtonType
```

### 수정 방법

```tsx
// before
<button onClick={handleBack}>

// after
<button type="button" onClick={handleBack}>
```

### 완료 기준

`pnpm biome lint` 실행 시 `useButtonType` 0건

---

## 우선순위 2 — `noSvgWithoutTitle` (32건)

장식용 SVG 아이콘에 접근성 정보가 없습니다. 스크린 리더가 빈 내용을 읽거나 불필요한 내용을 읽습니다.

### 두 가지 수정 패턴

**패턴 A: 장식용 아이콘 (대부분)** — `aria-hidden="true"` 추가

```tsx
// before
<svg viewBox="0 0 24 24">...</svg>

// after
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">...</svg>
```

**패턴 B: 의미 있는 아이콘** — `<title>` 추가

```tsx
// before
<svg viewBox="0 0 24 24">
  <path d="..." />
</svg>

// after
<svg viewBox="0 0 24 24" role="img" aria-labelledby="icon-title">
  <title id="icon-title">장바구니</title>
  <path d="..." />
</svg>
```

### 대상 파일 확인 명령

```bash
pnpm biome lint apps/consumer/src apps/seller/src apps/driver/src --max-diagnostics=500 2>&1 | grep "noSvgWithoutTitle" -B 5 | grep "\.tsx"
```

### 완료 기준

`pnpm biome lint` 실행 시 `noSvgWithoutTitle` 0건

---

## 우선순위 3 — `noAutofocus` (1건)

`autofocus` 속성은 스크린 리더 사용자의 포커스 흐름을 방해할 수 있습니다.

### 대상 파일 확인 명령

```bash
pnpm biome lint apps/consumer/src apps/seller/src apps/driver/src 2>&1 | grep noAutofocus
```

### 수정 방법

- `autofocus` 속성 제거
- 필요 시 `useEffect`에서 프로그래밍 방식으로 포커스 이동 (`ref.current?.focus()`)

---

## 작업 순서

```
T1  useButtonType 5건 수정 → 커밋
  ↓
T2  noSvgWithoutTitle 32건 수정 (장식용/의미있는 아이콘 분류 후 일괄 처리) → 커밋
  ↓
T3  noAutofocus 1건 수정 → 커밋
  ↓
T4  biome lint 재실행 → warn 0건 확인 → biome.json에서 a11y warn 설정 제거 → error로 승격
```

### T4 완료 후 biome.json 수정

```json
// 제거할 항목 (warn 설정)
"a11y": {
  "noSvgWithoutTitle": "warn",
  "useButtonType": "warn",
  "noAutofocus": "warn"
}
// → 이 블록 전체 삭제 (recommended 기본값 error로 복귀)
```

---

## 예상 소요

| 단계 | 시간 |
|------|------|
| T1 useButtonType | 15분 |
| T2 noSvgWithoutTitle | 45분 |
| T3 noAutofocus | 10분 |
| T4 검증 및 설정 정리 | 10분 |
| **총계** | **~80분** |

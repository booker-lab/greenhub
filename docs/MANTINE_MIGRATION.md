# Mantine 마이그레이션 가이드 & 트러블슈팅

driver 앱 마이그레이션(2026-04-03) 과정에서 발생한 문제와 해결책을 기록합니다.
consumer, seller 앱 마이그레이션 시 이 문서를 먼저 확인하세요.

---

## 체크리스트 (앱 마이그레이션 전 선행 작업)

- [ ] `package.json`에 `@mantine/core`, `@mantine/hooks` 버전을 **`^9.0.0`** 으로 명시 (lockfile과 일치)
- [ ] `postcss.config.mjs` — Tailwind 설정 제거, `postcss-preset-mantine` + `postcss-simple-vars` 추가
- [ ] `globals.css` — Tailwind `@tailwind` 지시어 제거, `@import '@mantine/core/styles.css'` 추가
- [ ] `layout.tsx` — `<html>` 태그에 `suppressHydrationWarning` 추가, `<head>`에 `<ColorSchemeScript />` 추가
- [ ] `providers.tsx` — `MantineProvider theme={theme}` 래핑, `@greenhub/ui`에서 theme import
- [ ] `pnpm install --no-frozen-lockfile` 실행 후 lockfile 커밋

---

## 트러블슈팅

### 1. ERR_PNPM_OUTDATED_LOCKFILE (Vercel 빌드 실패)

**증상:**
```
ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile"
specifiers in the lockfile don't match specifiers in package.json
- @mantine/hooks (lockfile: ^9, manifest: ^9.0.0)
```

**원인:**
- pnpm frozen-lockfile은 버전 스펙 **문자열 완전 일치** 요구 (`^9` ≠ `^9.0.0`)
- 로컬 `pnpm install`은 의미상 동일 범위면 "Already up to date"로 lockfile을 갱신하지 않음

**해결:**
1. 모든 `package.json`의 mantine 버전을 **`^9.0.0`** 으로 통일
   - `apps/{앱}/package.json`
   - `packages/ui/package.json` (peerDependencies + devDependencies 모두)
2. `pnpm install --no-frozen-lockfile` 실행 (lockfile 강제 재생성)
3. `pnpm-lock.yaml` 커밋 후 푸시

**예방:** 처음부터 `^9.0.0` 형식으로 통일해서 작성

---

### 2. Hydration Mismatch (`data-mantine-color-scheme`)

**증상:**
```
Warning: Prop `data-mantine-color-scheme` did not match. Server: "light" Client: undefined
```

**원인:**
- Mantine 컬러 스킴이 SSR과 클라이언트 간 불일치

**해결:**
```tsx
// layout.tsx
<html lang="ko" suppressHydrationWarning>  {/* ← 추가 */}
  <head>
    <ColorSchemeScript />  {/* ← 추가 */}
  </head>
```

---

### 3. TypeScript 오류 — `Cannot find module '@mantine/core'` (packages/ui)

**증상:**
```
Cannot find module '@mantine/core' or its corresponding type declarations
```

**원인:**
- `packages/ui`는 `@mantine/core`를 peerDependency로만 선언하고 devDependency에 없으면 TS가 타입을 못 찾음

**해결:**
```json
// packages/ui/package.json
{
  "peerDependencies": { "@mantine/core": "^9", "@mantine/hooks": "^9" },
  "devDependencies": { "@mantine/core": "^9.0.0", "@mantine/hooks": "^9.0.0" }
}
```

---

### 4. NextAuth `Configuration` 에러 (Vercel 로그인 실패)

**증상:**
```
/api/auth/error?error=Configuration
[auth][error] InvalidCheck: pkceCodeVerifier value could not be parsed
```

**원인 A — AUTH_SECRET 미설정:**
- Vercel 환경변수에 `AUTH_SECRET`이 없으면 NextAuth v5가 Configuration 에러 반환

**해결 A:** Vercel → Settings → Environment Variables에 `AUTH_SECRET` 추가 후 Redeploy

**원인 B — PKCE 도메인 불일치:**
- 프리뷰 URL(`xxx-git-main-xxx.vercel.app`)에서 로그인 시작
- 카카오가 프로덕션 URL(`greenhub-xxx.vercel.app`)로 콜백
- PKCE 쿠키가 다른 도메인이라 파싱 불가

**해결 B:** 반드시 **프로덕션 URL**에서 로그인 테스트
- `https://greenhubconsumer.vercel.app`
- `https://greenhub-seller.vercel.app`
- 프리뷰 URL에서 테스트 금지

---

## 마이그레이션 순서 (권장)

```
1. package.json 수정 (mantine 추가, tailwind 제거)
2. postcss.config.mjs 교체
3. globals.css 교체
4. layout.tsx 수정 (ColorSchemeScript + suppressHydrationWarning)
5. providers.tsx 수정 (MantineProvider 추가)
6. 각 페이지/컴포넌트 Tailwind → Mantine 컴포넌트 교체
7. pnpm install --no-frozen-lockfile
8. pnpm-lock.yaml + 변경파일 커밋
9. Vercel 환경변수 AUTH_SECRET 확인
10. 프로덕션 URL에서 E2E 검증
```

---

## 참고 — packages/ui 공유 테마

```ts
// packages/ui/src/theme.ts
import { createTheme, type MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = [
  '#F0FFF4','#D8F3DC','#95D5B2','#74C69D','#52B788',
  '#40916C','#2D6A4F','#1B4332','#163B2D','#0D2B1E',
];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  fontFamily: 'var(--font-geist-sans), -apple-system, sans-serif',
  defaultRadius: 'md',
});
```

driver 앱의 `apps/driver/src/app/providers.tsx`를 참고 템플릿으로 활용하세요.

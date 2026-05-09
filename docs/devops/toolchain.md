# 툴체인 도입 계획: TruffleHog + Just + Biome

> 작성일: 2026-05-03  
> 목적: 보안 스캔·태스크 러너·린터 통합 도입  
> 정합성 검토: 완료 (하단 §4 참조)

---

## 0. 현재 상태 스냅샷

| 앱 | ESLint | Prettier | lint 스크립트 |
|----|--------|----------|--------------|
| `apps/api` | `eslint.config.mjs` (커스텀 룰 3개) | `.prettierrc` (`singleQuote`, `trailingComma:all`) | `pnpm lint` |
| `apps/consumer` | Next.js 내장 (별도 config 없음) | 없음 | **없음** |
| `apps/seller` | Next.js 내장 (별도 config 없음) | 없음 | **없음** |
| `apps/driver` | Next.js 내장 (별도 config 없음) | 없음 | **없음** |
| root | `pnpm -r lint` (api만 실행됨) | — | — |

---

## Phase 1 — TruffleHog 보안 스캔

> 예상 소요: 30분 | 리스크: 없음 (읽기 전용)

### T1.1 — 바이너리 설치

```powershell
# Windows: winget 또는 scoop
winget install trufflesecurity.trufflehog
# 또는
scoop install trufflehog

# 설치 확인
trufflehog --version
```

### T1.2 — git 히스토리 전체 스캔

```bash
trufflehog git file://. --only-verified --json > trufflehog-report.json
```

- `--only-verified`: 실제 유효한 시크릿만 보고 (노이즈 제거)
- 결과가 비어 있으면 ✅ 통과

### T1.3 — 결과 검토 및 false positive 처리

결과에 항목이 있을 경우:

```yaml
# .trufflehog.yml (false positive 허용 목록)
detectors:
  - name: Generic
    allowlist:
      regexes:
        - "example\\.com"  # .env.example의 플레이스홀더
```

### T1.4 — `.trufflehog.yml` 커밋

```bash
git add .trufflehog.yml
git commit -m "chore: trufflehog allowlist 설정 추가"
```

### T1.5 — 완료 기준

- `trufflehog git file://. --only-verified` 실행 시 verified 시크릿 0건

---

## Phase 2 — Just 태스크 러너

> 예상 소요: 1시간 | 리스크: 없음 (기존 스크립트 래핑)

### T2.1 — 설치

```powershell
winget install Casey.Just
# 확인
just --version
```

### T2.2 — 루트 `Justfile` 생성

```makefile
# Justfile
# 기본 쉘 설정
set shell := ["bash", "-c"]

# ── 개발 ──────────────────────────────────────────────────
dev-consumer:
    pnpm --filter consumer dev

dev-api:
    pnpm --filter api start:dev

# ── 빌드 ──────────────────────────────────────────────────
build:
    pnpm build

build-api:
    pnpm --filter api build

# ── 린트 (Phase 3 완료 후 biome로 교체) ───────────────────
lint:
    pnpm -r lint

# ── 타입 체크 ──────────────────────────────────────────────
typecheck:
    pnpm -r typecheck

# ── 테스트 ────────────────────────────────────────────────
test-ds:
    pnpm --filter e2e exec playwright test consumer-design-system --reporter=list

test-e2e:
    pnpm test:e2e

# ── 보안 스캔 ──────────────────────────────────────────────
secret-scan:
    trufflehog git file://. --only-verified

# ── CI 파이프라인 ──────────────────────────────────────────
ci: lint typecheck test-e2e secret-scan
    @echo "✅ CI 완료"
```

### T2.3 — 동작 검증

```bash
just lint       # pnpm -r lint 와 동일한 결과
just typecheck  # pnpm -r typecheck 와 동일
just secret-scan
just --list     # 전체 레시피 목록 출력
```

### T2.4 — 커밋

```bash
git add Justfile
git commit -m "chore: just 태스크 러너 도입 (Justfile)"
```

### T2.5 — 완료 기준

- `just --list` 에서 모든 레시피 노출
- `just ci` 실행 시 순서대로 전체 파이프라인 통과

---

## Phase 3 — Biome 도입 (3단계 점진 전략)

> 예상 소요: 2~3시간 | 리스크: 포맷 diff 발생 가능 (로직 변경 없음)
>
> **전략**: ESLint를 즉시 삭제하지 않고 `consumer/seller/driver` → `api` 순으로 점진 교체

---

### 3-A. Biome 설치 및 공통 설정

#### T3.1 — 설치

```bash
pnpm add -D -w @biomejs/biome
```

(`-w` = workspace root에 설치)

#### T3.2 — `biome.json` 초기화

```bash
pnpm biome init
```

#### T3.3 — 현재 Prettier 설정과 일치하도록 `biome.json` 구성

```json
{
  "$schema": "https://biomejs.dev/schemas/1.x.x/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "off"
      }
    }
  },
  "files": {
    "ignore": [
      "node_modules",
      ".next",
      "dist",
      "*.tsbuildinfo",
      "apps/*/public/sw.js",
      "apps/*/public/workbox-*.js"
    ]
  }
}
```

**정합성 포인트**:
- `quoteStyle: "single"` ← `.prettierrc` `singleQuote: true` 대응
- `trailingCommas: "all"` ← `.prettierrc` `trailingComma: "all"` 대응
- `noExplicitAny: "off"` ← ESLint `@typescript-eslint/no-explicit-any: off` 대응

---

### 3-B. consumer / seller / driver 적용

> ESLint config가 없어서 biome만 추가하면 됨

#### T3.4 — 병렬 린트 실행 (비교 검증)

```bash
# Next.js 내장 ESLint 결과 확인
cd apps/consumer && npx next lint 2>&1 | tee /tmp/nextlint-consumer.txt

# Biome 결과 확인
pnpm biome lint apps/consumer/src 2>&1 | tee /tmp/biomelint-consumer.txt

# 두 결과 비교 — biome가 놓치는 게 있는지 확인
diff /tmp/nextlint-consumer.txt /tmp/biomelint-consumer.txt
```

**확인해야 할 Next.js 전용 규칙**:

| ESLint 플러그인 규칙 | Biome 대체 여부 | 대응 방안 |
|---------------------|----------------|----------|
| `no-img-element` | ❌ 없음 | next.config에 `images.dangerouslyAllowSVG` 제한으로 커버 |
| `no-html-link-for-pages` | ❌ 없음 | 코드 리뷰로 커버 (이미 `<Link>` 사용 중) |
| `no-sync-scripts` | ❌ 없음 | 해당 패턴 없음 (현재 코드베이스) |

> **판단**: consumer/seller/driver 코드베이스에서 Next.js 전용 규칙 위반이 없으므로 biome 전환 가능

#### T3.5 — 포맷 실행 및 diff 검토

```bash
# dry-run 먼저 (실제 변경 없음)
pnpm biome format apps/consumer/src apps/seller/src apps/driver/src --write=false

# 실제 적용
pnpm biome format apps/consumer/src apps/seller/src apps/driver/src --write
```

> **예상**: 미세한 공백·따옴표 정규화만 발생. 로직 변경 없음.

#### T3.6 — 포맷 변경만 별도 커밋

```bash
git add apps/consumer apps/seller apps/driver
git commit -m "style: biome format 적용 (consumer/seller/driver)"
```

#### T3.7 — package.json에 lint 스크립트 추가 (3개 앱)

각 앱 `package.json`의 `scripts`에 추가:

```json
"lint": "biome lint src",
"format": "biome format src --write"
```

#### T3.8 — 커밋

```bash
git commit -m "chore: biome lint 스크립트 추가 (consumer/seller/driver)"
```

---

### 3-C. api 적용 (커스텀 룰 대조 필수)

#### T3.9 — ESLint 커스텀 룰 → Biome 매핑 검증

| ESLint 룰 | Biome 동등 룰 | 상태 |
|-----------|--------------|------|
| `@typescript-eslint/no-explicit-any: off` | `suspicious.noExplicitAny: "off"` | ✅ 대응 가능 |
| `@typescript-eslint/no-floating-promises: warn` | `suspicious.noFloatingPromises: "warn"` | ✅ 대응 가능 |
| `@typescript-eslint/no-unsafe-argument: warn` | ❌ biome에 없음 | ⚠️ **공백 발생** |
| `prettier/prettier endOfLine: auto` | biome `formatter.lineEnding: "lf"` | ✅ 대응 가능 |

> `no-unsafe-argument`: 타입 불안전한 인자 전달을 잡는 규칙. NestJS 코드에서 `any` 타입 인자를 실수로 넘길 때 경고.  
> **결정**: api는 ESLint를 **유지하고** biome는 포매터로만 사용.

#### T3.10 — api에 biome 포매터만 적용

```bash
# ESLint는 유지, 포맷터만 biome로 교체
pnpm biome format apps/api/src --write
```

`apps/api/package.json` 수정:

```json
"format": "biome format src --write",
"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix"
```

`.prettierrc` 삭제 (biome가 대체):

```bash
rm apps/api/.prettierrc
```

`eslint.config.mjs`에서 prettier 플러그인 제거:

```js
// 삭제할 라인
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
// ...tseslint.config 에서 eslintPluginPrettierRecommended 제거
// rules에서 "prettier/prettier" 제거
```

#### T3.11 — 커밋

```bash
git add apps/api
git commit -m "chore(api): biome 포매터 적용, prettier 제거 (eslint 유지)"
```

---

### 3-D. Just 레시피 업데이트

#### T3.12 — `Justfile` lint 레시피 갱신

```makefile
# biome 도입 완료 후 교체
lint:
    pnpm biome lint apps/consumer/src apps/seller/src apps/driver/src
    pnpm --filter api lint

format:
    pnpm biome format apps/consumer/src apps/seller/src apps/driver/src --write
    pnpm --filter api format

# CI — 포맷 체크(--write=false)로 변경
ci: format-check lint typecheck test-e2e secret-scan
    @echo "✅ CI 완료"

format-check:
    pnpm biome format apps/consumer/src apps/seller/src apps/driver/src --write=false
    pnpm biome format apps/api/src --write=false
```

#### T3.13 — 최종 커밋

```bash
git add Justfile
git commit -m "chore: Justfile lint/format 레시피 biome 기준으로 갱신"
```

---

## §4 — 정합성 검토 체크리스트

### 포맷 정합성

- [x] `quoteStyle: "single"` ← `.prettierrc` `singleQuote: true`
- [x] `trailingCommas: "all"` ← `.prettierrc` `trailingComma: "all"`
- [x] api `.prettierrc` 삭제 시 ESLint prettier 플러그인도 동시 제거
- [x] `endOfLine: auto` → biome `lineEnding` 기본값(lf)으로 대체

### 린트 정합성

- [x] `noExplicitAny: off` 설정으로 기존 `any` 사용 코드 에러 없음
- [x] `no-floating-promises` biome 동등 룰 확인
- [x] `no-unsafe-argument` 공백 → api ESLint 유지로 보완
- [x] Next.js 전용 ESLint 룰(`no-img-element` 등) 위반 코드 없음 확인 후 전환

### 스크립트 정합성

- [x] root `pnpm -r lint` 기존 동작 유지 (api lint + 각 앱 biome lint)
- [x] `just ci` 실행 시 lint → typecheck → e2e → secret-scan 순서 보장
- [x] format-check는 `--write=false`로 CI에서 쓰기 금지

### 파일 정합성

- [x] `biome.json` ignore 목록에 `node_modules`, `.next`, `dist`, `*.tsbuildinfo` 포함
- [x] `sw.js`, `workbox-*.js` (PWA 빌드 생성 파일) ignore 포함
- [x] `apps/e2e` 는 biome lint 대상 외 (Playwright 전용)

---

## 실행 순서 요약

```
Phase 1  trufflehog 설치 → 스캔 → 결과 검토 → 커밋
   ↓
Phase 2  just 설치 → Justfile 작성 → 검증 → 커밋
   ↓
Phase 3-A  biome 설치 → biome.json 설정
   ↓
Phase 3-B  consumer/seller/driver 병렬 린트 비교 → 포맷 적용 → 커밋
   ↓
Phase 3-C  api 룰 대조 → 포매터만 적용, ESLint 유지 → 커밋
   ↓
Phase 3-D  Justfile 레시피 갱신 → just ci 최종 검증 → 커밋
```

**총 예상 소요: 4~5시간 (세션 1회)**

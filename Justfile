set shell := ["bash", "-c"]

# ── 개발 ──────────────────────────────────────────────────────
dev:
    pnpm dev:local

dev-consumer:
    pnpm --filter consumer dev

dev-api:
    pnpm --filter api start:dev

# ── 빌드 ──────────────────────────────────────────────────────
build:
    pnpm build

build-api:
    pnpm --filter api build

# ── 린트 ──────────────────────────────────────────────────────
lint:
    pnpm biome lint apps/consumer/src apps/seller/src apps/driver/src
    pnpm --filter api lint

# ── 포맷 ──────────────────────────────────────────────────────
format:
    pnpm biome format apps/consumer/src apps/seller/src apps/driver/src --write
    pnpm --filter api format

# ── 포맷 체크 (쓰기 없음 — CI 전용) ────────────────────────────
format-check:
    pnpm biome format apps/consumer/src apps/seller/src apps/driver/src
    pnpm biome format apps/api/src

# ── 타입 체크 ─────────────────────────────────────────────────
typecheck:
    pnpm -r typecheck

# ── 테스트 ────────────────────────────────────────────────────
test-ds:
    pnpm --filter e2e exec playwright test consumer-design-system --reporter=list

test-e2e:
    pnpm test:e2e

# ── 보안 스캔 ─────────────────────────────────────────────────
secret-scan:
    trufflehog git file://. --only-verified

# ── CI 파이프라인 ──────────────────────────────────────────────
ci: format-check lint typecheck secret-scan
    @echo "✅ CI 완료"

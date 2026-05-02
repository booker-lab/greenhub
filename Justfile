set shell := ["bash", "-c"]

# ── 개발 ──────────────────────────────────────────────────────
dev-consumer:
    pnpm --filter consumer dev

dev-api:
    pnpm --filter api start:dev

# ── 빌드 ──────────────────────────────────────────────────────
build:
    pnpm build

build-api:
    pnpm --filter api build

# ── 린트 (Phase 3 완료 후 biome 기준으로 교체) ─────────────────
lint:
    pnpm -r lint

# ── 포맷 ──────────────────────────────────────────────────────
format:
    pnpm -r format

# ── 포맷 체크 (쓰기 없음 — CI 전용) ────────────────────────────
format-check:
    pnpm -r format

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
ci: lint typecheck test-e2e secret-scan
    @echo "✅ CI 완료"

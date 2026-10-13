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
# 전체 이력 검사. CI 전체 이력 실패 단계(secret-scan-scheduled.yml)와 같은 설정·제외 경로를 쓴다.
secret-scan:
    trufflehog git file://. --only-verified --fail --config=.trufflehog.yml --exclude-paths=.github/trufflehog-exclude-paths.txt

# ── CI 파이프라인 ──────────────────────────────────────────────
ci: format-check lint typecheck secret-scan
    @echo "✅ CI 완료"

# FE-PILOT-L02-S Local Harness (Seller /orders 첫 Slice, 최소 기반)

> 전체 FE-DEV-LOCAL Foundation이 아니다. Seller `/orders` Slice를
> production/external state와 격리된 localhost에서 반복 검증하기 위한 최소 진입점이다.

## 진입점 (하나)

```bat
dev-local.bat
pnpm dev:local
```

- `dev.bat`는 건드리지 않는다 (기존 동작 보존).
- Launcher 실체는 `scripts/dev/local/launcher.mjs` (M1 검증 구조 보존).
- 새 orchestration framework/dependency 없음.

## Local contract

- API: `http://localhost:3000` (`GET /health` → `{status:"ok"}`)
- Seller: `http://localhost:3002` (`/login`, `/orders`)
- Admin: `http://localhost:3002/admin`
- Firebase project: `greenhub-local`
- Auth emulator: `127.0.0.1:9099`
- Firestore emulator: `127.0.0.1:8080`
- Storage emulator: `127.0.0.1:9199` (필요 시, production fallback 금지)

## 격리 (fail-closed)

- LOCAL mode는 local project + emulator hosts + localhost API + scheduler off만 허용.
- 다음이 감지되면 실행/seed를 거부한다 (값은 출력하지 않고 NAME만 다룬다):
  production Firebase project id, staging/production Railway API URL,
  production service-account binding, PortOne/ALIGO 실제 실행 가능 설정,
  실 Kakao OAuth 의존 Seller Slice 테스트.

## Seller-only local auth

재사용 (새 임의 bypass 없음):

- API `POST /auth/register` (seller invite) + `POST /auth/login` 실경로.
- NextAuth Credentials gate (`E2E_TEST_SECRET` + `x-e2e-test-token`, 미설정 시 전체 거부).
- Seller login page Credentials form은 `E2E_TEST==='true'`일 때만 노출.

Local 진입 조건: `development` + `GREENHUB_LOCAL_RUNTIME=true` (+ frontend
`NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME=true`) + localhost/emulator authority.
Preview/Production에서는 활성화되지 않는다.

Seed된 local seller:

- email: `local-seller@greenhub.local`
- password: `LocalSeller01!` (로컬 전용, 운영 계정 아님)
- store: `local-store-01`

## Deterministic seed/reset

```bash
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-EMPTY
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-ACTION
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-HELD
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-MIXED
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-FRESHNESS
node scripts/dev/local/seed-seller-orders.mjs --list
```

- 기본 `--reset` (기존 `local-store-01` 주문 삭제 후 적용 → 같은 상태 복원).
- `--no-reset`은 추적용으로만 사용.
- `S-FRESHNESS` 적용 후 emulator에서 `local-order-fresh-01`을 변경하고
  Seller 화면 revalidation으로 변화를 확인한다.
- read-failure 검증은 Firestore seed로 억지 표현하지 않는다
  (API/local harness safe test mechanism 사용).

## Manual browser gate (자동화 없이 검증할 때)

1. `dev-local.bat` 실행 → readiness (`api-health`, `seller-login`, emulator listeners) 확인.
2. API login: `POST http://localhost:3000/auth/login`
   `{email: local-seller@greenhub.local, password: LocalSeller01!}` → JWT 확보.
3. `GET http://localhost:3000/stores/local-store-01/orders` + `Authorization: Bearer <JWT>`
   → 시나리오별 주문 확인 (아래 매핑).
4. 브라우저: `http://localhost:3002/login` → local seller 로그인 → `/orders` 진입.
5. 시나리오별 확인:
   - S-EMPTY: "현재 해당 주문이 없습니다"
   - S-ACTION: 처리 필요 탭에 2건
   - S-HELD: 배송 보류 우선순위/뱃지 1건 (`DELIVERY_HELD`)
   - S-MIXED: 날짜 프리셋/상태 탭 필터로 5건 분기 확인
   - S-FRESHNESS: 초기 read → emulator에서 상태 변경 → 화면 새로고침으로 반영 확인.
6. 외부 안전: production Firebase write 0, Railway request 0,
   PortOne 실제 호출 0, ALIGO 실제 발송 0 (launcher env가 secret을 제거하므로
   실제 dispatch가 불가능해야 한다).

## Tests

```bash
node --test scripts/dev/local/launcher.spec.mjs
node --test scripts/dev/local/seed-seller-orders.spec.mjs
node --test scripts/dev/local/local-isolation.spec.mjs
pnpm --filter seller test -- firebase.binding
```

tracked file mutation이 test 실행에서 추가 발생하지 않는지 전후
`git status --short`로 확인한다.

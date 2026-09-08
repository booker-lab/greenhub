# FE-PILOT-L02 Local Harness (Seller /orders + Driver /board 최소 기반)

> 전체 FE-DEV-LOCAL Foundation이 아니다. Seller `/orders`와 Driver `/board`
> Slice를 production/external state와 격리된 localhost에서 반복 검증하기 위한
> 최소 진입점이다.

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
- Driver: `http://localhost:3003` (`/login`, `/board`)
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
- Local provider outbound는 `GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY=DENY_ALL_EXTERNAL_PROVIDER_DISPATCH`로 고정한다. launcher가 local child에 위 DENY 정책을 주입하고 provider secret을 제거하면, ALIGO/PortOne client가 network dispatch 전에 DENY 정책을 확인하고 fail-closed한다. 이 local 정책은 Production/Preview에 자동 적용되지 않는다.

## Seller-only local auth

재사용 (새 임의 bypass 없음):

- API `POST /auth/register` (seller invite) + `POST /auth/login` 실경로.
- NextAuth Credentials gate: local runtime marker가 있으면 헤더 게이트를
  생략하고 API 실경로로 검증하고, 그 외에는 `E2E_TEST_SECRET` +
  `x-e2e-test-token` (미설정 시 전체 거부).
- Seller login page Credentials form은 `E2E_TEST==='true'` 또는 local runtime
  (`GREENHUB_LOCAL_RUNTIME=true` + non-production)에서만 노출.

Local 진입 조건: `development` + `GREENHUB_LOCAL_RUNTIME=true` (+ frontend
`NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME=true`) + localhost/emulator authority.
Preview/Production에서는 활성화되지 않는다.

Seed된 local seller:

- email: `local-seller@greenhub.local`
- password: `LocalSeller01!` (로컬 전용, 운영 계정 아님)
- store: `local-store-01` (seed가 `users/{seller}.storeId`를 연결한다)

## Driver-only local auth

- API `POST /auth/register` (driver, invite 불필요) + 승인
  (`users/{driver}.driverApproved=true`) + `POST /auth/login` 실경로.
- NextAuth Credentials gate: local runtime에서만 허용하고 role `driver` +
  승인 검사를 적용한다. Preview E2E 경로는 그대로 유지한다.
- Driver login page는 카카오 로그인을 유지하고, local runtime에서만
  Credentials form을 추가로 노출한다 (`redirectTo: /board`).

Seed된 local driver:

- email: `local-driver@greenhub.local`
- password: `LocalDriver01!` (로컬 전용, 운영 계정 아님)
- board: `local-order-driver-01` (PREPARING 미배정), `local-order-driver-02`
  (DELIVERING, local driver 배정)

## Deterministic seed/reset

```bash
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-EMPTY
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-ACTION
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-HELD
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-MIXED
node scripts/dev/local/seed-seller-orders.mjs --scenario=S-FRESHNESS
node scripts/dev/local/seed-seller-orders.mjs --list
```

```bash
# Driver board seed (seller seed를 먼저 실행: local-store-01 필요)
node scripts/dev/local/seed-driver-board.mjs
node scripts/dev/local/seed-driver-board.mjs --no-reset
```

- 기본 `--reset` (기존 `local-store-01` 주문 삭제 후 적용 → 같은 상태 복원).
- 문서 쓰기는 upsert(POST 후 409면 전 필드 PATCH)이므로 반복 실행해도 수렴한다.
- Driver seed는 `local-order-driver-*`만 삭제하므로 Seller slice 주문을 유지한다.
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
5. 브라우저: `http://localhost:3003/login` → local driver 로그인 → `/board` 진입
   (수거 대기 1건 + 배송 중 1건).
6. 시나리오별 확인:
   - S-EMPTY: "현재 해당 주문이 없습니다"
   - S-ACTION: 처리 필요 탭에 2건
   - S-HELD: 배송 보류 우선순위/뱃지 1건 (`DELIVERY_HELD`)
   - S-MIXED: 날짜 프리셋/상태 탭 필터로 5건 분기 확인
   - S-FRESHNESS: 초기 read → emulator에서 상태 변경 → 화면 새로고침으로 반영 확인.
6. 외부 안전: production Firebase write 0, Railway request 0,
   PortOne 실제 호출 0, ALIGO 실제 발송 0 (launcher가 주입한 DENY 정책과 secret 제거를
   ALIGO/PortOne client가 network dispatch 전에 확인하고 fail-closed하므로 실제 dispatch가 불가능해야 한다).

## Tests

```bash
node --test scripts/dev/local/launcher.spec.mjs
node --test scripts/dev/local/seed-seller-orders.spec.mjs
node --test scripts/dev/local/seed-driver-board.spec.mjs
node --test scripts/dev/local/local-isolation.spec.mjs
pnpm --filter seller test -- firebase.binding
```

tracked file mutation이 test 실행에서 추가 발생하지 않는지 전후
`git status --short`로 확인한다.

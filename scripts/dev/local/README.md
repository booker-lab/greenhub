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

## Runtime lease (lease-first, single-owner)

Greenhub fixed-port local stack은 동시에 하나의 launcher owner만 허용한다
(resource key: `GREENHUB_LOCAL_RUNTIME_STACK`).
Launcher는 port preflight와 child spawn보다 먼저 lease를 획득한다.
시작 순서 (source authority: `launcher.mjs` `runLocalRuntime`, `runtime-lease.mjs`):

1. parent environment safety gate (production marker 거부)
2. runtime lease acquire (`GREENHUB_LOCAL_RUNTIME_STACK`)
3. fixed-port preflight (`3000, 3001, 3002, 3003, 8080, 9099, 9199`)
4. pre-spawn shutdown check (preflight 중 종료 요청 시 spawn 없이 종료)
5. child process spawn
6. readiness / runtime
7. child cleanup (owned process tree 정리)
8. own lease release (leaseId 소유권 확인 후 해제)

따라서 두 번째 `dev:local` 실행의 기본 admission failure는
`LocalRuntimeLeaseError`이다. lease를 통과하지 못하면 child는 하나도
시작하지 않는다 (spawn 0회).

### Lease directory resolution (checkout-independent shared default)

Default lease directory는 checkout-independent shared namespace이다:
같은 머신/사용자의 모든 Greenhub checkout/worktree
(예: `C:\Develop\greenhub`, `C:\Develop\greenhub-task-fe-local-01`)는
기본 설정에서 동일한 lock file을 사용한다. Repository working tree 아래가
아니며, `repositoryRoot`/`checkoutPath`/cwd에서 유도하지 않는다.
Source authority: `runtime-lease.mjs` `resolveLeaseDirectory` /
`resolveSharedLeaseDirectory`.

1. `GREENHUB_LOCAL_RUNTIME_DIR` — 설정된 경우 최우선. 테스트 격리·진단용
   explicit override이며, 서로 다른 값을 쓰면 의도적으로 mutual exclusion을
   우회한다 (아래 override 계약 참조). Normal `dev:local` 실행에서
   checkout마다 다른 값을 자동 생성·설정하지 않는다.
   whitespace-only 값은 absent 취급한다 (trim 후 빈 문자열은 무시).
2. Shared default Windows: `%LOCALAPPDATA%\Greenhub\local-runtime`.
   `LOCALAPPDATA`가 없으면 `APPDATA`, 둘 다 없으면 `os.tmpdir()` 기반.
3. Shared default POSIX + `XDG_RUNTIME_DIR`: `$XDG_RUNTIME_DIR/greenhub/local-runtime`.
4. Shared default POSIX fallback: `<tmp>/greenhub-local-runtime` (`os.tmpdir()` 기반).

Lease file:

```text
<lease-dir>/GREENHUB_LOCAL_RUNTIME_STACK.lock.json
```

Repository working tree에는 lease artifact를 남기지 않는다.
`GREENHUB_LOCAL_RUNTIME_DIR`와 acquire `directory` 옵션은 테스트 격리·진단용
explicit override이며, normal multi-checkout 실행을 분리하는 용도로
사용하지 않는다. Production/cloud runtime 기능이 아니다.
서로 다른 override 값을 쓰면 별도 lock file을 쓰게 되어 공유가 깨지므로,
이는 지원 구성이 아니라 명시적 bypass로 취급한다.

### Cross-checkout shared namespace (fail-closed)

같은 fixed-port stack을 공유하는 여러 checkout은 기본 설정에서 같은 shared
default lease directory를 사용하므로 cross-checkout mutual exclusion이
동작한다. 두 번째 checkout의 launcher는 `LocalRuntimeLeaseError`로
fail-closed하며, API/Next/Firebase child를 하나도 시작하지 않고 canonical
port도 점유하지 않는다.

Explicit override(`GREENHUB_LOCAL_RUNTIME_DIR` 또는 acquire `directory`에
서로 다른 값)로 namespace를 갈라 쓰면 공유가 우회된다. 이는 테스트 격리·
진단용 bypass이며 normal 실행의 지원 구성이 아니다. 이 우회 상태에서는
lease가 아니라 port preflight(`PortCollisionError`)만 남는다.

### Duplicate execution semantics

두 번째 launcher 실행에서 기대해야 하는 기본 오류는
`LocalRuntimeLeaseError`이다. 동일 fixed-port local stack
(`GREENHUB_LOCAL_RUNTIME_STACK`)은 single-owner이므로, 다른 Greenhub
checkout 또는 launcher가 해당 stack을 소유하고 있으면 두 번째 launcher는
실행하지 않고 fail-closed한다. 실패 메시지·오류 객체에서 확인 가능한 owner
attribution:

- `resourceKey`
- `ownerPid`
- `ownerCheckout` (`checkoutPath`)
- `acquiredAt`
- `leasePath`
- `ports`
- `reason` — `active-owner` | `owner-unknown` | `corrupt-lease` | `race-lost`

"duplicate dev:local must produce PortCollisionError" 같은 과거 가정은
성립하지 않는다. `PortCollisionError`와 구분:

- `LocalRuntimeLeaseError` = Greenhub local runtime ownership 충돌 (같은
  stack의 다른 checkout/launcher가 소유).
- `PortCollisionError` = 실제 port availability 충돌. lease를 정상 획득한
  뒤에도 foreign/non-Greenhub process가 포트를 점유하면 fallback으로
  발생한다 (예: unrelated foreign process가 port 사용). 서로 다른 checkout이
  서로 다른 explicit lease override를 써서 namespace를 갈라 쓴 경우에도
  lease 공유 대신 port 충돌만 남지만, 이는 테스트용 bypass이며 정상 실행
  계약이 아니다.

참고: lease 획득 후 port preflight가 실패하면 own lease는 해제되므로 다음
실행이 lease에서 막히지 않는다.

### Active owner recovery

owner process가 살아 있으면:

- 기다린다.
- owner가 정상 종료된 뒤 다시 실행한다.

금지:

- lock file 자동 삭제
- foreign PID kill
- foreign lease reclaim

살아 있는 owner의 lock을 임의로 지우지 않는다.

### Stale owner recovery

implementation은 owner가 명확하게 dead이고 (`process.kill(pid, 0)` probe가
부재 확정) leaseId를 다시 읽었을 때 동일한 경우에만 stale lease reclaim을
허용한다. 회수된 lease는 새 `leaseId`로 다시 기록되며, 경합에서 지면
`race-lost`로 fail-closed한다. 사용자가 임의로 racing manual surgery를 하지
않도록 한다 — stale 판정과 회수는 다음 launcher 실행에 맡긴다.

### Unknown liveness

PID probe가 owner의 생사를 확정하지 못하면 (`reason: owner-unknown`)
fail closed — 자동 reclaim하지 않는다. manual investigation 대상으로 둔다.

### Corrupt lease recovery

corrupt/unparseable lease는 fail-closed이며 (`reason: corrupt-lease`) 자동
삭제되지 않는다. 수동 복구는 다음 순서만 따른다:

1. 실제 local launcher/process가 살아 있지 않은지 확인
2. 오류에 표시된 exact `leasePath` 확인
3. 해당 파일이 현재 Greenhub runtime owner의 active lease가 아님을 확인
   (owner가 없음을 검증)
4. 그 뒤에만 그 파일 하나만 수동 제거
5. launcher 재실행

살아 있는 owner 또는 소유자 불명의 lock 파일을 무조건 삭제하지 않는다.

### Foreign lease preservation

다른 checkout/process가 소유한 lease (foreign lease)는 launcher가 삭제하지
않는다:

- kill 금지
- delete 금지
- foreign release 금지

release는 leaseId ownership에 의해 보호된다 — `leaseId`가 일치하지 않으면
release되지 않고 (`not-owner`) 파일이 보존된다. launcher 실패 경로는
foreign lease instance를 삭제하지 않는다.

### Manual recovery

수동 삭제가 필요한 경우 오류 메시지에 표시된 정확한:

```text
<lease-dir>/GREENHUB_LOCAL_RUNTIME_STACK.lock.json
```

만 대상으로 한다. owner가 살아 있는 동안 삭제하지 않는다.

Windows default 예:

```text
%LOCALAPPDATA%\Greenhub\local-runtime\GREENHUB_LOCAL_RUNTIME_STACK.lock.json
```

### Known Limitations

- Explicit lease override bypass (test-only): `GREENHUB_LOCAL_RUNTIME_DIR`
  또는 acquire `directory`에 서로 다른 값을 주면 별도 lock file을 쓰게 되어
  lease mutual exclusion이 우회되고 port preflight만 남는다. 이는 테스트
  격리·진단용 명시적 bypass이며, normal `dev:local` 실행에서 checkout마다
  다른 값을 쓰는 것은 지원하지 않는다. 기본 shared default에서는 여러
  checkout이 동일 namespace를 공유하므로 이 limitation이 발생하지 않는다.
- PID reuse (`LOCAL_DEV_ACCEPTED_LIMITATION`): 현재 liveness는
  `process.kill(pid, 0)` 기반이며 process creation-time identity는 사용하지
  않는다. 따라서 오래된 lease의 PID가 OS에서 재사용되면 실제로는 stale
  lease여도 active로 판단할 수 있다. 구현 변경 없이 accepted limitation으로
  둔다.

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
node --test scripts/dev/local/runtime-lease.spec.mjs
node --test scripts/dev/local/shared-lease.spec.mjs
node --test scripts/dev/local/seed-seller-orders.spec.mjs
node --test scripts/dev/local/seed-driver-board.spec.mjs
node --test scripts/dev/local/local-isolation.spec.mjs
pnpm --filter seller test -- firebase.binding
```

동일 spec의 package script 별칭 (`package.json` 확인됨):

```bash
pnpm test:local-launcher
pnpm test:local-lease
```

tracked file mutation이 test 실행에서 추가 발생하지 않는지 전후
`git status --short`로 확인한다.

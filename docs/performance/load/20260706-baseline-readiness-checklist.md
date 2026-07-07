# 2026-07-06 읽기 전용 baseline 준비 체크리스트

## 목적

PR #7 `codex/kakao-auth-k6-hardening`의 Draft 상태를 유지한 채, staging 또는 preview에서 첫 `baseline` k6 실행을 준비한다. 이 문서는 값을 직접 보관하지 않고, 실행 승인 전에 필요한 확정 항목과 제외 기준만 고정한다.

## 실행 금지선

- production baseline은 실행하지 않는다.
- `K6_ENABLE_WRITES`는 첫 baseline에서 `false`로 고정한다.
- Vercel env 조회, `vercel env pull`, 카카오 콘솔 Redirect URI 변경, e2e 실행, k6 실행은 별도 승인 전까지 하지 않는다.
- seed 계정 비밀번호와 비밀값은 문서에 기록하지 않는다.
- 계정 env가 없는 역할은 실패로 보지 않고 baseline 범위에서 제외해 기록한다.

## 필수 확정값

| 항목 | 상태 | 확정 기준 |
| --- | --- | --- |
| `K6_API_BASE_URL` | 미확정 | staging 또는 preview의 API 기본 URL. 프론트 Vercel URL이 아니라 API URL이어야 한다. |
| `K6_PROFILE` | 확정 | 첫 baseline은 `baseline` |
| `K6_ENABLE_WRITES` | 확정 | 첫 baseline은 `false` |
| `K6_STORE_ID` | 미확정 | 대상 환경에 존재하는 seed store id |
| `K6_PRODUCT_ID` | 미확정 | 대상 환경에 존재하고 공개 조회 가능한 seed product id |
| `K6_ORDER_ID` | 미확정 | seller 조회에 사용할 대상 환경의 seed order id |
| `K6_CONSUMER_EMAIL/PASSWORD` | 선택 | checkout write가 꺼져 있으면 필수는 아니지만, 인증 조회 기준선을 보려면 필요 |
| `K6_SELLER_EMAIL/PASSWORD` | 선택 | 있으면 `seller_ops` 포함, 없으면 자동 제외 |
| `K6_ADMIN_EMAIL/PASSWORD` | 선택 | 있으면 `admin_ops` 포함, 없으면 자동 제외 |
| `K6_DRIVER_EMAIL/PASSWORD` | 선택 | 있으면 `driver_ops` 포함, 없으면 자동 제외 |

## 시나리오 포함 기준

| 시나리오 | 포함 조건 | 기록 방식 |
| --- | --- | --- |
| `public_read` | 항상 포함 | `flow:public_read`, p95 800ms 기준 |
| `checkout` | 항상 포함 | `flow:checkout`, 읽기 전용 p95 1500ms 기준 |
| `seller_ops` | seller 계정 env 2개가 모두 있을 때 | `flow:seller_ops`, p95 1000ms 기준 |
| `admin_ops` | admin 계정 env 2개가 모두 있을 때 | `flow:admin_ops`, p95 1000ms 기준 |
| `driver_ops` | driver 계정 env 2개가 모두 있을 때 | `flow:driver_ops`, p95 1000ms 기준 |
| `throttle-auth` | baseline과 별도 실행 | 성능 실패가 아니라 인증 제한 검증으로 분리 기록 |

`release-readiness.js`는 `hasCredentials(role)` 결과가 참인 seller, admin, driver 역할만 baseline 시나리오와 threshold에 추가한다. 따라서 계정 env가 없는 역할은 자동 제외되며, 결과 보고서에는 “미포함 역할”로 명시한다.

## seed 데이터 검토 기준

- `K6_STORE_ID`와 `K6_PRODUCT_ID`는 404 허용 체크가 섞여 있으므로, 존재하지 않는 id로도 테스트가 통과처럼 보일 수 있다.
- 첫 baseline 전에는 seed store, product, order가 실제 조회 가능한지 확인한 뒤 값만 런타임 env로 주입한다.
- seed 데이터가 없으면 새로 만드는 작업은 별도 승인 후 staging 또는 preview에서만 진행한다.
- 문서에는 실제 계정 비밀번호나 토큰을 저장하지 않는다.

## 429 중단 기준

- baseline 중 public, checkout, seller, admin, driver 조회에서 429가 나오면 성능 실패로 판정하지 않고 환경 rate limit 정책 미정합으로 중단한다.
- `throttle-auth`의 429는 의도된 인증 제한 검증 결과로 별도 기록한다.
- 5xx가 연속 발생하거나 실패율이 1% 이상이면 즉시 다음 단계 진행을 중단한다.

## 통과 후 증분 조건

baseline 통과 후에만 `launch`, `growth`, `spike`, `soak` 순서로 진행한다.

| 다음 단계 | 진행 조건 |
| --- | --- |
| `launch` | baseline 실패율 1% 미만, p95 기준 충족, 비의도 429 없음, 연속 5xx 없음 |
| `growth` | launch 통과 후 병목 또는 Firestore 인덱스 이슈가 없을 때 |
| `spike` | growth 통과 후 순간 상승을 허용할 rate limit 정책이 확인됐을 때 |
| `soak` | launch의 60% 부하를 장시간 유지해도 비용과 외부 의존성 위험이 수용 가능할 때 |

## 확정 후 실행할 항목

아래 명령은 값이 확정되고 실행 승인을 받은 뒤에만 사용한다.

```powershell
$env:K6_API_BASE_URL="<staging-or-preview-api-url>"
$env:K6_PROFILE="baseline"
$env:K6_ENABLE_WRITES="false"
$env:K6_STORE_ID="<seed-store-id>"
$env:K6_PRODUCT_ID="<seed-product-id>"
$env:K6_ORDER_ID="<seed-order-id>"

# 선택 계정. 해당 역할을 포함할 때만 설정한다.
$env:K6_CONSUMER_EMAIL="<consumer-email>"
$env:K6_CONSUMER_PASSWORD="<consumer-password>"
$env:K6_SELLER_EMAIL="<seller-email>"
$env:K6_SELLER_PASSWORD="<seller-password>"
$env:K6_ADMIN_EMAIL="<admin-email>"
$env:K6_ADMIN_PASSWORD="<admin-password>"
$env:K6_DRIVER_EMAIL="<driver-email>"
$env:K6_DRIVER_PASSWORD="<driver-password>"

pnpm load:check-baseline
pnpm load:readiness
```

`pnpm load:check-baseline`은 k6를 실행하지 않고, 비밀번호 값을 출력하지 않는다. 첫 baseline에 필요한 profile, 쓰기 차단, API URL, seed id, 역할 계정 설정 완결성만 검사한다.

## 결과 보고 필수 항목

- 대상 환경과 `K6_API_BASE_URL`
- 포함된 역할과 제외된 역할
- seed id 3종의 확정 여부
- profile, duration, VU 구성
- p50, p95, p99, 실패율, check 성공률
- 429 발생 위치와 해석
- 5xx 발생 여부
- 다음 단계 진행 또는 중단 결정

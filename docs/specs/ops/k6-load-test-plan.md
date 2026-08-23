# k6 부하테스트 계획

## 목적

**서비스 전 부하테스트는 장애를 찾는 일회성 이벤트가 아니라, 개선 전후를 비교하는 반복 가능한 계측 체계로 운영한다.**

Green Hub는 Consumer, Seller, Driver 프론트와 Railway API, Firestore를 함께 사용한다. 따라서 k6 테스트의 1차 대상은 API이며, 프론트 렌더링 성능은 기존 Playwright와 Lighthouse 계측으로 분리한다.

## 범위

- 대상: Railway API, 인증 후 주요 조회, 주문 생성 보호 경로, 판매자/관리자/드라이버 운영 조회
- 제외: 실제 결제 승인, 실제 알림 발송, 실제 외부 OAuth 반복 호출, 카카오 로그인 반복 호출, 운영 데이터 파괴성 변경
- 실행 환경: staging 또는 preview 우선, production은 읽기 중심과 제한 검증만 허용

## 성공 기준

| 구분 | 기준 |
| --- | --- |
| 공개 조회 API | 실패율 1% 미만, p95 800ms 이하 |
| 인증 기반 조회 API | 실패율 1% 미만, p95 1000ms 이하 |
| 주문 생성/상태 변경 | 실패율 1% 미만, p95 1500ms 이하 |
| 제한 검증 | 인증 경로 429가 설정된 제한에서만 발생 |
| 서버 안정성 | 테스트 중 5xx 연속 발생 없음 |

## 목표치 증분 순서

**목표치는 서비스 전 한 번에 크게 올리지 않고, 아래 순서대로 성공한 단계만 다음 단계로 올린다.**

production API에는 전역 `100 req/min` 제한이 있으므로 단일 IP에서 baseline 이상을 실행하면 성능 병목보다 429 제한이 먼저 관찰된다. baseline 이상은 staging 또는 preview에서 부하테스트용 rate limit 정책을 명시적으로 둔 뒤 실행한다. production은 `smoke`와 소량 읽기 확인만 허용한다.

MVP 단계에서 staging URL이 production DB를 그대로 보는 경우, 정식 `baseline`으로 기록하지 않고 `probe` profile의 production 읽기 전용 확인으로만 실행한다. `probe`는 3분 동안 공개 조회 2 VU와 checkout 읽기 1 VU만 실행하며, `K6_ENABLE_WRITES=false`를 필수로 둔다.

| 단계 | 목적 | 지속 시간 | 주요 부하 | 통과 후 조치 |
| --- | --- | --- | --- | --- |
| 0. smoke | 스크립트와 계정 검증 | 1분 | 1 VU | 환경 변수와 seed 데이터 보정 |
| 0-1. probe | MVP production 읽기 여유 확인 | 3분 | 공개 조회 2 VU, checkout 읽기 1 VU | baseline이 아니라 운영 읽기 probe로 기록 |
| 1. baseline | 현재 기준선 확보 | 10분 | 공개 조회 20 VU, checkout 5 VU, 운영 조회 3 VU | p95와 실패율 기록 |
| 2. launch | 출시 직후 예상 피크 | 15분 | 공개 조회 50 VU, checkout 10 VU, 운영 조회 5 VU | Firestore 인덱스와 API 병목 수정 |
| 3. growth | 성장 여유 검증 | 20분 | 공개 조회 100 VU, checkout 20 VU, 운영 조회 10 VU | 캐시, 페이지네이션, 쿼리 구조 개선 |
| 4. spike | 순간 유입 검증 | 5분 | 공개 조회 150 VU 순간 상승 | rate limit, Railway 자원, 장애 복구 기준 확인 |
| 5. soak | 장시간 안정성 | 60분 | launch 단계의 60% | 메모리 증가와 외부 의존성 오류 확인 |

## 시나리오

### smoke

- `GET /health`
- `GET /banner`
- `GET /products`
- 선택: `POST /auth/login`, `GET /auth/me`

### consumer-read

- `GET /banner`
- `GET /products`
- `GET /products/:productId`
- `GET /stores/:storeId/products`
- `GET /stores/:storeId/delivery-config`

### checkout

- 기본은 읽기 전용으로 상품과 배송 설정만 조회한다.
- `K6_ENABLE_WRITES=true`일 때만 `POST /stores/:storeId/orders`를 실행한다.
- 실제 결제 승인과 webhook은 이 시나리오에서 제외한다.

### seller-ops

- `POST /auth/login`
- `GET /stores/:storeId/orders`
- `GET /stores/:storeId/orders/:orderId`
- 선택: `PATCH /stores/:storeId/orders/:orderId/status`

### admin-ops

- `POST /auth/login`
- `GET /admin/orders`
- `GET /admin/settlements`
- `GET /admin/stores`
- `GET /admin/users`

### driver-ops

- `POST /auth/login`
- `GET /driver/orders?status=PREPARING,DELIVERING`

### throttle

- `POST /auth/login`을 별도 실행해 1분 10회 제한이 의도대로 동작하는지 확인한다.
- 이 결과는 성능 실패가 아니라 보안 제한 검증으로 분리 기록한다.

## 환경 변수

| 이름 | 설명 |
| --- | --- |
| `K6_API_BASE_URL` | 테스트 대상 API 기본 URL |
| `K6_PROFILE` | `smoke`, `probe`, `baseline`, `launch`, `growth`, `spike`, `soak` |
| `K6_CONSUMER_EMAIL` | 소비자 테스트 계정 |
| `K6_CONSUMER_PASSWORD` | 소비자 테스트 비밀번호 |
| `K6_SELLER_EMAIL` | 판매자 테스트 계정 |
| `K6_SELLER_PASSWORD` | 판매자 테스트 비밀번호 |
| `K6_ADMIN_EMAIL` | 관리자 테스트 계정 |
| `K6_ADMIN_PASSWORD` | 관리자 테스트 비밀번호 |
| `K6_DRIVER_EMAIL` | 드라이버 테스트 계정 |
| `K6_DRIVER_PASSWORD` | 드라이버 테스트 비밀번호 |
| `K6_STORE_ID` | 테스트 대상 스토어 |
| `K6_PRODUCT_ID` | 테스트 대상 상품 |
| `K6_ORDER_ID` | 테스트 대상 주문 |
| `K6_ENABLE_WRITES` | 쓰기 요청 허용 여부 |

카카오 로그인 검증은 k6 부하 시나리오에서 제외한다. 카카오 OAuth는 외부 제공자 정책, 계정 보호, consent 화면, rate limit의 영향을 받으므로 성능 기준선에 포함하지 않는다. 인증 이후 API 성능은 seed된 email/password 계정으로 `/auth/login`을 호출하거나 사전 발급 JWT를 재사용해 측정한다.

## 실행 명령

사전 준비:

- 로컬 또는 CI 실행 환경의 PATH에서 `k6` CLI가 실행 가능해야 한다.
- production 대상 실행 전에는 반드시 `K6_PROFILE=smoke`로 먼저 확인한다.
- 쓰기 시나리오는 staging 또는 preview에서 seed 데이터를 준비한 뒤에만 켠다.

```powershell
pnpm load:smoke
pnpm load:consumer
pnpm load:checkout
pnpm load:seller
pnpm load:admin
pnpm load:driver
pnpm load:readiness
```

예시:

```powershell
$env:K6_API_BASE_URL="https://api-production-13e7.up.railway.app"
$env:K6_PROFILE="baseline"
$env:K6_STORE_ID="실제-스토어-id"
$env:K6_PRODUCT_ID="실제-상품-id"
pnpm load:consumer
```

혼합 readiness 실행:

```powershell
$env:K6_API_BASE_URL="https://staging-api.example.com"
$env:K6_PROFILE="baseline"
$env:K6_STORE_ID="테스트-스토어-id"
$env:K6_PRODUCT_ID="테스트-상품-id"
$env:K6_ORDER_ID="테스트-주문-id"
pnpm load:readiness
```

`pnpm load:readiness`는 `scripts/load/run-k6.mjs`를 통해 k6 위치를 찾고 `docs/performance/load/`에 summary JSON을 자동 저장한다. 인증 계정 환경 변수가 없는 역할 시나리오는 자동으로 제외된다.
`K6_PROFILE=smoke`일 때 readiness는 공개 조회와 checkout 읽기 흐름을 각 1회만 실행한다. `baseline` 이상에서만 VU 기반 지속 부하로 전환한다.

## 개선 루프

1. smoke로 환경과 계정 확인
2. baseline 결과를 `docs/performance/load/`에 저장
3. 병목을 API, Firestore, 외부 서비스, rate limit, 프론트 중복 호출로 분류
4. 단일 개선만 적용
5. 같은 profile로 재실행
6. 전후 p50, p95, p99, 실패율, 429, 5xx를 비교

## 예상 개선 후보

- Firestore 복합 인덱스 누락 보강
- 목록 API 페이지네이션 기본값 강제
- 관리자/판매자 목록의 N+1 조회 제거
- 공개 상품 조회 응답에서 카드용 요약 필드 고정
- 인증 토큰 재사용과 refresh 호출 빈도 축소
- 프론트 초기 진입 중복 호출 제거
- Railway 인스턴스 자원 조정

## 운영 가드

- production 쓰기 요청은 기본 금지한다.
- production에서는 `K6_PROFILE=smoke`와 `K6_PROFILE=probe`만 기본 허용하고, baseline 이상은 staging 또는 preview에서 실행한다.
- `K6_ENABLE_WRITES=true`는 staging 또는 preview에서만 사용한다.
- 외부 결제, SMS, push, OAuth 제공자에 반복 부하를 만들지 않는다.
- 테스트 전후 seed 데이터와 Firestore 비용을 확인한다.
- 실패율 또는 5xx가 기준을 초과하면 즉시 중단하고 다음 단계로 올리지 않는다.

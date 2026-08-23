# 2026-07-09 MVP production 읽기 전용 probe 준비안

## 결정

현재 `staging` Railway URL은 준비됐지만 내부 DB는 production으로 본다. 따라서 정식 `baseline`, `launch`, `growth`, `spike`, `soak`는 보류하고, MVP 단계에서는 production DB 영향을 전제로 한 낮은 강도의 읽기 전용 probe만 준비한다.

이 실행은 baseline이 아니다. 결과 보고서에는 `production read-only probe` 또는 `MVP launch smoke+`로 기록한다.

## 목적

- API URL과 배포 상태 확인
- 공개 조회가 비정상적으로 느리거나 실패하지 않는지 확인
- Firestore 인덱스 오류, 5xx, 의도하지 않은 429를 조기에 확인
- production 전역 rate limit에 닿기 전의 낮은 읽기 여유만 확인

## 실행 범위

| 항목 | 결정 |
| --- | --- |
| 대상 | production DB를 보는 API |
| profile | `probe` |
| 지속 시간 | 3분 |
| 부하 | `public_read` 2 VU, `checkout` 읽기 1 VU |
| 쓰기 | 금지, `K6_ENABLE_WRITES=false` |
| OAuth | 제외 |
| 결제, 알림, 외부 API 반복 호출 | 제외 |
| seller/admin/driver 운영 조회 | 첫 probe에서는 제외 |

## 준비값

| 이름 | 필수 여부 | 설명 |
| --- | --- | --- |
| `K6_API_BASE_URL` | 필수 | `https://api-production-13e7.up.railway.app` 또는 production DB를 보는 staging API URL |
| `K6_PROFILE` | 필수 | `probe` |
| `K6_ENABLE_WRITES` | 필수 | `false` |
| `K6_STORE_ID` | 필수 | 실제 조회 가능한 store id |
| `K6_PRODUCT_ID` | 필수 | 실제 조회 가능한 product id |
| `K6_ORDER_ID` | 불필요 | 첫 probe에서는 seller 운영 조회를 제외하므로 필요 없음 |
| 역할 계정 env | 선택 | 첫 probe에서는 되도록 비워 둔다 |

## 중단 기준

- 429가 public 또는 checkout 읽기 흐름에서 관찰되면 rate limit 접촉으로 보고 중단한다.
- 5xx가 연속 발생하면 중단한다.
- 실패율이 1% 이상이면 다음 단계로 올리지 않는다.
- p95가 공개 조회 800ms, checkout 읽기 1500ms를 크게 넘으면 병목 후보로 기록한다.

## 확정 후 실행 순서

아래 명령은 실행 승인을 받은 뒤에만 사용한다.

```powershell
cd C:\Develop\greenhub

$env:K6_API_BASE_URL="https://api-staging-94af.up.railway.app"
$env:K6_PROFILE="probe"
$env:K6_ENABLE_WRITES="false"
$env:K6_STORE_ID="<실제-store-id>"
$env:K6_PRODUCT_ID="<실제-product-id>"

node scripts/load/check-production-probe.mjs
node scripts/load/run-k6.mjs readiness
```

`pnpm` 실행 환경이 정상일 때는 아래 명령도 사용할 수 있다.

```powershell
pnpm load:check-probe
pnpm load:readiness
```

## 결과 보고 필수 항목

- 대상 API URL
- production DB를 본다는 전제
- `K6_PROFILE=probe`, `K6_ENABLE_WRITES=false`
- 포함 시나리오: `public_read`, `checkout`
- 제외 시나리오: seller/admin/driver 운영 조회, throttle, 쓰기 요청
- p50, p95, p99, 실패율, check 성공률
- 429, 5xx 발생 여부
- 정식 baseline 진행 여부는 별도 staging DB 분리 후 재판단

## 2026-07-09 준비 상태

- API URL 후보: `https://api-staging-94af.up.railway.app`
- 전제: staging API가 production DB를 본다.
- `GET /health`: 정상 확인
- `GET /products`: 정상 확인
- `GET /banner`: 정상 확인
- `GET /products/19009e23-33e4-463f-9953-5be860fe56b6`: 정상 확인
- `GET /stores/80189070-2c3d-45f2-bc11-68a870b13951/products`: 정상 확인
- `GET /stores/80189070-2c3d-45f2-bc11-68a870b13951/delivery-config`: 정상 확인
- `GET /public/stores`, `GET /banners/active`는 현재 API에서 404이므로 k6 읽기 경로에서 제외했다.

후보 env:

```powershell
$env:K6_API_BASE_URL="https://api-staging-94af.up.railway.app"
$env:K6_PROFILE="probe"
$env:K6_ENABLE_WRITES="false"
$env:K6_STORE_ID="80189070-2c3d-45f2-bc11-68a870b13951"
$env:K6_PRODUCT_ID="19009e23-33e4-463f-9953-5be860fe56b6"
```

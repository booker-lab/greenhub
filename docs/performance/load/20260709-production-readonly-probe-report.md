# 2026-07-09 MVP production 읽기 전용 probe 결과

## 요약

MVP 단계의 낮은 강도 읽기 전용 probe를 실행했다. 이 실행은 정식 baseline이 아니며, `staging` Railway URL이 production DB를 본다는 전제로 `production read-only probe`로 기록한다.

## 실행 조건

| 항목 | 값 |
| --- | --- |
| 대상 API | `https://api-staging-94af.up.railway.app` |
| DB 전제 | production DB |
| profile | `probe` |
| 쓰기 요청 | `K6_ENABLE_WRITES=false` |
| store id | `80189070-2c3d-45f2-bc11-68a870b13951` |
| product id | `19009e23-33e4-463f-9953-5be860fe56b6` |
| 실행 시간 | 3분 |
| 부하 | `public_read` 2 VU, `checkout` 1 VU |
| 역할 계정 | 설정하지 않음 |
| 제외 | seller/admin/driver 운영 조회, throttle, 쓰기 요청, OAuth |

## 결과

| 지표 | 결과 |
| --- | ---: |
| 총 HTTP 요청 | 772 |
| HTTP 실패율 | 0.00% |
| check 성공률 | 100.00% |
| check 성공/실패 | 772 / 0 |
| 전체 p95 | 512.30ms |
| `public_read` p95 | 526.03ms |
| `checkout` p95 | 425.13ms |
| 최대 응답 시간 | 693.35ms |
| 반복 횟수 | 248 |

## 통과 기준

| 기준 | 결과 |
| --- | --- |
| `http_req_failed rate<0.01` | 통과 |
| `checks rate>0.99` | 통과 |
| `public_read p95<800ms` | 통과 |
| `public_read p99<2000ms` | 통과 |
| `checkout p95<1500ms` | 통과 |
| `checkout p99<3000ms` | 통과 |

## 확인된 경로

- `GET /banner`
- `GET /products`
- `GET /products/:productId`
- `GET /stores/:storeId/products`
- `GET /stores/:storeId/delivery-config`

모든 check가 성공했으며, 실행 중 429 또는 5xx로 해석되는 실패는 관찰되지 않았다.

## 산출물

- `docs/performance/load/readiness-probe-2026-07-09T11-24-53-892Z.json`

## 판정

MVP production 읽기 전용 probe는 통과했다. 다만 이 결과는 정식 baseline이 아니다. `launch`, `growth`, `spike`, `soak` 또는 10분 baseline은 staging DB 분리와 rate limit 정책 확정 후 진행한다.

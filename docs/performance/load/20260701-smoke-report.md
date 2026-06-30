# 2026-07-01 k6 smoke 결과

## 실행 환경

- 대상 API: `https://api-production-13e7.up.railway.app`
- k6: `v2.0.0`
- profile: `smoke`
- 쓰기 요청: 비활성

## 결과

| 시나리오 | 요청 수 | 실패율 | p95 | 체크 |
| --- | ---: | ---: | ---: | --- |
| `smoke.js` | 3 | 0.00% | 705.99ms | 3/3 성공 |
| `consumer-read.js` | 6 | 0.00% | 587.84ms | 6/6 성공 |
| `release-readiness.js` | 7 | 0.00% | 677.69ms | 7/7 성공 |

## 재검증 결과

| 시나리오 | 요청 수 | 실패율 | p95 | 체크 |
| --- | ---: | ---: | ---: | --- |
| `smoke.js` | 3 | 0.00% | 499.49ms | 3/3 성공 |
| `consumer-read.js` | 6 | 0.00% | 646.10ms | 6/6 성공 |
| `checkout.js` | 2 | 0.00% | 439.65ms | 2/2 성공 |
| `release-readiness.js` | 7 | 0.00% | 586.29ms | 7/7 성공 |

## 사용한 공개 데이터

- `K6_STORE_ID=80189070-2c3d-45f2-bc11-68a870b13951`
- `K6_PRODUCT_ID=49b0a370-e0ab-4f19-b8e6-2de0e9b2e867`

## 산출물

- `docs/performance/load/smoke-20260701.json`
- `docs/performance/load/consumer-read-smoke-20260701.json`
- `docs/performance/load/readiness-smoke-safe-20260701.json`
- `docs/performance/load/smoke-rerun-20260701.json`
- `docs/performance/load/consumer-read-rerun-20260701.json`
- `docs/performance/load/checkout-readonly-smoke-20260701.json`
- `docs/performance/load/readiness-rerun-20260701.json`

## 판정

production 읽기 전용 smoke와 재검증 smoke는 모두 통과했다. 혼합 readiness smoke는 공개 조회와 checkout 읽기 흐름을 각 1회만 실행하도록 조정했다. baseline 이상은 전역 rate limit 때문에 production 단일 IP에서 실행하지 않고, staging 또는 preview에서 별도 rate limit 정책을 정한 뒤 진행한다.

# k6 부하테스트 계획

> **상태**: LATER / 현재 출시 차단 게이트 아님
> **재개 조건**: `docs/BACKLOG.md`의 `LOAD-TEST-FORMAL`
> **최종 정합화**: 2026-08-23 KST

## 1. 목적

k6는 API의 성능·rate limit·안정성을 반복 가능한 방식으로 측정한다. 회차 직배송 출시 전에 반드시 실행해야 하는 현재 P0 게이트로 취급하지 않는다.

정식 baseline은 **production과 분리된 staging 또는 동등한 격리 환경**이 준비된 뒤 재개한다.

## 2. 기본 안전 규칙

- 실제 결제 승인·환불에 부하를 만들지 않는다.
- 실제 알림톡·SMS를 반복 발송하지 않는다.
- Kakao OAuth 같은 외부 로그인 provider를 부하 대상으로 사용하지 않는다.
- production 쓰기 부하는 기본 금지한다.
- production에서 확인이 필요하면 read-only smoke/probe만 별도 승인 범위에서 사용한다.
- 과거 문서에 남아 있던 특정 Railway URL을 현재 대상으로 재사용하지 않는다. 실행 시 `K6_API_BASE_URL`을 현재 환경에서 다시 확정한다.
- 테스트 계정·token·비밀번호 원문을 결과 문서에 남기지 않는다.

## 3. 성공 기준 초안

| 구분 | 기준 |
|---|---|
| 공개 조회 API | 실패율 < 1%, p95 <= 800ms |
| 인증 조회 API | 실패율 < 1%, p95 <= 1000ms |
| 격리 환경 쓰기 API | 실패율 < 1%, p95 <= 1500ms |
| 서버 안정성 | 연속 5xx 없음 |
| rate limit | 의도한 제한에서만 429 관찰 |

이 숫자는 사업 트래픽과 인프라 규모가 바뀌면 정식 baseline 전에 다시 확정한다.

## 4. 단계

| 단계 | 목적 | 기본 범위 |
|---|---|---|
| smoke | 스크립트·대상·계정 확인 | 1 VU, 짧은 실행 |
| probe | 제한적 읽기 여유 확인 | production이면 read-only만 |
| baseline | 현재 기준선 확보 | 격리 staging |
| launch | 예상 출시 피크 | baseline 통과 후 |
| growth | 성장 여유 | launch 통과 후 |
| spike | 순간 유입 | 별도 격리/모니터링 |
| soak | 장시간 안정성 | 앞 단계 통과 후 |

단계를 건너뛰지 않는다. 5xx/오류율/비용 이상이 있으면 다음 단계로 올리지 않는다.

## 5. 시나리오

### 공개/read-only

- `GET /health`
- `GET /banner`
- 공개 상품 목록/상세
- 필요한 배송 설정 조회

### 인증 기반 조회

- seed된 테스트 계정 또는 사전 발급된 테스트 JWT 사용
- consumer/seller/admin/driver의 실제 현재 API 경로를 실행 직전 코드에서 다시 확인

### 쓰기

- `K6_ENABLE_WRITES=true`일 때만 허용
- production에서는 사용하지 않는다.
- staging/preview의 전용 fixture와 cleanup 계획이 있을 때만 주문 생성·상태 변경을 포함한다.
- webhook, 실제 provider 결제, 실제 알림 발송은 제외한다.

## 6. 환경 변수

대표 변수:

- `K6_API_BASE_URL`
- `K6_PROFILE`
- 역할별 테스트 계정 또는 token
- `K6_STORE_ID`
- `K6_PRODUCT_ID`
- `K6_ORDER_ID`
- `K6_ENABLE_WRITES`

정확한 변수 집합은 `tests/load/**`, `scripts/load/**`의 현재 구현을 실행 전에 확인한다.

## 7. 현재 루트 실행 진입점

루트 `package.json` 기준 대표 명령:

```text
pnpm load:smoke
pnpm load:consumer
pnpm load:checkout
pnpm load:seller
pnpm load:admin
pnpm load:driver
pnpm load:throttle
pnpm load:check-baseline
pnpm load:check-probe
pnpm load:readiness
pnpm load:run
```

명령 이름이 존재한다는 사실만으로 현재 대상 환경이 안전하다는 뜻은 아니다. 먼저 대상 URL, DB 격리, write flag, provider egress를 확인한다.

## 8. 결과 보존

정식 baseline을 재개하면 결과를 `docs/performance/load/`에 비민감 summary로 보존한다.

비교 항목:

- p50/p95/p99
- 실패율
- 429
- 5xx
- 실행 profile
- 대상 환경 종류
- 기준 commit SHA

계정 정보·Authorization header·provider secret·개인정보는 저장하지 않는다.

## 9. 개선 루프

1. smoke로 환경 검증
2. baseline 측정
3. API/Firestore/rate limit/외부 의존성/중복 호출로 원인 분류
4. 한 번에 하나의 개선만 적용
5. 같은 profile 재실행
6. 전후 결과 비교

## 10. 현재 출시와의 관계

회차 직배송의 현재 출시 검증은 이 k6 계획이 아니라 `docs/memory.md`, 활성 출시 PLAN, `docs/specs/ops/mvp-sales-round-e2e-environment.md`를 따른다. 트래픽 증가나 실제 성능 신호가 생기기 전에는 정식 부하테스트를 출시 차단점으로 승격하지 않는다.

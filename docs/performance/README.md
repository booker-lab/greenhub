# Performance 자료 라우팅

> 이 디렉터리는 과거 측정의 원시 JSON과 load 결과를 보존하는 증거 저장소다. 현재 성능 기준선 자체가 아니다.

## 자료 해석 규칙

- `consumer.json`, `seller.json`, `driver.json`, `after/**`는 측정 당시의 snapshot으로 본다.
- 파일 생성 시점·대상 URL·commit SHA가 확인되지 않으면 현재 성능과 직접 비교하지 않는다.
- 과거 Lighthouse/Playwright/k6 결과를 현재 출시 SHA의 통과 증거로 사용하지 않는다.
- 새 측정은 대상 SHA, 환경 종류, profile, 측정 시각과 함께 기록한다.

## 현재 부하테스트 계획

정식 k6 재개 조건과 안전 규칙은:

- `docs/BACKLOG.md`의 `LOAD-TEST-FORMAL`
- `docs/specs/ops/k6-load-test-plan.md`

을 따른다.

현재 회차 직배송 출시의 필수 검증은 이 디렉터리의 과거 성능 JSON이 아니라 활성 출시 PLAN과 지정 SHA 원격 E2E 계약을 따른다.

## 민감정보 규칙

새 성능 결과에는 계정 비밀번호, Authorization header, provider secret, 서비스 계정, 고객 개인정보를 저장하지 않는다. 필요한 경우 endpoint 종류·status·latency 같은 비민감 summary만 보존한다.

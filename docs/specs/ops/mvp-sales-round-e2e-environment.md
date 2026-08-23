<!-- Language: ko -->

# 회차 직배송 E2E 비운영 환경 계약

> **상태**: 현행 운영 검증 계약
> **기준**: `.github/workflows/e2e-round-direct.yml`과 관련 readiness/fixture 스크립트
> **최종 정합화**: 2026-08-23 KST

## 1. 목적

이 문서는 회차 직배송 출시 후보 SHA를 비운영 환경에서 검증할 때 지켜야 하는 격리·인증·provider·cleanup 경계를 정의한다.

과거 Task 번호는 현재 실행 조건이 아니다. 실제 실행 시에는 workflow input의 `expected_sha`와 `NON_PRODUCTION_E2E_APPROVED` 승인을 사용하고, 출시 전에는 실제 출시 대상 SHA로 다시 실행한다.

## 2. workflow 게이트

`.github/workflows/e2e-round-direct.yml`은 다음을 요구한다.

- 수동 `workflow_dispatch`
- 40자리 `expected_sha`
- 승인 값 `NON_PRODUCTION_E2E_APPROVED`
- GitHub Environment `round-direct-e2e`
- 지정 SHA checkout
- consumer·seller·driver Preview가 지정 SHA를 가리키는지 확인
- 비운영 readiness 통과
- chromium/mobile fixture seed·verify
- 회차 직배송 Playwright 52건 실행
- 성공/실패와 무관한 fixture cleanup

과거 성공 run은 새 출시 후보 SHA의 통과 증거를 대신하지 않는다.

## 3. 필수 E2E mode

API/runner에서 다음 의미가 유지돼야 한다.

- `ROUND_DIRECT_E2E_ENABLED=true`
- `ROUND_DIRECT_E2E_ENV=preview`
- `ROUND_DIRECT_E2E_EXPECTED_SHA=<지정 40자리 SHA>`
- `ROUND_DIRECT_E2E_PROVIDER_MODE=stub`
- 실행별 고유 `ROUND_DIRECT_E2E_RUN_ID`
- 비운영 API/Firebase/Storage 허용 목록과 실제 대상의 정확한 일치

운영 프로젝트·운영 API·운영 Storage가 E2E 대상에 섞이면 fail-closed로 중단한다. provider stub mode에서 실제 PortOne·ALIGO 호출을 허용하지 않는다.

## 4. Preview와 데이터 격리

- consumer·seller·driver는 모두 HTTPS Preview URL을 사용한다.
- 세 앱은 같은 비운영 API/Firebase 환경을 바라봐야 한다.
- 세 Preview deployment SHA는 `ROUND_DIRECT_E2E_EXPECTED_SHA`와 일치해야 한다.
- fixture namespace는 실행 ID와 Playwright project(`chromium`/`mobile`)를 포함한다.
- chromium과 mobile은 계정·store·round·상품·주문·사진 metadata를 공유하지 않는다.
- fixture가 만든 정확한 문서/Storage 객체만 manifest에 기록하고 cleanup한다.
- 운영 store·운영 주문·운영 bucket 경로는 seed·cleanup 대상이 아니다.

## 5. 역할별 인증 경계

운영 Kakao OAuth를 반복 호출하지 않고 Preview 전용 Credentials 경로를 사용한다. 앱별 게이트가 서로 다르므로 하나의 secret 규칙으로 합쳐 쓰지 않는다.

### consumer / seller

- NextAuth Credentials provider는 `E2E_TEST_SECRET`이 설정되어 있어야 한다.
- 요청 헤더 `x-e2e-test-token`이 해당 secret과 일치해야 한다.
- consumer는 `consumer|admin`, seller는 `seller|admin` 역할 경계를 확인한다.
- E2E 계정 email/password는 GitHub Environment secret에서 runner로만 주입한다.

### driver

- `VERCEL_ENV=preview`
- `ROUND_DIRECT_E2E_ENABLED=true`
- 요청 헤더 `x-round-direct-e2e-secret`이 `ROUND_DIRECT_E2E_SHARED_SECRET`과 일치
- email이 `ROUND_DIRECT_E2E_DRIVER_EMAILS` allowlist에 포함
- API 로그인 결과가 `role=driver`, `driverApproved=true`

장기 세션 cookie를 정본 증거로 재사용하지 않는다. 실행 시점의 Preview 인증 결과를 사용한다.

## 6. 외부 provider 격리

E2E provider mode는 `stub`이다.

- 실제 PortOne 결제 조회·환불을 호출하지 않는다.
- 실제 ALIGO 알림톡·SMS를 발송하지 않는다.
- 실제 provider 비밀키를 테스트 결과·artifact·로그에 기록하지 않는다.
- provider mode가 비운영 조건을 충족하지 못하면 API가 안전하게 실패해야 한다.

실제 ALIGO 심사 완료 후 수행할 격리 실제 발송 검증은 이 E2E stub 검증과 별개이며, 사용자 승인과 활성 출시 PLAN을 따른다.

## 7. 배송 사진 fixture

- 합성 JPEG fixture만 사용한다.
- MIME은 `image/jpeg`, 최대 5MiB라는 API 계약을 지킨다.
- 개인정보·위치 metadata가 없는 fixture를 사용한다.
- Storage 객체는 실행별 허용 prefix 아래에만 생성한다.
- cleanup은 manifest가 기록한 객체만 삭제한다.

## 8. 실행 순서와 판정

현재 workflow의 기본 순서는 다음과 같다.

1. 지정 SHA checkout 및 승인 확인
2. 세 Preview deployment SHA 확인
3. readiness 확인
4. chromium fixture seed → verify
5. mobile fixture seed → verify
6. `consumer-round-direct`, `seller-sale-rounds`, `driver-direct-delivery`를 chromium/mobile로 실행
7. `expected=52`, `skipped=0`, `unexpected=0`, `flaky=0`, retries 0 확인
8. chromium/mobile cleanup
9. cleanup 결과와 비민감 증거 artifact 확인

최종 통과는 **Playwright 52건 성공만으로는 부족**하다. 양쪽 fixture cleanup까지 성공해야 한다.

## 9. 비밀정보·증거 규칙

artifact와 문서에는 다음을 남기지 않는다.

- 서비스 계정 JSON 원문
- E2E shared/test secret
- 계정 비밀번호
- Preview bypass secret
- JWT·session cookie
- 실제 고객 전화번호·주소·사진

남길 수 있는 증거는 지정 SHA, deployment SHA 일치 여부, readiness 판정, 테스트 통계, cleanup 건수와 같은 비민감 요약이다.

## 10. 현재 출시와의 관계

현재 회차 직배송 MVP는 `main`에 통합됐지만 운영 공개 전 상태다. 운영 배포 전에 실제 출시 대상 SHA로 이 계약의 원격 E2E를 다시 통과해야 한다. 현재 출시 순서와 승인 경계는 `docs/memory.md`와 활성 HANDOFF·PLAN을 따른다.

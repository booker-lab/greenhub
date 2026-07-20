<!-- Language: ko -->

# 회차 직배송 E2E 비운영 환경 계약

## 목적

이 문서는 Task 6.7의 Playwright 52건을 실행할 수 있는 유일한 환경 경계를 고정한다.
검사는 읽기 전용으로 먼저 수행하며, 아래 조건 중 하나라도 충족하지 못하면
`test.fixme`를 유지하고 seed·화면 흐름·외부 provider 호출을 시작하지 않는다.

## 명시적 활성화

- `ROUND_DIRECT_E2E_ENABLED=true`
- `ROUND_DIRECT_E2E_ENV=preview`
- `ROUND_DIRECT_E2E_RUN_ID`는 영문 소문자·숫자·하이픈으로 된 8~48자 값
- `ROUND_DIRECT_E2E_EXPECTED_SHA`는 실행할 40자리 Git SHA
- `ROUND_DIRECT_E2E_SHARED_SECRET`은 API와 세 앱에 같은 값으로 배포하며 로그에 남기지 않음
- `ROUND_DIRECT_E2E_PROVIDER_MODE=stub`

하나라도 없거나 값이 다르면 fail-closed로 중단한다. 운영 환경에서 위 mode가
설정되면 API는 시작 자체를 거부한다.

## 허용 환경 식별자

실행자는 다음 값을 실행 환경에 명시한다.

- `ROUND_DIRECT_E2E_ALLOWED_API_ORIGINS`: 쉼표로 구분한 HTTPS 비운영 API origin
- `ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS`: 쉼표로 구분한 비운영 Firebase project ID
- `ROUND_DIRECT_E2E_ALLOWED_STORAGE_BUCKETS`: 쉼표로 구분한 비운영 Storage bucket
- `ROUND_DIRECT_E2E_API_ORIGIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`: 이번 실행의 실제 대상

실제 대상은 각 허용 목록의 한 항목과 정확히 일치해야 한다. 다음 운영 식별자는
허용 목록에 있더라도 항상 거부한다.

- Firebase project: `green-e4fe3`
- 디어오키드 store: `80189070-2c3d-45f2-bc11-68a870b13951`
- `green-e4fe3` 또는 운영 도메인을 포함한 Storage bucket과 API origin

세 프런트 URL은 HTTPS Preview URL이어야 하며 동일한 API origin과 Firebase project를
사용해야 한다. 소비자·셀러·드라이버 배포는 모두
`ROUND_DIRECT_E2E_EXPECTED_SHA`와 정확히 일치해야 한다.

## 역할별 인증

- 소비자: 실행 전용 consumer 계정과 짧은 Auth.js 세션
- 셀러: 실행 전용 seller 계정, 전용 E2E store 소유권과 짧은 Auth.js 세션
- 드라이버: 승인된 실행 전용 driver 계정과 Preview 전용 Credentials 세션
- 모든 Credentials 요청: `E2E_TEST_SECRET` 헤더 일치 필요
- 드라이버 Credentials: Preview, 명시적 enable, 공유 secret, 허용 이메일, API가 반환한
  `driverApproved=true`와 `role=driver`를 모두 확인

세션은 실행 직전에 발급하고 `/api/auth/session`에서 역할, 사용자 ID, 만료 가능성을
확인한다. 장기 `DRIVER_SESSION_COOKIE`는 통과 증거로 사용하지 않는다.

## fixture와 프로젝트 격리

- namespace: `round-direct-e2e-{runId}-{project}`
- `project`: `chromium` 또는 `mobile`
- 두 프로젝트는 계정·장바구니·회차·상품·주문·사진 metadata를 공유하지 않음
- 테스트 스토어만 `salesMode: round_direct`로 생성
- 운영 디어오키드 문서는 읽기·쓰기·cleanup 대상에 포함하지 않음
- seed는 같은 manifest로 반복 실행할 수 있고 완료 마커가 검증된 뒤에만 화면 흐름 허용

fixture 관리 명령은 `seed`, `verify`, `cleanup`을 제공한다. manifest는 생성한 Firestore
문서의 정확한 경로와 Storage 객체 이름만 기록하며 비밀키·세션·전화번호·주소·사진
원본을 포함하지 않는다.

## 외부 provider와 egress

- 브라우저 PortOne SDK, 서버 결제 조회·환불, 알림톡·문자는 모두 결정적 대역을 사용
- 실제 `api.portone.io`, `kakaoapi.aligo.in`, `apis.aligo.in` 연결 금지
- egress 감시 기록에서 위 호스트 요청이 한 건이라도 발견되면 즉시 실패
- 대역은 실행 ID와 fixture 시나리오로 성공·재조회·환불 실패·알림 재시도 결과를 선택
- 실제 PortOne·Aligo 비밀키는 대역 mode에서 읽거나 기록하지 않음

## JPEG와 Storage

- fixture: `apps/e2e/fixtures/round-direct-delivery.jpg`
- MIME `image/jpeg`, 시작 magic bytes `FF D8 FF`, 종료 `FF D9`, 최대 5MiB
- 위치·개인정보 metadata가 없는 소형 합성 이미지
- bucket은 허용된 비운영 bucket과 정확히 일치
- 객체 접두사는 `e2e/round-direct/{runId}/{project}/`
- cleanup은 manifest에 기록된 접두사 내부 객체만 삭제

## 실행과 cleanup

준비검사 → seed → verify → Playwright 52건 → cleanup → cleanup verify 순서를 직렬로
실행한다. 테스트 성공·실패·취소와 무관하게 로컬 runner의 `finally`와 CI의 `always()`
단계에서 동일 manifest cleanup을 수행한다. 컬렉션 전체, bucket 전체, 접두사 밖 문서와
객체 삭제는 금지한다.

최종 통과는 `52 passed`, `0 failed`, `0 skipped`, `0 fixme`, `0 flaky`, retries 0과
fixture·Storage cleanup 성공을 모두 만족한 경우뿐이다.

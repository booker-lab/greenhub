# 카카오 인증 보강과 k6 부하테스트 핸드오프 계획

## 목적

**카카오 로그인 보안 정합성을 보강한 뒤, 부하테스트는 외부 OAuth가 아닌 내부 API 성능만 측정하도록 분리한다.**

현재 프론트는 NextAuth Kakao provider로 OAuth를 수행하고, API는 `/auth/kakao-login`에서 전달받은 `kakaoId`를 기준으로 Green Hub JWT를 발급한다. 서비스 전 기준으로는 API 서버가 카카오 access token을 직접 검증해 `kakaoId`를 신뢰해야 한다.

## 범위

- 포함: API 서버 측 카카오 토큰 검증, DTO 변경, 프론트 콜백 전달값 변경, 역할별 로그인 정합성, k6 계정 전략 문서화
- 제외: 카카오 제공자 자체 부하테스트, 실제 외부 OAuth 반복 호출, 결제·알림 부하

## 설계 원칙

- 카카오 access token은 프론트가 받은 뒤 API에 전달한다.
- API는 카카오 사용자 정보 API를 호출해 검증된 `id`, `email`, `name`만 사용한다.
- 클라이언트가 전달한 `kakaoId`, `email`, `name`은 신뢰하지 않는다.
- seller 신규 카카오 가입 금지는 유지한다.
- k6는 카카오 OAuth를 반복 호출하지 않고, seed 계정의 email/password 또는 사전 발급 JWT를 사용한다.

## Atomic Tasks

### A0. 명세 고정

- 목표: `docs/specs/api/auth.md`와 `docs/specs/ops/k6-load-test-plan.md`의 인증 계약을 현재 계획으로 고정한다.
- 작업:
  - `/auth/kakao-login` 요청 계약을 `kakaoAccessToken`, `targetRole`, `inviteToken?` 중심으로 정리
  - k6는 카카오 OAuth를 호출하지 않는다는 원칙 명시
- 검증:
  - 문서 라인 수 500라인 미만
  - 결정 로그에 보안 결정 기록
- 완료 기준:
  - 새 대화에서 문서만 보고 구현 범위를 이해할 수 있다.

### A1. DTO 계약 변경

- 목표: `KakaoLoginDto`에서 신뢰 불가 필드를 제거하거나 선택값으로 격하한다.
- 작업:
  - `kakaoAccessToken` 필수 추가
  - `targetRole` 유지
  - `inviteToken` 유지
  - `kakaoId`, `email`, `name` 직접 입력 의존 제거
- 검증:
  - DTO 단위 테스트 또는 validation 실패 케이스 추가
- 완료 기준:
  - access token 없는 `/auth/kakao-login`은 400으로 실패한다.

### A2. Kakao 클라이언트 분리

- 목표: 외부 카카오 API 호출을 AuthService 내부에 섞지 않고 인프라 어댑터로 분리한다.
- 작업:
  - `apps/api/src/auth/kakao.client.ts` 추가
  - `getUser(accessToken)` 구현
  - HTTP 실패, 401, malformed response를 명확한 예외로 변환
- 검증:
  - 단위 테스트에서 카카오 응답 mock
- 완료 기준:
  - 비즈니스 로직은 검증된 Kakao profile만 받는다.

### A3. AuthService 카카오 로그인 정합성 보강

- 목표: 검증된 카카오 사용자 정보로만 Green Hub JWT를 발급한다.
- 작업:
  - `kakao.client.getUser(dto.kakaoAccessToken)` 호출
  - 검증된 `kakaoId`로 기존 사용자 조회
  - 신규 consumer/driver/hub_staff 생성은 기존 정책 유지
  - 신규 seller 생성 금지 유지
  - suspended 사용자 차단 유지
  - driver 신규 생성 시 `driverApproved` 정책 유지 여부 확인
- 검증:
  - 기존 사용자 로그인 성공
  - 잘못된 token 실패
  - seller 신규 생성 실패
  - role mismatch 403
  - suspended 401
- 완료 기준:
  - 클라이언트가 임의 `kakaoId`를 보내도 JWT 발급에 영향을 주지 못한다.

### A4. NextAuth 콜백 수정

- 목표: 각 앱의 Kakao callback에서 API에 검증 가능한 token을 전달한다.
- 작업:
  - consumer/seller/driver `auth.ts`에서 `account.access_token` 확보
  - `/auth/kakao-login` 요청 body에 `kakaoAccessToken` 전달
  - 역할별 `targetRole` 유지
  - seller hub_staff invite token 전달 유지
- 검증:
  - 각 앱 카카오 로그인 수동 smoke
  - 세션 `accessToken`, `refreshToken`, role 유지 확인
- 완료 기준:
  - 카카오 로그인 완료 후 기존 화면 진입이 유지된다.

### A5. 테스트 계정 전략 보강

- 목표: k6와 E2E 계정을 카카오 실계정 반복 호출 없이 준비한다.
- 작업:
  - k6: email/password seed 계정 사용
  - E2E: Credentials provider는 `E2E_TEST_SECRET` 헤더 게이트 유지
  - 카카오 로그인은 Playwright 수동/반자동 smoke로 별도 분리
- 검증:
  - `node scripts/load/run-k6.mjs readiness` smoke 통과
  - 카카오 로그인 수동 체크리스트 통과
- 완료 기준:
  - 부하테스트와 외부 OAuth 검증이 서로 섞이지 않는다.

### A6. 회귀 테스트 추가

- 목표: 인증 보안 회귀를 자동화한다.
- 작업:
  - `auth.service.spec.ts`에 카카오 token 검증 mock 케이스 추가
  - `kakao.client.spec.ts` 추가
  - 필요 시 e2e auth smoke 문서 갱신
- 검증:
  - `pnpm --filter api test`
  - 관련 lint/typecheck
- 완료 기준:
  - token 검증 없이 JWT 발급되는 경로가 없다.

### A7. 부하테스트 재실행

- 목표: 인증 보강 후 기존 smoke가 유지되는지 확인한다.
- 작업:
  - production 또는 staging 읽기 전용 smoke
  - staging baseline은 별도 rate limit 정책에서만 실행
- 검증:
  - `smoke`, `consumer-read`, `checkout`, `readiness` 실패율 0%
  - 결과 `docs/performance/load/` 저장
- 완료 기준:
  - 인증 보강 후 API 성능 smoke가 유지된다.

## 정합성 검토

| 항목 | 확인 기준 | 위험 | 대응 |
| --- | --- | --- | --- |
| 신뢰 경계 | API가 카카오 token으로 직접 사용자 확인 | 클라이언트 위조 `kakaoId` | `kakaoAccessToken` 필수화 |
| 역할 정책 | targetRole별 허용 role 유지 | seller 신규 생성 우회 | 신규 seller 금지 테스트 |
| 초대 정책 | hub_staff invite token 유지 | 초대 없는 hub_staff 생성 | transaction 재검증 유지 |
| refresh 정책 | JWT refresh rotation 유지 | 인증 보강 중 refresh 회귀 | 기존 refresh 테스트 유지 |
| k6 정책 | 외부 OAuth 부하 제외 | 카카오 rate limit·계정 잠금 | email/password seed 사용 |
| 운영 데이터 | production 쓰기 금지 | 실제 주문·계정 오염 | `K6_ENABLE_WRITES=false` 기본값 |

## 새 대화 핸드오프 프롬프트

```text
카카오 로그인 보안 보강과 k6 부하테스트 분리 계획을 이어서 구현해줘.

반드시 먼저 읽을 문서:
- docs/plans/PLAN_kakao-auth-hardening-loadtest-handoff.md
- docs/specs/api/auth.md
- docs/specs/ops/k6-load-test-plan.md
- docs/CRITICAL_LOGIC.md
- docs/memory.md

목표:
1. /auth/kakao-login이 클라이언트 전달 kakaoId를 신뢰하지 않도록 변경
2. API 서버가 kakaoAccessToken으로 카카오 사용자 정보를 직접 검증
3. consumer/seller/driver NextAuth Kakao callback에서 account.access_token을 API로 전달
4. seller 신규 카카오 가입 금지, hub_staff 초대 정책, suspended 차단, refresh rotation 정책을 유지
5. k6는 카카오 OAuth를 호출하지 않고 seed email/password 계정 또는 사전 발급 JWT만 사용

작업 방식:
- A0부터 A7까지 원자 작업 순서대로 진행
- 각 Task 완료 후 테스트 결과를 기록
- production 쓰기 요청 금지
- 수정 파일 500라인 초과 금지
- docs/memory.md가 200라인을 넘으면 즉시 요약·아카이브

최소 검증:
- pnpm --filter api test
- 관련 lint/typecheck
- k6 smoke 또는 readiness smoke
```

## 남은 결정

- driver 신규 카카오 가입 자동 승인 정책을 유지할지, 운영 승인제로 바꿀지 결정 필요
- 카카오 API 장애 시 사용자 메시지를 로그인 실패로 통일할지, 외부 인증 장애로 분리할지 결정 필요

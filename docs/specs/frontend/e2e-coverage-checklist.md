# Consumer E2E 과거 검증 기록

> **상태**: 역사 자료
> **원 기준일**: 2026-05-03
> **현재 커버리지 정본 아님**
> **최종 정합화**: 2026-08-23 KST

## 목적

이 문서는 2026-05 시점 consumer E2E 확장 계획과 당시 검증 결과를 보존한다. 당시 기록된 `60 passed, 2 skipped`, 이메일/password 기반 인증 활성화 절차, 신규 테스트 TODO는 현재 전체 E2E 상태를 뜻하지 않는다.

2026-08 현재 저장소에는 이 문서 작성 뒤 추가된 consumer·seller·driver·admin·회차 직배송 spec과 별도 원격 workflow가 존재한다. 따라서 현재 테스트 커버리지나 출시 준비도를 판단할 때 이 파일의 숫자와 TODO를 사용하지 않는다.

## 현재 확인 경로

현재 E2E 범위를 확인할 때는 다음 순서로 본다.

1. `apps/e2e/tests/**`의 실제 spec 목록
2. `apps/e2e/playwright.config.ts`와 관련 global setup/helper
3. `.github/workflows/e2e*.yml`의 실제 실행 대상
4. 현재 출시 Task가 요구하는 지정 SHA 원격 run
5. `docs/specs/ops/mvp-sales-round-e2e-environment.md`의 비운영 격리 계약

회차 직배송 출시 게이트는 `.github/workflows/e2e-round-direct.yml`이 실행하는:

- `consumer-round-direct`
- `seller-sale-rounds`
- `driver-direct-delivery`
- chromium + mobile
- 총 52건
- skipped/unexpected/flaky 0
- 양 프로젝트 fixture cleanup 성공

을 기준으로 한다.

## 과거 문서가 더 이상 정본이 아닌 항목

- 2026-05 당시의 consumer 중심 spec 목록
- `60 passed, 2 skipped` 결과
- 주석 블록을 풀어 인증 테스트를 활성화하라는 절차
- 일반 `PLAYWRIGHT_TEST_EMAIL/PASSWORD`만으로 현재 모든 역할 인증을 설명하는 방식
- 당시 P0/P1/P2/P3 TODO 목록

현재 Preview 역할 인증은 consumer/seller와 driver의 gate가 서로 다르며, 회차 원격 E2E는 전용 workflow와 GitHub Environment secret/fixture 계약을 사용한다.

## 역사적 가치

이 파일의 과거 Git history는 consumer 구매 퍼널·검색·마이페이지·회귀 테스트를 어떤 순서로 확대하려 했는지 추적할 때 사용할 수 있다. 아직 빠진 테스트를 결정할 때는 과거 TODO를 그대로 복원하지 말고 현재 코드와 현재 테스트 스위트를 다시 gap 분석한다.

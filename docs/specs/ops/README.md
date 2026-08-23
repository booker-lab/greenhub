# Ops 문서 라우팅

## 현행 계약

- `mvp-sales-round-runbook.md` — 회차 직배송 운영 런북
- `mvp-sales-round-e2e-environment.md` — 지정 SHA 비운영 E2E 격리 계약
- `preview-auth-url-policy.md` — Preview/Kakao OAuth URL 정책

현재 외부 상태와 출시 순서는 `docs/memory.md`와 활성 HANDOFF·PLAN이 우선한다.

## 출시 순서 주의

운영 런북은 일상 운영·장애·롤백 절차를 설명하지만 **출시 dependency의 정본은 아니다.**

특히 현재 production `/privacy`, `/terms`는 비판매 상태를 전제로 하므로, 실제 release SHA를 확정하기 전에 `docs/specs/legal/README.md`의 판매 활성화 법적 문서 재정합화 게이트를 수행한다.

런북의 판매 모드 전환 조건을 읽을 때도 활성 `PLAN_mvp_round_direct_launch_blockers.md`의 최신 dependency가 우선한다.

## 조건부 후속 계획

- `k6-load-test-plan.md` — `docs/BACKLOG.md`의 `LOAD-TEST-FORMAL` 재개 조건이 생길 때 사용

현재 출시 P0 게이트가 아니다.

## 완료된 증거

- `kakao-business-channel-proof.md` — 카카오 비즈니스 채널 심사 과정의 완료된 증거 기록

이 문서의 과거 반려·재신청 상태를 현재 상태로 사용하지 않는다. 현재 채널 승인은 완료 상태다.

## 공통 규칙

- 외부 provider 상태는 과거 snapshot을 현재값으로 승계하지 않는다.
- 문서에 명령이 있어도 production 변경 승인을 뜻하지 않는다.
- URL은 `docs/URLS.md`를 확인하고 중요한 실행 전에는 실제 provider/배포 환경에서 다시 검증한다.
- secret·서비스 계정·세션·고객 개인정보 원문을 문서에 기록하지 않는다.
- 운영 DB에 테스트 fixture를 만들거나 삭제하는 절차는 현재 E2E 환경 계약과 별도 승인 없이 수행하지 않는다.

# Plans 문서 라우팅

> `docs/plans`에는 현재 실행 계약과 완료된 수많은 PLAN·REPORT·PROMPT가 함께 보존된다.

## 현재 활성 문서

현재 활성 여부는 파일명이나 체크박스가 아니라 `docs/memory.md`가 결정한다.

2026-08-23 기준 현재 활성 계약은 다음 3개다.

- `HANDOFF_mvp_round_direct_aligo_review_pause.md` — ALIGO 외부 심사 대기와 재개 순서
- `PLAN_mvp_round_direct_launch_blockers.md` — 실제 출시 dependency와 승인 게이트
- `PLAN_deployment_safety_guards_20260823.md` — `main` 통합과 production 배포 분리, exact-SHA 배포 원칙, 완료된 Issue #32 보호 상태의 유지 계약

현재 상태 자체는 `docs/memory.md`, 미완료 작업은 `docs/BACKLOG.md`가 정본이다.

특히 `PLAN_deployment_safety_guards_20260823.md`는 파일명 패턴상 `PLAN_*`이지만 `docs/memory.md`가 명시적으로 활성화한 현재 계약이다. Issue #32가 `CLOSED`가 된 뒤에도 exact-SHA·production 분리·docs-only 안전 계약을 위해 현재 계약으로 유지한다.

## 기본적으로 역사 자료인 문서

`docs/memory.md`에서 활성 문서로 지정하지 않은 다음 파일은 기본적으로 과거 실행·설계·검증 증거다.

- `PLAN_*`
- `REPORT_*`
- `PROMPT_*`
- 과거 Task 번호 handoff
- 특정 SHA·PR·workflow run을 종료 증거로 기록한 문서

역사 문서 안의 `todo`, `next`, `blocked`, `미완료`, `병합 금지`, `배포 필요` 같은 표현을 현재 지시로 자동 승계하지 않는다.

## 상태 충돌 시 판정

1. GitHub/provider 직접 재검증
2. `docs/memory.md`
3. 현재 활성 HANDOFF·PLAN
4. `docs/BACKLOG.md`
5. 완료 PLAN·REPORT

과거 계획을 현재 작업으로 재개해야 한다면 먼저 현재 코드·외부 상태와 다시 비교하고 Backlog 또는 memory에 명시적으로 재활성화한다.

## 승인 경계

과거 PLAN·REPORT에 실행 명령이나 승인 문구가 남아 있어도 현재 승인으로 간주하지 않는다. production 배포·환경변수·실결제/환불·실제 알림 발송·운영 데이터 변경은 현재 Task의 별도 승인을 요구한다.

`main` merge 자체는 production 배포 승인이 아니며, 배포 안전 계약이 요구하는 exact release SHA 검증과 별도 `Task 3.1 승인`을 거친다.

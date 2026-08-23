<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

> 실행 순서·의존성·승인 게이트만 관리한다. 현재 상태는 `docs/memory.md`, 세부 Acceptance Criteria는 `docs/BACKLOG.md`, 도메인 계약은 current spec을 따른다.

## 문서 메타

- 작성일: 2026-07-28
- 최종 정합화: 2026-08-24 KST
- 상태: `paused_external_review`
- Priority: P0
- 외부 차단점: ALIGO 회차 알림 템플릿 8종 provider 심사 완료
- 상태 SSOT: `docs/memory.md`
- 재개 지점: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 미완료 상세: `docs/BACKLOG.md`
- 인증: `docs/specs/api/auth.md`
- 주문: `docs/specs/api/orders.md`
- 결제: `docs/specs/api/payments.md`
- 정산: `docs/specs/api/settlements.md`
- 관리자: `docs/specs/api/admin.md`
- legal: `docs/specs/legal/README.md`
- 배포 안전: `docs/plans/PLAN_deployment_safety_guards_20260823.md`

## 현재 출시 게이트

| ID | 게이트 | 상태 |
|---|---|---|
| 0A | GitHub `main` protection/ruleset | 미완료 — Issue #32 |
| 0B | 결제 finalization 비`PAID` 최종 차단 | 미완료 — P0 |
| 0C | 주문 mutation authorization 직접 거부 회귀 | 미완료 — P0 COVERAGE GAP |
| 0D | 주문 direct Firestore read·데이터 최소화 | 미완료 — P0 IMPLEMENTATION FINDING |
| 0E | driver 승인 + 세션/claims revocation | 미완료 — P0 IMPLEMENTATION FINDING / DECISION REQUIRED |
| 0F | admin 강제 환불 lifecycle 정합성 | 미완료 — P0 IMPLEMENTATION FINDING |
| 0G | 유료 재배송비 `PAID` 전 배송 재개 차단 | 미완료 — P0 IMPLEMENTATION FINDING |
| 1 | ALIGO 8종 provider 최종 승인 | 검수중 |
| 2 | 실제 알림톡 정상 발송 | 미실행 |
| 3 | SMS fallback 실제 검증 | 미실행 |
| 4 | 판매 활성화 legal 재정합화 | 미실행 |
| 5 | actual release SHA 확정 | 미실행 |
| 6 | exact SHA 원격 E2E 52건+cleanup | 미실행 |
| 7 | 운영 Firebase 재조회 | 미실행 |
| 8 | 운영 ALIGO 설정 | 미실행 |
| 9 | exact-SHA production 배포 | 미실행 — 별도 Task 3.1 승인 |
| 10 | 첫 회차 검수 | 미실행 |
| 11 | 최종 출시 판정 | 미실행 |
| 12 | `salesMode: round_direct` | 미실행 |

## Agent Completion Contract

1. repository 변경은 최신 `main` 기반 목적별 branch+PR로 통합한다.
2. direct `main` commit/push 금지.
3. Task 0A~0G는 ALIGO 심사와 병렬 수행 가능.
4. P0 구현 결함을 문서 문구만 바꿔 정상화하지 않는다.
5. `IMPLEMENTED / UNVERIFIED`, `COVERAGE GAP`, `IMPLEMENTATION FINDING`, P0 `DECISION REQUIRED`는 완료가 아니다.
6. 비밀값·고객 개인정보·사진 원본·서명 URL을 증거에 남기지 않는다.
7. actual release SHA는 Task 0A~0G와 legal gate 해결 뒤에만 확정한다.
8. exact release SHA E2E 52+cleanup 전 production 배포 금지.
9. `main` merge·빈 commit·재-push를 production 트리거로 사용하지 않는다.
10. production은 exact SHA/artifact + 별도 승인 게이트를 사용한다.
11. provider metadata SHA 불일치 시 traffic/domain 전환 금지.
12. ALIGO 실제 발송 실패 시 알림 없는 출시를 임의 승인하지 않는다.
13. 첫 회차가 검수된 `SCHEDULED`가 아니면 `salesMode` 전환 금지.
14. 금전 게이트는 UI 조건이 아니라 서버 boundary에서 fail-closed여야 한다.

## Phase 0 — 출시 전 코드·권한·금전 안전성

### Task 0.1 — 회차 직배송 코드 `main` 통합
- Status: done
- Evidence: PR #11, 기능 통합 SHA `e55f25914cc7d01576fbd4639583daaf0fe6385e`.

### Task 0.2 — `main` 자동 production deploy 분리
- Status: done
- Evidence: PR #30, PR #31.

### Task 0.3 — GitHub `main` protection/ruleset
- Dependency: 없음
- Required: PR required, `Deployment safety guard / verify`, force-push/delete 차단
- Tracking: Issue #32
- Status: todo_admin

### Task 0.4 — 결제 finalization `PAID` 최종 방어
- Dependency: 없음
- Goal: finalization boundary가 비`PAID` provider 상태 자체 차단
- Verify: `PENDING|FAILED|CANCELLED|PAID`, 금액 불일치, legacy/group/round
- Backlog: `PAYMENT-FINALIZATION-PAID-GUARD`
- Status: todo_code

### Task 0.5 — 주문 mutation authorization 직접 회귀
- Dependency: 없음
- Goal: 타-store seller, 비담당 driver, first-claim과 거부 side-effect 0 직접 고정
- Backlog: `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
- Status: todo_test

### Task 0.6 — 주문 direct Firestore read·데이터 최소화
- Dependency: 없음
- Goal: 필요한 discovery는 유지하고 arbitrary raw read와 불필요 필드 노출 제거
- Verify: Rules + discovery/assigned detail + 타주문/타store 거부
- Backlog: `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
- Status: todo_code_security

### Task 0.7 — Driver 승인·세션/claims revocation
- Dependency: 없음
- Goal: 관리자 승인 전 driver 권한 차단 + suspension/role/store/approval의 정의된 revocation window 보장
- Coupling: Task 0.6 broad driver read와 결합 회귀
- Backlog: `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
- Status: todo_code_security

### Task 0.8 — Admin 강제 환불 lifecycle 정합화
- Dependency: 없음
- Goal: admin refund가 정상 cancellation의 본 결제/추가 charge/capacity/held counter/settlement 불변식과 수렴
- Required: 허용 상태 fail-closed, paid settlement 별도 회계 정책, provider-success/local-failure 재시도, 동시 실행 수렴
- Backlog: `ADMIN-FORCE-REFUND-CONSISTENCY`
- Status: todo_code_financial

### Task 0.9 — 유료 재배송비 결제 완료 전 배송 재개 차단
- Dependency: 없음
- Goal: 고객 책임 유료 재배송은 현재 hold에 연결된 `REDELIVERY_FEE` charge가 `PAID`일 때만 `DELIVERY_HELD → DELIVERING` 허용
- Required:
  - 현재 hold와 `redeliveryChargeId` 연계 검증
  - charge type/order/store/user 일치 검증
  - `PENDING|FAILED|REFUNDED|missing|mismatched` fail-closed + side effect 0
  - 재배송비 없는 판매자/시스템 책임 보류는 불필요한 결제 gate 없음
  - driver UI charge 상태 표현
  - `미결제 거부 → 결제 완료 → 재개 성공` unit/integration/E2E
- Contract: `docs/specs/api/orders.md`
- Operational evidence: `docs/specs/ops/mvp-sales-round-runbook.md`
- Backlog: `ORDER-REDELIVERY-PAID-RESUME-GATE`
- Status: todo_code_financial

## Phase 1 — ALIGO 알림 게이트

### Task 1.1 — 발신 프로필·코드 매핑 기반
- Status: done

### Task 1.2 — 템플릿 8종 최종 승인
- Current: `docs/memory.md`
- Status: blocked_external_review

### Task 1.3 — 승인 `tpl_code` 1:1 매핑 검사
- Dependency: Task 1.2
- Status: todo

### Task 1.4 — 격리 실제 알림톡 정상 발송 [승인 게이트]
- Dependency: Task 1.3
- Status: todo

### Task 1.5 — SMS fallback 실제 검증 [승인 게이트]
- Dependency: Task 1.4
- Status: todo

## Phase 2 — 판매 공개 계약·release SHA

### Task 2.1 — 판매 활성화 legal 재정합화
- Dependency: Task 1.5, Task 0.6, Task 0.8, Task 0.9
- Required: 주문·취소·환불·배송·재배송비·보류, PortOne/PG, ALIGO, seller/driver 최소 접근, 시행일·이전 버전, legal tests
- Status: todo

### Task 2.2 — actual release SHA 확정
- Dependency: Task 0.3~0.9, Task 2.1
- Goal: 운영 대상 단 하나의 exact `main` SHA 고정
- Status: todo

### Task 2.3 — exact SHA 전체 원격 회차 E2E
- Dependency: Task 2.2
- Goal: chromium 26 + mobile 26 = 52, unexpected/skipped/flaky 0, 양쪽 cleanup 성공
- Status: todo

### Task 2.4 — 운영 Firebase read-only 재조회
- Dependency: Task 2.3
- Status: todo

### Task 2.5 — 운영 ALIGO 변수·매핑 반영 [승인 게이트]
- Dependency: Task 1.5, Task 2.3
- Status: todo

## Phase 3 — exact-SHA production 배포

### Task 3.0 — production deploy/promotion 절차 확정
- Dependency: Task 2.3
- Goal: exact SHA/artifact 기반 명시적 배포와 사후 SHA 검증
- Status: todo

### Task 3.1 — API production 배포 [별도 승인 게이트]
- Dependency: Task 0.3, Task 2.3, Task 2.4, Task 2.5, Task 3.0
- 사용자의 별도 `Task 3.1 승인` 없이는 실행하지 않는다.
- Status: todo

### Task 3.2 — consumer·seller·driver production 배포 [승인 게이트]
- Dependency: Task 3.1
- Status: todo

### Task 3.3 — 운영 smoke
- Dependency: Task 3.2
- 확인: health, Kakao auth, legacy, 회차 read, `/privacy`, `/terms`
- Status: todo

### Task 3.4 — 배포 후 오류 관찰
- Dependency: Task 3.3
- Status: todo

## Phase 4 — 첫 회차

### Task 4.1 — 첫 회차 `DRAFT` 생성 [승인 게이트]
- Dependency: Task 3.4
- Status: todo

### Task 4.2 — 일정·지역·상품·가격·한도 검수
- Dependency: Task 4.1
- Status: todo

### Task 4.3 — `SCHEDULED` 전환 [승인 게이트]
- Dependency: Task 4.2
- Status: todo

## Phase 5 — 최종 출시 판정

### Task 5.1 — 운영 역할·비상 연락·승인자 확인
- Dependency: Task 4.3
- Status: todo

### Task 5.2 — 전환·rollback dry-run
- Dependency: Task 5.1
- Status: todo

### Task 5.3 — 최종 출시 판정
- Dependency: Task 5.2
- 대조: exact SHA, Task 0A~0G, Firebase, ALIGO, legal, 첫 회차, 운영 예외, rollback
- Status: todo

## Phase 6 — 판매 모드 전환

### Task 6.1 — `round_direct` 전환 [최종 승인 게이트]
- Dependency: Task 5.3 승인
- Status: todo

### Task 6.2 — 전환 직후 smoke·rollback 판정
- Dependency: Task 6.1
- Status: todo

### Task 6.3 — 외부 유입 링크 공개 [승인 게이트]
- Dependency: Task 6.2
- Status: todo

## Phase 7 — 초기 안정화

### Task 7.1 — 첫 두 회차 집중 모니터링
- Dependency: Task 6.3
- Status: todo

### Task 7.2 — 출시 Closeout
- Dependency: Task 7.1
- Status: todo

## Completion Criteria

- Task 0A~0G가 직접 테스트 증거와 함께 `main`에 포함됨.
- 유료 재배송비 결제 완료 전 배송 재개가 서버에서 fail-closed되고 정상 결제 뒤 재개 회귀가 포함됨.
- admin 환불이 정상 cancellation 금전·capacity·settlement 불변식과 수렴하거나 명시적 별도 정책으로 검증됨.
- Issue #32 완료.
- ALIGO 8종 승인 + 실제 알림톡/SMS fallback 검증.
- 판매 활성화 legal docs/test 정합화.
- actual release SHA E2E 52+cleanup 성공.
- 운영 Firebase·ALIGO 설정 확인.
- exact SHA production metadata 일치.
- 첫 회차 `SCHEDULED`.
- 최종 승인 뒤 `round_direct` 전환·smoke 또는 rollback 성공.

## 현재 Closeout Roll-up

- 코드 통합: 완료
- payment finalization P0: 미완료
- redelivery paid-before-resume P0: 미완료
- admin force-refund P0: 미완료
- order direct-read P0: 미완료
- auth approval/revocation P0: 미완료
- order mutation coverage P0: 미완료
- repo-side production auto-deploy 분리: 완료
- GitHub `main` protection: 미완료 — Issue #32
- ALIGO 8종 승인: 검수중
- 실제 알림 발송: 미실행
- legal: 미실행
- actual release SHA/E2E: 미실행
- production 설정/배포: 미실행
- 첫 회차: 미생성
- `salesMode`: `legacy`

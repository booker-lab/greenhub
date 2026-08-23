<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

> 실행 순서·의존성·승인 게이트만 관리한다. 상태는 `docs/memory.md`, 세부 Acceptance Criteria는 `docs/BACKLOG.md`, 도메인 계약은 current spec을 따른다.

## 메타

- 최종 정합화: 2026-08-24 KST
- 상태: `active_p0_parallel / aligo_external_review_pending`
- 외부 차단점: ALIGO 8종 provider 심사 완료
- 상태 SSOT: `docs/memory.md`
- 재개: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 미완료: `docs/BACKLOG.md`

## Task 2C candidate closeout

- 검증 candidate: `codex/task-2c-r1-reg001` / `c9d60f6`
- 상태: `TASK_2C_REGRESSION_VERIFIED`
- 완료 범위: `F-001`, `P0-001`, `P0-002`, `REG-001`, `ENV-001`
- 검증 증거: [Task 2D integration closeout report](REPORT_task_2d_integration_closeout.md)
- 현재 `origin/main`: `256abc7`; candidate code는 아직 main에 통합되지 않았다.
- 다음 Git 단계는 branch+PR 검토이며, Task 2D에서 rebase/merge/push하지 않았다.
- 최신 main의 redelivery P0 상태머신(`ORDER-REDELIVERY-PAID-RESUME-GATE`)은 candidate 범위 밖의 미완료 작업이다.

## 출시 게이트

| ID | 게이트 | 상태 |
|---|---|---|
| 0A | GitHub `main` protection/ruleset | 미완료 — Issue #32 |
| 0B | payment finalization 비`PAID` 차단 | candidate 검증 완료 — main 통합 대기 |
| 0C | order mutation authorization 직접 거부 회귀 | candidate 관련 회귀 완료 — main 통합 대기 |
| 0D | order direct Firestore read·최소화 | candidate Rules 경계 검증 완료 — field minimization/main 통합 대기 |
| 0E | driver 승인 + session/claims revocation | candidate driver gate 검증 완료 — 일반 refresh policy/main 통합 대기 |
| 0F | admin force-refund lifecycle | 미완료 — P0 FINDING |
| 0G | 유료 재배송 payment-request/hold-resolution/resume 상태머신 | 미완료 — P0 FINDING, candidate 범위 밖 |
| 0H | payment webhook real-signature coverage | 미완료 — P0 COVERAGE GAP |
| 0I | admin privileged mutation authorization + settlement pay coverage | 미완료 — P0 COVERAGE GAP |
| 1 | ALIGO 8종 최종 승인 | 검수중 |
| 2 | 실제 알림톡 | 미실행 |
| 3 | SMS fallback | 미실행 |
| 4 | 판매 활성화 legal | 미실행 |
| 5 | actual release SHA | 미실행 |
| 6 | exact SHA E2E 52+cleanup | 미실행 |
| 7 | 운영 Firebase 재조회 | 미실행 |
| 8 | 운영 ALIGO 설정 | 미실행 |
| 9 | exact-SHA production | 별도 승인 필요 |
| 10~12 | 첫 회차 → 최종 판정 → `round_direct` | 미실행 |

## Completion Contract

1. repository 변경은 최신 `main` 기반 branch+PR.
2. direct `main` 금지.
3. 0A~0I는 ALIGO 심사와 병렬 가능.
4. P0를 문서/UI 변경만으로 완료 처리하지 않는다.
5. 금전·권한 불변식은 server boundary + 직접 거부/정상/동시성 회귀가 필요하다.
6. driver 관리자 승인 계약은 public register/login, Kakao, refresh, Firebase claims까지 하나의 authorization lifecycle로 검증한다.
7. admin role boundary는 UI redirect만으로 `VERIFIED` 처리하지 않는다.
8. webhook auth는 mock E2E만으로 `VERIFIED` 처리하지 않고 real verifier의 valid/invalid 양방향 증거가 필요하다.
9. actual release SHA는 0A~0I + legal 해결 뒤 고정한다.
10. exact SHA E2E 52+cleanup 전 production 금지.
11. production은 exact SHA/artifact + 별도 승인.
12. provider metadata SHA 불일치 시 traffic 전환 금지.
13. 첫 회차 `SCHEDULED` 전 `salesMode` 전환 금지.

## Phase 0 — 코드·권한·금전 안전성

### Task 0.1 — 회차 직배송 `main` 통합
- Status: done — PR #11

### Task 0.2 — main auto-production 분리
- Status: done — PR #30/#31

### Task 0.3 — GitHub main protection
- Required: PR required, deployment safety required check, force-push/delete 차단
- Tracking: Issue #32
- Status: todo_admin

### Task 0.4 — Payment finalization PAID boundary
- Backlog: `PAYMENT-FINALIZATION-PAID-GUARD`
- Status: todo_code

### Task 0.5 — Order mutation authorization coverage
- Backlog: `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
- Status: todo_test

### Task 0.6 — Order direct read·minimization
- Backlog: `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
- Status: todo_code_security

### Task 0.7 — Driver approval·session revocation
- Backlog: `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
- Priority: highest security coupling with Task 0.6
- Current bypasses:
  - public email `register(role=driver) → login` can issue driver JWT without approval
  - new Kakao driver auto-approved
  - legacy missing approval flag auto-approved during login
  - refresh/custom-token can preserve stale authorization claims
- Required:
  - public registration cannot create usable driver authorization pre-approval
  - unapproved email/Kakao driver cannot receive driver JWT/Firebase claim
  - login-side automatic approval removed
  - authoritative refresh/claim revocation policy + direct pre/post approval tests
- Status: todo_code_security

### Task 0.8 — Admin force-refund lifecycle
- Backlog: `ADMIN-FORCE-REFUND-CONSISTENCY`
- Goal: 본 결제·추가 charge·capacity·held counter·settlement 불변식 수렴 + paid settlement 정책
- Status: todo_code_financial

### Task 0.9 — 유료 재배송 상태머신 정합화
- Backlog: `ORDER-REDELIVERY-PAID-RESUME-GATE`
- Contract: `docs/specs/api/orders.md`
- Operational evidence: `docs/specs/ops/mvp-sales-round-runbook.md`
- Goal: `결제 전 재배송 금지`와 payment-request 흐름을 실제 상태머신에서 동시에 만족
- Required:
  - paid-required hold의 payment-required 정보가 결제 전 사라지지 않음
  - payment-request 알림 뒤 consumer charge 생성/UI·endpoint actionable
  - current hold↔charge durable linkage
  - `REDELIVERY_FEE` + order/store/user + `PAID` 검증
  - 모든 delivery-start 경로(`HELD→DELIVERING`, `HELD→PREPARING→DELIVERING` 포함) 동일 gate
  - `PENDING|FAILED|REFUNDED|missing|mismatch` side effect 0
  - hold resolve/held counter 감소 시점을 결제·재개 계약과 일치
  - 무료/판매자책임 흐름 정상 유지
  - seller/driver race 한 번만 수렴
- Required tests:
  - payment request 뒤 consumer 결제 가능
  - 미결제 direct resume 거부
  - seller PREPARING 정책 직접 고정
  - PREPARING 경유 미결제 배송 시작 거부
  - PAID 뒤 정상 1회 재개
- Status: todo_code_financial

### Task 0.10 — Payment webhook real-signature coverage
- Backlog: `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE`
- Contract: `docs/specs/api/payments.md`
- Evidence: `docs/reports/REPORT_payment_webhook_signature_coverage_20260824.md`
- Goal: 구현된 signature verifier를 실제 cryptographic positive/negative path와 controller raw-body 경계에서 직접 고정
- Required:
  - known valid HMAC real-verifier 성공
  - non-empty invalid HMAC 거부
  - body/id/timestamp mutation 거부
  - controller + real verifier에서 invalid request가 service에 도달하지 않음
  - invalid request side effect 0
  - duplicate webhook 멱등 회귀 유지
- Status: todo_test_security

### Task 0.11 — Admin privileged mutation coverage
- Backlog: `ADMIN-PRIVILEGED-MUTATION-COVERAGE`
- Contract: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`
- Evidence: `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`
- Goal: admin role server boundary와 settlement 지급 금전 상태 전이를 직접 검증
- Required:
  - unauthenticated admin mutation 401
  - consumer/seller/driver admin mutation 403 + side effect 0
  - admin happy path/service validation 도달
  - settlement missing/invalid states 거부, `confirmed → paid` 성공
  - transaction fresh-read + concurrent pay 한 번만 수렴
  - 실제 guard를 mock으로 우회하지 않는 integration 증거
- Status: todo_test_security_financial

## Phase 1 — ALIGO

1. 8종 승인 (`blocked_external_review`)
2. provider code 1:1 검사
3. 승인 후 격리 실제 알림톡
4. 승인 후 SMS fallback

## Phase 2 — legal·release SHA

### Task 2.1 — 판매 활성화 legal
- Dependency: ALIGO 실제 검증 + Task 0.6 + 0.7 + 0.8 + 0.9
- Required: 주문/환불/재배송비/보류 실제 상태머신, 개인정보 처리, ALIGO, seller/driver 최소 접근, legal tests

### Task 2.2 — actual release SHA
- Dependency: Task 0.3~0.11 + 2.1

### Task 2.3 — exact SHA E2E
- Goal: chromium 26 + mobile 26 = 52, cleanup success

### Task 2.4 — 운영 Firebase read-only 재조회

### Task 2.5 — 운영 ALIGO 설정 [승인]

## Phase 3 — production

- Task 3.0 exact-SHA deploy/promotion 절차
- Task 3.1 API production — **별도 사용자 승인 필수**
- Task 3.2 세 frontend 동일 SHA production
- Task 3.3 smoke
- Task 3.4 오류 관찰

## Phase 4~7

- 첫 회차 `DRAFT` → 검수 → `SCHEDULED`
- 운영 역할/비상 연락 확인
- rollback dry-run
- 최종 출시 판정
- 최종 승인 뒤 `salesMode: round_direct`
- 전환 smoke
- 외부 유입 공개
- 첫 두 회차 모니터링 → Closeout

## 최종 완료 기준

- Task 0A~0I 직접 증거와 함께 `main` 포함.
- 승인 전 public email/Kakao driver authorization과 stale Firebase claims 우회 해결.
- driver 권한과 order direct-read 최소화가 결합 위험 없이 fail-closed.
- 유료 재배송 payment request가 실제 결제 가능한 상태를 유지하고, 결제 전 모든 배송 시작 경로가 fail-closed.
- webhook signature valid/invalid real-verifier evidence 포함.
- admin privileged mutation role boundary + settlement pay 직접 증거 포함.
- admin refund·payment finalization·권한/개인정보 P0 해결.
- Issue #32 완료.
- ALIGO 승인+실발송/fallback.
- legal 정합화.
- actual release SHA E2E 52+cleanup.
- 운영 Firebase/ALIGO 확인.
- exact SHA production metadata 일치.
- 첫 회차 `SCHEDULED` 후 최종 승인·전환.

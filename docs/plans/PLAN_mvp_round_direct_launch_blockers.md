<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

> 실행 순서·의존성·승인 게이트만 관리한다. 상태는 `docs/memory.md`, 세부 Acceptance Criteria는 `docs/BACKLOG.md`, 도메인 계약은 current spec을 따른다.

## 메타

- 최종 정합화: 2026-09-05 KST
- 상태: `active_p0_parallel / public_readiness_closed / publication_pending`
- 외부 ALIGO 심사 차단점: 해소 — 회차 템플릿 8종 `승인완료`
- 다음 ALIGO gate: provider code 1:1 확인 → 격리 알림톡 → SMS fallback
- 승인 증거: `docs/reports/REPORT_aligo_template_approval_20260827.md`
- 상태 SSOT: `docs/memory.md`
- 재개: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 미완료: `docs/BACKLOG.md`
- S2 Browser Readiness: `CLOSED`; exact-source Browser R3: `PASS`; physical-device disposition: `PHYSICAL_DEVICE_NOT_REQUIRED`
- R1 Combined Public Readiness: `PUBLIC_READINESS_CLOSED`; S2 → R1 campaign: `TERMINAL_SUCCESS`
- accepted source authority: `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`; exact-source Driver Preview: `preview / READY`
- 다음 문서·Git 의존성: `PUBLICATION_TOPOLOGY_CONVERGENCE`; production release/activation은 별도 게이트다.

## 현재 source·publication reconciliation

- 작업 시작 source HEAD/local `main`: `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`
- 작업 시작 local `origin/main` 및 live remote `main`: `aba3013f6dd352316fbf542cda4e1fd33117a534`
- remote `main`은 source HEAD의 조상이며 local source는 7개 commit 앞서 있었다.
- 잘못된 transcription `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`는 Git object가 아니며 target으로 사용하지 않는다.
- GitHub `main`: `protected=true`, PR required, strict `verify` required check, force-push·branch 삭제 차단; Issue #32 `CLOSED`.
- S2 → R1 closure는 semantic/browser work의 종료 상태이며, 아래 release gate와 production readiness를 대체하지 않는다.
- `AUTH-SESSION-CLAIM-REVOCATION`은 OPEN이며, refresh/session lifecycle 완료로 해석하지 않는다.
- 문서 publication의 다음 Git 단계는 branch+PR 검토이며, direct main commit/push는 금지한다.
- 최신 main의 redelivery P0 상태머신(`ORDER-REDELIVERY-PAID-RESUME-GATE`)은 candidate 범위 밖의 미완료 작업이다.

## 출시 게이트

| ID | 게이트 | 상태 |
|---|---|---|
| 0A | GitHub `main` protection/ruleset | 완료 — `protected=true`, PR required, `verify` strict required, force-push·delete 차단; Issue #32 `CLOSED` |
| 0B | payment finalization 비`PAID` 차단 | candidate 검증 완료 — main 통합 대기 |
| 0C | order mutation authorization 직접 거부 회귀 | candidate 관련 회귀 완료 — main 통합 대기 |
| 0D | order direct Firestore read·최소화 | candidate Rules 경계 검증 완료 — field minimization/main 통합 대기 |
| 0E | driver 승인 + session/claims revocation | candidate public/Kakao/JWT gate 검증 완료 — `AUTH-SESSION-CLAIM-REVOCATION` OPEN, main 통합 대기 |
| 0F | admin force-refund lifecycle | 미완료 — P0 FINDING |
| 0G | 유료 재배송 payment-request/hold-resolution/resume 상태머신 | 미완료 — P0 FINDING, candidate 범위 밖 |
| 0H | payment webhook real-signature coverage | 미완료 — P0 COVERAGE GAP |
| 0I | admin privileged mutation authorization + settlement pay coverage | 미완료 — P0 COVERAGE GAP |
| 0J | settlement 생성·confirm·cancel core lifecycle coverage | 미완료 — P0 COVERAGE GAP |
| 0K | marketing consent→preference→withdrawal→retention lifecycle | 미완료 — P0 FINDING |
| 1 | ALIGO 8종 최종 승인 | 완료 — 2026-08-27 provider UI 8종 `승인완료` |
| 2 | provider code 1:1 검사 + 실제 알림톡 | 미실행 |
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
3. 0A~0K는 ALIGO provider 실제 검증과 병렬 가능.
4. P0를 문서/UI 변경만으로 완료 처리하지 않는다.
5. 금전·권한 불변식은 server boundary + 직접 거부/정상/동시성 회귀가 필요하다.
6. driver 관리자 승인 계약은 public register/login, Kakao, refresh, Firebase claims까지 하나의 authorization lifecycle로 검증한다.
7. admin role boundary는 UI redirect만으로 `VERIFIED` 처리하지 않는다.
8. settlement core는 transaction 구현만으로 `VERIFIED` 처리하지 않고 생성·중복·confirm·cancel·paid 역전 방지를 직접 고정한다.
9. 선택 marketing consent는 checkout checkbox 성공만으로 완료하지 않고 authoritative state → withdrawal → retention evidence → sender gating까지 검증한다.
10. 주문·결제·배송 정보성 연락은 선택 marketing opt-out과 별개의 계약으로 유지한다.
11. webhook auth는 mock E2E만으로 `VERIFIED` 처리하지 않고 real verifier의 valid/invalid 양방향 증거가 필요하다.
12. actual release SHA는 0A~0K + legal 해결 뒤 고정한다.
13. exact SHA E2E 52+cleanup 전 production 금지.
14. production은 exact SHA/artifact + 별도 승인.
15. provider metadata SHA 불일치 시 traffic 전환 금지.
16. 첫 회차 `SCHEDULED` 전 `salesMode` 전환 금지.
17. ALIGO provider 템플릿 승인과 실제 발송 검증을 구분하며, 승인만으로 production 알림 경로를 `VERIFIED` 처리하지 않는다.

## Phase 0 — 코드·권한·금전 안전성

### Task 0.1 — 회차 직배송 `main` 통합
- Status: done — PR #11

### Task 0.2 — main auto-production 분리
- Status: done — PR #30/#31

### Task 0.3 — GitHub main protection
- Required: PR required, deployment safety required check, force-push/delete 차단
- Tracking: Issue #32
- Status: done — 2026-09-05 직접 재조회에서 `protected=true`, strict `verify` required check, force-push/delete 차단 확인

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
- Candidate verified (not yet main): public register/login approval gate, Kakao new/legacy no-auto-approval, JWT strategy/current-user/Firebase approval boundary.
- Remaining: `AUTH-SESSION-CLAIM-REVOCATION` — authoritative refresh state, stale claims, suspension/role/store/approval revocation SLA, access-token window, logout/rotation regression.
- Status: candidate_gate_verified / todo_session_revocation

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

### Task 0.12 — Settlement core lifecycle coverage
- Backlog: `SETTLEMENT-LIFECYCLE-COVERAGE`
- Contract: `docs/specs/api/settlements.md`
- Evidence: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`
- Goal: settlement 생성·중복·자동 confirm·cancel의 core financial lifecycle을 직접 고정
- Required:
  - create 1건 + fee/net/status/completedStatus snapshot
  - DELIVERED→REVIEWED/동시 완료 중복 생성·snapshot overwrite 없음
  - cutoff 전 pending 유지 / due pending confirmed
  - confirm/cancel race에서 cancelled 미덮어쓰기
  - missing no-op, pending/confirmed cancelled, cancelled 멱등, paid 역전 금지
  - 실제 회차 integration에서 DELIVERED settlement 1건 + REVIEWED 중복 없음
- Status: todo_test_financial

### Task 0.13 — Marketing consent lifecycle consistency
- Backlog: `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY`
- Contract: `docs/specs/api/notifications.md`, `docs/specs/legal/README.md`
- Evidence: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`
- Goal: checkout consent, user preference, withdrawal, retention evidence를 한 정책으로 수렴
- Decision:
  - MVP에서 marketing 미사용 → consent 수집/설정 노출 비활성화·제거
  - 유지 → user-level SSOT + checkout sync + withdrawal evidence + sender gating
- Required regardless of decision:
  - 신규 user marketing state 정의
  - 설정 화면이 authoritative state만 표시
  - 철회 channel/state/evidence 멱등성
  - 실제 marketing sender가 있다면 opt-out 준수
  - ORDER_* 정보성 연락은 marketing opt-out과 분리
  - final legal wording과 실제 구현 일치
- Status: todo_code_legal

## Phase 1 — ALIGO

1. [x] 8종 provider 승인 — 2026-08-27 15:06 KST 경 모두 `승인완료`
2. [ ] provider code 1:1 검사
3. [ ] 승인된 템플릿 격리 실제 알림톡
4. [ ] SMS fallback

증거: `docs/reports/REPORT_aligo_template_approval_20260827.md`.

## Phase 2 — legal·release SHA

### Task 2.1 — 판매 활성화 legal
- Dependency: ALIGO 실제 검증 + Task 0.6 + 0.7 + 0.8 + 0.9 + 0.12 + 0.13
- Required: 주문/환불/정산/재배송비/보류 실제 상태머신, marketing consent 실제 정책, 개인정보 처리, ALIGO, seller/driver 최소 접근, legal tests

### Task 2.2 — actual release SHA
- Dependency: Task 0.3~0.13 + 2.1

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

- Task 0A~0K 직접 증거와 함께 `main` 포함.
- 승인 전 public email/Kakao driver authorization과 stale Firebase claims 우회 해결.
- driver 권한과 order direct-read 최소화가 결합 위험 없이 fail-closed.
- 유료 재배송 payment request가 실제 결제 가능한 상태를 유지하고, 결제 전 모든 배송 시작 경로가 fail-closed.
- settlement 생성·confirm·cancel core lifecycle 직접 상태/race 증거 포함.
- admin privileged mutation role boundary + settlement pay 직접 증거 포함.
- marketing consent 유지/미사용 정책이 checkout·preference·withdrawal·retention·legal에 일관되게 반영.
- webhook signature valid/invalid real-verifier evidence 포함.
- admin refund·payment finalization·권한/개인정보 P0 해결.
- Issue #32 완료.
- ALIGO 승인+실발송/fallback.
- legal 정합화.
- actual release SHA E2E 52+cleanup.
- 운영 Firebase/ALIGO 확인.
- exact SHA production metadata 일치.
- 첫 회차 `SCHEDULED` 후 최종 승인·전환.

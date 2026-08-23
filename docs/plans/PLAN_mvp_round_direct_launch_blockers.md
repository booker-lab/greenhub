<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

> 실행 순서·의존성·승인 게이트만 관리한다. 상태는 `docs/memory.md`, 상세 Acceptance Criteria는 `docs/BACKLOG.md`, 도메인 계약은 current spec을 따른다.

## 메타

- 최종 정합화: 2026-08-24 KST
- 상태: `paused_external_review`
- 외부 차단점: ALIGO 8종 provider 심사 완료
- 상태 SSOT: `docs/memory.md`
- 재개: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 미완료: `docs/BACKLOG.md`

## 출시 게이트

| ID | 게이트 | 상태 |
|---|---|---|
| 0A | GitHub `main` protection/ruleset | 미완료 — Issue #32 |
| 0B | payment finalization 비`PAID` boundary | 미완료 — P0 FINDING |
| 0C | payment webhook real-signature coverage | 미완료 — P0 COVERAGE GAP |
| 0D | order mutation authorization coverage | 미완료 — P0 GAP |
| 0E | order direct Firestore read·minimization | 미완료 — P0 FINDING |
| 0F | driver approval + session/claims revocation | 미완료 — P0 FINDING/DECISION |
| 0G | admin force-refund lifecycle | 미완료 — P0 FINDING |
| 0H | 유료 재배송 payment-request/hold-resolution/resume 상태머신 | 미완료 — P0 FINDING |
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
3. 0A~0H는 ALIGO 심사와 병렬 가능.
4. P0를 문서/UI 변경만으로 완료 처리하지 않는다.
5. 금전·권한 불변식은 server boundary + 직접 정상/거부/동시성 증거가 필요하다.
6. webhook auth는 mock E2E만으로 `VERIFIED` 처리하지 않고 real verifier의 valid/invalid 양방향 증거를 요구한다.
7. actual release SHA는 0A~0H + legal 해결 뒤 고정한다.
8. exact SHA E2E 52+cleanup 전 production 금지.
9. production은 exact SHA/artifact + 별도 승인.
10. provider metadata SHA 불일치 시 traffic 전환 금지.
11. 첫 회차 `SCHEDULED` 전 `salesMode` 전환 금지.

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

### Task 0.5 — Payment webhook signature real-verifier coverage
- Backlog: `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE`
- Goal: 구현된 HMAC verifier를 실제 cryptographic positive/negative path와 controller raw-body 경계에서 직접 고정
- Required:
  - known valid signature 성공
  - non-empty invalid signature 거부
  - body/id/timestamp mutation 거부
  - controller + real verifier에서 invalid request가 service에 도달하지 않음
  - invalid request side effect 0
  - duplicate webhook 멱등 회귀 유지
- Status: todo_test_security

### Task 0.6 — Order mutation authorization coverage
- Backlog: `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
- Status: todo_test

### Task 0.7 — Order direct read·minimization
- Backlog: `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
- Status: todo_code_security

### Task 0.8 — Driver approval·session revocation
- Backlog: `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
- Coupling: Task 0.7
- Status: todo_code_security

### Task 0.9 — Admin force-refund lifecycle
- Backlog: `ADMIN-FORCE-REFUND-CONSISTENCY`
- Goal: 본 결제·추가 charge·capacity·held counter·settlement 불변식 수렴 + paid settlement 정책
- Status: todo_code_financial

### Task 0.10 — 유료 재배송 상태머신 정합화
- Backlog: `ORDER-REDELIVERY-PAID-RESUME-GATE`
- Goal: `결제 전 재배송 금지`와 payment-request 결제 가능성을 동시에 보장
- Required:
  - payment-required 상태 PAID 전 보존
  - payment-request 뒤 consumer payment actionable
  - current hold↔charge durable linkage
  - 모든 delivery-start 경로 PAID gate
  - invalid charge state side effect 0
  - hold resolve/held counter timing·race 수렴
  - 무료/판매자책임 흐름 유지
- Status: todo_code_financial

## Phase 1 — ALIGO

1. 8종 승인 (`blocked_external_review`)
2. provider code 1:1 검사
3. 승인 후 격리 실제 알림톡
4. 승인 후 SMS fallback

## Phase 2 — legal·release SHA

### Task 2.1 — 판매 활성화 legal
- Dependency: ALIGO 실제 검증 + Task 0.7 + 0.9 + 0.10
- Required: 주문/환불/재배송/보류 실제 상태머신, PortOne/PG, ALIGO, seller/driver 최소 접근, legal tests

### Task 2.2 — actual release SHA
- Dependency: Task 0.3~0.10 + 2.1

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
- 전환 smoke → 외부 유입 공개
- 첫 두 회차 모니터링 → Closeout

## 최종 완료 기준

- Task 0A~0H 직접 증거와 함께 `main` 포함.
- webhook signature valid/invalid real-verifier evidence 포함.
- payment finalization·재배송·admin refund·권한/개인정보 P0 해결.
- Issue #32 완료.
- ALIGO 승인+실발송/fallback.
- legal 정합화.
- actual release SHA E2E 52+cleanup.
- 운영 Firebase/ALIGO 확인.
- exact SHA production metadata 일치.
- 첫 회차 `SCHEDULED` 후 최종 승인·전환.

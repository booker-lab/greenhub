<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 승인 후 재개 인계

> 현재 재개 지점만 관리한다. 상세 상태는 `docs/memory.md`, Acceptance Criteria는 `docs/BACKLOG.md`, 의존성은 `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`를 따른다.

## 현재 상태 — 2026-09-05 KST

- 회차 직배송 MVP `main` 통합 완료.
- 카카오 비즈니스 채널, ALIGO 발신 프로필·senderkey 준비 완료.
- 회차 알림 템플릿 8종 provider 승인 완료.
- 2026-08-27 15:06 KST 경 ALIGO SmartSMS 템플릿 관리 화면에서 8종 모두 `승인완료` 확인.
- 실제 알림톡·SMS 발송 0건.
- production ALIGO 설정 미반영.
- 첫 운영 회차 미생성, `salesMode=legacy`.
- production은 exact release SHA + 별도 승인 절차를 사용한다.
- S2 Browser Readiness와 R1 Combined Public Readiness는 각각 `CLOSED`·`PUBLIC_READINESS_CLOSED`이며 S2 → R1 campaign은 `TERMINAL_SUCCESS`다. 세부 상태는 `docs/memory.md`가 소유한다.
- exact-source Browser R3는 `PASS`, physical-device disposition은 `PHYSICAL_DEVICE_NOT_REQUIRED`다. physical-device proof나 production activation을 완료했다고 해석하지 않는다.
- accepted source authority는 `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`이며, exact-source Driver Preview는 `preview / READY`다.
- 다음 재개 의존성은 `PUBLICATION_TOPOLOGY_CONVERGENCE`다.

ALIGO 8종 provider 심사 차단점은 해소됐다. 승인 증거는 `docs/reports/REPORT_aligo_template_approval_20260827.md`를 따른다. 다음 ALIGO 단계는 provider code 1:1 매핑 확인 → 승인된 템플릿 격리 알림톡 → SMS fallback 검증이며, 실제 발송과 production 설정은 별도 승인 경계를 유지한다.

병렬 출시 P0:

1. `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
2. `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
3. `ORDER-REDELIVERY-PAID-RESUME-GATE`
4. `PAYMENT-FINALIZATION-PAID-GUARD`
5. `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
6. `ADMIN-FORCE-REFUND-CONSISTENCY`
7. `ADMIN-PRIVILEGED-MUTATION-COVERAGE`
8. `SETTLEMENT-LIFECYCLE-COVERAGE`
9. `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY`
10. `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE`

## 현재 source·publication reconciliation

- 작업 시작 branch: `main`
- 작업 시작 source HEAD/local `main`: `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`
- 작업 시작 local `origin/main` 및 live remote `main`: `aba3013f6dd352316fbf542cda4e1fd33117a534`
- remote `main`은 source HEAD의 조상이며 local source는 7개 commit 앞서 있었다.
- GitHub `main`은 `protected=true`, PR required, strict `verify` required check, force-push·branch 삭제 차단 상태다. Issue #32는 `CLOSED`다.
- 문서 변경은 repository 규칙에 따라 purpose branch + PR로 수렴해야 하며 direct main commit/push는 하지 않는다.
- `AUTH-SESSION-CLAIM-REVOCATION`과 나머지 broader release P0는 여전히 별도 재개 대상이다. S2 → R1 closure를 이유로 이를 닫거나 다시 열지 않는다.

다음 재개 지점은 `PUBLICATION_TOPOLOGY_CONVERGENCE`다. 이후 `AUTH-SESSION-CLAIM-REVOCATION`, 최신 main의 redelivery 상태머신, admin refund, legal, ALIGO provider 실제 검증, exact-SHA E2E와 production 승인 게이트를 별도 순서로 진행한다.

## 최우선 재개 — Driver 승인 + direct read 결합 위험

운영 불변식은 **관리자 승인 전 driver 권한을 얻을 수 없고, driver가 필요한 최소 주문만 접근한다**는 것이다.

2026-08-24 감사에서 확인된 public/Kakao approval bypass는 Task 2F-B candidate에서 다음과 같이 검증됐다.

- `POST /auth/register` driver는 `driverApproved: false`로 저장되고 client approval 주입이 거부된다.
- `POST /auth/login`은 false/missing approval driver를 JWT/refresh token 발급 전에 거부한다.
- 신규 Kakao driver와 legacy approval 필드 누락 driver는 로그인 side effect로 자동 승인되지 않는다.
- JWT strategy와 Firebase custom token은 current user의 role/approval/suspension 경계를 확인한다.
- `AUTH-SESSION-CLAIM-REVOCATION`의 refresh/stale claims lifecycle과 broad driver order read P0는 남아 있다.

따라서 frontend에서 일반 driver credentials UI를 숨기는 것만으로 해결되지 않는다. **API authorization boundary + Firebase claim + Rules read 경계를 함께 fail-closed**해야 한다.

Candidate에서 확인된 범위:

- public registration이 승인 전 usable driver authorization을 만들지 않음
- 미승인 email/Kakao driver가 driver JWT/Firebase claim을 얻지 못함
- login side-effect 자동승인 방지
- JWT/Firebase/Rules current-user 경계 직접 회귀

Remaining:

- refresh/custom-token session lifecycle이 authoritative approval/role/store 상태로 수렴
- driver direct Firestore read가 필요한 최소 대상·필드로 제한
- candidate의 main 통합 및 PR CI/merge readiness

정본: `docs/specs/api/auth.md`, `docs/specs/api/orders.md`, `docs/BACKLOG.md`.

## 다음 핵심 재개 — 재배송비 상태머신

운영 불변식은 **고객 책임 유료 재배송비를 결제하기 전에 실제 배송을 다시 시작하지 않는다**는 것이다.

현재는 두 문제가 결합돼 있다.

### A. direct resume 우회

`DELIVERY_HELD → DELIVERING`이 charge `PAID` 확인 없이 가능하며 driver UI도 결제 상태와 무관하게 `배송 재개`를 노출한다.

### B. seller PREPARING 경유 dead-end/우회

- 고객 책임+양수 재배송비 hold도 seller가 `DELIVERY_HELD → PREPARING` 가능.
- 이 전환은 hold를 해소하고 `heldOrderCount`를 줄이며 `ORDER_REDELIVERY_PAYMENT_REQUESTED`를 발생시키는 현재 경로다.
- 그러나 charge 생성 API와 consumer 결제 CTA는 현재 status `DELIVERY_HELD`를 요구한다.
- 따라서 payment-request 알림 뒤 실제 결제가 불가능할 수 있다.
- 이후 `PREPARING → DELIVERING`에도 과거 미결제 hold를 확인하는 durable gate가 없다.

완료 시 반드시:

- payment-required 정보가 결제 전 사라지지 않고,
- payment-request 알림 뒤 consumer가 실제 결제할 수 있으며,
- current hold↔charge가 durable하게 연결되고,
- `PAID` 전 모든 delivery-start 경로가 side-effect 0으로 거부되고,
- PAID 뒤 정상 한 번만 재개되며,
- hold resolve/held counter/알림이 race에서도 한 번만 수렴해야 한다.

단순 driver 버튼 숨김 또는 `HELD→DELIVERING` 한 경로 guard만으로 닫지 않는다.

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`.

## 새 감사 P0 포인터

### Settlement core lifecycle

transaction 구현은 있으나 생성 1건·중복 방지·confirm cutoff/race·cancel·paid 보존 직접 assertion이 부족하다.

- Backlog: `SETTLEMENT-LIFECYCLE-COVERAGE`
- Contract: `docs/specs/api/settlements.md`
- Evidence: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`
- Admin `confirmed → paid`는 `ADMIN-PRIVILEGED-MUTATION-COVERAGE`와 분리한다.

### Marketing consent lifecycle

checkout consent는 order+retention에 저장되지만 MY 설정은 별도 user preference를 읽고, checkout이 이를 동기화하지 않으며 철회 retention evidence가 없다.

- Backlog: `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY`
- Contract: `docs/specs/api/notifications.md`, `docs/specs/legal/README.md`
- Evidence: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`
- 제품 선택: MVP marketing 미사용이면 consent 수집/설정 노출 제거; 유지면 user-level SSOT + withdrawal evidence + sender gating.
- ORDER_* 정보성 연락은 marketing opt-out과 분리한다.

## 나머지 P0 포인터

- Payment finalization: `docs/specs/api/payments.md`
- Payment webhook signature coverage: `docs/specs/api/payments.md`, `docs/reports/REPORT_payment_webhook_signature_coverage_20260824.md`
- Order mutation authorization: `docs/specs/api/orders.md`
- Admin force-refund: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`
- Admin privileged mutation coverage: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`, `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`
- GitHub main protection: `protected=true`, Issue #32 `CLOSED` / deployment safety plan

## 지금 하지 말 것

- 승인된 ALIGO 템플릿 임의 수정·중복 등록
- 별도 승인 없는 실제 알림톡/SMS
- secret/실제 senderkey 원문/개인정보 Git 기록
- direct `main`
- main merge를 production 승인으로 해석
- 승인 없는 production/Firebase/운영 회차/`salesMode`
- P0를 frontend 버튼 숨김·UI redirect·legal 문구만으로 정상화
- settlement transaction 코드만 보고 financial lifecycle을 `VERIFIED` 처리
- marketing checkbox/UI만 보고 consent lifecycle 완료 처리
- 현재 정보성 ORDER_* 알림을 marketing opt-out으로 막아 consent 문제를 해결
- P0 전 actual release SHA 확정

## 병렬 가능 작업

1. driver public register/login + Kakao approval gate + refresh/custom claims
2. order direct read 최소화/Rules 회귀
3. 재배송 payment-request/hold-resolution/resume 상태머신 구현·회귀
4. payment finalization PAID boundary
5. order mutation 거부 회귀
6. admin force-refund lifecycle
7. admin privileged mutation + settlement pay 직접 회귀
8. settlement create/confirm/cancel core lifecycle 회귀
9. marketing consent lifecycle 정책 결정·구현·회귀
10. webhook signature real-verifier 회귀
11. read-only 문서/코드 감사
12. ALIGO provider code 1:1 매핑 read-only 확인

## ALIGO 승인 완료 후

1. P0 10개 완료 확인 — Issue #32 main protection은 이미 `CLOSED`
2. provider code 1:1 검사
3. 승인된 8종 기준 격리 알림톡
4. SMS fallback
5. 실제 재배송/환불/정산/read-minimization/auth/marketing 결과 기준 legal 재정합화
6. actual release SHA
7. exact SHA E2E 52+cleanup
8. 운영 Firebase read-only
9. 승인 후 production ALIGO 설정
10. exact-SHA deployment 절차
11. 별도 Task 3.1 승인 뒤 production
12. metadata SHA + smoke
13. 첫 회차 → 최종 판정 → `round_direct`

## 완료 체크

- [x] MVP main 통합
- [x] 카카오 채널 승인
- [x] ALIGO sender profile/senderkey
- [x] 8종 등록·심사 요청
- [x] ALIGO 8종 승인 — 2026-08-27 provider UI 확인
- [x] repo-side main auto-production 차단
- [x] S2 → R1 Public Readiness closure 기록 — 상세는 `docs/memory.md`
- [ ] driver approval/session revocation + public register/login gate
- [ ] order direct read 최소화
- [ ] 재배송 payment-required 상태머신 + 직접 회귀 + main
- [ ] payment finalization PAID
- [ ] order mutation coverage
- [ ] admin force-refund
- [ ] admin privileged mutation + settlement pay coverage
- [ ] settlement core lifecycle coverage
- [ ] marketing consent lifecycle consistency
- [ ] webhook signature real-verifier coverage
- [x] Issue #32 — GitHub main protection 직접 재확인
- [ ] provider code 1:1 매핑 검증
- [ ] 실제 알림톡/SMS fallback
- [ ] legal
- [ ] release SHA E2E 52+cleanup
- [ ] production ALIGO
- [ ] Task 3.1 승인

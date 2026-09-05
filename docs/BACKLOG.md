<!-- Language: ko -->

# Greenhub Backlog

> 기준일: 2026-09-06 KST
>
> 현재 미완료·향후 작업만 관리한다. 완료 상세는 Git history, `docs/CRITICAL_LOGIC.md`, `docs/archive/`, 완료 PLAN·REPORT를 사용한다.

## 우선순위 규칙

- **ACTIVE**: 지금 진행 가능한 최우선 작업
- **BLOCKED_EXTERNAL**: 외부 심사·승인 대기
- **NEXT**: 현재 게이트 해소 뒤 바로 진행
- **LATER**: MVP 출시 비차단 후속
- **STALE_OR_SUPERSEDED**: 현재 상태 재검증 전 실행 금지

---

## PUBLIC READINESS DOCUMENTATION CONVERGENCE

S2 → R1 Public Readiness의 accepted 종료 상태와 exact-source Preview 증거는 [현재 상태 SSOT](memory.md)에 기록한다. 이 Backlog는 그 종료 상태를 다시 열지 않으며, production release·activation과 혼동하지 않는다.

- S2 Browser Readiness: `CLOSED`
- exact-source Browser R3: `PASS` — 아래 source와 deployment는 역사적 Preview 증거다.
- physical-device disposition: `PHYSICAL_DEVICE_NOT_REQUIRED`
- R1 Combined Public Readiness: `PUBLIC_READINESS_CLOSED`
- S2 → R1 campaign: `TERMINAL_SUCCESS`
- #63이 확인한 pre-publication main 기준선: `ffd999423f8a98b0c1f34d020d832d7929feab72` — historical baseline
- #71이 재확인한 현재 live `main`: `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`
- #70 `SALE-ROUND-STATE-01`은 `MERGED`; 회차 atomicity/recovery implementation과 직접 proof가 publication되었다.
- 역사적 exact-source Preview 기준선: `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c` — 현재 main, PR, merge, production 증거로 승격하지 않는다.
- #63의 accepted closure는 닫힌 semantic work를 다시 열지 않는다는 뜻이며, Preview·Auth.js runtime 검증 잔여와 production/activation은 별도 상태다.
- 기존 문서 candidate는 PR #69에서 후속 갱신하며, 이 Goal은 PR #69를 merge하지 않고 Control Tower publication queue로 반환한다.

---

## 상태 구분

| 주장 | 현재 판정 |
|---|---|
| implementation | `SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY`는 `IMPLEMENTATION_PROVEN`; #66이 race/recovery proof를 accepted함 |
| verification | Sale Round implementation/race/recovery proof는 `PROVEN`; exact-release Preview/runtime/browser proof는 `PENDING` |
| prior candidate | PR #69의 기존 accepted candidate는 `9c921684a26597cb57887b6049288f1143b017c8` |
| updated candidate | PR #69의 후속 candidate는 remote-addressable 상태로 갱신하며, 정확한 head SHA는 Issue #75 TASK_RECORD에 기록 |
| PR | 기존 documentation PR #69는 `OPEN`; 이번 Goal은 merge하지 않음 |
| published / merged | PR #70은 `MERGED`; live `main`은 `fe5e680fa58c8b3af5e508d07115bb8ab9df272a` |
| Preview runtime proof | exact-release runtime/browser proof는 `PENDING`; historical Preview evidence를 승격하지 않음 |
| production deployment | `PRODUCTION_AUTHORITY_PENDING` |
| production activation | `PRODUCTION_AUTHORITY_PENDING` |
| first live round | `PRODUCTION_AUTHORITY_PENDING` |

---

## HISTORICAL / CLOSED BY REL-STATE-01

> 아래의 과거 P0/ACTIVE semantic scope와 상세 acceptance는 #63의 `A-N closed semantic work` 분류에 따라 현재 release blocker나 실행 가능한 ACTIVE task로 사용하지 않는다. 이 표시는 구현 완료, 검증 완료, remote publication, Preview proof, production deployment를 서로 추론하는 표기가 아니다. 역사적 finding과 보고서 경로는 Git history 및 관련 report에 보존한다.

> 특히 과거의 `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY`는 Pilot의 현재 정책인 `MARKETING_NOT_USED_IN_PILOT`을 다시 결정하는 근거가 아니다. `ORDER_CANCELLED` consumer self-cancel 알림도 이 Goal에서 정책을 결정하지 않는다.

### 역사적 P0 — PAYMENT-FINALIZATION-PAID-GUARD

`PaymentFinalizationService.finalizePaidOrder()`가 provider `status === 'PAID'`를 boundary 자체에서 강제하지 않는다.

- [ ] finalization boundary 비`PAID` 차단
- [ ] `PENDING|FAILED|CANCELLED` 직접 거부
- [ ] `PAID` legacy/group/round 정상 회귀
- [ ] 금액 불일치·reservation/race 회귀
- [ ] 수정 SHA `main` 통합

정본: `docs/specs/api/payments.md`.

### 역사적 P0 — PAYMENT-WEBHOOK-SIGNATURE-COVERAGE

PortOne webhook signature 구현은 존재하지만 금융 상태 변경 경계에 필요한 real-verifier cryptographic 양방향 회귀가 충분하지 않다.

현재 직접 근거:

- [x] production bootstrap은 `rawBody: true`
- [x] controller는 raw body + `webhook-id` + `webhook-timestamp` + `webhook-signature`를 요구
- [x] verifier는 `PORTONE_WEBHOOK_SECRET`, timestamp ±5분, HMAC SHA-256, timing-safe compare 사용
- [x] missing signature/secret, stale timestamp 거부 테스트 존재
- [x] HTTP E2E에서 webhook header 없는 요청 401
- [x] 회차 E2E fixture는 controller webhook 경로를 실행하지만 `verifyWebhookSignature`는 mock

판정:

- webhook signature 구현은 `IMPLEMENTED`.
- 현재 직접 증거는 `PARTIALLY VERIFIED`.
- 금융 인증 경계이므로 P0 `COVERAGE GAP`으로 추적한다.
- 구현 결함으로 단정하지 않는다.

남음:

- [ ] known secret/id/timestamp/raw body의 valid HMAC이 실제 `PortoneClient.verifyWebhookSignature()` 통과
- [ ] 필수 header를 모두 채운 non-empty invalid HMAC 거부
- [ ] 동일 signature에서 raw body 1 byte 변조 거부
- [ ] webhook-id 변조 거부
- [ ] signed timestamp 변조 및 허용창 경계 거부·허용 고정
- [ ] actual controller + real verifier에서 invalid request가 `PaymentsService.handleWebhook()`에 도달하지 않음
- [ ] invalid request의 주문/payment/orderCharge/capacity side effect 0
- [ ] 기존 duplicate webhook 멱등 회귀 유지
- [ ] 회귀 SHA `main` 통합

정본: `docs/specs/api/payments.md`; 증거: `docs/reports/REPORT_payment_webhook_signature_coverage_20260824.md`.

### 역사적 P0 — ORDER-REDELIVERY-PAID-RESUME-GATE

운영 계약은 고객 책임 첫 배송 실패의 유료 재배송에 **`결제 전 재배송 금지`**를 요구한다. 2026-08-24 추가 감사에서 이 문제는 단순 driver resume guard 누락이 아니라 **결제 요청·hold 해소·배송 재개 상태머신 전체 불일치**임을 확인했다.

현재 직접 근거:

- [x] `OrderChargePaymentService`의 charge `PAID` 검증·금액/연결 검증·환불 멱등성은 직접 테스트됨
- [x] driver `DELIVERY_HELD → DELIVERING` 전환은 charge `PAID`를 확인하지 않음
- [x] driver UI는 `DELIVERY_HELD` 회차 주문에 charge 상태와 무관하게 `배송 재개` CTA 노출
- [x] seller `DELIVERY_HELD → PREPARING`은 고객 책임+양수 재배송비 주문에서도 현재 테스트가 정상 성공으로 고정
- [x] 위 seller 전환은 hold `resolvedAt` 기록 + `heldOrderCount` 감소
- [x] 현재 notification map은 이 전환을 `ORDER_REDELIVERY_PAYMENT_REQUESTED` 발송 시점으로 사용
- [x] 그러나 `OrderChargesService.createRedeliveryFeeCharge()`는 현재 order status가 `DELIVERY_HELD`여야 charge 생성 가능
- [x] consumer `canPayRedeliveryFee`도 현재 status가 `DELIVERY_HELD`일 때만 true
- [x] 따라서 `PREPARING`으로 옮긴 뒤 결제 요청 알림이 가면 소비자 charge 생성/UI가 사라짐
- [x] 이후 `PREPARING → DELIVERING`에는 과거 paid-required hold의 미결제를 확인하는 durable guard가 없음

판정:

- charge 결제·환불 **하위 계약은 `VERIFIED`**.
- 유료 재배송 **주문 상태머신 전체는 P0 `IMPLEMENTATION FINDING`**.
- `DELIVERY_HELD → DELIVERING` 한 경로만 막아서는 `PREPARING` 우회가 남으므로 완료가 아니다.

남음 — 불변식:

- [ ] 고객 책임+양수 재배송비 hold의 `payment required`가 결제 완료 전 사라지지 않음
- [ ] payment-request 알림 시점에도 consumer charge 생성/결제 UI·endpoint가 actionable
- [ ] current hold↔charge를 `heldAt` 또는 동등 durable key로 연결
- [ ] charge type/order/store/user 일치 + `PAID`일 때만 모든 실제 delivery-start 경로 허용
- [ ] `PENDING|FAILED|REFUNDED|missing|mismatched`는 side effect 0 거부
- [ ] `DELIVERY_HELD → DELIVERING`과 `DELIVERY_HELD → PREPARING → DELIVERING` 모두 동일 paid gate 적용
- [ ] seller가 `PREPARING` 결제요청 구조를 유지한다면 durable payment-required marker와 consumer 결제 가능성을 상태 변경 뒤에도 보존; 아니면 결제 완료 전 hold를 해소하지 않는 구조로 변경
- [ ] hold 해소·`heldOrderCount` 감소 시점을 payment completion/재개 정책과 명시적으로 일치
- [ ] 판매자/시스템 책임·무료 재배송 정상 흐름 유지
- [ ] seller/driver 동시 요청에서 hold 해소·counter 감소·scheduled 알림이 한 번만 수렴

필수 회귀:

- [ ] payment-request 알림 뒤 consumer payment CTA/endpoint 유지
- [ ] charge 없음/PENDING/FAILED/REFUNDED direct resume 거부
- [ ] 결제 전 seller `PREPARING` 전환을 정책대로 허용/거부 직접 고정
- [ ] `PREPARING` 경유 미결제 `DELIVERING` 거부
- [ ] `PAID` 뒤 한 번 정상 재개
- [ ] 무료/판매자책임 재배송 정상 회귀
- [ ] 변경 SHA `main` 통합

정본: `docs/specs/api/orders.md`; 운영 근거: `docs/specs/ops/mvp-sales-round-runbook.md`.

### 역사적 P0 — ADMIN-FORCE-REFUND-CONSISTENCY

admin refund가 정상 cancellation의 추가 charge·capacity·held counter·settlement 후속효과를 우회한다.

- [ ] admin 환불 허용 상태 fail-closed
- [ ] 정상 cancellation orchestration 재사용 또는 동등 단일 orchestration
- [ ] 본 결제+paid 추가 charge 중복 없는 환불
- [ ] reservation/round/item/held counter 반환
- [ ] pending/confirmed settlement 취소
- [ ] paid settlement 별도 회계 조정/operation issue 정책
- [ ] provider 성공/local 실패 재시도·동시 실행 수렴
- [ ] 직접 회귀 후 `main` 통합

정본: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`.

### 역사적 P0 — ADMIN-PRIVILEGED-MUTATION-COVERAGE

`AdminController` class-level `JwtAuthGuard + RolesGuard + @Roles('admin')`와 고위험 mutation 구현은 존재하지만 서버 authorization 및 admin settlement 지급 상태 전이의 직접 회귀가 충분하지 않다.

현재 직접 근거:

- [x] admin controller 전체에 JWT + admin role guard 구현
- [x] `RolesGuard`는 request JWT role과 required metadata를 비교
- [x] `AdminService.markAsPaid()`는 transaction에서 fresh settlement status를 재확인하고 `confirmed → paid`를 구현
- [x] Playwright admin 테스트는 비로그인 UI redirect와 admin read smoke를 확인
- [x] 현재 `apps/api/src/admin`에 전용 controller/service `*.spec.ts` 없음
- [x] 확인한 API E2E에서 admin high-impact mutation의 direct role-denial coverage 없음

판정:

- admin guard 및 mutation 구현은 `IMPLEMENTED`.
- privileged mutation authorization + settlement pay transition은 `UNVERIFIED`.
- 권한·금전 상태 경계이므로 P0 `COVERAGE GAP`으로 둔다.

남음:

- [ ] 실제 HTTP admin mutation의 unauthenticated 401
- [ ] consumer/seller/driver의 admin mutation 403
- [ ] invalid role에서 service 호출·Firestore/payment side effect 0
- [ ] admin 정상 요청은 service validation/허용 경계까지 도달
- [ ] `markAsPaid`: missing settlement 거부
- [ ] `markAsPaid`: `pending|cancelled|paid` 거부
- [ ] `markAsPaid`: `confirmed → paid` 정상 성공 + timestamps
- [ ] 동시 지급/race에서 transaction fresh-read 기준 한 번만 수렴
- [ ] 실제 guard를 mock으로 우회하지 않는 controller/API integration 증거
- [ ] 회귀 SHA `main` 통합

`ADMIN-FORCE-REFUND-CONSISTENCY`의 lifecycle 구현 결함과는 별도다. force-refund 구현을 고쳤더라도 admin role boundary와 다른 privileged mutation coverage가 없으면 이 항목은 닫히지 않는다.

정본: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`; 증거: `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`.

### 역사적 P0 — SETTLEMENT-LIFECYCLE-COVERAGE

settlement 생성·자동 확정·취소 transaction 구현은 존재하지만 core financial lifecycle의 직접 상태·race 회귀가 없다.

현재 직접 근거:

- [x] `createSettlement()`는 transaction에서 기존 문서를 재확인하고 pending settlement를 생성
- [x] fee/net/completedStatus snapshot 구현
- [x] `confirmDueSettlements()`는 due pending을 transaction fresh-read 후 confirmed로 전환
- [x] `cancelSettlement()`는 pending/confirmed를 cancelled로 전환하고 cancelled 멱등·paid 역전 방지를 구현
- [x] 회차 E2E fixture는 실제 `SettlementsService`를 주입
- [x] 현재 `apps/api/src/settlements`에 core lifecycle 전용 `*.spec.ts` 없음
- [x] 회차 전체 흐름 E2E는 settlement 생성·중복·confirm·cancel·paid 보존을 직접 assertion하지 않음

판정:

- core implementation = `IMPLEMENTED`.
- 실제 service의 간접 통합 실행은 core 상태의 직접 검증으로 세지 않는다.
- 핵심 금전 불변식 직접 증거가 없으므로 `UNVERIFIED`.
- P0 `COVERAGE GAP`으로 추적한다.

남음:

- [ ] `createSettlement()` 1건 생성 + fee/net/status/completedStatus snapshot
- [ ] `DELIVERED → REVIEWED`/동시 완료 호출에서 중복 생성·settledAt 덮어쓰기 없음
- [ ] confirm cutoff 이전 pending 유지, due pending만 confirmed
- [ ] confirm/cancel race에서 cancelled 미덮어쓰기
- [ ] cancel missing no-op
- [ ] pending/confirmed → cancelled
- [ ] cancelled 멱등
- [ ] paid → cancelled 역전 금지
- [ ] 실제 회차 E2E에서 DELIVERED settlement 1건 + REVIEWED 중복 없음
- [ ] 정상 cancellation에서 pending/confirmed settlement 수렴
- [ ] 회귀 SHA `main` 통합

admin `confirmed → paid` authorization/status 전이는 별도 `ADMIN-PRIVILEGED-MUTATION-COVERAGE`가 소유한다.

정본: `docs/specs/api/settlements.md`; 증거: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`.

### 역사적 P0 — MARKETING-CONSENT-LIFECYCLE-CONSISTENCY

round checkout 선택 마케팅 consent, user preference, 철회, retention evidence가 하나의 authoritative lifecycle로 수렴하지 않는다.

현재 직접 근거:

- [x] round checkout은 기본 해제 선택 마케팅 checkbox 제공
- [x] 동의 시 order request에 `marketingConsent` 포함
- [x] round order 생성은 order snapshot + `marketingConsentLogs` `CONSENT` record 저장
- [x] MY 마케팅 설정은 `users.notificationPreferences`만 읽음
- [x] checkout consent는 user preference를 동기화하지 않음
- [x] Auth 신규 user는 `notificationPreferences` pair를 기본 초기화하지 않음
- [x] MY “즉시 철회”는 user preference만 false로 갱신
- [x] 철회 시 `MARKETING_CONSENT` withdrawal retention record 생성 경로 없음
- [x] 정보성 ORDER_* 연락은 마케팅 동의와 별개라는 UI/notification 계약 존재
- [x] 현재 실제 선택 마케팅 sender는 이번 감사에서 확인되지 않음

판정:

- consent 수집/설정 UI와 저장 구성은 존재한다.
- 동의→현재 상태→철회→retention evidence가 불일치하므로 P0 `IMPLEMENTATION FINDING`.
- 실제 마케팅 발송이 미운영이라는 이유로 consent lifecycle의 모순을 정상 계약으로 두지 않는다.

완료 정책 — 둘 중 하나를 명시적으로 선택:

- [ ] **미사용 정책**: MVP에서 실제 마케팅을 하지 않으면 consent 수집/설정 노출을 비활성화·제거하고 불필요한 저장을 중단
- [ ] **유지 정책**: user-level authoritative SSOT + checkout 동기화 + 철회 evidence + sender gating을 구현

공통 완료 조건:

- [ ] 신규 user의 marketing 상태가 정의되고 MY 설정이 오류 없이 해석
- [ ] checkout consent와 authoritative user 상태가 정책대로 일치
- [ ] 채널별 철회가 다른 채널 상태를 보존
- [ ] 철회 timestamp/policy/channel retention evidence 생성
- [ ] 중복 철회 멱등
- [ ] 실제 marketing sender가 존재한다면 opt-out 채널 발송 차단
- [ ] ORDER_* 주문·결제·배송 정보성 연락은 marketing opt-out 때문에 차단되지 않음
- [ ] legal current fact와 공개 출시 문구를 최종 정책에 맞춰 정합화
- [ ] 회귀 SHA `main` 통합

정본: `docs/specs/api/notifications.md`, `docs/specs/legal/README.md`, `docs/specs/mvp-sales-round-direct-delivery.md`; 증거: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`.

### 역사적 P0 — ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION

API authorization보다 seller/driver raw Firestore read 경계가 넓다.

- [ ] 미배정 `PREPARING` direct/hub discovery 최소 대상·필드 정의
- [ ] arbitrary/타-driver/완료 주문 raw read 차단
- [ ] assigned driver·seller 최소 projection/DTO 또는 동등 분리
- [ ] broad driver rule 제거
- [ ] Rules + 앱 정상/거부 회귀
- [ ] `main` 통합

정본: `docs/specs/api/orders.md`.

### 역사적 P0 — AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION

관리자 승인 전 driver 권한을 얻을 수 없는지와 stale session/claims 수렴을 하나의 umbrella로 추적한다. 현재 accepted source에는 approval-gate/current-user 하위 범위가 반영됐지만, 전체 P0를 닫지는 않는다.

Accepted source에서 검증됨 (remote `main` publication pending):

- [x] 신규 Kakao `targetRole: driver`가 `driverApproved: false`로 생성되고 자동 승인되지 않음
- [x] 기존 `driverApproved === undefined` driver가 Kakao 로그인 중 자동 승인되지 않음
- [x] 공개 `POST /auth/register` driver가 `driverApproved: false`로 생성되고 client approval 주입이 거부됨
- [x] 공개 `POST /auth/login`이 false/missing approval driver에게 JWT/refresh token을 발급하지 않음
- [x] 현재 user 기반 JWT strategy/Firebase custom-token approval·suspension 경계와 직접 register→login 회귀

남음 — `AUTH-SESSION-CLAIM-REVOCATION` OPEN 및 통합 대기:

- [ ] accepted source를 policy-compliant PR로 remote `main`에 통합
- [ ] 과거 계정 migration을 로그인 side effect가 아닌 별도 감사 절차로 분리
- [ ] refresh 시 authoritative user 상태 확인 및 stale role/store/approval claim 재발급 차단
- [ ] suspension/role/store/approval revocation SLA와 access-token window 결정·구현
- [ ] logout/rotation을 포함한 session lifecycle 회귀
- [ ] `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`과 결합된 broad driver read/minimization 해결

정본: `docs/specs/api/auth.md`; 증거: `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`.

### 역사적 P0 — ORDER-MUTATION-AUTHORIZATION-COVERAGE

상태 변경 ownership guard는 구현돼 있으나 핵심 거부 회귀가 부족하다.

- [ ] 타-store seller status/delivery-hold 403
- [ ] 비담당 driver assigned-order mutation 403
- [ ] first-claim 외 미배정 driver mutation 거부
- [ ] first claim 정확한 `driverId`
- [ ] 거부 side effect 0
- [ ] 필요한 admin 허용 범위 고정
- [ ] `main` 통합

정본: `docs/specs/api/orders.md`.

### 역사적 P0 — DEPLOY-SAFETY-MAIN-PROTECTION

repo-side production auto-deploy 차단과 GitHub main 보호를 완료했다. 2026-09-05 직접 재조회에서 `protected=true`, PR required, `Deployment safety guard / verify` strict required check, force push·branch delete 차단을 확인했다. Issue #32는 `CLOSED`다.

- [x] Issue #32
- [x] PR required
- [x] `Deployment safety guard / verify` required
- [x] force push·branch delete 차단
- [x] 재조회에서 enforcement 확인

---

## IMPLEMENTED / PUBLISHED

### SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY

상태: `IMPLEMENTATION_PROVEN` + `PUBLISHED`.

Issue #66이 회차 수정·수동 개방·주문 예약·취소 복구의 race/recovery 구현과 직접 proof를
accepted했다. semantic candidate `4169bf250d3bdf4a5196209090307ca979e8d32a`는 PR #70으로
게시되었고, PR #70은 merge되어 현재 live `main` `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`로
read-back되었다.

직접 proof 범위:

| proof scope | 현재 판정 |
|---|---|
| fresh round/item edit gate와 snapshot 보호 | `PROVEN` |
| `SCHEDULED → OPEN` 및 reservation의 authoritative open/close window | `PROVEN` |
| cancellation owner/lease/expiry, takeover와 stale-worker fencing | `PROVEN` |
| crash recovery, partial cancellation/retry와 duplicate convergence | `PROVEN` |
| focused/integration/regression proof와 exact candidate publication | `PROVEN` / `PUBLISHED` |

이 상태는 implementation과 repository publication에 대한 proof다. exact-release Preview/browser/runtime
proof는 `PENDING`이며, production deployment·production activation·`salesMode` 전환·live round·actual
payment/notification·first live round는 `PRODUCTION_AUTHORITY_PENDING`이다. 이 문서 후보와 PR #69는
이를 production-ready로 표현하지 않는다.

기술 계약은 `docs/specs/mvp-sales-round-direct-delivery.md`, 운영 중단·재개 규칙은
`docs/specs/ops/mvp-sales-round-runbook.md`에 둔다.

## ACTIVE

### BR-R3 — 증거 분류와 역사 승격 경계

이번 정본화는 선택지 B를 적용한다. 역사 보고서 전체를 current branch에 복구하지 않고, 역사
commit과 경로만 추적 가능한 `HISTORICAL_EVIDENCE`로 남긴다. 현재 판정과 acceptance의 정본은
아래 `CURRENT_IMPLEMENTATION_EVIDENCE`와 이 Backlog의 두 finding이다.

- `HISTORICAL_EVIDENCE`: `54af6edf44008848e586b1707d0f1fd13470a5f6`의
  `docs/reports/REPORT_retention_operations_sale_round_audit_20260824.md`는 2026-08-24 당시의
  감사 보고서다. 현재 branch에는 보고서 파일을 복구하지 않으며, 과거 결론을 현재 `VERIFIED`로
  승격하지 않는다.
- `CURRENT_IMPLEMENTATION_EVIDENCE`: 현재 source·직접 테스트·current spec·runbook을 다시
  대조한 결과다. Sale Round atomicity/recovery는 #66의 직접 proof와 #70/#71 publication으로
  `IMPLEMENTATION_PROVEN` / `PUBLISHED`가 되었으며, 남은 현재 공백은 retention과 operation
  claim fencing의 두 finding으로 분리했다.
- 위에서 유지된 직접 검증 항목은 `RESOLVED_NOT_PROMOTED`다. 이는 해당 base contract가 현재
  증거로 유지된다는 뜻일 뿐, 이번 두 finding이 해결되었거나 release gate·production 승인이
  되었다는 뜻이 아니다.
- `CURRENT_UNRESOLVED_FINDING`: `RETENTION-DELETE-ISSUE-ROUTING`,
  `OPERATION-ACTION-CLAIM-FENCING`만 이번 BR-R3의 current unresolved finding으로
  canonicalize한다. Sale Round finding은 #66/#70/#71로 implementation proof와 publication이
  완료되었지만, 이 사실이 exact-release runtime proof나 production 승인을 의미하지는 않는다.
- `FUTURE_REENABLE_REQUIREMENT`: 역사 보고서의 marketing consent lifecycle 논점은 현재
  `MARKETING_NOT_USED_IN_PILOT` controlled-pilot 정책을 변경하거나 새 finding으로 승격하지 않는다. 향후 marketing을 다시
  활성화할 때에만 당시의 동의·철회·보관·법무·provider·release 증거를 현재 권위로 재검증하고,
  별도 승인된 Task에서 범위를 확정한다.

---

## VERIFICATION

### Preview·exact-SHA proof

상태: `VERIFICATION_PENDING`.

- #63이 인정한 Preview/browser/fixture 결과는 해당 exact source에 대한 재사용 가능한 역사적 증거다.
- `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`와 그 Preview deployment를 현재 main, 현재 candidate, production deployment로 표현하지 않는다.
- 현재 release candidate에서 필요한 exact-SHA Preview/browser/fixture proof와 Auth.js session/logout/rotation/stale-claim lifecycle proof는 별도 검증 gate다.
- 구현 완료, 검증 완료, Preview proof, production deployment·activation은 서로 대체하지 않는다.

## BLOCKED_EXTERNAL

### Auth.js session runtime

상태: `EXTERNAL_RUNTIME_BLOCKED`.

- Auth.js session cookie 발급·동일 브라우저 context persistence·logout/rotation·stale claim lifecycle은 runtime/browser proof가 필요하다.
- static source, fixture, callback 응답만으로 session runtime 성공을 주장하지 않는다.
- 필요한 runtime/browser authority가 없으면 `UNVERIFIED`로 유지하며 source/runtime mutation을 이 Goal에서 수행하지 않는다.

### ALIGO provider current metadata

상태: `EXTERNAL_GATE_PENDING`.

- repository logical 8-code contract: `VERIFIED` — #65에서 8개 logical code/body/required-variable 계약을 확인했다.
- provider current metadata: `UNVERIFIED` — authenticated provider read-back이 없다.
- production mapping: provider metadata와 별도의 `UNVERIFIED` gate다.
- actual Alimtalk/SMS send: `NOT RUN`이며 별도 authority가 필요하다.
- 과거의 provider 승인·심사 상태를 현재 metadata read-back으로 승격하지 않는다.

## AUTHORITY_PENDING

### Production deployment·activation

상태: `PRODUCTION_AUTHORITY_PENDING`.

- production deployment, `salesMode` 전환, 운영 회차/live round, actual payment, actual notification, first-round completion은 이 문서 후보나 PR로 완료되지 않는다.
- production deployment와 production activation은 각각 별도 gate이며, exact release SHA와 별도 authority 없이는 주장하지 않는다.

## PRODUCT_POLICY_DECISION_REQUIRED

### Consumer self-cancel `ORDER_CANCELLED` notification

상태: `PRODUCT_POLICY_DECISION_REQUIRED`.

- consumer self-cancel 경로에서 `ORDER_CANCELLED` 알림을 어떻게 처리할지는 정책 결정이 필요하다.
- 이 Goal에서는 정책을 선택하거나 runtime/callsite를 변경하지 않는다.

## DOC_DELTA

### Pilot marketing contract

상태: `DOC_DELTA_CANDIDATE`.

- Pilot 정책은 `MARKETING_NOT_USED_IN_PILOT`이다.
- 선택 마케팅 consent/retention wording을 현재 Pilot 계약보다 넓게 유지하지 않는다.
- 향후 marketing 활성화는 별도의 product·legal·provider·release authority와 현재 증거가 필요한 후속 판단이다.

## NEXT — 현재 residual 해소 후

### 외부·권한 gate

- [ ] authenticated ALIGO metadata read-back
- [ ] provider metadata와 repository logical 8-code mapping 직접 대조
- [ ] 별도 authority 후 격리 actual Alimtalk/SMS 및 fallback 검증
- [ ] exact release SHA 기준 Preview/browser/fixture와 Auth.js session lifecycle 검증
- [ ] production deployment·activation·첫 회차 전용 승인 및 read-back

### 법무·출시 후보 정합성

- [ ] 주문 성립·취소·환불·배송·재배송비·보류 실제 정책 반영
- [ ] settlement 및 payment 검증 결과 반영
- [ ] PortOne/PG·ALIGO 전화번호·메시지 처리 경계 반영
- [ ] Pilot `MARKETING_NOT_USED_IN_PILOT` 정책과 공개 legal/source wording 정합화
- [ ] exact release SHA와 필요한 release verification

---

## HISTORICAL / PREVIOUS EXTERNAL SNAPSHOT

### 역사적 P0 — ALIGO 회차 알림 템플릿 8종 최종 승인

`ORDER_ACCEPTED`, `ORDER_PREPARING`, `ORDER_DELIVERING`, `ORDER_DELIVERY_HELD`, `ORDER_REDELIVERY_PAYMENT_REQUESTED`, `ORDER_REDELIVERY_SCHEDULED`, `ORDER_DELIVERED`, `ORDER_CANCELLED`.

마지막 provider 확인: 8종 등록·심사 요청 완료, 전부 `검수중`, 실제 발송 0건. 재개 시 직접 재조회한다.

---

## HISTORICAL / PREVIOUS NEXT CHECKLIST

> 이 체크리스트는 이전 provider snapshot을 전제로 한 역사적 기록이다. 현재 provider metadata, production mapping, actual send authority를 입증하지 않으며 현재 NEXT 상태로 사용하지 않는다.

### 역사적 P0 — 실제 알림 검증

- [ ] 승인 `tpl_code` 8종 ↔ 내부 논리 코드 1:1
- [ ] 별도 승인 후 격리 실제 알림톡
- [ ] 별도 승인 후 SMS fallback

### 역사적 P0 — 판매 활성화 legal 재정합화

- [ ] 주문 성립·취소·환불·배송·재배송비·보류 실제 정책
- [ ] 재배송 payment-required 상태머신과 결제 전 재개 금지 계약 반영
- [ ] settlement 생성·확정·취소·지급 실제 정책/검증 결과 반영
- [ ] PortOne/PG 개인정보 처리
- [ ] ALIGO 전화번호·메시지 처리
- [ ] marketing consent 유지/미사용 최종 정책 + 동의·철회·보관 실제 lifecycle 반영
- [ ] order direct-read 최소화 뒤 seller/driver 접근 설명
- [ ] 시행일·이전 버전
- [ ] legal tests
- [ ] release SHA 포함

### 역사적 P0 — 출시 후보 검증·운영 준비

- [ ] `PAYMENT-FINALIZATION-PAID-GUARD`
- [ ] `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE`
- [ ] `ORDER-REDELIVERY-PAID-RESUME-GATE`
- [ ] `ADMIN-FORCE-REFUND-CONSISTENCY`
- [ ] `ADMIN-PRIVILEGED-MUTATION-COVERAGE`
- [ ] `SETTLEMENT-LIFECYCLE-COVERAGE`
- [ ] `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY`
- [ ] `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
- [ ] `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
- [ ] `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
- [x] Issue #32 — 2026-09-05 GitHub 보호 상태 직접 재확인
- [ ] legal 포함 actual release SHA
- [ ] exact SHA E2E 52 + cleanup
- [ ] 운영 Firebase read-only 재조회
- [ ] 승인 후 production ALIGO 설정
- [ ] exact-SHA deployment 절차 + Task 3.1 별도 승인
- [ ] 동일 SHA production + metadata 검증 + smoke
- [ ] 첫 회차 SCHEDULED
- [ ] 최종 출시 판정·rollback dry-run
- [ ] 최종 승인 후 `salesMode: round_direct`
- [ ] 초기 두 회차 모니터링·Closeout

상세 dependency: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`.

---

## LATER

### RETENTION-DELETE-ISSUE-ROUTING

현재 source 재검증 결과 `CURRENT_UNRESOLVED`다. 배송 사진 Storage 삭제가 3회 모두 실패하면
`RETENTION_DELETE_FAILED`는 생성되지만, 배송 사진 보관 record에 `storeId`가 없어 현재 store-scoped
운영 예외 목록으로 안정적으로 route되지 않는다.

현재 직접 근거:

- [x] `DeliveryPhotosService.attachPhoto()`가 배송 사진 retention metadata로 `{ orderId, photoId }`만
  저장하고 `storeId`를 저장하지 않는다.
- [x] `RetentionService.deleteStorageObject()`는 누락된 `storeId`를 `String(... ?? '')`로 바꾸어
  issue를 생성한다.
- [x] `OperationsController`와 `OperationsService.listIssuesForStore()`는 `/stores/:storeId`와
  issue `storeId` 일치를 요구한다.
- [x] seller parser도 비어 있거나 손상된 `storeId`를 읽지 않는다.
- [x] retention purge의 3회 retry, record 보존, 멱등 issue 생성 자체는 직접 테스트되지만, 누락·알 수
  없는 store의 운영자 visibility와 global queue는 직접 테스트·구현 근거가 없다.

영향: 삭제 실패한 비공개 배송 사진과 보관 record가 남을 수 있고, 담당 셀러의 store-scoped
운영 화면에서 확인·재처리 대상이 유실될 수 있다. 일반 배송 사진 만료가 완료 후 90일이므로
현재 출시 직전 gate로 확정하지 않고 `P2_CANDIDATE` / `LATER`로 routing한다.

완료 acceptance:

- [ ] non-PII `storeId` 보존으로 store issue route를 보장하거나 admin/technical global retention
  queue 중 하나를 current contract로 확정
- [ ] missing/unknown store가 false success가 되지 않고 지정된 운영 queue에 항상 보인다.
- [ ] retry·resolve·record 보존 관계와 동일 실패 멱등성을 직접 회귀하고 원본 삭제·record 선삭제를 금지
- [ ] issue와 보관 metadata에 주소·전화번호·Storage 서명 URL·비밀값을 기록하지 않음

owner 제안: `apps/api/src/orders/delivery-photos.service.ts`, `apps/api/src/retention/**`,
`apps/api/src/operations/**`; seller 표시가 필요하면 최소 parser/UI 변경은 별도 구현 Task로 분리한다.

정본 routing: LATER summary는 이 항목, 보관 계약은
`docs/specs/mvp-sales-round-direct-delivery.md`, 현재 운영 중단·전달 규칙은
`docs/specs/ops/mvp-sales-round-runbook.md`에 둔다.

### OPERATION-ACTION-CLAIM-FENCING

현재 source 재검증 결과 `CURRENT_UNRESOLVED`다. `claimAction()`은 5분 `actionClaim` token을
발급하지만 action 실행 후 성공·실패 write가 현재 claim의 fresh token을 확인하지 않아, 만료된
worker가 새 claimant의 최신 상태를 지우거나 덮을 수 있다.

현재 직접 근거:

- [x] `claimAction()`은 transaction에서 lease token과 expiry를 저장한다.
- [x] `runAction()`은 최초에 읽은 issue snapshot을 spread해 성공·실패를 일반 update하고,
  `claimToken`을 새 문서의 token과 비교하지 않는다.
- [x] `RESEND_SMS`는 outer operation claim과 별도로 직접 외부 문자 발송을 호출한다.
- [x] 정상 lease 안의 동시 요청은 한 번만 외부 호출하는 테스트가 있지만, lease 만료 후 takeover와
  stale completion/failure race를 검증하는 직접 테스트는 없다.

영향: worker A가 지연된 사이 worker B가 takeover하면 A의 늦은 completion/failure가 B의 claim·action
감사·issue status를 덮을 수 있다. 특히 문자 재발송은 operation-level 외부 중복 방어가 직접 입증되지
않았고, 환불 내부 claim이 있더라도 operation claim fencing의 대체 증거가 아니다.

우선순위 후보: `P1_CANDIDATE` / 현재 Backlog routing은 수동 운영 경로인 `LATER`로 둔다.

완료 acceptance:

- [ ] 외부 action 직전과 completion/failure write에서 owner token 또는 generation을 fresh-read해
  현재 claim이 아니면 side effect·상태 write·claim clear를 수행하지 않음
- [ ] lease가 외부 호출 중 만료될 수 있는 action은 provider idempotency 또는 authoritative
  reconciliation 없이는 자동 재시도하지 않음
- [ ] A 지연 → B takeover → A 늦은 성공/실패 race에서 B의 최신 claim·status·audit가 보존되고
  문자·환불 외부 side effect가 중복되지 않음
- [ ] 기존 action mapping, 최신 주문·결제 재조회, 민감정보 없는 감사 기록, 정상 동시 claim 회귀 유지

owner 제안: `apps/api/src/operations/**`; refund·SMS provider 경계의 idempotency/reconciliation은
각 `payments`·`notifications` owner와 함께 별도 구현 Task로 정의한다.

정본 routing: LATER summary는 이 항목, operation issue 기술 계약은
`docs/specs/mvp-sales-round-direct-delivery.md`, 수동 조치 중단 규칙은
`docs/specs/ops/mvp-sales-round-runbook.md`에 둔다.

### LEGACY-GROUP-CANCEL-NOTIFICATION

legacy 목표 미달 공동구매에서 consumer `GROUP_CANCELLED_LACK` 알림이 누락될 수 있다.

현재 `cancelGroupBuyLack()`가 주문을 먼저 `CANCELLED`로 바꾼 뒤 `sendToGroupParticipants()`를 호출하고, sender는 `CANCELLED`를 대상에서 제외한다.

- [ ] 취소 대상 participant snapshot 또는 동등 명시적 recipient 집합 사용
- [ ] consumer 목표미달 취소 알림 1회 직접 회귀
- [ ] 판매자 취소 알림 정상 유지
- [ ] 다른 template의 terminal filtering 의미 유지

정본: `docs/specs/api/notifications.md`.

### NOTIFICATION-RETRY-POLICY
- [ ] backoff·오류 분류·rate limit·중복 SMS·관측 지표

### API-LINT-BASELINE
- [ ] auth `any`, spec mock 타입, lint command 분리

### LOCAL-DEV-FULLSTACK
- [ ] API/consumer/seller/driver launcher·CORS·`dev.bat` 정책

### LOAD-TEST-FORMAL
- [ ] staging/equivalent, 재개 트리거, baseline→soak, k6 plan

### Seller/Admin
- [ ] ADMIN-STORES-T7/T8, 준비 물량 공동구매 재설계, 필요 시 정산 UX

### Driver/배송
- [ ] Kakao Maps·밀크런 preview 재평가, 플랫폼형 전 GPS 보류

### 인프라/확장
- [ ] Railway contingency, 다중 판매자, hub_staff, 외부 driver 정산, 결제수단 확장

---

## STALE_OR_SUPERSEDED

- 네이버페이 과거 승인 대기 전제
- 과거 BUG-03 공개 read/Custom Token 가정
- 운영 DB reset/visual cleanup 지시
- 2026-05 Railway outage 상태
- PR #11 OPEN/Draft 표현
- ALIGO 8종 “미등록” 표현
- `main` merge가 auto-production이어야 한다는 전제

## 관리 원칙

1. 완료 이력을 장문 누적하지 않는다.
2. 현재 행동 가능한 미완료만 유지한다.
3. 외부 상태는 직접 재조회 뒤 갱신한다.
4. 체크박스는 production 승인 아님.
5. 우선순위 충돌 시 memory + 활성 HANDOFF/PLAN 우선.
6. repository 변경은 branch+PR.
7. `VERIFIED` 승격은 `docs/DOCUMENT_CONSISTENCY.md` 기준.

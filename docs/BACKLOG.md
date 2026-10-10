<!-- Language: ko -->

# Greenhub Backlog

> 기준일: 2026-09-28 KST
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
- 기존 문서 candidate는 PR #69에서 후속 갱신하며, 이 Goal은 PR #69를 merge하지 않고 Git-native publication 경계(`docs/specs/ops/development-authority.md`)를 따른다.

---

## 상태 구분

| 주장 | 현재 판정 |
|---|---|
| implementation | `SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY`는 `IMPLEMENTATION_PROVEN`; #66이 race/recovery proof를 accepted함 |
| verification | Sale Round proof `PROVEN`; 2026-09-28 exact Preview 원격 E2E 52 + 세션 12 통과(`PRE_RELEASE_PROVEN`), 출시 SHA 재실행은 `PENDING` |
| prior candidate | PR #69의 기존 accepted candidate는 `9c921684a26597cb57887b6049288f1143b017c8` |
| updated candidate | PR #69의 후속 candidate는 remote-addressable 상태로 갱신하며, 정확한 head SHA는 Issue #75 TASK_RECORD에 기록 |
| PR | 기존 documentation PR #69는 `OPEN`; 이번 Goal은 merge하지 않음 |
| published / merged | PR #70은 `MERGED`; live `main`은 `fe5e680fa58c8b3af5e508d07115bb8ab9df272a` |
| Preview runtime proof | Auth.js 세션 런타임 `RUNTIME_PROVEN`(Preview); 출시 SHA 기준 재실행은 `PENDING` |
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

상태: `PRE_RELEASE_PROVEN` — 출시 SHA 확정 뒤 재실행 필요.

- 2026-09-28 run `36348002412`(live `main` `c8bec1f5`): exact Preview 3개 + 스테이징 API로 회차 52/52 + 세션 12/12, cleanup 잔여 0.
- 출시 SHA의 증거는 출시 SHA로 다시 실행한 run만 인정한다.

- #63이 인정한 Preview/browser/fixture 결과는 해당 exact source에 대한 재사용 가능한 역사적 증거다.
- `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`와 그 Preview deployment를 현재 main, 현재 candidate, production deployment로 표현하지 않는다.
- 현재 release candidate에서 필요한 exact-SHA Preview/browser/fixture proof와 Auth.js session/logout/rotation/stale-claim lifecycle proof는 별도 검증 gate다.
- 구현 완료, 검증 완료, Preview proof, production deployment·activation은 서로 대체하지 않는다.

## BLOCKED_EXTERNAL

### Auth.js session runtime

상태: `RUNTIME_PROVEN`(Preview, 2026-09-28) — run `36341189483`, `apps/e2e/tests/auth-session-lifecycle.spec.ts` 12건.

- 쿠키 발급·같은 컨텍스트 유지·로그아웃 후 소멸·정지/기사 승인 철회 뒤 세션 종료를 세 역할 × chromium·mobile로 확인했다.
- 이후 회차 E2E는 52건 뒤 이 12건을 함께 실행한다.

### ALIGO provider current metadata

상태: `EXTERNAL_GATE_PENDING`.

- repository logical 8-code contract: `VERIFIED` — #65에서 8개 logical code/body/required-variable 계약을 확인했다.
- provider 템플릿: 2026-09-28 콘솔에서 UK_5691~5698 코드·이름·승인완료·본문·변수 일치 확인.
- production mapping: Railway production 변수 저장값은 8종 모두 올바르다. 실행 중인 운영 API(8/23 이전 배포)에는 아직 반영되지 않았다.
- 남은 gate: 출시 배포 뒤 운영 송신 IP의 ALIGO 등록 확인, API 기준 템플릿 대조, 격리 actual Alimtalk/SMS 및 fallback(별도 authority).

## AUTHORITY_PENDING

### Production deployment·activation

상태: `PRODUCTION_AUTHORITY_PENDING`.

- production deployment, `salesMode` 전환, 운영 회차/live round, actual payment, actual notification, first-round completion은 이 문서 후보나 PR로 완료되지 않는다.
- production deployment와 production activation은 각각 별도 gate이며, exact release SHA와 별도 authority 없이는 주장하지 않는다.

## PRODUCT_POLICY_DECISION_REQUIRED

### Consumer self-cancel `ORDER_CANCELLED` notification

상태: `RESOLVED` — 2026-09-28 사용자 결정으로 소비자 회차 직접 취소도 `ORDER_CANCELLED`를 보낸다.

- 결제 전(`PENDING`)·이미 취소된 주문은 제외하고, 사유는 고정 문구 `고객 요청`, 멱등 키 `round-consumer-cancel:<orderId>`를 사용한다.
- 계약 정본: `docs/specs/api/notifications.md`. 직접 근거: `legacy-consumer-cancel-convergence.spec.ts` S9~S12.

## DOC_DELTA

### Pilot marketing contract

상태: `DOC_DELTA_CANDIDATE`.

- Pilot 정책은 `MARKETING_NOT_USED_IN_PILOT`이다.
- 선택 마케팅 consent/retention wording을 현재 Pilot 계약보다 넓게 유지하지 않는다.
- 향후 marketing 활성화는 별도의 product·legal·provider·release authority와 현재 증거가 필요한 후속 판단이다.

## NEXT — 현재 residual 해소 후

### 외부·권한 gate

- [x] provider 템플릿과 repository logical 8-code mapping 대조 (2026-09-28 콘솔)
- [x] 운영 ALIGO 호출 경로 — Fixie 고정 IP 프록시 경유, 2026-09-28 `code=0`·템플릿 8종 API 대조 일치
- [x] 격리 실제 알림톡 — 2026-09-28 휴대폰 도착 확인
- [ ] SMS fallback — 발신번호(개인 휴대폰) 통신사 번호도용 차단으로 실패. 사업자 번호로 발신번호 교체 후 재시험
- [ ] 별도 authority 후 격리 actual Alimtalk/SMS 및 fallback 검증
- [x] exact release SHA 기준 원격 회차 E2E 52 + 세션 12 재실행 — `197f84a4`, run `36372493414`
- [x] 운영 Firebase rules/indexes 대조와 배포 — 7/31 배포본 → `197f84a4` 규칙 반영, 재조회 일치
- [x] production deployment — 2026-09-28 `197f84a4` (API·프런트 3개·규칙)
- [x] activation — 2026-09-29 `salesMode` `round_direct` 전환, 첫 회차 `SCHEDULED`(read-back 확인)
- [x] 첫 회차 자동 오픈 차단 — 2026-09-29 회차 일정을 11/1 오픈·11/10 배송으로 이동
- [ ] 파일럿 운영 시작 — 2026-11-01(첫 회차 주문 11/1 10:00 자동 오픈)
- [ ] 파일럿 시작 직후 실제 결제·환불 1건 시험

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

`RESOLVED` — 배송 사진 retention metadata에 non-PII `storeId`를 보존하고, Storage 삭제 3회 실패 시
생성되는 `RETENTION_DELETE_FAILED` issue가 실제 storeId로 store-scoped 운영 목록에 노출되며 재실행에도
멱등하다. 보관 metadata는 non-PII `storeId` 외 개인정보 필드를 거부한다.

- [x] non-PII `storeId` 보존으로 store issue route 보장
- [x] retry·resolve·record 보존 관계와 동일 실패 멱등성 직접 회귀
- [x] issue와 보관 metadata에 주소·전화번호·Storage 서명 URL·비밀값 미기록

legacy record처럼 `storeId`가 없는 기록은 이번 계약의 신규 기록 범위가 아니며, 필요하면 별도
migration·visibility Task로 다룬다.

직접 회귀: `apps/api/src/retention/delivery-photo-store-routing.spec.ts`,
`apps/api/src/retention/retention.service.spec.ts`.

정본 routing: LATER summary는 이 항목, 보관 계약은
`docs/specs/mvp-sales-round-direct-delivery.md`, 현재 운영 중단·전달 규칙은
`docs/specs/ops/mvp-sales-round-runbook.md`에 둔다.

### OPERATION-ACTION-CLAIM-FENCING

`RESOLVED` — `runAction()`이 외부 action dispatch 전에 transaction에서 fresh `actionClaim.token`을
확인하고, 현재 claim이 아니면 side effect·상태 write 없이 종료한다. lease 만료 takeover 뒤 stale
success/failure는 새 claimant의 claim·status·audit를 덮지 않는다.

- [x] 외부 action 직전 fresh token 확인, 비소유자 side effect·write 0
- [x] lease 만료 takeover에서 RETRY_REFUND·RESEND_SMS 외부 side effect 0
- [x] stale success/failure가 최신 claim·status·audit를 보존
- [x] 기존 action mapping·정상 동시 claim 회귀 유지

직접 회귀: `apps/api/src/operations/operations-action-claim-lease-expiry.spec.ts`,
`apps/api/src/operations/operations-action-claim-occ-retry.spec.ts`.

정본 routing: LATER summary는 이 항목, operation issue 기술 계약은
`docs/specs/mvp-sales-round-direct-delivery.md`, 수동 조치 중단 규칙은
`docs/specs/ops/mvp-sales-round-runbook.md`에 둔다.

### LEGACY-GROUP-CANCEL-NOTIFICATION

`RESOLVED` — legacy 목표 미달 공동구매에서 consumer `GROUP_CANCELLED_LACK` 알림이 누락되던 문제를 해소했다.

`cancelGroupBuyLack()`는 상태 변경 전에 취소 대상 participant snapshot을 확정하고, `CANCELLED` 전환 뒤 해당 명시적 recipient 집합에 consumer `GROUP_CANCELLED_LACK`를 정확히 1회 직접 전달한다. `sendToGroupParticipants()`의 terminal filtering은 다른 template에 그대로 유지하고 판매자 `SELLER_GROUP_CANCELLED_LACK` 알림도 유지한다.

- [x] 취소 대상 participant snapshot 또는 동등 명시적 recipient 집합 사용
- [x] consumer 목표미달 취소 알림 1회 직접 회귀
- [x] 판매자 취소 알림 정상 유지
- [x] 다른 template의 terminal filtering 의미 유지

정본: `docs/specs/api/notifications.md`. 회귀: `apps/api/src/notifications/legacy-group-cancel-notification.spec.ts`.

### NOTIFICATION-RETRY-POLICY

`RESOLVED` — 알림톡/SMS 전달 경로가 provider 응답을 재시도 가능·rate-limit·영구·불확실로 분류하고, `NOTIFICATION_RETRY_BACKOFF_POLICY`에 따라 시도 사이 bounded backoff와 rate-limit 지연을 적용한다. `UNKNOWN`에서는 blind 중복 SMS를 시도하지 않는다. 3회 알림톡 상한·1회 SMS fallback·설정 오류 fail-closed·delivery idempotency는 유지한다. 채널별 provider 오류 분류 counter와 재시도 사이 적용 지연 값은 `NOTIFICATION_RETRY_METRICS` in-process 관측 recorder로 기록·노출하며 전화번호·본문·receipt 등 PII는 기록하지 않는다.

- [x] backoff·오류 분류·rate limit·중복 SMS
- [x] 관측 지표(분류·지연 metric 노출)

정본: `docs/specs/api/notifications.md`. 회귀: `apps/api/src/notifications/notification-retry-policy.spec.ts`, `apps/api/src/notifications/notification-retry-metrics.spec.ts`.

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

### AUTH-LOGOUT-SERVER-REVOCATION
- [ ] 세 앱 Auth.js 로그아웃 시 API `POST /auth/logout`도 호출해 서버 refresh token을 폐기한다. 현재는 쿠키만 삭제되어 로그아웃 전에 복사된 쿠키가 refresh 만료(30일)까지 재사용될 수 있다. `refreshTokens/{sub}`가 사용자당 1개라 같은 계정의 다른 기기도 함께 로그아웃되는 영향을 설계에 포함한다. 2026-09-28 결정(D2)으로 출시 후 과제. **2026-10-10 결정: 지금 한다**(아래 `AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE`의 경쟁 상태 확인). 병행 세션 PR #415·#429·#431 병합 대기.

### PREVIEW-GENERIC-ENV-ALIGNMENT
- [ ] exact Preview(브랜치 없는 배포)는 Vercel의 브랜치 미지정 Preview env를 쓴다. 판매자 앱은 이 env에서 API=스테이징, Firebase=운영(`green-e4fe3`, 운영·Preview·개발 공통 항목)으로 어긋나 Firebase 클라이언트 로그인이 실패한다. 세 앱의 브랜치 미지정 Preview Firebase 설정을 비운영 프로젝트로 분리할지 결정한다.

### LEGACY-E2E-WORKFLOW-VARS
- [ ] (2026-10-09: `sync-preview`의 자동 디스패치를 끄고 수동 실행만 남김) 일반 E2E `e2e.yml`은 저장소 수준 `vars.ROUND_DIRECT_E2E_*`를 읽지만 값이 `round-direct-e2e` 환경에만 있어 대상 확인 단계에서 매번 실패한다(최근 100회 성공 없음). legacy 판매 재도입 전에 설정 출처를 고치고 legacy 흐름을 새 코드로 검증한다.

### EXACT-PREVIEW-WORKFLOW-CREDENTIALS
- [ ] `create-exact-preview-deployment.yml`은 앱별 Vercel 토큰(`VERCEL_EXACT_PREVIEW_{CONSUMER,SELLER,DRIVER}_TOKEN`) 미등록으로 성공한 적이 없다. 현재 exact Preview는 로컬 Vercel CLI 권한으로 `preview-exact/<scope>/<sha>` ref를 사용해 만든다. 워크플로 경로로 옮길지 결정한다.

### SELLER-SETTLEMENT-KST
- [x] 셀러 정산 탭 정산일시가 timeZone 미지정 `toLocaleDateString`으로 표시되고, CSV는 UTC(`Z`) ISO로 기록되어 KST 자정 전후 정산이 전날로 읽힌다. 수정 PR #320(화면 Asia/Seoul 고정·CSV `+09:00`)과 어드민 정산 #316 병합, 2026-09-30 운영 반영(`389066c8`). 2026-09-28 발견.

### ADMIN-CANCELLED-REFUND-RETRY
- [x] 서버 강제환불은 이미 취소된 주문도 재시도를 허용한다(일반: `cancellation.status` LOCAL_PENDING·LOCAL_FAILED·REFUND_FAILED·만료 claim·취소 상태 기록 없음, 회차: 결제가 아직 PAID). 어드민 주문 탭은 취소 주문에 버튼이 없다(#318 이후에도 동일). 결과 불명확 환불은 운영 이슈 `AUTO_REFUND_FAILED`→`RETRY_REFUND`로, 취소 전 주문은 기존 버튼으로 복구할 수 있어 급하지 않다. 취소 주문용 "환불 재시도" 버튼을 둘지 사람이 결정한다. 2026-09-28 발견. **2026-10-04 결정: 만들지 않는다.** 기존 복구 경로(운영 이슈 `RETRY_REFUND`, 취소 전 주문 강제환불 버튼)로 충분하고, 버튼 추가는 중복 환불 실수 위험만 늘린다. 파일럿에서 실제로 필요해지면 다시 연다.

### SELLER-ORDER-LIST-BUYER-INFO
- [x] 2026-10-04 사용자 결정으로 해결: 목록 카드에 손님 이름을 보이고 이름·전화 통합 검색을 넣는다. 목록 API `LIST_FIELDS`에는 상세와 같은 `buyerName`만 더하고 전화는 싣지 않는다. 전화 검색은 서버(`?phone=` 숫자 4자리 이상)가 판매자에게 보이는 연락처 숫자만 비교해 자기 매장의 맞는 주문만 돌려준다(`seller-orders-customer-info-plan.md` T1·T4). 이전 기록: 목록 API에 손님 정보가 없어 개인정보 최소화 계약을 넓힐지 결정 대기였다. 상세 화면 표시는 #314. 2026-09-28 발견.

### ADMIN-DESKTOP-TABLE-IN-480-SHELL
- [x] 2026-10-03 해결: 사용자 결정(어드민만 넓은 레이아웃)대로 `AppShell`이 `/admin`에서 폭 제한을 풀고 판매자 하단 탭을 숨긴다. 이전 기록: 셀러 앱 루트 레이아웃이 폭 480px로 고정돼 있다. 그런데 어드민 탭은 Mantine `visibleFrom="sm"`(창 폭 기준)으로 데스크톱 표를 고른다. 그래서 PC에서도 카드 폭 446px 안에 표가 들어가고 `overflow:hidden`으로 오른쪽이 잘린다. 어드민 주문 표(489px)는 강제환불 버튼이 "강제환"까지만 보인다. 기존 결함이다(#318과 무관). 어드민을 넓은 레이아웃으로 뺄지, 표 기준을 컨테이너 폭으로 바꿀지 결정한다. #317은 표를 4칸으로 유지해 피했다. 2026-09-28 로컬 하네스 검증에서 발견.

### DRIVER-MANTINE-CSS-AUDIT
- [x] 2026-10-03 대조 완료: 세 앱의 사용 컴포넌트와 import를 대조한 결과 드라이버는 누락 없음, 소비자(Checkbox·Image·Modal 계열)와 셀러(ActionIcon·NumberInput)는 채움. 이전 기록: 드라이버 `globals.css`는 Mantine CSS를 골라 import한다. 알림 스타일 누락은 #323으로 고쳤지만, `Modal.css` 같은 다른 사용 컴포넌트 CSS도 빠졌을 수 있다. 실제 사용 컴포넌트와 import 목록을 대조한다. 2026-09-28 발견.

### AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE
- [ ] 2026-10-03 원격 회차 E2E run `37108803974` 1차에서 `auth-session-lifecycle` mobile seller "로그아웃하면 사라진다"가 실패했다. 로그아웃 뒤 세션 쿠키는 없었는데 바로 이은 `/api/auth/session`이 `seller`를 돌려줬다. 같은 Preview 재실행에서는 통과했고, 직전 실행들도 통과했다. 로그아웃 순간 화면이 보낸 다른 요청의 응답이 갱신된 세션 쿠키를 다시 써 넣는 경쟁 상태로 추정한다(#333 proxy 쿠키 반영과 관련 가능). 실제로 로그아웃이 되돌려질 수 있는지 로컬에서 재현해 확인한다. 2026-10-10 코드 대조로 원인을 확인했다: JWT 세션 조회 응답이 세션 쿠키를 다시 쓰고(#333 proxy 반영), 로그아웃은 서버 토큰을 폐기하지 않아 늦게 도착한 응답이 유효한 쿠키를 되살린다. 같은 날 로컬 에뮬레이터(dev:local)로 세션 스펙을 돌려 6건 중 가끔 1건이 같은 방식으로 실패하는 것도 재현했다(`page.goto(base)`가 연 화면의 세션 조회가 로그아웃과 겹칠 때). 테스트에서 화면을 비워 피하지 않고 `AUTH-LOGOUT-SERVER-REVOCATION`으로 고친다.

### HOME-BANNER-OVERLAP-AND-LEGACY-CTA
- [x] 2026-10-03 해결: 배너를 글자 칸과 사진 칸(40%)을 나란히 두는 배치로 바꾸고 한글을 낱말 단위로 줄바꿈했다(#365, `53f8e374` 운영 배포). 운영 배너 문서 `banners/main_hero`의 cta2("공구 참여하기 " → `/groupbuy`)는 어드민 화면에서 비운 것과 같은 `{label:"", href:""}`로 바꿨다. 이어서 운영에서 cta1 "지금인기 호접란" 링크가 이미 없는 상품(404)이고, 배너가 현재 회차에서 팔지 않는 호접란과 "할인"을 알리는 것을 확인했다. 사용자 결정으로 배너를 `isActive:false`로 내렸다(내용은 보존). 다시 켤 때는 특정 상품 대신 서비스 안내 문구와 404가 날 수 없는 링크를 쓴다. 같은 날 소비자 앱에 한국어 404 화면을 추가했다(#367). 이전 기록: 운영 소비자 홈 캡처에서 관리자 배너(`HeroBanner`)의 긴 제목이 오른쪽 절반 사진 위로 겹쳐 읽기 어렵다(모바일 390px). 또 배너 버튼에 예전 판매용 "공구 참여하기"가 떠 있는데 회차 직배송에서는 공동구매 진입을 숨긴다. 배너 레이아웃(사진을 배경으로 깔거나 제목 폭 제한)과 배너 내용(어드민 배너 탭에서 버튼 정리)을 함께 정리한다.

### BRAND-APP-ICON-REDESIGN
- [ ] 2026-10-03 앱 아이콘 상징(두 잎 하트)은 사용자가 "일단 이렇게" 정한 임시안이다. 잎사귀 하트·"그" 글자·손글씨 G·새싹·붓선 하트·꽃·화분·난초·gl·G+잎 시안을 봤지만 마음에 드는 것이 없었다. 나중에 아이콘 디자인을 다시 정한다. 로고(Nunito "Green Love" 글자만)와 앱별 구성(소비자=상징만, 판매자=+Seller, 기사=+Driver)은 확정. 원본은 `packages/ui/brand/`, 기준은 `docs/specs/frontend/design-standard.md` §7.

### ADMIN-TAB-PLANS-STALE-PROGRESS
- [ ] 어드민 탭 계획서(`docs/specs/frontend/admin-tabs-improve-plan.md`와 `admin/admin-tab-*-plan.md`) 진행표가 현재 코드보다 뒤처져 있다. stores는 T7·T8을 빼고 구현을 마쳤고, 6개 탭 공통 조회 실패 표시와 users D1·banner T1·T3도 끝났는데 표에는 "미착수"로 남아 있다. 문서 정합성 작업으로 정리한다. 2026-09-28 코드 대조로 확인.

### DRIVER-SELLER-PHONE-BEFORE-PICKUP
- [ ] 기사 IA(`docs/design/드라이버-2단계-IA.md` §4)는 수거 전 화면에 판매자 연락처를 두지만, 코드(`2e2c0b50` 최소 노출)와 테스트는 미배정 주문의 `sellerPhone`을 숨긴다. **2026-10-04 결정: 파일럿 동안 현재 동작(숨김)을 유지한다.** 파일럿은 판매자와 기사가 같은 사람이라 필요가 없다. 외부 기사를 쓰기 시작할 때 노출 범위를 다시 정하고 IA 또는 테스트를 맞춘다.

### ROUND-PAYMENT-RETRY-DOUBLE-HOLD
- [ ] 소비자가 결제창을 닫고 새 결제 시도 ID로 다시 결제하면(#328), 이전 시도의 `PENDING` 주문·`HELD` 예약이 결제 실패 웹훅 또는 15분 만료 정리(1분 주기)까지 최대 약 16분 동안 회차 배송지·수량·상품 한도를 함께 차지한다. **2026-10-04 결정: 파일럿 동안 유지한다.** 즉시 해제하려면 늦게 도착한 이전 결제(늦은 결제 재확보·자동 환불) 흐름까지 다시 맞춰야 해서 위험이 이득보다 크다. 주문 오픈 날 '한도 마감'이 비정상적으로 빨리 나오면 우선 대응한다.

### CI-REQUIRED-CHECK
- [ ] **2026-10-09 결정: 지정한다.** `.github/workflows/ci.yml`이 GitHub에서 실제로 통과하는 것을 확인한 뒤 lint·unit·rules·build를 branch protection 필수 검사로 건다. 지정하면 에이전트 PR 자동 병합도 이 검사를 기다린다. 2026-10-09 CI 추가(#417) 뒤 PR마다 통과한다. 남은 일은 branch protection 필수 검사 지정(사용자)이다.

### STORE-COMMISSION-RATE-UNUSED
- [ ] 어드민이 가게별 수수료(`stores.commissionRate`)를 저장하지만 정산 생성은 전역 `PLATFORM_FEE_RATE`만 쓴다(`apps/api/src/settlements/settlements.service.ts`). **2026-10-09 결정: 파일럿 동안 그대로 둔다**(가게가 하나). 어드민 판매자 목록에 "정산은 공통 수수료율" 안내만 표시한다. 가게가 늘면 다시 정한다.

### SILENT-REFUND-CUSTOMER-NOTICE
- [ ] 회차 전체 취소, 관리자 강제 환불, 늦은 결제 자동 환불은 환불만 하고 고객 알림톡을 보내지 않는다. **2026-10-09 결정: 보낸다.** 승인된 `ORDER_CANCELLED`에 상황별 고정 사유를 싣는다. 사유 문구는 파일럿 개시 전에 사용자가 최종 확정한다. 2026-10-09 코드 반영(#420, 운영 미배포). 남은 일은 `apps/api/src/notifications/refund-notice-reasons.ts` 문구 확정이다.

### OPS-ALERTING
- [ ] 운영 이슈 생성·ALIGO 계정 오류(잔액 부족·IP 미허용·발신번호)·PortOne 서명/금액 이상·정기 작업 실패를 사람에게 알리는 채널이 없다. `/operations` 화면과 홈 "운영 확인 N건"(2026-10-09)은 들어와서 봐야 보인다. **2026-10-09 결정: 도입한다.** 휴대폰 푸시 채널과 GitHub 정기 가동 확인(실패 시 소유자 이메일)으로 시작한다. 2026-10-09 코드 반영(#421, 텔레그램 봇과 GitHub 15분 가동 확인, 운영 미배포). 남은 일은 `OPS_TELEGRAM_BOT_TOKEN`·`OPS_TELEGRAM_CHAT_ID`를 Railway 운영과 GitHub Actions 비밀값에 넣는 것이다(`docs/specs/ops/ops-alerts.md` §2).

### FIRESTORE-MANAGED-BACKUP
- [ ] 운영 Firestore 백업은 손으로 돌리는 `scripts/backup-firestore.mjs`(로컬 JSON)뿐이다. **2026-10-09 결정: 켠다.** PITR과 일일 관리형 백업을 GCP 콘솔에서 사용자가 켠다(이 저장소 작업 환경에는 GCP 권한이 없다). 켠 뒤 비운영 프로젝트 복구 연습을 한 번 한다.

### ROUND-HOLD-ABUSE-LIMITS
- [ ] **2026-10-10 결정**: 결제 없이 자리를 묶어 두지 못하게 상한을 건다. 주문당 상품별 수량 상한(병행 PR #422), 쓰이지 않는 공개 회원가입 API 차단(#431), 같은 회차의 고객별 활성 결제 예약 상한(#427). 예약 상한은 `ROUND-PAYMENT-RETRY-DOUBLE-HOLD`(재결제 때 이전 예약 유지)를 그대로 두고 최대 3건으로 정해 #427을 고치는 중이다.

### OPERATION-ISSUE-MANUAL-RESOLVE
- [ ] 환불 재시도·문자 재발송 외의 운영 기록은 닫을 방법이 없어 홈 경고와 아침 텔레그램 요약에 계속 남는다. **2026-10-10 결정**: 판매자·관리자가 메모를 남기고 닫는다. 운영 기록 API를 고치는 병행 PR #436 병합 뒤 구현한다.

### CHECKOUT-DELIVERY-PHONE-CLIENT-CHECK
- [ ] 받는 분 연락처는 휴대폰 번호만 받는다(**2026-10-10 결정**). 서버 검사는 #445로 들어갔다. 결제 화면 입력 단계 검사는 같은 화면을 고치는 병행 PR #437 병합 뒤 맞춘다(그전에도 서버 400 안내 문구가 결제 화면에 보인다).

### REDELIVERY-PAID-REQUEST-RESEND
- [ ] 재배송비를 이미 결제한 보류 주문을 판매자가 "재배송 준비로 돌리기"(`DELIVERY_HELD → PREPARING`)하면 서버가 `ORDER_REDELIVERY_PAYMENT_REQUESTED`를 한 번 더 보낸다(연결 결제 PAID 여부를 보지 않음). 판매자 확인 창은 이 사실을 알린다(#446). 병행 PR #448이 연결 결제가 PAID면 건너뛰게 고치고, 판매자 확인 창 문구·런북도 함께 맞춘다. 2026-10-10 발견.

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

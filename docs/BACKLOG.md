<!-- Language: ko -->

# Greenhub Backlog

> 기준일: 2026-08-24 KST
>
> 현재 미완료·향후 작업만 관리한다. 완료 상세는 Git history, `docs/CRITICAL_LOGIC.md`, `docs/archive/`, 완료 PLAN·REPORT를 사용한다.

## 우선순위 규칙

- **ACTIVE**: 지금 진행 가능한 최우선 작업
- **BLOCKED_EXTERNAL**: 외부 심사·승인 대기
- **NEXT**: 현재 게이트 해소 뒤 바로 진행
- **LATER**: MVP 출시 비차단 후속
- **STALE_OR_SUPERSEDED**: 현재 상태 재검증 전 실행 금지

---

## ACTIVE

### P0 — PAYMENT-FINALIZATION-PAID-GUARD

`PaymentFinalizationService.finalizePaidOrder()`가 provider `status === 'PAID'`를 boundary 자체에서 강제하지 않는다.

- [ ] finalization boundary 비`PAID` 차단
- [ ] `PENDING|FAILED|CANCELLED` 직접 거부
- [ ] `PAID` legacy/group/round 정상 회귀
- [ ] 금액 불일치·reservation/race 회귀
- [ ] 수정 SHA `main` 통합

정본: `docs/specs/api/payments.md`.

### P0 — PAYMENT-WEBHOOK-SIGNATURE-COVERAGE

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

### P0 — ORDER-REDELIVERY-PAID-RESUME-GATE

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

### P0 — ADMIN-FORCE-REFUND-CONSISTENCY

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

### P0 — ADMIN-PRIVILEGED-MUTATION-COVERAGE

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

### P0 — SETTLEMENT-LIFECYCLE-COVERAGE

settlement 생성·자동 확정·취소 transaction 구현은 존재하지만 core financial lifecycle의 직접 상태·race 회귀가 부족하다.

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
- 간접 통합 실행 가능성은 있으나 핵심 금전 불변식 직접 증거가 부족해 `PARTIALLY VERIFIED`.
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

### P0 — MARKETING-CONSENT-LIFECYCLE-CONSISTENCY

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

### P0 — ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION

API authorization보다 seller/driver raw Firestore read 경계가 넓다.

- [ ] 미배정 `PREPARING` direct/hub discovery 최소 대상·필드 정의
- [ ] arbitrary/타-driver/완료 주문 raw read 차단
- [ ] assigned driver·seller 최소 projection/DTO 또는 동등 분리
- [ ] broad driver rule 제거
- [ ] Rules + 앱 정상/거부 회귀
- [ ] `main` 통합

정본: `docs/specs/api/orders.md`.

### P0 — AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION

관리자 승인 전 driver 권한을 얻을 수 있는 복수 경로와 stale session/claims 수렴 문제가 있다.

현재 확인된 approval bypass:

- [x] 신규 Kakao `targetRole: driver`가 `driverApproved: true`로 즉시 생성됨
- [x] 기존 `driverApproved === undefined` driver가 Kakao 로그인 중 자동 승인됨
- [x] 공개 `POST /auth/register`가 `role: driver`를 허용하고 seller와 달리 invite/approval gate 없이 driver user 생성 가능
- [x] 공개 `POST /auth/login`이 `driverApproved` 확인 없이 저장된 `role: driver`로 JWT 발급
- [x] Firebase custom token은 현재 JWT role/storeId claim을 사용

이 P0는 `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`과 결합해서 완료 판단한다. broad driver Firestore read가 남아 있는 동안 self-issued/stale driver claim의 영향이 커질 수 있다.

남음:

- [ ] 공개 registration이 관리자 승인 전 usable driver authorization을 만들지 못함
- [ ] email login이 미승인 driver에게 driver JWT를 발급하지 않음
- [ ] 미승인 driver의 Firebase driver claim 발급 거부
- [ ] 신규/legacy Kakao 로그인 side-effect 자동 승인 제거
- [ ] 과거 계정 migration 별도 감사 절차
- [ ] admin 승인 전/후 email/Kakao 앱·API·Firebase 직접 회귀
- [ ] suspension/role/store/approval revocation SLA 결정
- [ ] refresh/current claims authoritative state 검증
- [ ] Firebase stale claims 재발급 차단
- [ ] logout/rotation 포함 회귀
- [ ] `main` 통합

정본: `docs/specs/api/auth.md`; 증거: `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`.

### P0 — ORDER-MUTATION-AUTHORIZATION-COVERAGE

상태 변경 ownership guard는 구현돼 있으나 핵심 거부 회귀가 부족하다.

- [ ] 타-store seller status/delivery-hold 403
- [ ] 비담당 driver assigned-order mutation 403
- [ ] first-claim 외 미배정 driver mutation 거부
- [ ] first claim 정확한 `driverId`
- [ ] 거부 side effect 0
- [ ] 필요한 admin 허용 범위 고정
- [ ] `main` 통합

정본: `docs/specs/api/orders.md`.

### P0 — DEPLOY-SAFETY-MAIN-PROTECTION

repo-side production auto-deploy 차단은 완료. GitHub 관리자 레벨 보호는 남음.

- [ ] Issue #32
- [ ] PR required
- [ ] `Deployment safety guard / verify` required
- [ ] force push·branch delete 차단
- [ ] 재조회에서 enforcement 확인

---

## BLOCKED_EXTERNAL

### P0 — ALIGO 회차 알림 템플릿 8종 최종 승인

`ORDER_ACCEPTED`, `ORDER_PREPARING`, `ORDER_DELIVERING`, `ORDER_DELIVERY_HELD`, `ORDER_REDELIVERY_PAYMENT_REQUESTED`, `ORDER_REDELIVERY_SCHEDULED`, `ORDER_DELIVERED`, `ORDER_CANCELLED`.

마지막 provider 확인: 8종 등록·심사 요청 완료, 전부 `검수중`, 실제 발송 0건. 재개 시 직접 재조회한다.

---

## NEXT — ALIGO 승인 직후

### P0 — 실제 알림 검증

- [ ] 승인 `tpl_code` 8종 ↔ 내부 논리 코드 1:1
- [ ] 별도 승인 후 격리 실제 알림톡
- [ ] 별도 승인 후 SMS fallback

### P0 — 판매 활성화 legal 재정합화

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

### P0 — 출시 후보 검증·운영 준비

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
- [ ] Issue #32
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

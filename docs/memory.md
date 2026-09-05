<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 상세 Acceptance Criteria는 `docs/BACKLOG.md`와 current spec을 사용한다.

## 검증 기준

- Git·GitHub와 #63/#70/#71 release state: `2026-09-06 KST` 직접 재조회
- Vercel 배포 안전·exact-source Preview: 역사적 증거 snapshot; 현재 release proof로 재사용하지 않는다.
- ALIGO provider current metadata: `UNVERIFIED` — #65에서 authenticated provider read-back이 없음을 확인했다.
- 운영 상태 변경은 별도 승인 없이 수행하지 않는다.

## Git·배포 기준선

- 저장소: `booker-lab/greenhub`
- 기본 브랜치: `main`; HEAD는 작업 시작 시 직접 재조회한다.
- 회차 직배송 기능 통합 기준 SHA(역사적 기능 기준선): `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- #63이 accepted한 pre-publication main 기준 SHA: `ffd999423f8a98b0c1f34d020d832d7929feab72` — historical baseline
- #70/#71이 publication 후 재확인한 현재 live `main`: `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`
- `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`는 historical exact-source Preview 기준선이며 현재 main이나 production source가 아니다.
- PR #30/#31로 세 프런트의 `main` Vercel Git auto-production과 pure-doc build를 repo-side 차단했다.
- docs-only main 변경은 Preview sync/일반 E2E 제외.
- `AGENTS.md` + deployment safety CI가 branch+PR 원칙을 소유한다.
- GitHub `main`은 직접 재조회에서 `protected=true`이며 PR required, strict `verify` check, force-push·branch 삭제 차단이 적용됐다. Issue #32는 `CLOSED`다.

`main` merge는 production 배포 승인이 아니다. production은 검증된 exact release SHA + 별도 승인 절차를 사용한다.

## S2 → R1 Public Readiness 종료 상태

> 아래 `CLOSED`·`PASS` 상태는 #63이 인정한 closure와 historical Preview/browser/fixture evidence를 구분해 기록한다. 이 docs-only 작업에서는 Browser R3, physical device, fixture provisioning/cleanup을 재실행하지 않았으며, 새로운 runtime proof를 만들지 않는다.

- S2 Browser Readiness: `CLOSED`
- exact-source Browser R3: `PASS`
- physical-device disposition: `PHYSICAL_DEVICE_NOT_REQUIRED` — physical-device proof를 수행했다고 주장하지 않는다.
- canonical R3 fixture cleanup: `CLOSED`
  - project: `greenhub-round-direct-e2e`
  - runId: `s2-authbound-20260904-r3`
  - manifest ownership: `4/4`
  - exact Firestore documents: `4 deleted`
  - Storage targets: `0`
  - independent readback: `4/4 HTTP 404`
- R1 Combined Public Readiness: `PUBLIC_READINESS_CLOSED`
- S2 → R1 campaign: `TERMINAL_SUCCESS`
- historical exact-source Preview source: `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`
- historical Driver Preview: deployment `dpl_4UVQ2BuTNfrBc1zm68X5Kjbvu9PE`, target `preview`, state `READY`. 당시 metadata가 해당 historical source와 일치했다는 뜻이며 현재 main·candidate·production proof가 아니다.
- pre-publication main accepted by #63: `ffd999423f8a98b0c1f34d020d832d7929feab72`; PR #60/#61/#62가 merge된 historical publication baseline이다.
- current live main after #70/#71: `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`; PR #70이 merge된 Sale Round publication state다.

## Readiness·publication·production 구분

- `IMPLEMENTATION`: #66이 `SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY`의 구현과 race/recovery proof를 accepted하여 `IMPLEMENTATION_PROVEN`이다.
- `VERIFICATION`: Sale Round focused/integration/regression proof는 `PROVEN`; exact-release Preview/browser/runtime과 Auth.js session/logout/rotation/stale-claim lifecycle은 별도 `PENDING`/`EXTERNAL_RUNTIME_BLOCKED` gate다.
- `CANDIDATE`: 기존 documentation candidate는 `9c921684a26597cb57887b6049288f1143b017c8`; 후속 candidate는 PR #69 head로 갱신한다.
- `REMOTE_ADDRESSABLE`: #70 semantic candidate와 현재 live main `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`는 remote-addressable이며, 문서 후속 candidate도 PR #69 원격 head로 read-back한다.
- `PR`: PR #70은 `MERGED`; 기존 documentation PR #69는 `OPEN`이며 이번 Goal은 merge하지 않는다.
- `PUBLISHED/MERGED`: Sale Round publication은 `PUBLISHED`; live main read-back은 `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`다.
- `PREVIEW_PROOF`: exact-release runtime/browser proof는 `PENDING`; `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c` Preview deployment는 historical evidence다.
- production deployment/activation, live round, actual payment, actual notification, first-round completion: `PRODUCTION_AUTHORITY_PENDING` / `NOT CLAIMED`.

## 현재 source·publication 기준

#63/#68 작업의 pre-publication 기준과 #71 publication 후 live authority를 read-only로 확인한 결과를 기록한다. 문서 변경 후 생기는 commit은 이 source baseline과 별도의 documentation publication candidate다.

- 작업 시작 branch: `main`
- 작업 시작 source HEAD/local `main`: `ffd999423f8a98b0c1f34d020d832d7929feab72`
- 작업 시작 local `origin/main`: `ffd999423f8a98b0c1f34d020d832d7929feab72`
- 작업 시작 live remote `main`: `fe5e680fa58c8b3af5e508d07115bb8ab9df272a` — #71 publication read-back
- pre-publication live baseline `ffd999423f8a98b0c1f34d020d832d7929feab72`는 #63/#68의 historical baseline이다.
- #70 semantic candidate `4169bf250d3bdf4a5196209090307ca979e8d32a`는 `PUBLISHED`; documentation candidate는 PR #69에서 후속 갱신하며 main merge가 아니다.
- historical `7cc4d9862dd49b68fb1542e49c53bf953bfdf59c`와 이전 provider snapshot은 current SHA·current provider metadata·production proof로 사용하지 않는다.
- GitHub main 보호 때문에 direct main commit/push는 금지되며, 문서 변경은 purpose branch + PR 경계를 따른다.

기존 Task 2F-B candidate의 상세는 [Task 2D integration closeout report](plans/REPORT_task_2d_integration_closeout.md)와 해당 historical handoff를 따른다. 아래 출시 P0 서술은 S2 → R1 campaign 종료와 별개의 broader release dependency이며, 이번 문서화로 자동 종료하거나 다시 열지 않는다.

## 제품 현재 상태

- 회차 직배송 MVP는 `main` 통합 완료.
- consumer 구매, seller 회차·주문, driver 직배송, 결제·환불·재배송비·보류·사진·운영 예외 흐름 존재.
- 카카오 비즈니스 채널 승인 완료.
- repository ALIGO logical 8-code contract: `VERIFIED` — #65에서 확인한 repository 계약이며 provider current metadata와 다르다.
- ALIGO provider current metadata: `UNVERIFIED`; production mapping은 별도 gate이며 actual send는 `NOT RUN`이다.
- 운영 Firebase rules/indexes는 출시 전 read-only 재조회 필요.
- production 회차 배포·첫 운영 회차·`salesMode` 전환 미실행.
- 판매 모드: `legacy`.

## 현재 release residual

> #63 accepted classification을 현재 release 문서의 기준으로 사용한다. 아래 상태는 implementation, verification, external/runtime, authority, product policy, docs delta를 서로 합치지 않는다.

### 1. Sale-round state atomicity and recovery

상태: `IMPLEMENTATION_PROVEN` + `PUBLISHED` — `SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY`.

#66이 회차 수정·수동 개방·주문 예약·취소 복구의 fresh state/time/ownership 경계를 직접 검증하고
구현 proof를 accepted했다. semantic candidate `4169bf250d3bdf4a5196209090307ca979e8d32a`는
PR #70으로 merge되었고, #71 publication read-back의 현재 live `main`은
`fe5e680fa58c8b3af5e508d07115bb8ab9df272a`다.

이 상태는 implementation과 repository publication에 대한 proof다. exact-release Preview/browser/runtime
proof는 `PENDING`, production authority는 `PENDING`이며 production deployment·activation·`salesMode`·
live round·actual payment/notification·first-round completion을 주장하지 않는다.

### 2. Preview·exact-SHA proof

상태: `VERIFICATION_PENDING`.

historical exact-source Preview/browser/fixture evidence는 현재 release candidate의 exact-SHA proof를 대체하지 않는다. 필요한 Preview/browser/fixture 검증은 Auth.js session lifecycle과 별도 gate다.

### 3. Auth.js session runtime

상태: `EXTERNAL_RUNTIME_BLOCKED`.

cookie 발급·동일 browser context persistence·logout/rotation·stale-claim lifecycle은 runtime/browser proof가 없으므로 `UNVERIFIED`다. static source나 callback 응답으로 승격하지 않는다.

### 4. ALIGO provider metadata

상태: `EXTERNAL_GATE_PENDING`.

repository logical 8-code contract는 `VERIFIED`지만 provider current metadata는 `UNVERIFIED`다. production mapping과 actual Alimtalk/SMS send는 각각 별도 authority gate다.

### 5. Production activation

상태: `PRODUCTION_AUTHORITY_PENDING`.

production deployment, activation, `salesMode`, live round, actual payment, actual notification, first-round completion은 모두 별도 상태이며 현재 `NOT DONE` / `NOT CLAIMED`다.

### 6. Consumer self-cancel `ORDER_CANCELLED`

상태: `PRODUCT_POLICY_DECISION_REQUIRED`.

consumer self-cancel notification callsite의 정책은 이 Goal에서 결정하거나 변경하지 않는다.

### 7. Pilot marketing wording

상태: `DOC_DELTA_CANDIDATE`.

Pilot 정책은 `MARKETING_NOT_USED_IN_PILOT`이며, 선택 consent/retention wording만 문서에서 정규화한다. 새로운 runtime 사실이나 marketing 기능을 만들지 않는다.

## HISTORICAL / CLOSED BY REL-STATE-01

> 아래 과거 P0 서술은 #63의 `A-N closed semantic work` 분류에 따른 historical record다. 현재 release blocker, current implementation finding, current verification proof, remote-addressable candidate, PR, merged, Preview, production 상태를 이 기록만으로 추론하지 않는다.

> S2 → R1 campaign의 종료는 아래 broader release P0를 production-ready로 만들지 않으며, 닫힌 S2·S3A·S3B·S4 작업을 새로 재수용하지 않는다.

### 1. Driver 승인·세션 권한 — 최우선 security coupling

관리자 승인 전 driver 권한을 얻을 수 없어야 한다. 현재 accepted source에서 다음 approval-gate 하위 범위가 검증됐다.

- public `register(role=driver)`는 `driverApproved: false`를 저장하고 client approval 주입을 거부한다.
- public `register → login`의 false/missing approval driver는 token side effect 전에 거부된다.
- 신규/legacy Kakao driver 자동승인이 제거됐고, JWT strategy/Firebase custom-token 경계가 current user 상태를 확인한다.

**S4 Driver/Auth Initial Gate = CLOSED**. `AUTH-SESSION-CLAIM-REVOCATION`의 refresh/stale-claim/session lifecycle은 **OPEN**이며, broad driver Firestore read와 결합 위험도 남는다.

이 P0는 broad driver Firestore read가 남아 있는 `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`과 결합 위험이 크므로 우선 함께 닫는다.

정본: `docs/specs/api/auth.md`; 증거: `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`.

### 2. 주문 direct Firestore read·개인정보 최소화

API driver read는 배정 경계가 있고 직접 테스트로 `VERIFIED`지만 current Rules는 driver role에 broad order read를 허용하며 seller/driver frontend는 raw document를 사용한다.

**시스템 전체 driver read authorization + seller/driver data minimization = P0 IMPLEMENTATION FINDING**.

API query authorization 자체는 `VERIFIED`를 유지하며 direct Firestore 경계와 혼동하지 않는다.

### 3. 재배송비 결제·재개 상태머신

운영 계약은 고객 책임 유료 재배송에서 `결제 전 재배송 금지`를 요구한다.

2026-08-24 감사에서 다음 두 우회/불일치가 확인됐다.

- driver `DELIVERY_HELD → DELIVERING`: charge `PAID` 확인 없음 + UI `배송 재개` 항상 노출.
- seller `DELIVERY_HELD → PREPARING`: 고객 책임+양수 재배송비에서도 성공하며 hold를 해소하지만, charge 생성 API와 consumer 결제 UI는 `status === DELIVERY_HELD`를 요구해 payment-request 뒤 결제 dead-end가 가능하다. 이후 `PREPARING → DELIVERING`도 과거 미결제 hold를 확인하지 않는다.

따라서 **`ORDER-REDELIVERY-PAID-RESUME-GATE` = P0 재배송 상태머신 `IMPLEMENTATION FINDING`**이다.

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`, 운영 근거 `docs/specs/ops/mvp-sales-round-runbook.md`.

### 4. 관리자 강제 환불 lifecycle

admin refund는 본 결제 환불 뒤 주문을 직접 `CANCELLED` write하며 정상 cancellation의 추가 charge·reservation/capacity·held counter·settlement 후속효과를 재사용하지 않는다.

**`ADMIN-FORCE-REFUND-CONSISTENCY` = P0 IMPLEMENTATION FINDING**.

### 5. Admin privileged mutation coverage

`AdminController`의 JWT + admin role guard와 `markAsPaid()` transaction 구현은 존재한다. 그러나 admin 전용 server unit/API E2E가 없고 현재 Playwright admin 테스트는 UI redirect/read smoke 중심이라 high-impact mutation의 non-admin 직접 거부·side-effect 0 및 settlement 지급 상태/race를 직접 고정하지 않는다.

**`ADMIN-PRIVILEGED-MUTATION-COVERAGE` = IMPLEMENTED / UNVERIFIED + P0 COVERAGE GAP**.

정본: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`; 증거: `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`.

### 6. Settlement core lifecycle coverage

`SettlementsService`는 transaction 기반 생성·`pending → confirmed`·취소·paid 역전 방지를 구현한다. 회차 E2E fixture도 실제 service를 주입한다.

그러나 전용 settlement lifecycle test가 없고 회차 통합 E2E도 settlement 생성 1건, 중복 방지, confirm cutoff/race, cancel/paid 보존을 직접 assertion하지 않는다. 실제 service의 간접 실행은 core 금전 상태의 직접 증거로 세지 않는다.

**`SETTLEMENT-LIFECYCLE-COVERAGE` = IMPLEMENTED / UNVERIFIED + P0 COVERAGE GAP**.

Admin `confirmed → paid`는 기존 `ADMIN-PRIVILEGED-MUTATION-COVERAGE`가 별도로 소유한다.

정본: `docs/specs/api/settlements.md`; 증거: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`.

### 7. 역사적 marketing consent lifecycle finding

round checkout에는 선택 마케팅 consent가 있고 consent retention record도 생성한다. 반면 MY 설정은 별도 `users.notificationPreferences`만 사용하고, checkout consent는 이를 동기화하지 않으며 신규 user 기본 preference도 없다. “즉시 철회”는 preference만 false로 바꾸고 withdrawal retention evidence를 남기지 않는다.

현재 실제 선택 마케팅 sender는 확인되지 않았고, 주문·결제·배송 정보성 연락은 선택 마케팅과 별개의 계약이다.

**`MARKETING-CONSENT-LIFECYCLE-CONSISTENCY` = historical P0 finding**. 현재 Pilot 정책은 `MARKETING_NOT_USED_IN_PILOT`이며, 이 기록으로 현재 implementation blocker나 marketing runtime을 주장하지 않는다.

MVP에서 마케팅을 사용하지 않으면 consent 수집/설정 노출을 비활성화·제거하는 선택도 가능하고, 유지한다면 user-level SSOT + checkout sync + withdrawal evidence + sender gating을 구현한다.

정본: `docs/specs/api/notifications.md`, `docs/specs/legal/README.md`; 증거: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`.

### 8. 결제 finalization provider 상태 방어

`finalizePaidOrder()` boundary가 비`PAID` provider 입력을 자체 차단하지 않는다.

**`PAYMENT-FINALIZATION-PAID-GUARD` = P0 IMPLEMENTATION FINDING**.

### 9. PortOne webhook signature 검증 coverage

webhook signature 구현은 raw body + id/timestamp/signature, timestamp ±5분, HMAC SHA-256 timing-safe 검증을 사용한다. 그러나 현재 회차 E2E의 signature verifier는 mock이며 real verifier의 valid HMAC 성공·non-empty invalid HMAC 거부·body/id/timestamp 변조 거부를 직접 고정한 증거가 부족하다.

**`PAYMENT-WEBHOOK-SIGNATURE-COVERAGE` = IMPLEMENTED / PARTIALLY VERIFIED + P0 COVERAGE GAP**. 구현 결함으로 단정하지 않는다.

정본: `docs/specs/api/payments.md`; 증거: `docs/reports/REPORT_payment_webhook_signature_coverage_20260824.md`.

### 10. 주문 mutation authorization 회귀

ownership guard는 구현돼 있으나 타-store seller·비담당 driver·first-claim 외 action과 거부 side-effect 0 직접 회귀가 부족하다.

**`ORDER-MUTATION-AUTHORIZATION-COVERAGE` = IMPLEMENTED / UNVERIFIED + P0 COVERAGE GAP**.

### 11. GitHub main protection

repo-side 배포 방어와 GitHub main 보호를 직접 재확인했다. `protected=true`, PR required, strict `verify` required check, force-push·delete 차단이며 Issue #32는 `CLOSED`다.

## ALIGO 상태

현재 상태:

- repository logical 8-code contract: `VERIFIED` — #65에서 8개 logical code/body/required-variable 계약을 확인했다.
- provider current metadata: `UNVERIFIED` — authenticated provider read-back이 없다.
- production mapping: provider metadata와 별도의 `UNVERIFIED` gate다.
- actual Alimtalk/SMS send: `NOT RUN`이며 별도 authority가 필요하다.

### 역사적 provider snapshot

마지막 provider snapshot — 2026-08-27 15:06 KST 경:

- 발신 프로필·senderkey 준비 완료.
- 회차 알림 템플릿 8종 등록·심사 요청 완료.
- 8종 모두 `승인완료`.
- provider 심사 외부 blocker 해소.
- 실제 알림톡·SMS 발송 0건.
- production ALIGO 자격 증명·매핑 미반영.

승인 템플릿:

- `UK_5691` 주문 접수
- `UK_5692` 상품 준비 시작
- `UK_5693` 배송 시작
- `UK_5694` 배송 보류
- `UK_5695` 재배송비 결제 요청
- `UK_5696` 재배송 예정
- `UK_5697` 배송 완료
- `UK_5698` 주문 취소

코드 레벨 알림톡 3회 retry→SMS fallback, 설정 fail-closed, notification delivery idempotency는 직접 테스트가 있다. 이를 실제 provider 발송 증거로 확장하지 않는다.

승인 증거: `docs/reports/REPORT_aligo_template_approval_20260827.md`.

위 snapshot은 현재 provider metadata read-back이 아니다. 다음 ALIGO gate는 provider code 1:1 매핑 확인 → 승인된 템플릿 격리 알림톡 → SMS fallback 실제 검증이며, 실제 발송과 production 설정은 별도 승인 없이는 수행하지 않는다.

## 판매 활성화 legal 상태

- production `/privacy`, `/terms`는 2026-08-19 비판매 상태 기준.
- 실제 판매 전 주문·취소·환불·재배송비·보류, PortOne/PG, ALIGO, seller/driver 개인정보 접근을 재정합화해야 한다.
- 2026-08-19 consumer legal baseline의 “마케팅 수신 동의 기능 없음” 사실은 현재 코드와 달라 `docs/specs/legal/README.md`의 2026-08-24 errata가 해당 구현 사실을 우선한다.
- Pilot marketing policy는 `MARKETING_NOT_USED_IN_PILOT`이다. 이 문서화는 marketing runtime sender, consent lifecycle, provider 상태를 새로 주장하지 않는다.
- broad read를 legal 문구로 정당화하지 않는다.
- 재배송 payment-required 상태머신과 admin refund 실제 정책을 legal의 재배송비·환불 설명에 반영한다.
- settlement 생성·확정·취소·지급 검증 결과와 Pilot `MARKETING_NOT_USED_IN_PILOT` wording을 legal 확정 전에 반영한다.

## 검증 상태

- 마지막 전체 원격 회차 E2E 역사 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404` — 현재 release proof가 아니다.
- chromium 26 + mobile 26 = 52, 양쪽 cleanup 성공.
- 과거 run을 현재 release 증거로 확장하지 않는다.
- exact-SHA Preview/browser/fixture와 필요한 legal/release proof는 actual release candidate에서 다시 판정한다.

## 활성 문서

- 라우팅: `docs/README.md`
- 정합성 기준: `docs/DOCUMENT_CONSISTENCY.md`
- 작업 규칙: `AGENTS.md`
- Context router: `docs/PROJECT_MAP.md`
- 상태 SSOT: 이 문서
- 미완료: `docs/BACKLOG.md`
- 재개: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 출시 의존성: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- 배포 안전: `docs/plans/PLAN_deployment_safety_guards_20260823.md`
- legal gate: `docs/specs/legal/README.md`

## 승인 경계

명시적 승인 없이 ALIGO 실제 발송/설정, production 환경변수·Firebase·운영 데이터 변경, Railway/Vercel production 배포·rollback, 운영 회차/`salesMode`, 실제 결제·환불을 실행하지 않는다.

## 다음 작업

1. exact-SHA Preview/browser/fixture와 Auth.js session lifecycle을 필요한 runtime/browser authority에서 검증한다.
2. authenticated ALIGO provider metadata read-back → repository 8-code mapping 대조 → 별도 authority 후 actual send 검증.
3. production deployment·activation·live round·actual payment·actual notification·first-round completion은 각각 별도 authority와 read-back으로 판정한다.
4. consumer self-cancel `ORDER_CANCELLED` notification은 `PRODUCT_POLICY_DECISION_REQUIRED`로 유지한다.
5. Pilot `MARKETING_NOT_USED_IN_PILOT`와 legal/source wording을 문서 범위에서 정합화한다.

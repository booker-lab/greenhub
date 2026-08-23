<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 상세 Acceptance Criteria는 `docs/BACKLOG.md`와 current spec을 사용한다.

## 검증 기준

- Git·GitHub: `2026-08-24 KST`
- Vercel 배포 안전 증거: `2026-08-23 KST`
- ALIGO 마지막 provider 상태: `2026-08-23`
- 운영 상태 변경은 별도 승인 없이 수행하지 않는다.

## Git·배포 기준선

- 저장소: `booker-lab/greenhub`
- 기본 브랜치: `main`; HEAD는 작업 시작 시 직접 재조회한다.
- 회차 직배송 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- PR #30/#31로 세 프런트의 `main` Vercel Git auto-production과 pure-doc build를 repo-side 차단했다.
- docs-only main 변경은 Preview sync/일반 E2E 제외.
- `AGENTS.md` + deployment safety CI가 branch+PR 원칙을 소유한다.
- GitHub `main` 자체 보호는 Issue #32가 남아 있다.

`main` merge는 production 배포 승인이 아니다. production은 검증된 exact release SHA + 별도 승인 절차를 사용한다.

## Task 2C integration candidate closeout

현재 workspace 기준 검증 상태와 `origin/main` 상태를 분리한다.

- 현재 branch: `codex/task-2c-r1-reg001`
- 현재 candidate HEAD: `c9d60f63af63a841f92ac56666fbafc6b49ec029`
- candidate 기준: `TASK_2C_REGRESSION_VERIFIED`
- `F-001`, `P0-001`, `P0-002`, `REG-001`, `ENV-001`: candidate에서 검증·종료
- candidate 변경은 최신 main 기준으로 재구성됐지만 아직 main에 반영되지 않았다.
- 현재 `origin/main`: `256abc705c6895a0d43936207382238be15bd976`
- candidate와 현재 main의 merge-base: `97674e97a4f2f763f83a51a79c65012425c4a50c`
- `origin/main`의 이후 변경은 문서-only redelivery P0 정합화이며 candidate 코드 영역과 overlap이 없다. 이 branch에서 rebase/merge하지 않았다.

검증 상세는 [Task 2D integration closeout report](plans/REPORT_task_2d_integration_closeout.md)를 따른다. 아래 출시 P0 서술은 현재 main의 미통합 상태를 설명하며, candidate에서 검증된 remediation을 main 완료로 해석하지 않는다.

## 제품 현재 상태

- 회차 직배송 MVP는 `main` 통합 완료.
- consumer 구매, seller 회차·주문, driver 직배송, 결제·환불·재배송비·보류·사진·운영 예외 흐름 존재.
- 카카오 비즈니스 채널 승인 완료.
- 운영 Firebase rules/indexes는 출시 전 read-only 재조회 필요.
- production 회차 배포·첫 운영 회차·`salesMode` 전환 미실행.
- 판매 모드: `legacy`.

## 현재 확인된 출시 P0

### 1. Driver 승인·세션 권한 — 최우선 security coupling

관리자 승인 전 driver 권한을 얻을 수 없어야 하지만 현재 세 경로가 확인됐다.

- 공개 email `POST /auth/register`가 `role: driver`를 허용하고 승인 gate 없이 driver user 생성 가능.
- 공개 `POST /auth/login`은 `driverApproved`를 확인하지 않고 `role=driver` JWT 발급.
- Kakao는 신규 driver를 `driverApproved: true`로 만들고 legacy 승인 필드 누락 driver도 로그인 중 자동 승인.

refresh/Firebase custom claims는 authoritative user 상태를 재검증하지 않는 stale authorization 문제도 있다.

**관리자 승인 gate = P0 IMPLEMENTATION FINDING**, suspension/role/store/approval revocation = **P0 DECISION REQUIRED + remediation**.

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

### 6. 결제 finalization provider 상태 방어

`finalizePaidOrder()` boundary가 비`PAID` provider 입력을 자체 차단하지 않는다.

**`PAYMENT-FINALIZATION-PAID-GUARD` = P0 IMPLEMENTATION FINDING**.

### 7. PortOne webhook signature 검증 coverage

webhook signature 구현은 raw body + id/timestamp/signature, timestamp ±5분, HMAC SHA-256 timing-safe 검증을 사용한다. 그러나 현재 회차 E2E의 signature verifier는 mock이며 real verifier의 valid HMAC 성공·non-empty invalid HMAC 거부·body/id/timestamp 변조 거부를 직접 고정한 증거가 부족하다.

**`PAYMENT-WEBHOOK-SIGNATURE-COVERAGE` = IMPLEMENTED / PARTIALLY VERIFIED + P0 COVERAGE GAP**. 구현 결함으로 단정하지 않는다.

정본: `docs/specs/api/payments.md`; 증거: `docs/reports/REPORT_payment_webhook_signature_coverage_20260824.md`.

### 8. 주문 mutation authorization 회귀

ownership guard는 구현돼 있으나 타-store seller·비담당 driver·first-claim 외 action과 거부 side-effect 0 직접 회귀가 부족하다.

**`ORDER-MUTATION-AUTHORIZATION-COVERAGE` = IMPLEMENTED / UNVERIFIED + P0 COVERAGE GAP**.

### 9. GitHub main protection

repo-side 배포 방어는 완료. GitHub 관리자 레벨 PR required/required check/force-push·delete 차단은 Issue #32가 남아 있다.

## ALIGO 상태

마지막 provider snapshot:

- 발신 프로필·senderkey 준비 완료.
- 회차 알림 템플릿 8종 등록·심사 요청 완료.
- 8종 모두 `검수중`.
- 실제 알림톡·SMS 발송 0건.
- production ALIGO 자격 증명·매핑 미반영.

현재성이 필요하면 provider에서 다시 조회한다.

## 판매 활성화 legal 상태

- production `/privacy`, `/terms`는 2026-08-19 비판매 상태 기준.
- 실제 판매 전 주문·취소·환불·재배송비·보류, PortOne/PG, ALIGO, seller/driver 개인정보 접근을 재정합화해야 한다.
- broad read를 legal 문구로 정당화하지 않는다.
- 재배송 payment-required 상태머신과 admin refund 실제 정책을 legal의 재배송비·환불 설명에 반영한다.

## 검증 상태

- 마지막 전체 원격 회차 E2E 역사 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`.
- chromium 26 + mobile 26 = 52, 양쪽 cleanup 성공.
- 과거 run을 현재 release 증거로 확장하지 않는다.
- 모든 P0·legal 변경을 포함한 actual release SHA에서 다시 52+cleanup 필요.

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

1. `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION` + `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION` 결합 위험을 최우선으로 해결·직접 회귀·`main` 통합.
2. `ORDER-REDELIVERY-PAID-RESUME-GATE` 상태머신 전체 구현·직접 회귀.
3. `ADMIN-PRIVILEGED-MUTATION-COVERAGE`, webhook coverage, payment finalization, admin refund, order mutation 등 나머지 P0를 ALIGO 심사와 병렬 해결.
4. Issue #32.
5. ALIGO 상태 재조회 → 승인 뒤 실제 알림톡/SMS fallback.
6. P0 결과 기준 legal 재정합화.
7. actual release SHA → E2E 52+cleanup → Firebase 재조회 → 승인된 production 설정/배포.
8. 첫 회차 검수 → 최종 승인 → `salesMode: round_direct`.

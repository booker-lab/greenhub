<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 완료 이력과 상세 Acceptance Criteria는 Git history·REPORT·`docs/BACKLOG.md`·current spec을 사용한다.

## 검증 기준

- Git·GitHub 직접 재검증: `2026-08-24 KST`
- Vercel 배포 안전 증거: `2026-08-23 KST`
- ALIGO 상태: 마지막 provider 확인 `2026-08-23`
- 운영 상태 변경은 별도 승인 없이 수행하지 않는다.

## Git·배포 기준선

- 저장소: `booker-lab/greenhub`
- 기본 브랜치: `main`
- `main` HEAD는 작업 시작 시 GitHub에서 직접 재조회한다.
- 회차 직배송 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- PR #30/#31로 세 프런트의 `main` Vercel Git production auto-deploy와 pure-doc build를 repo-side에서 차단했다.
- docs-only `main` 변경은 Preview sync/일반 E2E에서 제외된다.
- `AGENTS.md`와 deployment safety CI가 branch+PR 원칙을 강제한다.
- GitHub `main` 자체는 마지막 재조회에서 `protected=false`; Issue #32가 남아 있다.

**`main` merge는 production 배포 승인이 아니다.** production은 검증된 exact release SHA + 별도 승인 절차를 사용한다.

## 제품 현재 상태

- 회차 직배송 MVP 구현은 `main`에 통합됐다.
- consumer 구매, seller 회차·주문, driver 직배송, 결제·환불·재배송비·보류·사진·운영 예외 흐름이 존재한다.
- 카카오 비즈니스 채널 승인 완료.
- 운영 Firebase rules/indexes는 기존 준비에서 반영 완료 상태이나 출시 전 read-only 재조회가 필요하다.
- production 회차 배포·첫 운영 회차·`salesMode` 전환은 미실행.
- 판매 모드: `legacy`.

## 현재 확인된 출시 P0

### 1. 재배송비 결제 전 배송 재개 가드

운영 계약은 고객 책임 첫 배송 실패에서 유료 재배송비가 있으면 **결제 전 재배송 금지**를 요구한다.

현재:

- `OrderChargePaymentService`의 charge 결제·환불 하위 계약은 직접 회귀로 `VERIFIED`다.
- 하지만 driver `DELIVERY_HELD → DELIVERING` 서버 전환은 연결 charge의 `PAID` 상태를 확인하지 않는다.
- driver 상세 UI도 회차 직배송 `DELIVERY_HELD`이면 charge 상태와 무관하게 `배송 재개` 버튼을 노출한다.

따라서 **`ORDER-REDELIVERY-PAID-RESUME-GATE` = P0 `IMPLEMENTATION FINDING`**이다. API 직접 호출에서 미결제/실패/환불/불일치 charge를 fail-closed하고 `미결제 거부 → 결제 완료 → 정상 재개`를 직접 검증해야 한다.

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`, 운영 근거 `docs/specs/ops/mvp-sales-round-runbook.md`.

### 2. 관리자 강제 환불 lifecycle 일관성

`AdminService.forceRefund()`는 본 결제 환불 뒤 주문을 직접 `CANCELLED`로 write하며 정상 회차 cancellation의 추가 charge, reservation/capacity, held counter, settlement 후속효과를 재사용하지 않는다.

따라서 **`ADMIN-FORCE-REFUND-CONSISTENCY` = P0 `IMPLEMENTATION FINDING`**이다. paid settlement 환불은 별도 회계 조정 정책도 필요하다.

정본: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`, `docs/BACKLOG.md`.

### 3. Driver 승인·세션 권한 수명주기

- 신규 Kakao `targetRole: driver`가 `driverApproved: true`로 생성될 수 있다.
- 승인 필드 누락 기존 driver도 로그인 side effect로 자동 승인된다.
- refresh는 authoritative user 상태를 재조회하지 않고 stale `role/storeId` claims를 재사용한다.

따라서 **관리자 승인 게이트는 P0 `IMPLEMENTATION FINDING`**, suspension/role/store/approval 변경의 세션 수렴은 **P0 `DECISION REQUIRED` + remediation**이다.

정본: `docs/specs/api/auth.md`, `docs/specs/api/admin.md`, `docs/BACKLOG.md`.

### 4. 주문 direct Firestore read·개인정보 최소화

API driver read는 배정 주문으로 제한되지만 current Firestore Rules는 `role == driver`이면 주문을 배정/store/status와 무관하게 read 허용하며 seller/driver 앱은 raw order document를 사용한다.

따라서 API read만 `VERIFIED`이며 **시스템 전체 driver read authorization + seller/driver data minimization은 P0 `IMPLEMENTATION FINDING`**이다.

정본: `docs/specs/api/orders.md`, `docs/specs/legal/README.md`, `docs/BACKLOG.md`.

### 5. 결제 finalization provider 상태 방어

`PaymentFinalizationService.finalizePaidOrder()`가 비`PAID` provider 입력을 boundary 자체에서 차단하지 않는다. caller 방어는 있지만 최종화 불변식 전체는 보장되지 않는다.

따라서 **`PAYMENT-FINALIZATION-PAID-GUARD` = P0**다.

정본: `docs/specs/api/payments.md`, `docs/BACKLOG.md`.

### 6. 주문 mutation authorization 회귀

seller store ownership, driver assignment, consumer ownership guard는 구현돼 있으나 타-store seller·비담당 driver·first-claim 외 action과 거부 side-effect 0의 직접 테스트가 부족하다.

따라서 **`ORDER-MUTATION-AUTHORIZATION-COVERAGE` = `IMPLEMENTED / UNVERIFIED` + P0 `COVERAGE GAP`**다.

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`.

### 7. GitHub main protection

repo-side 배포 방어는 완료됐지만 GitHub 관리자 레벨의 PR required / required check / force-push·delete 차단은 Issue #32가 남아 있다.

## ALIGO 상태

마지막 provider snapshot:

- 발신 프로필·senderkey 준비 완료.
- 회차 알림 템플릿 8종 등록·심사 요청 완료.
- 8종 모두 `검수중`.
- 실제 알림톡·SMS 발송 0건.
- production ALIGO 자격 증명 4개·`ALIGO_TEMPLATE_CODES_JSON` 미반영.

새 작업에서 현재성이 필요하면 provider에서 다시 조회한다.

## 판매 활성화 법적 상태

- production `/privacy`, `/terms`는 2026-08-19 비판매 상태 기준이다.
- 실제 판매 전 주문·취소·환불·재배송비·보류, PortOne/결제사업자, ALIGO, seller/driver 개인정보 접근을 재정합화해야 한다.
- `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION` 해결 전에 broad read를 법적 문구로 정당화하지 않는다.
- `ORDER-REDELIVERY-PAID-RESUME-GATE`와 `ADMIN-FORCE-REFUND-CONSISTENCY` 해결 결과를 실제 재배송비·환불 약관에 반영한다.

## 검증 상태

- 마지막 전체 원격 회차 E2E 역사 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`.
- chromium 26 + mobile 26 = 52, 양쪽 fixture cleanup 성공.
- 과거 run을 현재 release SHA 증거로 확장하지 않는다.
- 모든 출시 P0와 법적 변경을 포함한 actual release SHA에서 52건+cleanup을 다시 통과해야 한다.

## 활성 문서

- 문서 라우팅: `docs/README.md`
- 정합성 기준: `docs/DOCUMENT_CONSISTENCY.md`
- 작업 규칙: `AGENTS.md`
- Context router: `docs/PROJECT_MAP.md`
- 현재 상태 SSOT: 이 문서
- 미완료 SSOT: `docs/BACKLOG.md`
- 재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 출시 의존성: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- 배포 안전: `docs/plans/PLAN_deployment_safety_guards_20260823.md`
- 판매 활성화 legal gate: `docs/specs/legal/README.md`

## 승인 경계

명시적 승인 없이 다음을 수행하지 않는다.

- ALIGO 템플릿 변경·등록·실제 발송
- production 자격 증명·환경 변수·Firebase/운영 데이터 변경
- Railway/Vercel production 배포·rollback
- 운영 회차 생성·상태 변경·`salesMode` 전환
- 실제 결제·환불

비밀값과 고객 개인정보 원문은 문서·로그·Git에 기록하지 않는다.

## 다음 작업

1. `ORDER-REDELIVERY-PAID-RESUME-GATE` 구현·직접 회귀·`main` 통합.
2. 나머지 P0 코드/권한/환불 게이트를 ALIGO 심사와 병렬 해결.
3. Issue #32 관리자 설정.
4. ALIGO 심사 결과 재조회.
5. 승인 뒤 실제 알림톡 → SMS fallback.
6. 모든 P0 결과 기준으로 판매 활성화 legal docs/test 재정합화.
7. actual release SHA 고정 → 원격 E2E 52+cleanup → 운영 Firebase 재조회.
8. 별도 승인 후 ALIGO production 설정·exact-SHA production deploy.
9. 첫 회차 검수 → 최종 승인 → `salesMode: round_direct`.

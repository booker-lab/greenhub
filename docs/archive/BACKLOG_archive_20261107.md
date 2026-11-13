<!-- Language: ko -->

# Backlog 아카이브 — 닫힌 역사 섹션 (2026-11-07)

> `docs/BACKLOG.md`에서 분리한 닫힌 과거 체크리스트의 추적 요약이다. 현재 미완료 작업은
> [../BACKLOG.md](../BACKLOG.md)를 따른다. 이 문서는 역사 기록(`HISTORICAL`)이며 현재 실행 지시가 아니다.
>
> - 원문 전체: `git show 2cbc1b9ca881969f0e1cc442d1c6c5851a034043:docs/BACKLOG.md`
>   (`HISTORICAL / CLOSED BY REL-STATE-01` 54–348행, `HISTORICAL / PREVIOUS EXTERNAL SNAPSHOT` 507–515행,
>   `HISTORICAL / PREVIOUS NEXT CHECKLIST` 517–577행)
> - 판정: 2026-11-07 `main` `2cbc1b9c` 코드·테스트 대조, `docs/DOCUMENT_CONSISTENCY.md` 기준.
>   아래 항목은 모두 `STALE_SPEC`(현재 코드·직접 회귀로 닫혔거나 현재 섹션이 대신 소유)이다.
> - 남은 실제 공백(`IMPLEMENTATION_GAP`) 2건은 BACKLOG `NEXT — 외부·권한 gate`로 옮겼다.
> - ACTIVE `BR-R3`도 같은 날 종료해 아래 `ACTIVE`에 요약했다.

## HISTORICAL / CLOSED BY REL-STATE-01

| 항목 | 현재 근거 | 추적 |
|---|---|---|
| `PAYMENT-FINALIZATION-PAID-GUARD` | `payments/payment-finalization.service.ts` 비`PAID` 조기 종료, `payments/payments.service.spec.ts` PENDING·FAILED·CANCELLED `it.each`·금액 불일치·중복 웹훅 | `docs/reports/REPORT_payments_auth_rules_reaudit_20261010.md` |
| `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE` | `payments/portone-webhook-boundary.spec.ts` 실제 HMAC 통과·불일치·본문/id/timestamp 변조·±300초 경계·side effect 0 | `docs/reports/REPORT_payment_webhook_signature_coverage_20260824.md`(당시 공백), `REPORT_payments_auth_rules_reaudit_20261010.md`(해소) |
| `ORDER-REDELIVERY-PAID-RESUME-GATE` | `orders/redelivery-resume-gate.spec.ts`(PREPARING 경유 미결제 재개 거부 포함), `orders/legacy-redelivery-resume-gate.spec.ts` | #505; 레거시 잔여는 BACKLOG `LEGACY-ORDER-REDELIVERY-GAPS` |
| `ADMIN-FORCE-REFUND-CONSISTENCY` | `admin/admin.service.ts` 회차 주문은 `cancelForRound` 위임, `admin/admin.service.spec.ts` 상태 fail-closed·capacity·정산, `admin/admin-legacy-refund-occ-retry.spec.ts` | `REPORT_payments_auth_rules_reaudit_20261010.md` |
| `ADMIN-PRIVILEGED-MUTATION-COVERAGE` | `admin/admin-privileged-mutation.spec.ts` 실제 HTTP 401·역할별 403·side effect 0, `markAsPaid` 상태 계약·동시 지급 race | `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`(당시 공백) |
| `SETTLEMENT-LIFECYCLE-COVERAGE` | `settlements/settlements-lifecycle.spec.ts` 생성 멱등·동시 완료·confirm cutoff·cancel(missing no-op·멱등·paid 역전 금지)·confirm/cancel race | `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`(당시 공백) |
| `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY` | Pilot `MARKETING_NOT_USED_IN_PILOT`: `orders/round-order-create.service.ts`가 `marketingConsent` 거부, MY 설정은 미운영 안내; legacy preference API 유지는 `docs/specs/api/notifications.md` §9 계약 | BACKLOG `DOC_DELTA — Pilot marketing contract`가 소유 |
| `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION` | `firestore.rules` `orders`·`saleRounds`·`saleRoundItems` `allow read, write: if false`, `tests/firestore/firestore-rules.test.mjs` | #402 |
| `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION` | `auth/auth.service.ts` 미승인·`driverApproved` 누락 기사 토큰 거부(로그인 중 자동 승인 없음), refresh 권한 재조회·`sessionsRevokedAt`, `auth/auth.service.spec.ts`·`auth/strategies/jwt.strategy.spec.ts` | #474·#526; 런타임 잔여는 BACKLOG `AUTH-LOGOUT-SERVER-REVOCATION` |
| `ORDER-MUTATION-AUTHORIZATION-COVERAGE` | `orders/order-mutation-authorization.spec.ts` 타 매장·비담당 기사 거부·first claim 원자 배정, `orders/driver-assignment.spec.ts` | `REPORT_auth_orders_admin_verification_audit_20260824.md`(당시 공백) |
| `DEPLOY-SAFETY-MAIN-PROTECTION` | 2026-09-05 보호 확인 완료; 현재 필수 검사는 BACKLOG `CI-REQUIRED-CHECK`(2026-10-24) | Issue #32(CLOSED), PR #30·#31 |

## HISTORICAL / PREVIOUS EXTERNAL SNAPSHOT

| 항목 | 현재 근거 | 추적 |
|---|---|---|
| ALIGO 회차 알림 템플릿 8종 최종 승인(당시 `검수중`) | 2026-09-28 콘솔 UK_5691~5698 승인·운영 대조 일치 | BACKLOG `BLOCKED_EXTERNAL — ALIGO provider current metadata`가 소유 |

## HISTORICAL / PREVIOUS NEXT CHECKLIST

| 항목 | 현재 근거 | 추적 |
|---|---|---|
| 실제 알림 검증(tpl 8종 1:1·격리 알림톡·SMS fallback) | 8종 대조·격리 알림톡 2026-09-28, SMS 실수신 2026-10-08; 남은 fallback 검증은 현재 NEXT 미체크 항목 | BACKLOG `NEXT — 외부·권한 gate`가 소유 |
| 판매 활성화 legal 재정합화 | `/terms` 제9조 재배송비 결제 확인 전 재개 금지, `/privacy` 판매·배송 담당자 최소 접근 설명, 시행일 2026-11-01 개정판, `apps/consumer/src/app/legal-documents.test.mjs`; settlement·payment 반영 잔여는 현재 NEXT | `docs/specs/legal/README.md` `2026-10-10 실제 흐름 재대조`, BACKLOG `NEXT — 법무·출시 후보 정합성` |
| 출시 후보 검증·운영 준비(P0 umbrella 10건 체크, release SHA~activation) | 2026-09-28 출시 `197f84a4`(run `36372493414`), 2026-09-29 `salesMode=round_direct`; 이후 운영 SHA는 `docs/memory.md` 5절 | `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`(Historical). 잔여 rollback dry-run·첫 두 회차 Closeout은 BACKLOG NEXT로 이동 |

## ACTIVE (종료)

| 항목 | 현재 근거 | 추적 |
|---|---|---|
| `BR-R3 — 증거 분류와 역사 승격 경계` | current finding 2건이 LATER에서 `RESOLVED`: `RETENTION-DELETE-ISSUE-ROUTING`(`retention/delivery-photo-store-routing.spec.ts`·`retention/retention.service.spec.ts`), `OPERATION-ACTION-CLAIM-FENCING`(`operations/operations.service.ts` fresh `actionClaim.token` 확인, `operations/operations-action-claim-lease-expiry.spec.ts`·`operations-action-claim-occ-retry.spec.ts`). Sale Round는 `IMPLEMENTED / PUBLISHED`가 소유. marketing 재활성화 조건은 `DOC_DELTA`로 옮김 | 역사 보고서 `54af6edf44008848e586b1707d0f1fd13470a5f6:docs/reports/REPORT_retention_operations_sale_round_audit_20260824.md`, #66·#70·#71 |

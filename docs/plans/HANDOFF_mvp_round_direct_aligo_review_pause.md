<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

> 현재 재개 지점만 관리한다. 상세 상태는 `docs/memory.md`, 미완료 Acceptance Criteria는 `docs/BACKLOG.md`, 실행 의존성은 `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`를 따른다.

## 현재 상태 — 2026-08-24 KST

- 회차 직배송 MVP `main` 통합 완료.
- 카카오 비즈니스 채널, ALIGO 발신 프로필·`senderkey`, 회차 알림 템플릿 8종 등록·심사 요청 완료.
- 마지막 provider 확인 기준 8종 모두 `검수중`.
- 실제 알림톡·SMS 발송 0건.
- production ALIGO 설정 미반영.
- 첫 운영 회차 미생성, `salesMode=legacy`.
- `main` merge는 production 승인/배포가 아니며 exact release SHA + 별도 승인 절차를 사용한다.

현재 외부 차단점은 **ALIGO 8종 provider 심사 완료**다. 재개 시 provider 상태를 직접 다시 확인한다.

ALIGO 심사와 병렬로 해결할 출시 P0:

1. `ORDER-REDELIVERY-PAID-RESUME-GATE`
2. `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
3. `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
4. `PAYMENT-FINALIZATION-PAID-GUARD`
5. `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
6. `ADMIN-FORCE-REFUND-CONSISTENCY`
7. Issue #32 `main` protection/ruleset

## P0 재개 포인터

### 1. 유료 재배송비 결제 전 배송 재개

운영 runbook은 고객 책임 첫 배송 실패의 유료 재배송에 **결제 전 재배송 금지**를 요구한다.

현재:

- charge 생성·결제·환불 자체는 직접 회귀가 있어 `VERIFIED`.
- 하지만 server lifecycle은 `DELIVERY_HELD → DELIVERING` 전에 연결 charge `PAID`를 확인하지 않는다.
- driver 상세도 charge 상태와 무관하게 `배송 재개` CTA를 노출한다.

완료 방향:

- 현재 hold ↔ current `redeliveryChargeId` 연계 확인
- `REDELIVERY_FEE`, order/store/user 일치, `PAID`일 때만 유료 재배송 재개
- `PENDING|FAILED|REFUNDED|missing|mismatched` side-effect 0 거부
- 재배송비 없는 판매자/시스템 책임 보류는 기존 정책 유지
- UI 상태 표현 + `미결제 거부 → 결제 → 재개 성공` 직접 E2E

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`; 운영 근거: `docs/specs/ops/mvp-sales-round-runbook.md`.

### 2. Driver 승인·세션 권한

- 신규 Kakao `targetRole: driver`와 승인 필드 누락 기존 driver의 자동 승인 경로 제거.
- suspension/role/store/approval 변경 뒤 refresh/Firebase claims가 정의된 revocation window 안에 authoritative state로 수렴하도록 보정.
- broad driver Firestore read P0와 결합 회귀.

정본: `docs/specs/api/auth.md`, `docs/specs/api/admin.md`, `docs/BACKLOG.md`.

### 3. 주문 direct read·데이터 최소화

- 필요한 미배정 `PREPARING` direct/hub discovery는 유지.
- arbitrary raw order read와 역할에 불필요한 내부/동의/유입 필드 노출 제거.
- Rules + projection/API + seller/driver 정상 흐름을 함께 검증.

정본: `docs/specs/api/orders.md`, `docs/specs/legal/README.md`, `docs/BACKLOG.md`.

### 4. 결제 finalization `PAID` guard

- `finalizePaidOrder()` boundary가 비`PAID` 입력을 자체 차단하도록 보정.
- `PENDING|FAILED|CANCELLED` 거부와 `PAID` legacy/group/round 정상 회귀.

정본: `docs/specs/api/payments.md`, `docs/BACKLOG.md`.

### 5. 주문 mutation authorization 회귀

- 타-store seller, 비담당 driver, first-claim 외 미배정 driver action을 직접 거부 테스트로 고정.
- 거부 side-effect 0 포함.

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`.

### 6. Admin 강제 환불 lifecycle

- admin 본 결제 환불 + 주문 직접 `CANCELLED` write를 정상 cancellation 금전·capacity·settlement 불변식과 수렴시킨다.
- paid settlement 환불은 별도 회계 조정 정책이 필요하다.

정본: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`, `docs/BACKLOG.md`.

### 7. GitHub `main` protection

- repo-side production auto-deploy 차단은 완료.
- Issue #32에서 PR required, safety required check, force-push/delete 차단 필요.

정본: `docs/plans/PLAN_deployment_safety_guards_20260823.md`.

## 지금 하지 말아야 할 작업

- 심사 중 ALIGO 템플릿 중복 등록·임의 수정.
- 승인 전 실제 알림톡·SMS 발송.
- secret, 실제 `tpl_code`, 고객 개인정보 원문 Git/문서 기록.
- direct `main` commit/push.
- `main` merge를 production 배포 승인으로 해석.
- 별도 승인 없는 production 배포·Firebase 운영 변경·운영 회차 생성·`salesMode` 변경.
- P0 구현 결함을 UI·legal·운영 문구만으로 정당화.
- P0가 `main`에 포함되기 전 actual release SHA 확정.

## 지금 병렬로 할 수 있는 작업

1. 유료 재배송비 `PAID` resume guard 구현·회귀·통합.
2. driver 승인·세션 revocation 구현·회귀·통합.
3. 주문 direct read 최소화 구현·Rules/frontend 회귀·통합.
4. payment finalization `PAID` guard 구현·회귀·통합.
5. 주문 mutation authorization 거부 회귀·통합.
6. admin force-refund lifecycle 정합화·회귀·통합.
7. Issue #32 관리자 설정.
8. read-only 문서/코드 정합성 감사.
9. ALIGO provider 심사 상태 조회.

## ALIGO 승인 뒤 재개 순서

1. 위 P0 6개와 Issue #32 완료 확인.
2. ALIGO 8종 승인/수정요청/반려 재확인.
3. 승인 `tpl_code` 8종 ↔ 내부 논리 코드 1:1 검사.
4. 별도 승인 후 격리 실제 알림톡 정상 발송.
5. 별도 승인 후 SMS fallback 실제 검증.
6. 실제 재배송비/환불/read-minimization 결과를 기준으로 판매 활성화 legal docs/test 재정합화.
7. 모든 P0·legal 변경 포함 actual release SHA 확정.
8. exact SHA 원격 E2E 52 + cleanup.
9. 운영 Firebase read-only 재조회.
10. 별도 승인 후 production ALIGO 설정.
11. exact-SHA deploy/promotion 절차 확정.
12. 사용자의 별도 `Task 3.1 승인` 뒤 production 배포.
13. provider metadata SHA 대조 → 운영 smoke.
14. 첫 회차 검수 → 최종 출시 판정 → `salesMode: round_direct`.

## 재개 완료 조건

- [x] 회차 직배송 코드 `main` 통합
- [x] 카카오 비즈니스 채널 승인
- [x] ALIGO 발신 프로필·senderkey 준비
- [x] ALIGO 템플릿 8종 등록·심사 요청
- [x] repo-side `main` auto-production 차단
- [ ] 유료 재배송비 `PAID` resume gate + 직접 회귀 + `main`
- [ ] driver 승인·세션/claims revocation + 직접 회귀 + `main`
- [ ] 주문 direct read 최소화 + Rules/frontend 회귀 + `main`
- [ ] payment finalization `PAID` guard + 회귀 + `main`
- [ ] 주문 mutation authorization 거부 회귀 + `main`
- [ ] admin force-refund lifecycle + 회귀 + `main`
- [ ] Issue #32
- [ ] ALIGO 8종 최종 승인
- [ ] 실제 알림톡 정상 발송
- [ ] SMS fallback
- [ ] 판매 활성화 legal
- [ ] actual release SHA E2E 52+cleanup
- [ ] production ALIGO 설정
- [ ] Task 3.1 별도 승인

미완료 게이트를 건너뛰어 production 배포 또는 `salesMode` 전환을 진행하지 않는다.

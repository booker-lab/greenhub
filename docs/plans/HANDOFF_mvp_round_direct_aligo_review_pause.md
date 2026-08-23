<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

> 이 문서는 현재 재개 지점만 관리한다. 상세 상태는 `docs/memory.md`, 미완료 Acceptance Criteria는 `docs/BACKLOG.md`, 실행 의존성은 `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`를 따른다.

## 현재 상태 — 2026-08-24 KST

- 회차 직배송 MVP는 `main` 통합 완료.
- 카카오 비즈니스 채널, ALIGO 발신 프로필·`senderkey`, 회차 알림 템플릿 8종 등록·심사 요청 완료.
- 마지막 provider 확인 기준 8종 모두 `검수중`.
- 실제 알림톡·SMS 발송 0건.
- production ALIGO 자격 증명·8종 매핑 미반영.
- 첫 운영 회차 미생성, `salesMode=legacy`.
- `main` merge는 production 배포 승인이 아니며 exact release SHA + 별도 승인 절차를 사용한다.

현재 외부 차단점은 **ALIGO 8종 provider 심사 완료**다. provider 상태는 재개 시 직접 다시 확인한다.

ALIGO 심사와 병렬로 해결해야 할 P0는 여섯 가지다.

1. `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
2. `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
3. `PAYMENT-FINALIZATION-PAID-GUARD`
4. `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
5. `ADMIN-FORCE-REFUND-CONSISTENCY`
6. Issue #32 `main` branch protection/ruleset

## P0 재개 포인터

### 1. Driver 승인·세션 권한

- 신규 Kakao `targetRole: driver`와 승인 필드 누락 기존 driver의 자동 승인 경로가 현재 존재한다.
- refresh는 authoritative user 상태를 재조회하지 않고 stale `role/storeId` claims를 재사용한다.
- 관리자 승인 전 driver 권한 차단과 suspension/role/store/approval 변경의 revocation window를 구현·직접 검증해야 한다.
- broad driver Firestore read P0와 결합 검증한다.

정본: `docs/specs/api/auth.md`, `docs/specs/api/admin.md`, `docs/BACKLOG.md`.

### 2. 주문 direct read·데이터 최소화

- API driver read는 배정 경계가 있으나 실제 driver 앱은 raw Firestore 주문을 직접 읽는다.
- current Rules의 broad driver read와 raw order 문서의 불필요 필드 노출을 안전한 discovery/assigned 계약으로 축소해야 한다.
- 미배정 `PREPARING` direct/hub discovery 의도는 보존한다.

정본: `docs/specs/api/orders.md`, `docs/specs/legal/README.md`, `docs/BACKLOG.md`.

### 3. 결제 finalization `PAID` guard

- `PaymentFinalizationService.finalizePaidOrder()`가 비`PAID` provider 상태를 메서드 자체에서 차단하지 않는다.
- `PENDING/FAILED/CANCELLED` 거부와 `PAID` 정상·금액 불일치·legacy/group/round 회귀를 직접 고정한다.

정본: `docs/specs/api/payments.md`, `docs/BACKLOG.md`.

### 4. 주문 mutation authorization 회귀

- seller store ownership, driver assignment, consumer ownership guard는 구현돼 있다.
- 타-store seller, 비담당 driver, 미배정 first-claim 외 mutation, 거부 side-effect 0의 직접 회귀가 부족하다.

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`.

### 5. Admin 강제 환불 lifecycle 정합성

현재 `AdminService.forceRefund()`는 정상 회차 cancellation orchestration과 수렴하지 않는다.

현재 차이:

- admin 경로: 본 결제 환불 → 주문 `CANCELLED` 직접 write
- 정상 회차 취소: cancellation claim/state → 본 결제·추가 charge 환불 → reservation/capacity 반환 → hold counter 정합화 → 주문 취소 → settlement 취소

따라서 actual release SHA 확정 전 다음을 해결한다.

- admin 환불 허용 상태 fail-closed
- 이미 결제된 재배송비/추가 charge 처리
- 회차 reservation 및 sale-round/item counter 반환
- `DELIVERY_HELD`의 `heldOrderCount` 수렴
- `pending|confirmed` settlement 취소
- `paid` settlement 환불의 별도 회계 조정 정책
- provider 성공/local 실패 재시도 계약
- seller/consumer/round cancellation과 admin refund 동시 실행의 이중환불·이중 release 방지
- 직접 회귀 테스트

정본: `docs/specs/api/admin.md`, `docs/specs/api/payments.md`, `docs/specs/api/settlements.md`, `docs/specs/api/orders.md`, `docs/BACKLOG.md`.

### 6. GitHub `main` protection

- repo-side production auto-deploy 차단은 완료.
- GitHub `main` 자체 보호는 Issue #32에서 완료해야 한다.
- 목표: PR required, `Deployment safety guard / verify`, force-push/delete 차단.

정본: `docs/plans/PLAN_deployment_safety_guards_20260823.md`.

## 지금 하지 말아야 할 작업

- 심사 중 ALIGO 템플릿 중복 등록·임의 수정.
- 승인 전 실제 알림톡·SMS 발송.
- secret, 실제 `tpl_code`, 고객 개인정보 원문을 Git/문서에 기록.
- direct `main` commit/push.
- `main` merge를 production 배포 승인으로 해석.
- 별도 승인 없이 production 배포·Firebase 운영 변경·운영 회차 생성·`salesMode` 변경.
- P0 구현 결함을 법적/운영 문구 확대로 정당화.
- 현재 P0가 `main`에 포함되기 전에 actual release SHA 확정.

## 지금 병렬로 할 수 있는 작업

1. driver 승인·세션 revocation 구현·회귀·통합.
2. 주문 direct read 최소화 구현·Rules/frontend 회귀·통합.
3. 결제 finalization `PAID` guard 구현·회귀·통합.
4. 주문 mutation authorization 직접 거부 회귀·통합.
5. admin 강제 환불 lifecycle 정합화 구현·회귀·통합.
6. Issue #32 관리자 설정.
7. read-only 문서/코드 정합성 감사.
8. ALIGO provider 심사 상태 조회.

## ALIGO 승인 뒤 재개 순서

1. 위 P0 다섯 코드/검증 게이트와 Issue #32가 완료됐는지 확인.
2. ALIGO 8종 승인/수정요청/반려 상태 재확인.
3. 승인 `tpl_code` 8종 ↔ 내부 논리 템플릿 1:1 매핑 검사.
4. 별도 승인 후 격리 실제 알림톡 정상 발송.
5. 별도 승인 후 SMS fallback 실제 검증.
6. 주문 read 최소화와 admin 환불 실제 정책을 기준으로 판매 활성화 법적 문서·테스트 재정합화.
7. 모든 P0 및 법적 변경을 포함한 actual release SHA 확정.
8. exact SHA 원격 회차 E2E 52건 + fixture cleanup.
9. 운영 Firebase read-only 재조회.
10. 별도 승인 후 production ALIGO 설정 반영·검증.
11. exact-SHA production deploy/promotion 절차 확정.
12. 사용자의 별도 `Task 3.1 승인` 뒤에만 production 배포.
13. provider deployment metadata SHA 대조 → 운영 smoke.
14. 첫 회차 검수 → 최종 출시 판정 → `salesMode: round_direct` 전환.

## 재개 완료 조건

- [x] 회차 직배송 코드 `main` 통합
- [x] 카카오 비즈니스 채널 승인
- [x] ALIGO 발신 프로필·senderkey 준비
- [x] ALIGO 템플릿 8종 등록·심사 요청
- [x] repo-side `main` 자동 production deploy 차단
- [ ] driver 승인·세션/claims revocation + 직접 회귀 + `main` 통합
- [ ] 주문 direct read authorization·데이터 최소화 + Rules/frontend 회귀 + `main` 통합
- [ ] 결제 finalization `PAID` guard + 회귀 + `main` 통합
- [ ] 주문 mutation authorization 직접 거부 회귀 + `main` 통합
- [ ] admin 강제 환불 lifecycle 정합성 + 회귀 + `main` 통합
- [ ] Issue #32 branch protection/ruleset
- [ ] ALIGO 템플릿 8종 최종 승인
- [ ] 실제 알림톡 정상 발송
- [ ] SMS fallback 실제 검증
- [ ] 판매 활성화 법적 문서 정합화
- [ ] actual release SHA 원격 E2E 52건+cleanup
- [ ] production ALIGO 설정
- [ ] Task 3.1 별도 승인

미완료 게이트를 건너뛰어 production 배포 또는 `salesMode` 전환을 진행하지 않는다.

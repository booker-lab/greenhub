<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

> 현재 재개 지점만 관리한다. 상세 상태는 `docs/memory.md`, Acceptance Criteria는 `docs/BACKLOG.md`, 의존성은 `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`를 따른다.

## 현재 상태 — 2026-08-24 KST

- 회차 직배송 MVP `main` 통합 완료.
- 카카오 비즈니스 채널, ALIGO 발신 프로필·senderkey, 회차 알림 템플릿 8종 등록·심사 요청 완료.
- 마지막 provider 확인: 8종 모두 `검수중`, 실제 발송 0건.
- production ALIGO 설정 미반영.
- 첫 운영 회차 미생성, `salesMode=legacy`.
- production은 exact release SHA + 별도 승인 절차를 사용한다.

현재 외부 차단점은 ALIGO 8종 심사 완료다. 재개 시 provider 상태를 다시 확인한다.

병렬 출시 P0:

1. `ORDER-REDELIVERY-PAID-RESUME-GATE`
2. `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
3. `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
4. `PAYMENT-FINALIZATION-PAID-GUARD`
5. `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
6. `ADMIN-FORCE-REFUND-CONSISTENCY`
7. Issue #32

## 최우선 재개 — 재배송비 상태머신

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

## 나머지 P0 포인터

- Driver 승인·session revocation: `docs/specs/api/auth.md`
- Order direct read·minimization: `docs/specs/api/orders.md`, legal gate
- Payment finalization: `docs/specs/api/payments.md`
- Order mutation authorization: `docs/specs/api/orders.md`
- Admin force-refund: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`
- GitHub main protection: Issue #32 / deployment safety plan

## 지금 하지 말 것

- 심사 중 ALIGO 템플릿 중복 등록·임의 수정
- 승인 전 실제 알림톡/SMS
- secret/실제 tpl_code/개인정보 Git 기록
- direct `main`
- main merge를 production 승인으로 해석
- 승인 없는 production/Firebase/운영 회차/`salesMode`
- P0를 UI·legal 문구만으로 정상화
- P0 전 actual release SHA 확정

## 병렬 가능 작업

1. 재배송 payment-request/hold-resolution/resume 상태머신 구현·회귀
2. driver 승인/session revocation
3. order direct read 최소화
4. payment finalization PAID boundary
5. order mutation 거부 회귀
6. admin force-refund lifecycle
7. Issue #32
8. read-only 문서/코드 감사
9. ALIGO 상태 조회

## ALIGO 승인 뒤

1. P0 6개 + Issue #32 완료 확인
2. ALIGO 8종 상태 재확인
3. provider code 1:1 검사
4. 승인 후 격리 알림톡
5. 승인 후 SMS fallback
6. 실제 재배송/환불/read-minimization 기준 legal 재정합화
7. actual release SHA
8. exact SHA E2E 52+cleanup
9. 운영 Firebase read-only
10. 승인 후 production ALIGO 설정
11. exact-SHA deployment 절차
12. 별도 Task 3.1 승인 뒤 production
13. metadata SHA + smoke
14. 첫 회차 → 최종 판정 → `round_direct`

## 완료 체크

- [x] MVP main 통합
- [x] 카카오 채널 승인
- [x] ALIGO sender profile/senderkey
- [x] 8종 등록·심사 요청
- [x] repo-side main auto-production 차단
- [ ] 재배송 payment-required 상태머신 + 직접 회귀 + main
- [ ] driver 승인/session revocation
- [ ] order direct read 최소화
- [ ] payment finalization PAID
- [ ] order mutation coverage
- [ ] admin force-refund
- [ ] Issue #32
- [ ] ALIGO 8종 승인
- [ ] 실제 알림톡/SMS fallback
- [ ] legal
- [ ] release SHA E2E 52+cleanup
- [ ] production ALIGO
- [ ] Task 3.1 승인

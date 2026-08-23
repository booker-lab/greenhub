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

1. `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE`
2. `PAYMENT-FINALIZATION-PAID-GUARD`
3. `ORDER-REDELIVERY-PAID-RESUME-GATE`
4. `ADMIN-FORCE-REFUND-CONSISTENCY`
5. `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
6. `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
7. `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
8. Issue #32

## 최우선 재개 포인터

### 1. PortOne webhook signature coverage

구현은 raw body + webhook headers + timestamp ±5분 + HMAC SHA-256 timing-safe 검증을 사용한다. production bootstrap도 `rawBody: true`다.

현재는 missing signature/secret/stale timestamp 단위 거부와 unsigned HTTP 401 증거가 있지만, **real verifier의 valid HMAC 성공과 non-empty invalid HMAC 거부가 직접 고정되지 않았다.** 회차 E2E의 signature verifier는 mock이다.

완료:

- valid HMAC real verifier 성공
- invalid non-empty HMAC 거부
- body/id/timestamp mutation 거부
- actual controller + real verifier에서 invalid request가 service에 도달하지 않음
- side effect 0

정본: `docs/specs/api/payments.md`, `docs/BACKLOG.md`.

### 2. Payment finalization PAID boundary

`finalizePaidOrder()`가 비`PAID` provider 입력을 boundary 자체에서 차단하도록 보정하고 `PENDING|FAILED|CANCELLED|PAID`를 직접 고정한다.

### 3. 유료 재배송 상태머신

`결제 전 재배송 금지`와 payment-request 후 실제 consumer 결제 가능성을 동시에 만족해야 한다. direct resume와 seller PREPARING 경유 우회를 모두 닫는다.

### 4. Admin force-refund

정상 cancellation의 본 결제·추가 charge·capacity·held counter·settlement 불변식과 수렴하고 paid settlement 별도 회계 정책을 정의한다.

### 5~7. 권한 P0

- driver 승인/session revocation
- order direct read/minimization
- order mutation authorization coverage

세부는 Backlog/current spec을 따른다.

### 8. GitHub main protection

Issue #32: PR required + deployment safety required check + force-push/delete 차단.

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

1. webhook signature real-verifier 회귀
2. payment finalization PAID boundary
3. 재배송 상태머신
4. admin force-refund lifecycle
5. driver approval/session revocation
6. order direct read 최소화
7. order mutation 거부 회귀
8. Issue #32
9. read-only 문서/코드 감사
10. ALIGO 상태 조회

## ALIGO 승인 뒤

1. P0 7개 + Issue #32 완료 확인
2. ALIGO 8종 상태 재확인
3. provider code 1:1 검사
4. 승인 후 격리 알림톡
5. 승인 후 SMS fallback
6. 실제 P0 해결 결과 기준 legal 재정합화
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
- [ ] webhook real-signature coverage + main
- [ ] payment finalization PAID + main
- [ ] 재배송 payment-required 상태머신 + main
- [ ] admin force-refund lifecycle + main
- [ ] driver approval/session revocation + main
- [ ] order direct read 최소화 + main
- [ ] order mutation coverage + main
- [ ] Issue #32
- [ ] ALIGO 8종 승인
- [ ] 실제 알림톡/SMS fallback
- [ ] legal
- [ ] release SHA E2E 52+cleanup
- [ ] production ALIGO
- [ ] Task 3.1 승인

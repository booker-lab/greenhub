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

`PaymentFinalizationService.finalizePaidOrder()`가 전달받은 PortOne 결제의 `status === 'PAID'`를 자체 강제하지 않는다.

현재 방어:

- [x] scheduler는 원격 `PAID`일 때만 finalization 호출
- [x] webhook은 `Transaction.Paid`에서 원격 결제 재조회
- [x] 금액 불일치 처리 존재

남음:

- [ ] finalization boundary에서 비`PAID` 차단
- [ ] `PENDING|FAILED|CANCELLED` 직접 거부 회귀
- [ ] `PAID` legacy/group/round 정상 회귀
- [ ] 금액 불일치·reservation/race 회귀 유지
- [ ] 수정 SHA `main` 통합

정본: `docs/specs/api/payments.md`.

### P0 — ORDER-REDELIVERY-PAID-RESUME-GATE

2026-08-24 감사에서 **유료 재배송비 결제 전 배송 재개 금지**라는 운영 계약이 서버와 driver UI에서 강제되지 않음을 확인했다.

현재 구현·증거:

- [x] 운영 runbook은 첫 고객 사유 실패를 `재배송비 1건 생성·결제. 결제 전 재배송 금지`로 명시
- [x] `OrderChargePaymentService`는 charge 자체의 `PAID` 상태·금액·order 연결과 환불 멱등성을 직접 검증
- [x] `orders.helpers.ts`는 driver `DELIVERY_HELD → DELIVERING`을 허용
- [x] `OrdersLifecycleService`/`RoundOrderLifecycleService`는 해당 전환 직전에 현재 `redeliveryChargeId`의 charge `PAID` 여부를 확인하지 않음
- [x] driver 주문 상세은 회차 직배송 `DELIVERY_HELD`이면 charge 상태와 무관하게 `배송 재개` CTA를 노출하고 `DELIVERING` PATCH 호출
- [x] 현재 테스트는 charge 생성·결제·환불은 검증하지만 `미결제 재배송 재개 거부`를 직접 고정하지 않음

판정:

- 재배송비 **결제·환불 하위 계약 자체는 `VERIFIED`**다.
- 하지만 **결제 완료를 배송 재개 전제조건으로 강제하는 주문 lifecycle은 P0 `IMPLEMENTATION FINDING`**이다.
- UI 버튼 조건만 수정해서 닫지 않는다. API 직접 호출에서도 fail-closed여야 한다.

남음:

- [ ] 고객 책임 + `redeliveryFee > 0`인 현재 보류를 유료 재배송 대상으로 서버 판정
- [ ] 현재 `redeliveryChargeId`가 현재 hold(`heldAt`)에 연결된 charge인지 검증
- [ ] charge type/order/store/user 일치 + `status === 'PAID'`일 때만 `DELIVERY_HELD → DELIVERING` 허용
- [ ] `PENDING|FAILED|REFUNDED|missing|mismatched`이면 order/counter/notification side effect 0으로 거부
- [ ] 판매자/시스템 책임 또는 재배송비 없는 보류는 불필요한 결제 요구 없이 기존 정책대로 해소
- [ ] driver UI에 charge 상태·대기 사유 표현
- [ ] `미결제 재개 거부 → 결제 완료 → 재개 성공` unit/integration/E2E 직접 회귀
- [ ] 변경 SHA `main` 통합

정본: `docs/specs/api/orders.md`, 운영 증거: `docs/specs/ops/mvp-sales-round-runbook.md`.

### P0 — ADMIN-FORCE-REFUND-CONSISTENCY

`AdminService.forceRefund()`가 정상 cancellation orchestration의 금전·capacity·정산 후속효과를 우회한다.

확인됨:

- [x] admin 경로는 `CANCELLED`만 거부하고 본 결제 환불 뒤 주문을 직접 `CANCELLED` write
- [x] 정상 회차 취소는 본 결제+paid 추가 charge 환불, retry state, reservation/counter 반환, held counter, settlement 취소 수행
- [x] admin 경로는 추가 charge, reservation/capacity, held counter, settlement를 처리하지 않음
- [x] 완료/리뷰/정산 생성 주문도 `CANCELLED`가 아니면 별도 상태 제한 없이 진입 가능

남음:

- [ ] admin 환불 허용 상태 fail-closed 정의
- [ ] 정상 회차 cancellation orchestration 재사용 또는 동등 단일 orchestration
- [ ] 본 결제+paid 재배송비 중복 없는 환불
- [ ] reservation/round/item counter·held counter 정확한 반환
- [ ] pending/confirmed settlement 취소
- [ ] paid settlement 환불의 별도 회계 조정/운영 예외 정책
- [ ] provider 성공/local 실패 재시도와 동시 실행 수렴
- [ ] 상태·settlement·charge 조합 직접 회귀
- [ ] 변경 SHA `main` 통합

정본: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`.

### P0 — ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION

API 주문 조회 authorization보다 seller/driver 실제 raw Firestore read 경계가 넓다.

확인됨:

- [x] API driver 상세은 assigned `driverId` 제한과 직접 테스트 존재
- [x] current Rules는 `role == driver`이면 주문을 배정/store/status와 무관하게 read 허용
- [x] driver 보드·상세, seller 목록이 raw `orders`를 직접 사용
- [x] raw order에 역할에 불필요한 내부/유입/동의 metadata가 존재할 수 있음

남음:

- [ ] 미배정 `PREPARING` direct/hub discovery의 최소 대상·필드 정의
- [ ] arbitrary/타-driver/완료 주문 raw read 차단
- [ ] assigned driver·seller 최소 필드 projection/DTO 또는 동등 분리
- [ ] broad driver rule 제거
- [ ] Rules 및 앱 정상/거부 회귀
- [ ] 변경 SHA `main` 통합

법적 문구를 넓혀 현재 broad read를 정당화하지 않는다. 정본: `docs/specs/api/orders.md`.

### P0 — AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION

driver 관리자 승인 계약과 실제 Kakao 가입 경로가 충돌하며 suspension/role/store 변경 뒤 stale session/claims 수렴도 불완전하다.

확인됨:

- [x] admin approval endpoint와 driver app `driverApproved` gate 존재
- [x] 신규 Kakao `targetRole: driver`가 `driverApproved: true`로 즉시 생성될 수 있음
- [x] 기존 승인 필드 누락 driver도 로그인 side effect로 자동 승인
- [x] refresh가 authoritative user 문서를 재조회하지 않고 기존 `role/storeId` claims 재사용
- [x] Firebase custom token도 현재 API JWT claims 사용

남음:

- [ ] 신규/legacy 자동 승인 제거
- [ ] 과거 계정 migration은 별도 감사 가능한 절차로 분리
- [ ] 승인 전/후 앱·API·Firebase 직접 회귀
- [ ] suspension/role/store/approval 변경의 revocation window/SLA 결정
- [ ] refresh/current claims authoritative user 상태 검증
- [ ] Firebase stale claims 재발급 차단
- [ ] logout/rotation 포함 회귀
- [ ] 변경 SHA `main` 통합

`ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`과 결합 검증한다. 정본: `docs/specs/api/auth.md`.

### P0 — ORDER-MUTATION-AUTHORIZATION-COVERAGE

`OrdersLifecycleService.assertOrderActionAccess()`의 권한 구현은 있으나 핵심 거부 회귀가 부족하다.

현재 구현:

- [x] seller store ownership
- [x] assigned driver ownership
- [x] 미배정 `PREPARING → DELIVERING` first claim
- [x] consumer order ownership

남음:

- [ ] 타-store seller status/delivery-hold 403
- [ ] 비담당 driver assigned-order mutation 403
- [ ] first-claim 외 미배정 driver mutation 거부
- [ ] first claim 정확한 `driverId` 기록
- [ ] 거부된 mutation side effect 0
- [ ] 필요한 admin 허용 범위 직접 고정
- [ ] 변경 SHA `main` 통합

정본: `docs/specs/api/orders.md`.

### P0 — DEPLOY-SAFETY-MAIN-PROTECTION

repo-side production auto-deploy 차단은 완료됐지만 GitHub `main` 자체 보호는 아직 비활성이다.

완료:

- [x] PR #30 세 프런트 `main` Vercel Git auto-deploy 차단
- [x] docs-only Preview sync/E2E 제외
- [x] `AGENTS.md` direct-main 금지
- [x] deployment safety CI
- [x] PR #31 pure docs/Markdown Vercel build skip

남음:

- [ ] Issue #32 ruleset/branch protection
- [ ] PR required
- [ ] `Deployment safety guard / verify` required check
- [ ] force push·branch deletion 차단
- [ ] 재조회에서 `protected=true` 또는 동등 enforcement 확인

---

## BLOCKED_EXTERNAL

### P0 — ALIGO 회차 알림 템플릿 8종 최종 승인

- [ ] `ORDER_ACCEPTED`
- [ ] `ORDER_PREPARING`
- [ ] `ORDER_DELIVERING`
- [ ] `ORDER_DELIVERY_HELD`
- [ ] `ORDER_REDELIVERY_PAYMENT_REQUESTED`
- [ ] `ORDER_REDELIVERY_SCHEDULED`
- [ ] `ORDER_DELIVERED`
- [ ] `ORDER_CANCELLED`

마지막 provider 확인 기준:

- 8종 등록·심사 요청 완료
- 8종 모두 `검수중`
- 실제 알림톡·SMS 발송 0건

상태는 재개 시 provider에서 다시 조회한다.

---

## NEXT — ALIGO 승인 직후

### P0 — 실제 알림 검증

- [ ] 승인 실제 `tpl_code` 8종 ↔ 내부 논리 코드 1:1 검사
- [ ] 별도 승인 후 격리 수신자 실제 알림톡 정상 발송
- [ ] 별도 승인 후 SMS fallback 실제 검증

### P0 — 판매 활성화 법적 문서 재정합화

현재 production `/terms`, `/privacy`는 2026-08-19 비판매 상태를 전제로 한다.

- [ ] 주문 성립·취소·환불·배송·재배송비·배송 보류 실제 정책 반영
- [ ] 재배송비 결제 전 배송 재개 금지와 결제/환불 실제 구현 일치 확인
- [ ] PortOne·결제사업자 개인정보 처리 역할 검수
- [ ] ALIGO 고객 전화번호·메시지 처리 고지
- [ ] order direct-read 최소화 해결 후 seller/driver 고객정보 접근 설명
- [ ] 시행일·이전 버전 관리
- [ ] `legal-documents.test.mjs` 갱신
- [ ] 법적 변경을 release SHA에 포함

정본: `docs/specs/legal/README.md`.

### P0 — 출시 후보 검증·운영 준비

- [ ] `PAYMENT-FINALIZATION-PAID-GUARD`
- [ ] `ORDER-REDELIVERY-PAID-RESUME-GATE`
- [ ] `ADMIN-FORCE-REFUND-CONSISTENCY`
- [ ] `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
- [ ] `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
- [ ] `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
- [ ] Issue #32
- [ ] 법적 페이지 포함 actual release SHA 확정
- [ ] exact SHA 원격 E2E chromium 26 + mobile 26 = 52 + cleanup
- [ ] 운영 Firebase indexes/Rules read-only 재조회
- [ ] 별도 승인 후 production ALIGO 설정
- [ ] production exact-SHA deploy/promotion 절차 확정
- [ ] 별도 `Task 3.1 승인`
- [ ] 동일 exact SHA로 API + consumer/seller/driver production 배포
- [ ] deployment metadata SHA 확인
- [ ] 운영 smoke
- [ ] 첫 회차 DRAFT 검수 → SCHEDULED
- [ ] 최종 출시 판정·rollback dry-run
- [ ] 최종 승인 후 `salesMode: round_direct`
- [ ] 초기 두 회차 모니터링·Closeout

상세 dependency: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`.

---

## LATER — 출시 후 품질·운영 개선

### NOTIFICATION-RETRY-POLICY
- [ ] backoff·일시/영구 오류 분류
- [ ] timeout·rate limit 처리
- [ ] 중복 SMS 방지·재시작 멱등성
- [ ] 구조화 관측 지표

### API-LINT-BASELINE
- [ ] auth `any` 제거
- [ ] spec mock 타입 정리
- [ ] `lint:check` / `lint:fix` 분리

### LOCAL-DEV-FULLSTACK
- [ ] API 3000 / consumer 3001 / seller 3002 / driver 3003 launcher
- [ ] seller·driver local CORS 계약
- [ ] 기존 `dev.bat` frontend-only 유지 여부

### LOAD-TEST-FORMAL
- [ ] production 분리 staging/equivalent
- [ ] 재개 트리거
- [ ] `baseline → launch → growth → spike → soak`
- [ ] k6 plan 재검증

### Seller/Admin
- [ ] ADMIN-STORES-T7 판매자 상세
- [ ] ADMIN-STORES-T8 플랫폼 기본 수수료율
- [ ] 준비 물량 공동구매 주문 포함 재설계
- [ ] 필요 시 정산 UX 검증

### Driver/배송
- [ ] Kakao Maps SDK 재평가
- [ ] 밀크런 경로 프리뷰 필요 시 구현
- [ ] 플랫폼형 드라이버 전 실시간 GPS 추적 보류

### 인프라 복원력
- [ ] Railway 단일 장애점 재평가
- [ ] backend contingency 비교

### 확장 트리거
- [ ] 다중 판매자 Phase 2
- [ ] 실제 협력 거점 계약 시 hub 운영
- [ ] 필요 시 `hub_staff`
- [ ] 외부 드라이버 정산
- [ ] 플랫폼형 드라이버
- [ ] 결제수단 확장 재평가

---

## STALE_OR_SUPERSEDED

현재 상태를 재검증하기 전 다음 과거 전제를 실행하지 않는다.

- 네이버페이 “승인 메일 대기 / 채널키만 넣으면 즉시 활성화”
- 과거 BUG-03 Firestore 공개 read/Firebase Custom Token 가정
- 과거 운영 DB reset/visual cleanup 지시
- 2026-05 Railway outage 상태
- PR #11 OPEN/Draft·병합 금지 표현
- ALIGO 8종 “미등록” 표현
- `main` merge가 자동 production 배포를 해야 한다는 전제

## 관리 원칙

1. 완료 이력을 장문으로 누적하지 않는다.
2. 현재 행동 가능한 미완료만 유지한다.
3. 외부 상태는 직접 재조회 뒤 갱신한다.
4. 체크박스는 production 변경 승인으로 간주하지 않는다.
5. 우선순위 충돌 시 `docs/memory.md`와 활성 HANDOFF·PLAN을 우선한다.
6. repository 변경은 branch+PR로 수행한다.
7. `VERIFIED` 승격은 `docs/DOCUMENT_CONSISTENCY.md`를 따른다.

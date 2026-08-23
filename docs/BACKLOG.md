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

PortOne webhook 인증 구현은 존재하지만 금융 상태 변경 경계에 필요한 cryptographic 양방향 회귀가 충분하지 않다.

현재 구현·증거:

- [x] production bootstrap은 `rawBody: true`
- [x] controller는 raw body + `webhook-id` + `webhook-timestamp` + `webhook-signature` 요구
- [x] `PORTONE_WEBHOOK_SECRET` 필수
- [x] timestamp ±5분
- [x] HMAC SHA-256 + timing-safe compare 구현
- [x] missing signature/secret, stale timestamp 단위 거부 테스트
- [x] HTTP E2E에서 webhook header 없는 요청 401
- [x] signed-flow fixture에서 controller webhook 경로 실행

현재 공백:

- 회차 E2E fixture의 `verifyWebhookSignature`는 mock이므로 실제 HMAC 검증 성공 증거가 아님
- 실제 verifier의 valid signature 성공 테스트가 없음
- 필수 header를 모두 채운 non-empty invalid signature 직접 거부 테스트가 없음
- body/id/timestamp 변조에 동일 signature가 거부되는 직접 테스트가 없음
- actual controller + real verifier 조합에서 invalid signature가 `PaymentsService.handleWebhook()`에 도달하지 않는 통합 증거가 없음

판정:

- 구현을 결함으로 단정하지 않는다.
- 금융 인증 경계이므로 **`IMPLEMENTED / PARTIALLY VERIFIED` + P0 `COVERAGE GAP`**으로 둔다.

남음:

- [ ] 고정 secret/id/timestamp/raw body의 valid HMAC이 실제 `PortoneClient.verifyWebhookSignature()` 통과
- [ ] non-empty invalid HMAC 거부
- [ ] raw body 1 byte 변조 거부
- [ ] webhook-id 변조 거부
- [ ] signed timestamp 변조/허용창 경계 거부·허용 고정
- [ ] real verifier를 사용하는 controller integration에서 valid request만 `PaymentsService.handleWebhook()` 도달
- [ ] invalid request에서 주문/payment/orderCharge/capacity side effect 0
- [ ] 기존 duplicate webhook 멱등 회귀 유지
- [ ] 회귀 SHA `main` 통합

정본: `docs/specs/api/payments.md`.

### P0 — ORDER-REDELIVERY-PAID-RESUME-GATE

운영 계약은 고객 책임 유료 재배송에서 `결제 전 재배송 금지`를 요구하지만 payment-request/hold-resolution/resume 상태머신이 이 불변식과 충돌한다.

현재 확인:

- [x] charge 결제·환불 하위 계약은 직접 테스트됨
- [x] `DELIVERY_HELD → DELIVERING`에 charge `PAID` server gate 없음
- [x] driver UI도 charge 상태와 무관하게 `배송 재개` 노출
- [x] 고객 책임+양수 재배송비 hold도 seller `DELIVERY_HELD → PREPARING` 성공이 테스트로 고정
- [x] 이 전환은 hold resolve + held counter 감소 + payment-request 알림을 발생시킴
- [x] charge 생성 API와 consumer payment CTA는 현재 `DELIVERY_HELD`를 요구해 PREPARING 전환 뒤 결제 dead-end 가능
- [x] 이후 `PREPARING → DELIVERING`에도 과거 paid-required hold의 durable gate 없음

남음:

- [ ] payment-required 정보가 PAID 전 사라지지 않음
- [ ] payment-request 알림 뒤 consumer 결제 UI/endpoint actionable
- [ ] current hold↔charge durable linkage
- [ ] `REDELIVERY_FEE` + order/store/user + `PAID` 검증
- [ ] 모든 delivery-start 경로 동일 paid gate
- [ ] invalid charge state side effect 0
- [ ] hold resolve/held counter 감소 시점 명시·race 수렴
- [ ] 무료/판매자책임 흐름 유지
- [ ] 직접 unit/integration/E2E + `main`

정본: `docs/specs/api/orders.md`.

### P0 — ADMIN-FORCE-REFUND-CONSISTENCY

admin refund가 정상 cancellation의 추가 charge·capacity·held counter·settlement 후속효과를 우회한다.

- [ ] admin 환불 허용 상태 fail-closed
- [ ] 정상 cancellation orchestration 재사용 또는 동등 단일 orchestration
- [ ] 본 결제+paid 추가 charge 중복 없는 환불
- [ ] reservation/round/item/held counter 반환
- [ ] pending/confirmed settlement 취소
- [ ] paid settlement 별도 회계 조정/operation issue 정책
- [ ] provider 성공/local 실패 재시도·동시 실행 수렴
- [ ] 직접 회귀 + `main`

정본: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`.

### P0 — ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION

API authorization보다 seller/driver raw Firestore read 경계가 넓다.

- [ ] 미배정 `PREPARING` direct/hub discovery 최소 대상·필드
- [ ] arbitrary/타-driver/완료 주문 raw read 차단
- [ ] assigned driver·seller 최소 projection/DTO 또는 동등 분리
- [ ] broad driver rule 제거
- [ ] Rules + 앱 정상/거부 회귀
- [ ] `main`

정본: `docs/specs/api/orders.md`.

### P0 — AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION

신규/legacy driver 자동 승인과 stale session/claims 수렴 문제가 있다.

- [ ] 로그인 side-effect 자동 승인 제거
- [ ] 과거 계정 migration 별도 감사 절차
- [ ] 승인 전/후 앱·API·Firebase 회귀
- [ ] suspension/role/store/approval revocation SLA
- [ ] refresh authoritative state 검증
- [ ] Firebase stale claims 재발급 차단
- [ ] logout/rotation 회귀
- [ ] `main`

정본: `docs/specs/api/auth.md`.

### P0 — ORDER-MUTATION-AUTHORIZATION-COVERAGE

상태 변경 ownership guard는 구현돼 있으나 핵심 거부 회귀가 부족하다.

- [ ] 타-store seller status/delivery-hold 403
- [ ] 비담당 driver assigned-order mutation 403
- [ ] first-claim 외 미배정 driver mutation 거부
- [ ] first claim 정확한 `driverId`
- [ ] 거부 side effect 0
- [ ] 필요한 admin 허용 범위 고정
- [ ] `main`

정본: `docs/specs/api/orders.md`.

### P0 — DEPLOY-SAFETY-MAIN-PROTECTION

repo-side production auto-deploy 차단은 완료. GitHub 관리자 레벨 보호는 남아 있다.

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
- [ ] 재배송 payment-required 상태머신
- [ ] PortOne/PG 개인정보 처리
- [ ] ALIGO 전화번호·메시지 처리
- [ ] order direct-read 최소화 뒤 seller/driver 접근 설명
- [ ] 시행일·이전 버전
- [ ] legal tests
- [ ] release SHA 포함

### P0 — 출시 후보 검증·운영 준비

- [ ] `PAYMENT-FINALIZATION-PAID-GUARD`
- [ ] `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE`
- [ ] `ORDER-REDELIVERY-PAID-RESUME-GATE`
- [ ] `ADMIN-FORCE-REFUND-CONSISTENCY`
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

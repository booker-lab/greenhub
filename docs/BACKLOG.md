<!-- Language: ko -->

# Greenhub Backlog

> 기준일: 2026-08-24 KST
>
> 현재 미완료·향후 작업만 관리한다. 완료 상세는 Git history, `docs/CRITICAL_LOGIC.md`, `docs/archive/`, 완료 PLAN·REPORT를 사용한다.

## 우선순위 규칙

- **ACTIVE**: 지금 진행 가능한 최우선 작업
- **BLOCKED_EXTERNAL**: 외부 심사·승인 때문에 기다리는 작업
- **NEXT**: 현재 게이트가 풀리면 바로 진행할 작업
- **LATER**: MVP 출시를 막지 않는 후속 개선
- **STALE_OR_SUPERSEDED**: 현재 상태 재검증 전 실행 금지

---

## ACTIVE

### P0 — PAYMENT-FINALIZATION-PAID-GUARD

현재 `main`의 `apps/api/src/payments/payment-finalization.service.ts`는 `finalizePaidOrder()` 내부에서 전달받은 PortOne 결제의 `status === 'PAID'`를 자체 강제하지 않는다.

현재 방어:

- [x] scheduler 경로는 `paymentData.status === 'PAID'`일 때만 finalization 호출
- [x] webhook 경로는 `Transaction.Paid` 이벤트에서 PortOne 원격 결제 재조회
- [x] 금액 불일치 환불·취소 처리 존재

남음:

- [ ] finalization service 자체에서 비`PAID` 입력 차단
- [ ] `PENDING` 회귀 테스트
- [ ] `FAILED` 회귀 테스트
- [ ] `CANCELLED` 회귀 테스트
- [ ] `PAID` 일반/공동구매 정상 경로 테스트
- [ ] `PAID` 회차 주문 정상 경로 테스트
- [ ] 금액 불일치 회귀 유지
- [ ] 기존 회차 reservation/race 회귀 유지
- [ ] 수정이 포함된 SHA를 `main`에 통합한 뒤 actual release SHA 후보에 포함

문서만으로 이 불변식을 완료 처리하지 않는다. 정본: `docs/specs/api/payments.md`.

### P0 — ADMIN-FORCE-REFUND-CONSISTENCY

2026-08-24 감사에서 `AdminService.forceRefund()`가 정상 주문 취소 lifecycle의 금전·capacity·정산 후속효과를 우회함을 확인했다.

현재 구현·증거:

- [x] admin refund는 주문 존재 후 `CANCELLED`만 거부
- [x] `PaymentsService.processRefundByOrderId()`로 본 결제만 환불 시도
- [x] 이후 주문을 직접 `CANCELLED`로 write
- [x] `PaymentRefundService`의 본 결제 refund claim/idempotency는 별도 검증됨
- [x] 정상 회차 취소는 본 결제 + paid 재배송비 환불, cancellation retry state, reservation/counter 반환, held counter 감소, settlement 취소를 수행
- [x] admin force refund는 `refundOrderChargesByOrderId`, reservation/capacity release, held counter 조정, `cancelSettlement()`을 호출하지 않음
- [x] admin 경로는 `PENDING`, `DELIVERY_HELD`, `DELIVERED`, `PICKED_UP`, `REVIEWED` 등도 `CANCELLED` 외면 별도 상태 제한 없이 진입 가능
- [x] payment 없음/비`PAID`가 refund service에서 no-op여도 admin 경로는 이후 주문을 `CANCELLED`로 직접 변경 가능

판정:

- provider 본 결제 환불 멱등성은 `VERIFIED`지만 **admin 주문 환불 전체 일관성은 `IMPLEMENTATION FINDING` P0**다.
- 특히 회차 reservation/counters, paid redelivery charge, pending/confirmed settlement, paid settlement 회계가 admin 경로에서 정상 취소 계약과 수렴한다고 보장할 수 없다.

남음:

- [ ] admin 환불 허용 주문 상태를 명시적으로 정의
- [ ] 회차 주문 admin 환불이 `RoundOrderLifecycleService` 취소 불변식을 재사용하거나 동등한 단일 orchestration으로 수렴
- [ ] 본 결제 + 연결 paid 재배송비를 중복 없이 함께 환불
- [ ] HELD/CONSUMED reservation 및 round/item counters 정확히 반환
- [ ] `DELIVERY_HELD` 취소 시 `heldOrderCount` 정확히 감소
- [ ] pending/confirmed settlement를 `cancelled`로 수렴
- [ ] 이미 `paid` settlement가 있는 주문의 환불은 단순 status 역전이 아닌 명시적 회계 조정/operation issue/승인 정책 결정
- [ ] provider refund 성공 후 local side-effect 실패 시 재시도 상태 보존, 외부 환불 중복 방지
- [ ] 정상 취소와 admin 환불 동시 실행이 하나의 결과로 수렴
- [ ] `PENDING`, `ACCEPTED`, `DELIVERY_HELD`, `DELIVERED/REVIEWED`, paid settlement, paid redelivery charge 조합 직접 회귀
- [ ] 수정이 포함된 SHA를 `main`에 통합한 뒤 actual release SHA 후보에 포함

정본: `docs/specs/api/admin.md`, 정산 영향: `docs/specs/api/settlements.md`.

### P0 — ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION

2026-08-24 감사에서 API 주문 조회 authorization과 실제 seller/driver 클라이언트 read 경계가 다름을 확인했다.

현재 구현·증거:

- [x] `OrdersQueryService`는 driver 상세를 `order.driverId === requesterId`로 제한하고 해당 API 권한 테스트가 존재
- [x] `firestore.rules`는 `role == 'driver'`이면 `orders/{orderId}`를 store/status/배정과 무관하게 read 허용
- [x] driver 보드는 미배정 `PREPARING` direct/hub 주문 discovery를 위해 Firestore `orders`를 직접 query
- [x] driver 상세는 Firestore `orders/{orderId}`를 직접 `onSnapshot()`
- [x] seller 주문 목록도 같은-store `orders` 원문을 직접 구독
- [x] 회차 주문 원문에는 배송 수행 필드 외에 `acquisition`, `marketingConsent`, `clientOrderPayloadHash`, reservation 관련 내부 필드가 함께 저장될 수 있음
- [x] 현재 Firestore Rules 테스트가 driver의 다른 store 주문 직접 read를 성공 케이스로 고정

판정:

- API layer read authorization만 보면 배정 기사 경계가 `VERIFIED`다.
- end-to-end 주문 read authorization은 direct Firestore 경로가 API보다 넓으므로 **`IMPLEMENTATION FINDING` P0**다.
- seller/driver의 역할별 최소 필드 제공도 raw document read 때문에 현재 `VERIFIED`가 아니다.

남음:

- [ ] 미배정 `PREPARING` direct/hub 주문을 driver가 discovery해야 하는 제품 의도를 명시하고 discovery에 필요한 최소 필드 정의
- [ ] 임의 driver가 다른 기사 배정 주문·완료 주문·일반 임의 주문 원문을 직접 read하지 못하도록 경계 축소
- [ ] assigned driver 상세에 필요한 배송지·연락처·상품·보류 정보만 제공하는 역할별 DTO/projection 또는 동등한 데이터 분리
- [ ] seller 주문 read도 판매 업무에 필요한 필드만 제공하고 `marketingConsent`, `acquisition` 등 불필요한 고객/행동 메타데이터 노출 제거
- [ ] raw `orders` 직접 구독을 유지할 경우 Rules만으로 field minimization이 가능한지 검증하고, 불가능하면 API/projection 구조로 전환
- [ ] `firestore.rules`의 broad `role == 'driver'` read 제거 또는 안전한 discovery/assigned 조건으로 대체
- [ ] `tests/firestore/firestore-rules.test.mjs`의 broad driver 성공 기대를 제거하고 허용/거부 경계를 직접 검증
- [ ] driver가 임의 order ID로 다른 주문 상세을 읽을 수 없는 직접 Rules/앱 회귀
- [ ] seller 타-store read 거부와 seller/driver 정상 보드·상세 기능 회귀 유지
- [ ] 변경이 포함된 SHA를 `main`에 통합한 뒤 actual release SHA 후보에 포함

이 finding을 법적 문구를 넓혀 정당화하지 않는다. 먼저 실제 read 경계를 최소화·검증한 뒤 `docs/specs/legal/README.md`의 seller/driver 개인정보 처리 문구를 확정한다. 기술 정본: `docs/specs/api/orders.md`.

### P0 — AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION

2026-08-24 인증 감사에서 driver 관리자 승인 계약과 실제 Kakao 가입 경로가 충돌하고, 정지·role/store 변경 뒤 기존 세션 권한 수렴도 불완전함을 확인했다.

현재 구현·증거:

- [x] admin에는 `PATCH /admin/drivers/:userId/approve`와 `driverApproved` 상태가 존재
- [x] driver NextAuth callback은 driver role에 `driverApproved === true`를 요구
- [x] 신규 로그인은 `suspended === true` 사용자를 거부하고 해당 unit test 존재
- [x] `AuthService.kakaoLogin()`은 기존 driver의 `driverApproved === undefined`를 로그인 중 `true`로 자동 갱신
- [x] 신규 Kakao identity가 `targetRole: driver`를 요청하면 `role: driver`, `driverApproved: true`로 즉시 생성
- [x] `AuthService.refresh()`는 user 문서를 재조회하지 않고 refresh JWT의 기존 `role/storeId`를 새 토큰에 재사용
- [x] `GET /auth/firebase-token`은 현재 API JWT의 `role/storeId`로 Firebase custom claims를 생성
- [x] `JwtStrategy`/`RolesGuard`는 token claims를 사용하며 매 요청마다 `suspended`·승인 상태를 재조회하지 않음

판정:

- 관리자 승인 전 driver 권한 획득 차단 계약과 신규/legacy 자동 승인 경로는 **`IMPLEMENTATION FINDING` P0**다.
- 정지·role/store/승인 변경 이후 기존 access/refresh/Firebase claims의 허용 수명은 **`DECISION REQUIRED` + P0 authorization remediation**다.
- 특히 suspended 계정이 refresh를 통해 stale 권한 token을 계속 재발급받는 상태를 정상 계약으로 간주하지 않는다.
- `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`의 broad driver Firestore read와 결합될 수 있으므로 두 P0를 독립적으로 닫지 않는다.

남음:

- [ ] 신규 Kakao `targetRole: driver`가 관리자 승인 없이 `driverApproved: true` 권한을 만들지 못하도록 수정
- [ ] 기존 `driverApproved` 누락 계정을 로그인 side effect로 자동 승인하지 않음
- [ ] 과거 계정 migration이 필요하면 명시적·감사 가능한 별도 migration/관리 절차로 분리
- [ ] 승인 전 driver 앱/API/Firebase 권한 거부, 승인 후 정상 진입 직접 회귀
- [ ] 계정 정지 시 refresh token의 후속 갱신 거부 정책 확정·구현
- [ ] refresh가 authoritative user 문서의 현재 `suspended/role/storeId/driverApproved`를 검증하고 stale claims를 재발급하지 않음
- [ ] 이미 발급된 access token의 허용 revocation window/SLA 결정
- [ ] 즉시 revocation이 필요하면 token version/session revocation 또는 동등 서버 경계 적용
- [ ] Firebase custom token이 stale API claims만으로 과거 role/store 권한을 재발급하지 않도록 현재 상태 검증
- [ ] suspended/role-changed/store-changed/driver-approval-changed/logout/rotation 회귀
- [ ] 수정이 포함된 SHA를 `main`에 통합한 뒤 actual release SHA 후보에 포함

정본: `docs/specs/api/auth.md`, admin 영향: `docs/specs/api/admin.md`.

### P0 — ORDER-MUTATION-AUTHORIZATION-COVERAGE

주문 API 조회 authorization은 `OrdersQueryService`와 직접 테스트가 일치해 해당 API 계층에서는 `VERIFIED`다. 반면 `OrdersLifecycleService.assertOrderActionAccess()`의 mutation authorization은 구현돼 있으나 권한 우회 방지 핵심 거부 시나리오를 직접 고정하는 회귀 테스트가 충분하지 않다.

현재 구현·검증:

- [x] seller mutation은 해당 store `ownerId`와 requester 일치 요구
- [x] driver mutation은 배정된 `driverId` 일치 요구
- [x] 미배정 `PREPARING → DELIVERING`은 최초 driver claim으로 허용하고 `driverId` 기록
- [x] consumer는 자신의 주문만 action access 통과
- [x] consumer가 `DELIVERY_HELD`를 위장 요청하는 직접 거부 테스트
- [x] 정상 seller/driver 회차 E2E 흐름
- [x] API 조회 권한의 consumer/seller/driver/admin 직접 거부·허용 테스트

남음:

- [ ] 다른 store의 seller가 `PATCH .../status`를 시도하면 403
- [ ] 다른 store의 seller가 `PATCH .../delivery-hold`를 시도하면 403
- [ ] `driverId`가 다른 주문을 비담당 driver가 상태 변경하면 403
- [ ] 미배정 주문은 `PREPARING → DELIVERING` 최초 claim 외 driver mutation 거부
- [ ] 최초 claim 성공 시 정확한 `driverId` 기록 직접 검증
- [ ] 거부된 mutation에서 주문 write·알림·환불·정산 side effect 0 확인
- [ ] 필요한 경우 admin 의도된 허용 범위 직접 검증
- [ ] 회귀가 포함된 SHA를 `main`에 통합한 뒤 actual release SHA 후보에 포함

권한은 P0 계약이므로 위 핵심 거부 회귀가 추가되기 전 mutation authorization 전체를 `VERIFIED`로 처리하지 않는다. 정본: `docs/specs/api/orders.md`.

### P0 — DEPLOY-SAFETY-MAIN-PROTECTION

repo-side 자동배포 차단은 완료됐지만 GitHub `main` 자체 보호는 아직 비활성이다.

완료:

- [x] PR #30 — consumer/seller/driver `main` Vercel Git auto-deploy 차단
- [x] PR #30 merge 뒤 3앱 Vercel 신규 deployment 0건 확인
- [x] docs-only `main` push의 `sync-preview`/일반 E2E 제외
- [x] `AGENTS.md` direct-main 금지 규칙
- [x] deployment safety CI
- [x] PR #31 — 순수 docs/Markdown Vercel build skip
- [x] pure-docs branch commit 뒤 3앱 신규 deployment 0건 확인

남음:

- [ ] Issue #32 — `main` branch protection/ruleset 활성화
- [ ] PR required
- [ ] `Deployment safety guard / verify` required check
- [ ] force push 차단
- [ ] branch deletion 차단
- [ ] 재조회에서 `protected=true` 또는 동등 enforcement 확인

Issue #32 완료 전에도 repo-side Vercel guard는 동작하지만, direct push 자체를 GitHub가 강제 차단하지는 못한다. 따라서 모든 작업은 `AGENTS.md`에 따라 branch+PR로 수행한다.

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

현재:

- 8종 provider 등록·심사 요청 완료
- 8종 모두 `검수중`
- 중복·오류·반려 없음
- 실제 알림톡·SMS 발송 0건

재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`

---

## NEXT — ALIGO 승인 직후

### P0 — 실제 알림 검증

- [ ] 승인된 실제 `tpl_code` 8종 ↔ 내부 논리 템플릿 1:1 매핑 검사
- [ ] 사용자 승인 후 격리 수신자 실제 알림톡 정상 발송
- [ ] 사용자 승인 후 SMS fallback 실제 검증

### P0 — 판매 활성화 법적 문서 재정합화

현재 production `/terms`, `/privacy`는 2026-08-19 **비판매 상태**를 전제로 한다.

- [ ] 상용 주문·결제·배송 상태와 약관 문구 일치
- [ ] 주문 성립·취소·환불·배송·재배송비·배송 보류 정책 검수
- [ ] PortOne·실제 결제사업자 개인정보 처리 역할 검수
- [ ] ALIGO 고객 알림 전화번호·메시지 처리 고지 검수
- [ ] `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION` 해결 후 seller·driver 고객 배송정보 접근 설명 검수
- [ ] 시행일·이전 버전 관리
- [ ] `apps/consumer/src/app/legal-documents.test.mjs` 갱신
- [ ] 변경된 `/privacy`, `/terms`를 release SHA에 포함

정본: `docs/specs/legal/README.md`

### P0 — 출시 후보 검증·운영 준비

- [ ] PAYMENT-FINALIZATION-PAID-GUARD 완료 및 `main` 통합
- [ ] ADMIN-FORCE-REFUND-CONSISTENCY 완료 및 `main` 통합
- [ ] ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION 완료 및 `main` 통합
- [ ] AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION 완료 및 `main` 통합
- [ ] ORDER-MUTATION-AUTHORIZATION-COVERAGE 완료 및 `main` 통합
- [ ] Issue #32 branch protection 완료
- [ ] 법적 페이지 포함 actual release SHA 확정
- [ ] exact SHA 원격 회차 E2E chromium 26 + mobile 26 = 52건 통과
- [ ] 양쪽 fixture cleanup 성공
- [ ] 운영 Firebase indexes·Firestore Rules·Storage Rules 읽기 전용 재조회
- [ ] 사용자 승인 후 운영 ALIGO 자격 증명 4개·`ALIGO_TEMPLATE_CODES_JSON` 반영
- [ ] 8종 매핑 검사
- [ ] production exact-SHA deploy/promotion 절차 확정
- [ ] 별도 `Task 3.1 승인`
- [ ] 승인된 exact release SHA로 Railway API production 배포
- [ ] consumer·seller·driver를 동일 release SHA로 production 배포
- [ ] deployment metadata SHA 일치 확인
- [ ] 운영 무변경 smoke: health·인증·legacy·회차 read·`/privacy`·`/terms`
- [ ] 첫 운영 회차 `DRAFT` 생성·검수
- [ ] 첫 회차 `SCHEDULED` 전환
- [ ] 최종 출시 판정·롤백 dry-run
- [ ] 최종 승인 후 `salesMode: round_direct`
- [ ] 전환 직후 smoke 뒤 외부 유입 링크 공개
- [ ] 첫 두 회차 집중 모니터링 및 Closeout

상세 dependency: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`

---

## LATER — 출시 후 품질·운영 개선

### NOTIFICATION-RETRY-POLICY

- [ ] backoff·일시/영구 오류 분류
- [ ] timeout·rate limit 처리 기준
- [ ] 중복 SMS 방지·재시작 이후 멱등성
- [ ] 구조화 관측 지표와 격리 테스트

### API-LINT-BASELINE

- [ ] auth 흐름의 `any` 제거
- [ ] spec mock 타입 정리
- [ ] `lint:check` / `lint:fix` 분리 검토

### LOCAL-DEV-FULLSTACK

- [ ] API 3000 / consumer 3001 / seller 3002 / driver 3003 launcher 설계
- [ ] seller·driver local CORS origin 계약 확인
- [ ] 기존 `dev.bat` frontend-only 유지 여부 결정

### LOAD-TEST-FORMAL

- [ ] production과 분리된 staging/equivalent 환경 확보
- [ ] 재개 트리거 정의
- [ ] `baseline → launch → growth → spike → soak`
- [ ] `docs/specs/ops/k6-load-test-plan.md` 재검증

### Seller/Admin

- [ ] ADMIN-STORES-T7 판매자 상세 드릴다운
- [ ] ADMIN-STORES-T8 플랫폼 기본 수수료율 설정
- [ ] 준비 물량 공동구매 주문 포함 여부 재설계
- [ ] 필요 시 정산 UX 육안 검증 재개

### Driver/배송

- [ ] Kakao Maps SDK 필요성 재평가
- [ ] 밀크런 경로 프리뷰 필요 시 구현
- [ ] 플랫폼형 드라이버 전까지 실시간 GPS 추적 보류

### 인프라 복원력

- [ ] Railway 단일 장애점 재평가
- [ ] 필요 시 대체 backend contingency 비교

### 확장 트리거

- [ ] 다중 판매자 Phase 2
- [ ] 실제 협력 거점 계약 시 hub 운영 오픈
- [ ] 필요 시 `hub_staff` 역할
- [ ] 외부 드라이버 정산
- [ ] 플랫폼형 드라이버 모델
- [ ] 결제수단 확장 재평가

---

## STALE_OR_SUPERSEDED

다음은 과거 상태를 그대로 전제로 실행하지 않는다.

- 네이버페이 “승인 메일 대기 / 채널키만 넣으면 즉시 활성화”
- 과거 BUG-03 Firestore 공개 read/Firebase Custom Token 가정
- 과거 운영 DB `reset-*` / `visual-settle-*` cleanup 지시
- 2026-05 Railway outage 당시 상태
- PR #11 OPEN/Draft·병합 금지 표현
- 회차 ALIGO 템플릿 8종 “미등록” 표현
- `main` merge가 자동 production 배포를 해야 한다는 과거 전제

---

## 관리 원칙

1. 완료 이력을 장문으로 누적하지 않는다.
2. 현재 행동 가능한 미완료만 ACTIVE/BLOCKED_EXTERNAL/NEXT/LATER에 둔다.
3. 외부 상태는 실제 재조회 뒤에만 갱신한다.
4. Backlog 체크박스는 production 변경 승인으로 간주하지 않는다.
5. 현재 출시 우선순위 충돌 시 `docs/memory.md`와 활성 HANDOFF·PLAN을 우선한다.
6. 모든 repository 변경은 direct `main`이 아니라 branch+PR로 수행한다.
7. 문서 정합성 판정과 `VERIFIED` 승격은 `docs/DOCUMENT_CONSISTENCY.md`를 따른다.

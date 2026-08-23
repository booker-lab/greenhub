<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

> 현재 재개 순서만 유지한다. 상세 과거 증거는 `docs/plans/REPORT_mvp_round_direct_launch.md`와 Git 이력에서 확인한다.

## 현재 상태 — 2026-08-24 KST

- 회차 직배송 MVP는 PR #11을 통해 `main` 통합 완료.
- 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`.
- 카카오 비즈니스 채널 최종 승인 완료.
- ALIGO 발신 프로필·`senderkey` 준비 완료.
- 회차 알림 템플릿 8종 provider 등록·심사 요청 완료, 마지막 확인 시 전부 `검수중`.
- 실제 알림톡·SMS 발송 0건.
- production ALIGO 자격 증명·8종 매핑 미반영.
- 첫 운영 회차 미생성, `salesMode=legacy`.

현재 외부 차단점은 **ALIGO 8종 provider 심사 완료**다. provider 상태는 새 작업 시작 시 다시 조회한다.

동시에 해결 가능한 P0는 다섯 가지다.

1. **Driver 승인 게이트·세션/claims revocation** — 신규/legacy driver 자동 승인 경로 제거와 정지·role/store 변경 권한 수렴 정책 필요.
2. **주문 direct Firestore read authorization·데이터 최소화** — API보다 넓은 driver direct read와 raw order 필드 노출을 안전한 discovery/assigned 경계로 축소해야 함.
3. **결제 finalization `PAID` 최종 방어** — 현재 `main`의 `finalizePaidOrder()`는 전달받은 provider status를 자체 강제하지 않음.
4. **주문 mutation authorization 직접 회귀** — 권한 guard는 구현돼 있으나 타-store seller·비담당 driver·미배정 first-claim 경계를 직접 고정하는 회귀가 부족함.
5. **Issue #32 `main` branch protection/ruleset 활성화**.

현재 상태 정본은 `docs/memory.md`, 미완료 목록은 `docs/BACKLOG.md`를 우선한다. 문서 정합성 판정은 `docs/DOCUMENT_CONSISTENCY.md`를 따른다.

## Driver 승인 게이트·세션 revocation P0

2026-08-24 인증 감사에서 admin driver 승인 계약과 실제 Kakao 가입·refresh 경로가 충돌함을 확인했다.

현재 사실:

- admin에는 `driverApproved` 승인 API가 있고 driver 앱 callback도 승인 flag를 요구한다.
- `AuthService.kakaoLogin()`은 신규 Kakao identity가 `targetRole: driver`를 요청하면 `role: driver`, `driverApproved: true`로 즉시 생성한다.
- 기존 driver에서 `driverApproved`가 누락된 경우도 로그인 중 자동 `true`로 보정한다.
- 신규 로그인은 `suspended` 사용자를 차단한다.
- 그러나 `AuthService.refresh()`는 사용자 문서를 재조회하지 않고 refresh JWT의 기존 `role/storeId`를 새 token에 재사용한다.
- `GET /auth/firebase-token`도 현재 JWT claims로 Firebase custom claims를 발급한다.

판정:

- 관리자 승인 전 driver 권한 획득 차단: **`IMPLEMENTATION FINDING` P0**.
- 정지·role/store/승인 변경 후 기존 세션의 revocation window와 refresh/Firebase claim 수렴: **`DECISION REQUIRED` + P0 remediation**.

이 finding은 broad driver Firestore read P0와 결합될 수 있으므로 한쪽만 해결해 driver authorization 전체를 완료 처리하지 않는다.

actual release SHA 확정 전에:

- 신규 `targetRole: driver` 자동 승인과 승인 필드 누락 계정 로그인 자동 승인을 제거하고,
- 필요한 legacy migration을 로그인 side effect가 아닌 명시적 절차로 분리하고,
- 승인 전 driver 앱/API/Firebase 접근을 직접 거부 테스트로 고정하고,
- 계정 정지 시 refresh가 새 권한 token을 발급하지 않도록 하며,
- role/storeId/driverApproved 변경 시 authoritative user 상태로 claims를 수렴시키고,
- 이미 발급된 access token의 revocation SLA를 명시적으로 결정·검증한다.

정본: `docs/specs/api/auth.md`, `docs/specs/api/admin.md`.

## 주문 direct Firestore read P0

2026-08-24 감사에서 API 주문 조회 authorization과 seller/driver가 실제 사용하는 Firestore read 경계가 서로 다름을 확인했다.

현재 사실:

- API `OrdersQueryService`는 driver 주문 상세을 `order.driverId === requesterId`로 제한한다.
- `firestore.rules`는 `role == 'driver'`이면 주문의 store/status/배정과 무관하게 `orders` read를 허용한다.
- driver 보드는 미배정 `PREPARING` direct/hub 주문 discovery를 위해 raw Firestore query를 사용한다.
- driver 상세는 arbitrary `orders/{orderId}`를 raw Firestore `onSnapshot()`으로 읽는다.
- seller 주문 목록도 same-store raw `orders` 문서를 직접 구독한다.
- 회차 주문 원문에는 배송 수행 외 `acquisition`, `marketingConsent`, 내부 hash/reservation 메타데이터가 함께 존재할 수 있다.
- 현재 Firestore Rules 테스트는 driver의 다른 store 주문 direct read를 성공 케이스로 고정한다.

따라서 API 계층 조회 권한만 `VERIFIED`이며 시스템 전체 driver read authorization과 seller/driver 최소 데이터 제공은 **`IMPLEMENTATION FINDING` P0**다.

actual release SHA 확정 전에:

- 미배정 `PREPARING` direct/hub discovery 의도와 필요한 최소 필드를 명시하고,
- 임의 driver의 타-driver/완료/기타 arbitrary order 원문 read를 차단하고,
- assigned driver와 seller에 필요한 역할별 최소 필드만 제공하며,
- `firestore.rules`와 Rules 테스트를 해당 계약으로 변경하고,
- seller/driver 보드·상세·first-claim 회귀를 확인한다.

Rules만으로 field minimization이 불가능하면 API DTO, safe projection 또는 민감/내부 필드 분리 등 동등한 구조를 사용한다. broad 구현을 개인정보처리방침 문구로 정당화하지 않는다.

정본: `docs/specs/api/orders.md`, `docs/specs/legal/README.md`.

## 결제 finalization P0

현재 `apps/api/src/payments/payment-finalization.service.ts`의 `finalizePaidOrder()`는 주문 상태·금액·reservation을 검사하지만 전달받은 `paymentData.status === 'PAID'`를 메서드 내부에서 직접 강제하지 않는다.

현재 일반 호출 경로는 일부 방어한다.

- scheduler는 원격 상태가 `PAID`일 때만 finalization 호출.
- webhook은 `Transaction.Paid` 이벤트에서 원격 결제를 재조회.

하지만 finalization service 자체가 비`PAID` 입력을 최종 차단하는 구조는 아니다.

따라서 actual release SHA를 확정하기 전에:

- 비`PAID` 차단 구현,
- `PENDING`/`FAILED`/`CANCELLED` 회귀,
- `PAID` 일반·공동구매·회차 정상 경로,
- 금액 불일치,
- 기존 reservation/race 회귀

를 통과하고 수정이 `main`에 포함됐음을 확인한다.

정본: `docs/specs/api/payments.md`.

## 주문 mutation authorization P0

주문 API 조회 authorization은 consumer/seller/driver/admin별 직접 테스트가 존재해 **API 계층에서는** `VERIFIED`다.

상태 변경은 `OrdersLifecycleService.assertOrderActionAccess()`가 다음 경계를 구현한다.

- seller: 해당 store owner만 변경 가능
- driver: 배정된 기사만 변경 가능
- 미배정 driver: `PREPARING → DELIVERING` 최초 claim만 허용 후 `driverId` 기록
- consumer: 자신의 주문만 action access 통과, 실제 전이는 consumer FSM이 추가 제한

그러나 문서 감사에서 타-store seller mutation, 비담당 driver mutation, 미배정 first-claim 외 driver mutation과 거부 side-effect 0을 직접 고정하는 회귀 테스트는 확인되지 않았다.

따라서 현재 상태는 **`IMPLEMENTED / UNVERIFIED` + `COVERAGE GAP`**이며 actual release SHA를 확정하기 전 직접 회귀를 추가하고 `main`에 통합한다.

정본: `docs/specs/api/orders.md`.

## 배포 안전성 변경

2026-08-23 배포 감사에서 `main` push가 문서 변경만으로 Vercel production deployment를 만들던 구조를 확인했고 repo-side remediation을 적용했다.

- PR #30: consumer·seller·driver `main` Vercel Git auto-deploy 차단.
- PR #30 merge 후 세 프로젝트 신규 deployment 0건 확인.
- docs-only `main` push는 Preview sync/E2E 제외.
- deployment safety CI 추가.
- `AGENTS.md`: direct `main` commit/push 금지.
- PR #31: 순수 docs/Markdown Vercel build skip.
- pure-docs branch 검증에서도 세 프로젝트 신규 deployment 0건 확인.

남음:

- GitHub `main`은 2026-08-24 재조회에서도 `protected=false`.
- Issue #32에서 PR required + safety required check + force-push/delete 차단 필요.

**중요:** `main` merge는 더 이상 production 배포 경로가 아니다. production은 actual release SHA를 고정·검증한 뒤 별도 승인으로 exact-SHA deploy/promotion을 수행한다.

상세: `docs/plans/PLAN_deployment_safety_guards_20260823.md`.

## 판매 활성화 법적 상태

production `/privacy`, `/terms`는 현재 비판매 상태를 전제로 한다.

따라서 ALIGO 실제 발송 검증 뒤 release SHA를 고정하기 전에:

- 주문 direct Firestore read P0를 해결해 seller/driver 실제 접근 범위를 최소화·검증하고,
- 실제 주문·결제·취소·환불·배송·재배송비·보류 정책,
- PortOne/결제사업자 개인정보 처리,
- ALIGO 고객 알림 처리,
- seller/driver 배송정보 접근,
- 시행일·이전 버전,
- `legal-documents.test.mjs`

을 `docs/specs/legal/README.md` 계약에 맞게 갱신한다.

현재 broad direct read를 설명하기 위해 공개 개인정보 문구를 넓히지 않는다. 실제 접근 경계를 먼저 수정한다.

## ALIGO 템플릿 현황

마지막 확인 snapshot: 2026-08-23.

| 논리 템플릿 | 상태 |
|---|---|
| `ORDER_ACCEPTED` | 검수중 |
| `ORDER_PREPARING` | 검수중 |
| `ORDER_DELIVERING` | 검수중 |
| `ORDER_DELIVERY_HELD` | 검수중 |
| `ORDER_REDELIVERY_PAYMENT_REQUESTED` | 검수중 |
| `ORDER_REDELIVERY_SCHEDULED` | 검수중 |
| `ORDER_DELIVERED` | 검수중 |
| `ORDER_CANCELLED` | 검수중 |

- 중복·오류·반려 없음.
- 비밀값 원문 기록 금지.
- 현재성이 필요한 경우 provider에서 다시 조회한다.

## 검증 기준

- 마지막 전체 원격 회차 E2E 역사 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`.
- chromium 26 + mobile 26 = 52, 양쪽 cleanup 성공.
- 현재 release SHA 증거로 확장 적용하지 않는다.
- auth approval/revocation P0, 주문 direct read P0, 결제 finalization P0, 주문 mutation authorization P0와 법적 변경까지 포함한 actual release SHA에서 다시 검증한다.

## 지금 하지 말아야 할 작업

- 심사 중 템플릿 중복 등록·임의 수정.
- 승인 전 실제 알림톡·SMS 발송.
- ALIGO secret/`tpl_code` 원문 Git 기록.
- direct `main` commit/push.
- `main` merge를 production 배포 승인으로 해석.
- 별도 Task 승인 없이 production 배포·Firebase 운영 변경·운영 회차 생성·`salesMode` 변경.
- 비판매 법적 문구를 판매 공개 전에 임의로 미리 전환.
- broad seller/driver 주문 read를 개인정보 문구 확대만으로 정당화.
- driver 자동 승인 경로를 현재 운영 승인 정책으로 정당화.
- suspended/권한 변경 계정의 stale refresh/Firebase claims를 검증 없이 정상 동작으로 간주.
- 현재 P0 코드·검증 게이트가 `main`에 반영되기 전에 release SHA를 확정.

## 지금 병렬로 할 수 있는 작업

1. driver 승인 게이트·세션/claims revocation 구현·직접 회귀·통합.
2. 주문 direct Firestore read authorization·데이터 최소화 구현·Rules/frontend 회귀·통합.
3. 결제 finalization `PAID` guard 구현·회귀 검증·통합.
4. 주문 mutation authorization 직접 거부 회귀 테스트·통합.
5. Issue #32 `main` protection/ruleset 관리자 설정.
6. read-only 문서/코드 정합성 감사.
7. ALIGO provider 심사 상태 조회.

## ALIGO 승인 뒤 재개 순서

1. auth approval/revocation P0, 주문 direct read P0, 결제 finalization P0, 주문 mutation authorization P0가 `main`에 통합됐는지 확인.
2. 8종 모두 승인/수정요청/반려 여부 확인.
3. 승인 `tpl_code` 8종 ↔ 내부 논리 템플릿 1:1 매핑 검사.
4. 별도 승인 후 격리 실제 알림톡 정상 발송.
5. 별도 승인 후 SMS fallback 실제 검증.
6. 주문 read 최소화 결과를 전제로 판매 활성화 법적 문서·테스트 재정합화.
7. Issue #32 완료 확인.
8. 법적 변경과 모든 P0 코드·검증 보정까지 포함한 actual release SHA 확정.
9. exact SHA 원격 회차 E2E 52건 + fixture cleanup.
10. 운영 Firebase read-only 재조회.
11. 별도 승인 후 production ALIGO 설정 반영·검증.
12. exact-SHA production deploy/promotion 절차 확정.
13. 사용자의 별도 `Task 3.1 승인` 뒤에만 production 배포.
14. deployment metadata SHA 대조 → 운영 smoke.
15. 첫 회차 검수 → 최종 출시 판정 → `salesMode: round_direct` 전환.

## 재개 완료 조건

- [x] 회차 직배송 코드 `main` 통합
- [x] 카카오 비즈니스 채널 승인
- [x] ALIGO 발신 프로필·senderkey 준비
- [x] ALIGO 템플릿 8종 등록·심사 요청
- [x] repo-side `main` 자동 production deploy 차단
- [x] deployment safety CI와 docs-only ignore 적용
- [ ] driver 승인 게이트·세션/claims revocation + 직접 회귀 + `main` 통합
- [ ] 주문 direct Firestore read authorization·데이터 최소화 + Rules/frontend 회귀 + `main` 통합
- [ ] 결제 finalization `PAID` guard + 회귀 검증 + `main` 통합
- [ ] 주문 mutation authorization 직접 거부 회귀 + `main` 통합
- [ ] Issue #32 branch protection/ruleset
- [ ] ALIGO 템플릿 8종 최종 승인
- [ ] 실제 알림톡 정상 발송
- [ ] SMS fallback
- [ ] 판매 활성화 법적 문서 정합화
- [ ] actual release SHA 원격 E2E 52건+cleanup
- [ ] production ALIGO 설정
- [ ] Task 3.1 별도 승인

미완료 게이트를 건너뛰어 production 배포 또는 `salesMode` 전환을 진행하지 않는다.
<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 완료 이력과 상세 증거는 기본 Context로 읽지 않는다.

## 검증 기준

- Git·GitHub 직접 재검증: `2026-08-24 KST`
- Vercel 배포 안전 증거: `2026-08-23 KST`
- ALIGO 상태: 2026-08-23 provider 등록 결과
- 운영 상태 변경은 별도 승인 없이 수행하지 않는다.

## Git 기준선

- 저장소: `booker-lab/greenhub`
- 기본 브랜치: `main`
- `main` HEAD는 문서 PR만으로도 이동하므로 이 문서에 “현재 HEAD”를 고정하지 않는다. 새 작업 시작 시 GitHub에서 직접 재조회한다.
- 회차 직배송 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- 배포 안전 repo-side 통합 기준: PR #30, PR #31
- PR #11: `MERGED`·`CLOSED`
- 기존 `codex/mvp-sales-round-direct`는 통합 완료 branch이며 새 작업 기준 branch로 재사용하지 않는다.
- 새 작업은 최신 `main`에서 목적별 branch를 만들고 PR로 통합한다.

## 배포 안전성 상태

2026-08-23 감사에서 `main` push가 문서 변경만으로도 Vercel production-target deployment와 Preview/E2E 연쇄 실행을 만들 수 있음을 확인했다.

repo-side remediation은 완료됐다.

- PR #30: consumer·seller·driver `git.deploymentEnabled.main=false`
- PR #30 merge SHA `a83fa20516ed6209a4705020cc92154f39e383ca` 이후 세 Vercel 프로젝트 신규 deployment 0건 확인
- `sync-preview.yml`: `docs/**`, `**/*.md`만 바뀐 `main` push 제외
- `AGENTS.md`: 문서-only 포함 direct `main` commit/push 금지, branch+PR 통합 요구
- `deployment-safety.yml` + `verify-deployment-safety.mjs`: 안전 invariant 검증
- PR #31: 세 앱 순수 docs/Markdown 변경의 Vercel build skip `ignoreCommand` 추가
- pure-docs branch commit `ebf44c104b2e8758733fd14501fd0e820d575ae4` 이후 세 Vercel 프로젝트 신규 deployment 0건 확인
- docs-only PR #33 merge 이후에도 세 Vercel 프로젝트 신규 deployment 0건 확인
- PR #33 생성 시각은 2026-08-23 13:57 UTC이고, 당시 최신 `preview` sync commit `b1c92cedf01f3c2ce596251bcc86066314ebc40f`의 시각은 13:55:32 UTC다. PR #33 이후 더 새로운 preview sync가 없어 docs-only main merge가 `sync-preview`를 발화하지 않았음을 확인했다.

Vercel Hobby build-rate-limit 때문에 docs-only PR에 Vercel check failure가 생길 수 있지만, 실제 deployment가 0건이면 배포 회귀로 판정하지 않는다. `Deployment safety guard` 자체 성공 여부와 Vercel deployment 목록을 분리해 본다.

남은 관리자 P0:

- GitHub `main`은 2026-08-24 재조회에서도 `protected=false`.
- Issue #32 `P0: main branch protection / ruleset 활성화`가 남아 있다.
- 목표: PR required, `Deployment safety guard / verify` required check, force push·branch delete 차단.
- 연결된 GitHub 도구와 실행 환경에는 branch protection mutation·인증된 관리자 UI·GitHub token이 없어 Issue #32 완료 전까지 정책+CI 방어 상태다.

**중요:** `main` merge는 production 배포 승인이 아니다. production은 검증된 exact release SHA와 별도 `Task 3.1 승인`을 사용해야 하며, 빈 commit·재-push로 배포를 유도하지 않는다.

상세: `docs/plans/PLAN_deployment_safety_guards_20260823.md`

## 제품 현재 상태

- 회차 직배송 MVP 구현은 `main`에 통합됐다.
- consumer 회차 구매, seller 회차·주문 운영, driver 직배송 흐름이 구현돼 있다.
- API에는 회차 주문·결제 최종화·환불·재배송비·배송 보류·배송 사진·운영 예외 흐름이 포함된다.
- 공통 회차 계약은 `packages/shared/src/sale-round.types.ts`가 소유한다.
- 카카오 비즈니스 채널 최종 승인 완료.
- 운영 Firebase indexes·Firestore Rules·Storage Rules는 기존 출시 준비에서 반영 완료 상태이며 출시 전 재조회가 필요하다.
- 회차 출시 후보 production 배포, 첫 운영 회차 생성, `salesMode` 전환은 미실행.
- 판매 모드는 최신 운영 확인 기준 `legacy`.

## 현재 확인된 P0

### Driver 승인 게이트·세션 권한 수명주기

2026-08-24 인증 감사에서 관리자 driver 승인 계약과 실제 Kakao 가입 경로가 충돌함을 확인했다.

- admin에는 `driverApproved` 승인 API가 있고 driver 앱 callback도 승인 flag를 요구한다.
- 그러나 `AuthService.kakaoLogin()`은 신규 Kakao identity가 `targetRole: driver`를 요청하면 `role: driver`, `driverApproved: true`로 즉시 생성한다.
- 기존 driver에서 `driverApproved`가 누락된 경우도 로그인 중 `true`로 자동 보정한다.
- 따라서 **관리자 승인 전 driver 권한 획득 차단은 현재 `IMPLEMENTATION FINDING` P0**다.
- `AuthService.refresh()`는 user 문서를 재조회하지 않고 기존 refresh JWT의 `role/storeId`를 새 token에 재사용한다.
- 신규 로그인은 suspended 사용자를 거부하지만 정지·role/store/승인 변경 후 기존 세션의 revocation SLA와 refresh/Firebase claim 수렴은 현재 `DECISION REQUIRED` + P0 remediation 상태다.

특히 이 finding은 `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`의 broad driver Firestore read와 결합될 수 있으므로 두 P0를 모두 해결·직접 검증하기 전 driver 권한 경계를 `VERIFIED`로 처리하지 않는다.

정본: `docs/specs/api/auth.md`, `docs/specs/api/admin.md`, `docs/BACKLOG.md`.

### 주문 direct Firestore read authorization·개인정보 최소화

2026-08-24 감사에서 API read guard와 실제 seller/driver client read 경계가 다름을 확인했다.

- API `OrdersQueryService`는 driver 주문 조회를 배정된 `driverId`로 제한하고 직접 테스트가 존재한다.
- 그러나 `firestore.rules`는 `role == 'driver'`이면 `orders` 문서를 store/status/배정과 무관하게 read 허용한다.
- driver 보드·상세와 seller 주문 목록은 Firestore `orders` 원문을 직접 구독한다.
- 회차 order 원문에는 배송 수행 정보 외에도 `acquisition`, `marketingConsent`, `clientOrderPayloadHash`, reservation 관련 내부 필드가 함께 저장될 수 있다.
- 현재 Firestore Rules 테스트도 driver의 다른 store 주문 직접 read를 성공 케이스로 고정한다.

따라서 API 조회 authorization만 `VERIFIED`이며, **시스템 전체 driver read authorization과 seller/driver 데이터 최소화는 `IMPLEMENTATION FINDING` P0**다.

미배정 `PREPARING` direct/hub 주문 discovery가 현재 제품 흐름에 필요한 점은 보존하되, 임의 driver의 arbitrary order 원문 접근과 역할에 불필요한 필드 노출은 actual release SHA 확정 전에 제거·직접 검증한다.

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`, 법적 선행 게이트 `docs/specs/legal/README.md`.

### 결제 최종화 provider 상태 방어

현재 `main`의 `apps/api/src/payments/payment-finalization.service.ts`는 `finalizePaidOrder()` 내부에서 전달받은 `paymentData.status === 'PAID'`를 독립적으로 강제하지 않는다.

현재 일반 호출 경로는 일부 방어를 갖는다.

- `cleanupPendingOrders()`는 원격 상태가 `PAID`일 때만 finalization을 호출한다.
- webhook은 `Transaction.Paid` 이벤트에서 원격 결제를 다시 조회한다.

그러나 finalization service 자체가 비`PAID` 입력을 최종 차단하는 구조는 아니다. 따라서 문서·테스트에서 “최종화 계층이 모든 비`PAID`를 차단한다”고 간주하지 않는다.

이 항목은 **actual release SHA 확정 전 해결·회귀 검증이 필요한 P0**다. 최소 회귀 범위는 `PENDING`, `FAILED`, `CANCELLED`, `PAID`, 금액 불일치, legacy/group 및 회차 경로다.

정본: `docs/specs/api/payments.md`, `docs/BACKLOG.md`

### 주문 mutation authorization 회귀 검증

주문 API 조회 권한은 consumer/seller/driver/admin별 직접 테스트가 존재해 **API 계층에서는** `VERIFIED`다.

주문 상태 변경은 `OrdersLifecycleService.assertOrderActionAccess()`에서 seller store 소유권, driver 배정, consumer 주문 소유권을 검사하고 정상 회차 E2E도 존재한다. 그러나 2026-08-24 감사에서는 다음 직접 거부 회귀를 확인하지 못했다.

- 다른 store seller의 order status/delivery-hold mutation 거부
- 이미 다른 기사에게 배정된 주문의 비담당 driver mutation 거부
- 미배정 주문의 최초 `PREPARING → DELIVERING` 외 driver mutation 거부와 side-effect 0 보장

권한은 P0 계약이므로 이 범위는 현재 **`IMPLEMENTED / UNVERIFIED` + `COVERAGE GAP`**로 취급하고 actual release SHA 확정 전 직접 회귀를 추가한다.

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`

## ALIGO 템플릿 상태

- 발신 프로필 1건 정상, `senderkey` 발급 완료.
- 내부 논리 템플릿 코드 ↔ provider `tpl_code` 분리 및 필수 변수 검증 구현 완료.
- 아래 8종 provider 등록·심사 요청 완료, 현재 모두 `검수중`.

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

- 실제 알림톡·SMS 발송: 0건
- 실제 알림톡 정상 발송·SMS fallback 검증: 미실행
- 운영 ALIGO 자격 증명 4개·`ALIGO_TEMPLATE_CODES_JSON`: 미반영

현재 출시 흐름의 외부 차단점은 ALIGO 8종 심사 완료다.

## 판매 활성화 법적 문서 상태

- production `/privacy`, `/terms`는 2026-08-19 시행 버전이다.
- 현재 공개 문서는 상용 주문·결제·배송을 운영하지 않는 **비판매 상태**를 명시한다.
- 개인정보 정본은 PortOne·결제사업자를 현재 상용 처리 수탁자로 운영하지 않는다고 적고 있다.
- 실제 고객 ALIGO 알림 처리도 판매 활성화 기준으로 재검수해야 한다.
- seller/driver 고객정보 접근 문구는 `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION` P0 해결 전 최종 확정하지 않는다.
- broad direct read를 법적 문구로 정당화하지 않고 실제 접근 경계를 먼저 최소화한다.
- 기존 법적 고지 production 반영 완료는 **판매 활성화 법적 준비 완료를 뜻하지 않는다.**
- ALIGO 실제 발송 검증 뒤 release SHA 고정 전에 `docs/specs/legal/README.md`의 P0 재정합화 게이트를 완료한다.
- 판매 공개 전에는 비판매 문구를 임의로 `판매 중`으로 미리 바꾸지 않는다.

## 검증 상태

- 마지막 전체 원격 회차 E2E 성공 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`.
- chromium 26 + mobile 26 = 총 52건 및 양쪽 fixture cleanup 성공.
- 이 과거 run을 현재 release SHA 검증으로 확장하지 않는다.
- 법적 페이지와 현재 P0 코드·검증 보정까지 포함한 실제 출시 대상 SHA를 고정한 뒤 52건+cleanup을 다시 통과해야 한다.

## 활성 문서

- 전체 문서 라우팅: `docs/README.md`
- 문서 정합성 감사 기준: `docs/DOCUMENT_CONSISTENCY.md`
- 작업 규칙: `AGENTS.md`
- Context 라우터: `docs/PROJECT_MAP.md`
- 현재 상태 SSOT: 이 문서
- 현재 재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 출시 실행 계약: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- 배포 안전 계약: `docs/plans/PLAN_deployment_safety_guards_20260823.md`
- 판매 활성화 법적 게이트: `docs/specs/legal/README.md`
- 현재 미완료 작업: `docs/BACKLOG.md`
- 설계 결정 이력: `docs/CRITICAL_LOGIC.md`

## 승인 경계

명시적 승인 없이 다음을 수행하지 않는다.

- ALIGO 템플릿 변경·추가 등록·실제 알림톡/SMS 발송
- 운영 자격 증명·환경 변수·Firebase/운영 데이터 변경
- Railway·Vercel production 배포·롤백
- 운영 회차 생성·상태 변경·`salesMode` 전환
- 실제 결제·환불

비밀값과 고객 개인정보 원문은 문서·로그·Git에 기록하지 않는다.

## 다음 작업

1. **P0 병렬 인증 게이트**: driver 관리자 승인 우회 제거 + 정지/role/store 변경의 refresh/Firebase claims 수렴 정책 확정·구현·직접 회귀 후 `main` 통합.
2. **P0 병렬 코드 게이트**: 주문 direct Firestore read를 안전한 discovery/assigned 경계와 역할별 최소 데이터로 축소하고 Rules·frontend 회귀를 `main`에 통합.
3. **P0 병렬 코드 게이트**: 결제 finalization이 비`PAID` provider 상태를 자체 차단하도록 구현·회귀 검증 후 `main` 통합.
4. **P0 병렬 검증 게이트**: 주문 mutation authorization의 타-store seller·비담당 driver·미배정 first-claim 경계를 직접 회귀 테스트하고 `main` 통합.
5. **P0 병렬 관리자 게이트**: Issue #32의 `main` branch protection/ruleset 활성화.
6. **외부 차단**: ALIGO 8종 심사 결과 대기. 승인 전 실제 발송·운영 ALIGO 설정은 진행하지 않는다.
7. 8종 승인 후 격리 알림톡 정상 발송 → SMS fallback 검증.
8. 주문 read 최소화 P0 해결을 전제로 판매 활성화 법적 문서·테스트 재정합화.
9. 법적 변경과 모든 P0 코드·검증 보정까지 포함한 actual release SHA 확정 → 원격 회차 E2E 52건+cleanup.
10. 운영 Firebase 재조회 → ALIGO 운영 설정 → 별도 `Task 3.1 승인` → exact-SHA production 배포.
11. 이후 첫 회차 검수 → 최종 출시 판정 → `salesMode: round_direct` 전환.

문서 정합성 감사는 `docs/DOCUMENT_CONSISTENCY.md`를 따르고, repository 변경은 **branch + PR**로 수행한다.
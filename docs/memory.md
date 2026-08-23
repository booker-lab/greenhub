<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 완료 이력과 상세 증거는 기본 Context로 읽지 않는다.

## 검증 기준

- Git·GitHub·Vercel·current 코드 직접 재검증: `2026-08-23 KST`
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

## 현재 P0 보안 갭 — F-001

2026-08-23 current `main` 직접 재검증에서 driver 승인·주문 접근 계약이 아직 안전한 목표 상태로 통합되지 않은 것을 확인했다.

현재 `main` 사실:

- 신규 Kakao driver를 `driverApproved: true`로 생성한다.
- 기존 driver에 `driverApproved`가 없으면 로그인 시 `true`로 자동 보정한다.
- `/driver/orders`는 `@Roles('driver', 'seller')`다.
- `DriverService.getOrders(driverId, ...)`는 `driverId`를 실제 쿼리/필터에 사용하지 않고 요청 상태의 전체 주문을 반환한다.
- Firestore Rules는 `request.auth.token.role == 'driver'`이면 모든 주문 read를 허용한다.

따라서 과거 문서에 적힌 “미승인 driver 차단·본인 주문만 접근”을 현재 구현 완료 상태로 간주하지 않는다.

추적: Issue #37 `P0: F-001 driver 승인·주문 접근 보안 remediation을 main에 통합`.

Issue #37 완료 전에는 actual release SHA 고정, release-SHA 원격 E2E 52건, production 배포로 진행하지 않는다.

목표 계약:

- 신규 driver 기본 `driverApproved: false`
- API 요청에서 승인·정지 상태 최신 재검증
- Firebase token/Rules에서도 최신 승인·정지 상태 재검증
- `/driver/orders` driver 전용 + 서버-side 허용 주문 필터
- 주문 선점 transaction 경쟁 조건 방지
- suspend/refresh/session 무효화 범위 검증
- 관련 API/Rules tests 통과 후 최신 `main`에 PR 통합

## 배포 안전성 상태

2026-08-23 감사에서 `main` push가 문서 변경만으로도 Vercel production-target deployment와 Preview/E2E 연쇄 실행을 만들 수 있음을 확인했다.

repo-side remediation은 완료됐다.

- PR #30: consumer·seller·driver `git.deploymentEnabled.main=false`
- PR #30 merge SHA `a83fa20516ed6209a4705020cc92154f39e383ca` 이후 세 Vercel 프로젝트 신규 deployment 0건 확인
- `sync-preview.yml`: `docs/**`, `**/*.md`만 바뀐 `main` push 제외
- `AGENTS.md`: 문서-only 포함 direct `main` commit/push 금지, branch+PR 통합 요구
- `deployment-safety.yml` + `verify-deployment-safety.mjs`: 안전 invariant 검증
- PR #31: 세 앱 순수 docs/Markdown 변경의 Vercel build skip `ignoreCommand` 추가
- 반복된 docs-only PR merge에서 세 Vercel 프로젝트 신규 deployment 0건과 `preview` 미동기화를 확인했다.

Vercel Hobby build-rate-limit 때문에 docs-only PR에 Vercel check failure가 생길 수 있지만, 실제 deployment가 0건이면 배포 회귀로 판정하지 않는다. `Deployment safety guard` 자체 성공 여부와 Vercel deployment 목록을 분리해 본다.

남은 관리자 P0:

- GitHub `main`은 마지막 재조회에서 `protected=false`.
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

현재 출시 흐름의 외부 차단점은 ALIGO 8종 심사 완료다. 다만 내부적으로는 Issue #37 F-001과 Issue #32 branch protection도 출시 전 필수 P0다.

## 판매 활성화 법적 문서 상태

- production `/privacy`, `/terms`는 2026-08-19 시행 버전이다.
- 현재 공개 문서는 상용 주문·결제·배송을 운영하지 않는 **비판매 상태**를 명시한다.
- 개인정보 정본은 PortOne·결제사업자를 현재 상용 처리 수탁자로 운영하지 않는다고 적고 있다.
- 실제 고객 ALIGO 알림 처리도 판매 활성화 기준으로 재검수해야 한다.
- 기존 법적 고지 production 반영 완료는 **판매 활성화 법적 준비 완료를 뜻하지 않는다.**
- ALIGO 실제 발송 검증 뒤 release SHA 고정 전에 `docs/specs/legal/README.md`의 P0 재정합화 게이트를 완료한다.
- 판매 공개 전에는 비판매 문구를 임의로 `판매 중`으로 미리 바꾸지 않는다.

## 검증 상태

- 마지막 전체 원격 회차 E2E 성공 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`.
- chromium 26 + mobile 26 = 총 52건 및 양쪽 fixture cleanup 성공.
- 이 과거 run을 현재 release SHA 검증으로 확장하지 않는다.
- Issue #37, legal 페이지, Issue #32까지 포함한 실제 출시 대상 SHA를 고정한 뒤 52건+cleanup을 다시 통과해야 한다.

## 활성 문서

- 전체 문서 라우팅: `docs/README.md`
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

1. **P0 즉시 실행 가능**: Issue #37 F-001 remediation을 최신 `main` 기준으로 통합·검증.
2. **P0 병렬 관리자 게이트**: Issue #32의 `main` branch protection/ruleset 활성화.
3. **외부 차단**: ALIGO 8종 심사 결과 대기. 승인 전 실제 발송·운영 ALIGO 설정은 진행하지 않는다.
4. 8종 승인 후 격리 알림톡 정상 발송 → SMS fallback 검증.
5. 판매 활성화 법적 문서·테스트 재정합화.
6. Issue #37·Issue #32·법적 변경까지 포함한 actual release SHA 확정 → 원격 회차 E2E 52건+cleanup.
7. 운영 Firebase 재조회 → ALIGO 운영 설정 → 별도 `Task 3.1 승인` → exact-SHA production 배포.
8. 이후 첫 회차 검수 → 최종 출시 판정 → `salesMode: round_direct` 전환.

문서 정합성 감사 자체는 앞으로도 **branch + PR**로 수행하고, current 계약과 직접 충돌하는 문서만 수정한다.
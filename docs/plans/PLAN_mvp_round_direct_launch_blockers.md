<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

> 현재 실행 계약만 유지한다. 과거 상세 증거는 `docs/plans/REPORT_mvp_round_direct_launch.md`와 Git 이력에서 확인한다.

## 문서 메타

- 작성일: 2026-07-28
- 최종 정합화: 2026-08-24 KST
- 상태: `paused_external_review`
- Priority: P0
- 현재 외부 차단점: ALIGO 회차 알림 템플릿 8종 provider 심사 완료
- 병렬 인증 P0: driver 관리자 승인 게이트 + 세션/claims revocation
- 병렬 보안 P0: 주문 direct Firestore read authorization·역할별 데이터 최소화
- 병렬 코드 P0: 결제 finalization `PAID` 최종 방어
- 병렬 검증 P0: 주문 mutation authorization 직접 거부 회귀
- 병렬 관리자 P0: GitHub Issue #32 `main` branch protection/ruleset
- 현재 상태 SSOT: `docs/memory.md`
- 재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 인증 계약: `docs/specs/api/auth.md`
- 결제 계약: `docs/specs/api/payments.md`
- 주문 계약: `docs/specs/api/orders.md`
- 배포 안전 계약: `docs/plans/PLAN_deployment_safety_guards_20260823.md`
- 판매 활성화 법적 게이트: `docs/specs/legal/README.md`
- 운영 런북: `docs/specs/ops/mvp-sales-round-runbook.md`

## 현재 기준선

- 회차 직배송 MVP는 PR #11을 통해 `main`에 통합됐다.
- 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`.
- 카카오 비즈니스 채널 승인, ALIGO 발신 프로필·`senderkey`, 내부↔외부 템플릿 코드 분리 구현 완료.
- 회차 알림 템플릿 8종 provider 등록·심사 요청 완료, 모두 `검수중`.
- 실제 알림톡 정상 발송·SMS fallback 검증 미실행.
- production ALIGO 자격 증명 4개와 `ALIGO_TEMPLATE_CODES_JSON` 미반영.
- 운영 Firebase rules/indexes는 기존 준비에서 반영 완료 상태이며 출시 전 재조회 필요.
- production 회차 앱 배포·첫 회차 생성·`salesMode` 전환 미실행.
- `salesMode=legacy` 유지.
- 현재 `/terms`, `/privacy`는 비판매 상태를 전제로 하므로 실제 판매 활성화 전 재정합화가 필요하다.
- 현재 `main`의 `PaymentFinalizationService.finalizePaidOrder()`는 전달받은 provider `status === 'PAID'`를 메서드 내부에서 독립적으로 강제하지 않는다. actual release SHA 확정 전 해결·회귀 검증해야 한다.
- 주문 API 조회 authorization은 직접 테스트가 존재해 API 계층에서는 `VERIFIED`다. 그러나 driver/seller 앱은 raw Firestore `orders` read를 사용하고, current Rules는 `role == 'driver'`이면 배정·store·상태와 무관하게 주문 read를 허용하므로 시스템 전체 read authorization·데이터 최소화는 P0 `IMPLEMENTATION FINDING`이다.
- order mutation authorization은 seller 타-store·비담당 driver·미배정 driver first-claim 경계의 직접 거부 회귀가 부족해 `IMPLEMENTED / UNVERIFIED` 상태다.
- driver admin 승인 계약과 달리 신규 Kakao `targetRole: driver` 및 승인 필드 누락 기존 driver가 `driverApproved: true`로 자동 수렴하는 경로가 있어 P0 `IMPLEMENTATION FINDING`이다.
- 정지·role/store/driverApproved 변경 뒤 refresh/custom-token 권한 수렴은 stale JWT payload를 재사용하므로 revocation SLA 결정과 구현 보정이 필요하다.

## 배포 안전 기준선

2026-08-23 발견된 `main push → Vercel production` 자동 연결은 repo-side에서 차단했다.

- PR #30: 세 프런트 `git.deploymentEnabled.main=false`.
- PR #30 merge 뒤 3앱 신규 Vercel deployment 0건 확인.
- docs-only `main` push는 Preview sync/E2E 제외.
- PR #31: 순수 docs/Markdown의 Vercel build skip.
- deployment safety CI 추가.
- direct `main` 작업은 `AGENTS.md`에서 금지.

그러나 GitHub `main` 자체는 2026-08-24 재조회 기준 `protected=false`이므로 Issue #32 완료가 출시 전 필수다.

**이제 `main` merge는 production 배포 수단이 아니다.** 운영 배포는 아래 Task 3 단계에서 검증된 exact release SHA를 명시적으로 deploy/promote한다.

## 출시 게이트 요약

| 순서 | 게이트 | 상태 |
|---|---|---|
| 0 | repo-side 자동배포 차단 | 완료 |
| 0A | GitHub `main` branch protection/ruleset | **미완료 — Issue #32** |
| 0B | 결제 finalization 비`PAID` 최종 차단 + 회귀 | **미완료 — P0** |
| 0C | 주문 mutation authorization 직접 거부 회귀 | **미완료 — P0 COVERAGE GAP** |
| 0D | 주문 direct Firestore read authorization·데이터 최소화 | **미완료 — P0 IMPLEMENTATION FINDING** |
| 0E | driver 승인 게이트 + 세션/claims revocation | **미완료 — P0 IMPLEMENTATION FINDING / DECISION REQUIRED** |
| 1 | ALIGO 8종 provider 최종 승인 | **검수중** |
| 2 | 실제 알림톡 정상 발송 | 미실행 |
| 3 | SMS fallback 실제 검증 | 미실행 |
| 4 | 판매 활성화 법적 문서 재정합화 | 미실행 |
| 5 | actual release SHA 확정 | 미실행 |
| 6 | exact SHA 원격 회차 E2E 52건+cleanup | 미실행 |
| 7 | 운영 Firebase 재조회 | 미실행 |
| 8 | 운영 ALIGO 설정 | 미실행 |
| 9 | exact-SHA production 배포 | 미실행 — 별도 Task 3.1 승인 |
| 10 | 첫 회차 검수 | 미실행 |
| 11 | 최종 출시 판정 | 미실행 |
| 12 | `round_direct` 전환 | 미실행 |

## Agent Completion Contract

1. 모든 repository 변경은 최신 `main`에서 목적별 branch를 만들고 PR로 통합한다.
2. direct `main` commit/push를 하지 않는다.
3. dependency 순서대로 Task를 실행하되 auth P0, 주문 direct read P0, 결제 finalization P0, 주문 mutation authorization P0와 Issue #32는 ALIGO 심사와 병렬로 해결할 수 있다.
4. 외부 서비스 변경·실제 발송·운영 변수·Firebase 운영 변경·production 배포·운영 데이터·`salesMode` 변경은 해당 승인 게이트를 따른다.
5. 한 Task의 승인을 이후 운영 변경 승인으로 확대 해석하지 않는다.
6. 비밀값·고객 개인정보·사진 원본·서명 URL을 Git/문서/증거에 남기지 않는다.
7. auth 승인/revocation, 주문 direct read 최소화, 결제/권한 P0 보정과 법적 페이지 변경까지 포함한 actual release SHA를 확정하기 전 release 검증을 완료로 기록하지 않는다.
8. actual release SHA의 원격 회차 E2E 52건과 cleanup 통과 전 production 배포 금지.
9. Issue #32의 `main` 보호 완료 전 production release 금지.
10. `main` merge·빈 commit·재-push를 production 배포 트리거로 사용하지 않는다.
11. production 배포 직전·직후 provider metadata Git SHA가 승인 release SHA와 동일한지 확인한다.
12. ALIGO 실제 발송 검증 실패 시 알림 없는 출시를 임의 승인하지 않는다.
13. 첫 회차가 검수된 `SCHEDULED`가 아니면 `salesMode`를 전환하지 않는다.
14. `docs/DOCUMENT_CONSISTENCY.md` 기준에서 `IMPLEMENTED / UNVERIFIED`, `COVERAGE GAP`, `IMPLEMENTATION FINDING`, P0 `DECISION REQUIRED`인 항목을 완료로 간주하지 않는다.
15. broad 주문 read를 개인정보처리방침 문구를 넓혀 정당화하지 않고 실제 접근 경계를 먼저 최소화한다.
16. driver role/approval은 client `targetRole` 또는 로그인 side effect만으로 부여하지 않는다.
17. suspended 또는 권한 변경 계정이 refresh/Firebase custom token을 통해 stale 권한을 무기한 연장하지 않도록 revocation 계약을 확정한다.
18. 미검증 항목을 완료로 기록하지 않는다.

## Execution Plan

### Phase 0 — 통합·배포·코드 안전성

#### Task 0.1 — 회차 직배송 코드 `main` 통합
- Status: done
- Evidence: PR #11, 기능 통합 SHA `e55f259...`.

#### Task 0.2 — `main` 자동 production deploy 분리
- Status: done
- Evidence: PR #30, PR #31.
- Verify: 세 Vercel 프로젝트에서 PR #30 merge 이후 `main` deployment 0건.

#### Task 0.3 — GitHub `main` protection/ruleset
- Dependency: 없음. ALIGO 심사와 병렬 가능.
- Goal: direct push/force push/delete를 GitHub 관리자 레벨에서 차단한다.
- Required:
  - PR required
  - `Deployment safety guard / verify` required status check
  - force push 차단
  - branch deletion 차단
- Tracking: Issue #32
- Status: todo_admin

#### Task 0.4 — 결제 finalization `PAID` 최종 방어
- Dependency: 없음. ALIGO 심사·Task 0.3과 병렬 가능.
- Goal: `finalizePaidOrder()`가 호출 경로에 의존하지 않고 비`PAID` provider 상태를 자체 차단한다.
- Required:
  - `PENDING`, `FAILED`, `CANCELLED` 차단
  - `PAID` 일반·공동구매·회차 정상 경로 유지
  - 금액 불일치 처리 유지
  - 회차 reservation/race 회귀 유지
- Contract: `docs/specs/api/payments.md`
- Status: todo_code

#### Task 0.5 — 주문 mutation authorization 직접 회귀
- Dependency: 없음. ALIGO 심사·Task 0.3·0.4와 병렬 가능.
- Goal: 구현된 `assertOrderActionAccess()`의 권한 경계를 직접 거부 테스트로 고정한다.
- Required:
  - 타-store seller의 status mutation 403
  - 타-store seller의 delivery-hold mutation 403
  - 비담당 driver의 assigned order mutation 403
  - 미배정 주문은 `PREPARING → DELIVERING` first-claim만 허용
  - first-claim 성공 시 `driverId` 기록
  - 거부된 mutation의 order write·notification·refund·settlement side effect 0
  - 필요 시 admin 의도된 허용 범위 고정
- Contract: `docs/specs/api/orders.md`
- Status: todo_test

#### Task 0.6 — 주문 direct Firestore read authorization·데이터 최소화
- Dependency: 없음. ALIGO 심사·Task 0.3~0.5와 병렬 가능.
- Goal: 미배정 수거 후보 discovery는 보존하되 seller/driver가 raw `orders` 원문을 필요 이상으로 읽는 구조를 제거한다.
- Required:
  - driver discovery 계약: 미배정 `PREPARING` + `direct|hub` 등 실제 필요한 대상과 최소 노출 필드 확정
  - 임의 driver의 타-driver/완료/기타 arbitrary order raw read 차단
  - assigned driver 상세의 최소 배송 필드만 제공
  - seller 주문 read의 업무상 불필요 `marketingConsent`, `acquisition`, 내부 hash/reservation 메타데이터 노출 제거
  - `firestore.rules` broad `role == 'driver'` 허용 제거 또는 안전 조건으로 대체
  - Rules만으로 필드 최소화가 불가능하면 API DTO/safe projection/민감 필드 분리 중 동등한 구조 적용
  - `tests/firestore/firestore-rules.test.mjs`의 다른 store driver read 성공 기대 제거
  - 허용 discovery, assigned detail, 비담당/임의 read 거부, seller cross-store 거부 직접 테스트
  - seller/driver 정상 보드·상세·first-claim 회귀 유지
- Contract: `docs/specs/api/orders.md`
- Legal dependency: `docs/specs/legal/README.md`
- Status: todo_code_security

#### Task 0.7 — Driver 승인 게이트·세션/claims revocation
- Dependency: 없음. ALIGO 심사·Task 0.3~0.6과 병렬 가능.
- Goal: 관리자 승인 전 driver 권한 획득을 차단하고 정지·role/store/승인 변경이 기존 세션과 Firebase claims에 정의된 시간 안에 수렴하도록 한다.
- Required:
  - 신규 Kakao `targetRole: driver`가 `driverApproved: true`를 자동 획득하지 않음
  - 기존 승인 필드 누락 driver를 로그인 side effect로 자동 승인하지 않음
  - 필요한 legacy migration은 명시적·감사 가능한 별도 절차
  - 승인 전 driver 앱/API/Firebase 접근 거부, 승인 후 정상 진입
  - refresh가 authoritative user 상태를 확인하고 suspended 계정 또는 stale role/store/approval claims를 재발급하지 않음
  - 이미 발급된 access token의 revocation window/SLA 결정·검증
  - 필요 시 token version/session revocation 또는 동등 서버 경계
  - Firebase custom token 발급도 현재 authoritative 권한과 일치
  - logout/rotation 및 consumer/seller/admin 로그인 회귀 유지
  - `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`과 결합 회귀: 승인되지 않은 driver identity가 order discovery/read 권한을 얻지 못함
- Contract: `docs/specs/api/auth.md`
- Admin impact: `docs/specs/api/admin.md`
- Status: todo_code_security

### Phase 1 — ALIGO 알림 게이트

#### Task 1.1 — 발신 프로필·코드 매핑 기반
- Status: done

#### Task 1.2 — 템플릿 8종 최종 승인
- Current: 8종 전부 `검수중`.
- Status: blocked_external_review

#### Task 1.3 — 승인 `tpl_code` 1:1 매핑 검사
- Dependency: Task 1.2
- Status: todo

#### Task 1.4 — 격리 실제 알림톡 정상 발송 [승인 게이트]
- Dependency: Task 1.3
- 실제 고객 발송 금지.
- Status: todo

#### Task 1.5 — SMS fallback 실제 검증 [승인 게이트]
- Dependency: Task 1.4
- Status: todo

### Phase 2 — 판매 공개 계약·release SHA

#### Task 2.1 — 판매 활성화 법적 문서 재정합화
- Dependency: Task 1.5, Task 0.6
- Contract: `docs/specs/legal/README.md`
- Required:
  - 주문 성립·취소·환불·배송·재배송비·배송 보류
  - PortOne/결제사업자 개인정보 처리
  - ALIGO 고객 알림 처리
  - seller/driver 배송정보 접근은 Task 0.6에서 검증된 최소 접근 구조를 기준으로 설명
  - 시행일·이전 버전
  - `legal-documents.test.mjs` 갱신
- Status: todo

#### Task 2.2 — actual release SHA 확정
- Dependency: Task 0.3, Task 0.4, Task 0.5, Task 0.6, Task 0.7, Task 2.1
- Goal: 운영에 올릴 단 하나의 exact `main` SHA 고정.
- 과거 `6e0fc9d...` run은 역사 증거일 뿐 현재 release 증거가 아니다.
- Status: todo

#### Task 2.3 — exact SHA 전체 원격 회차 E2E
- Dependency: Task 2.2
- Goal: chromium 26 + mobile 26 = 52, unexpected/skipped/flaky 0, 양쪽 cleanup 성공.
- Status: todo

#### Task 2.4 — 운영 Firebase 읽기 전용 재조회
- Dependency: Task 2.3
- Status: todo

#### Task 2.5 — 운영 ALIGO 변수·매핑 반영 [승인 게이트]
- Dependency: Task 1.5, Task 2.3
- Goal: 필수 자격 증명 4개 + `ALIGO_TEMPLATE_CODES_JSON`을 비밀값 비공개 방식으로 반영·검증.
- Status: todo

### Phase 3 — exact-SHA production 배포

#### Task 3.0 — production deploy/promotion 절차 확정
- Dependency: Task 2.3
- Goal: 자동 Git main deploy가 아닌 exact SHA/artifact 기반 명시적 배포 절차를 확정한다.
- Required:
  - 입력 release SHA 고정
  - 배포 전 SHA 출력/검사
  - 배포 또는 이미 검증된 artifact promotion
  - 배포 뒤 provider metadata SHA 재검사
  - mismatch 시 domain/traffic 전환 금지
- Note: 현재 저장소에는 production 전용 자동 workflow가 없다.
- Status: todo

#### Task 3.1 — API production 배포 [별도 승인 게이트]
- Dependency: Task 0.3, Task 2.3, Task 2.4, Task 2.5, Task 3.0
- Important: 사용자의 별도 `Task 3.1 승인` 없이는 실행하지 않는다.
- Verify: 배포된 API release identity/SHA를 승인값과 대조.
- Status: todo

#### Task 3.2 — consumer·seller·driver production 배포 [승인 게이트]
- Dependency: Task 3.1
- Goal: 세 프런트를 승인된 동일 release SHA/artifact에서 배포.
- Verify: 각 Vercel deployment metadata의 Git SHA 일치.
- Status: todo

#### Task 3.3 — 운영 무변경 smoke
- Dependency: Task 3.2
- 확인: health, Kakao auth, legacy 경로, 회차 read, `/privacy`, `/terms`.
- Status: todo

#### Task 3.4 — 배포 후 오류 관찰
- Dependency: Task 3.3
- Status: todo

### Phase 4 — 첫 회차

#### Task 4.1 — 첫 회차 `DRAFT` 생성 [승인 게이트]
- Dependency: Task 3.4
- Status: todo

#### Task 4.2 — 일정·지역·상품·가격·한도 검수
- Dependency: Task 4.1
- Status: todo

#### Task 4.3 — `SCHEDULED` 전환 [승인 게이트]
- Dependency: Task 4.2
- Status: todo

### Phase 5 — 최종 출시 판정

#### Task 5.1 — 운영 역할·비상 연락·승인자 확인
- Dependency: Task 4.3
- Status: todo

#### Task 5.2 — 전환·롤백 dry-run
- Dependency: Task 5.1
- 현재 `legacy`, 예정 `round_direct`, 롤백 경로 확인.
- Status: todo

#### Task 5.3 — 최종 출시 판정
- Dependency: Task 5.2
- 대조: exact SHA, auth approval/revocation P0, payment P0, order direct-read P0, order mutation P0, branch protection, Firebase, ALIGO, legal, 첫 회차, 예외, 담당자, rollback.
- Status: todo

### Phase 6 — 판매 모드 전환

#### Task 6.1 — `round_direct` 전환 [최종 승인 게이트]
- Dependency: Task 5.3 승인
- Status: todo

#### Task 6.2 — 전환 직후 smoke·rollback 판정
- Dependency: Task 6.1
- Status: todo

#### Task 6.3 — 외부 유입 링크 공개 [승인 게이트]
- Dependency: Task 6.2 통과
- Status: todo

### Phase 7 — 초기 안정화

#### Task 7.1 — 첫 두 회차 집중 모니터링
- Dependency: Task 6.3
- Status: todo

#### Task 7.2 — 출시 Closeout
- Dependency: Task 7.1
- Status: todo

## Completion Criteria

- driver 관리자 승인 전 권한 획득이 차단되고 정지·role/store/승인 변경의 refresh/Firebase claims 수렴 계약이 구현·직접 검증돼 `main`에 포함됨.
- 주문 direct Firestore read가 안전한 discovery/assigned 경계와 역할별 최소 데이터 계약으로 축소되고 Rules·frontend 회귀가 `main`에 포함됨.
- 결제 finalization 비`PAID` 차단과 회귀 검증이 `main`에 포함됨.
- 주문 mutation authorization 핵심 거부 회귀가 `main`에 포함되고 P0 mutation 권한 계약이 `VERIFIED`로 승격됨.
- Issue #32 branch protection/ruleset 완료.
- ALIGO 8종 최종 승인.
- 실제 알림톡·SMS fallback 검증.
- 판매 활성화 legal docs/test 정합화.
- actual release SHA 원격 E2E 52건+cleanup 성공.
- 운영 Firebase 상태 확인.
- production ALIGO 설정 검증.
- production deploy/promotion이 exact SHA를 사용하고 provider metadata가 일치.
- 첫 회차 `SCHEDULED`.
- 최종 출시 승인 뒤 `round_direct` 전환·smoke 또는 rollback 성공.
- 비밀값·개인정보·사진·서명 URL이 증거에 포함되지 않음.

## 현재 Closeout Roll-up

- 코드 통합: 완료
- driver 승인 게이트·세션/claims revocation: **미완료 — P0 IMPLEMENTATION FINDING / DECISION REQUIRED**
- 주문 direct Firestore read authorization·데이터 최소화: **미완료 — P0 IMPLEMENTATION FINDING**
- 결제 finalization `PAID` 최종 방어: **미완료 — P0**
- 주문 mutation authorization 직접 회귀: **미완료 — P0 COVERAGE GAP**
- repo-side production auto-deploy 분리: 완료
- docs-only Preview/E2E 억제: 완료
- GitHub `main` protection: **미완료 — Issue #32**
- ALIGO 8종 등록: 완료
- ALIGO 8종 승인: **검수중**
- 실제 알림 발송: 미실행
- 판매 활성화 법적 문서: 미실행
- actual release SHA/E2E: 미실행
- production 설정/배포: 미실행
- 첫 회차: 미생성
- `salesMode`: `legacy`
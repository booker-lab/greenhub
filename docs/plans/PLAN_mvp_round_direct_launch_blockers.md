<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

> 현재 실행 계약만 유지한다. 과거 상세 증거는 `docs/plans/REPORT_mvp_round_direct_launch.md`와 Git 이력에서 확인한다.

## 문서 메타

- 최종 정합화: 2026-08-23 KST
- 상태: `paused_external_review_and_internal_p0`
- Priority: P0
- 현재 내부 P0: Issue #37 F-001 driver 승인·주문 접근 보안, Issue #32 `main` protection
- 현재 외부 차단: ALIGO 회차 알림 템플릿 8종 provider 심사
- 현재 상태 SSOT: `docs/memory.md`
- 재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 배포 안전 계약: `docs/plans/PLAN_deployment_safety_guards_20260823.md`
- 판매 활성화 법적 게이트: `docs/specs/legal/README.md`

## 현재 기준선

완료:

- 회차 직배송 MVP PR #11 `main` 통합
- 기능 통합 기준 SHA `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- 카카오 비즈니스 채널 승인
- ALIGO 발신 프로필·senderkey 준비
- ALIGO 템플릿 8종 provider 등록·심사 요청
- repo-side `main → Vercel production` 자동배포 차단: PR #30/#31

미완료:

- Issue #37 F-001 remediation의 `main` 통합
- Issue #32 GitHub `main` branch protection/ruleset
- ALIGO 8종 최종 승인 및 실제 알림 검증
- 판매 활성화 legal docs/test
- actual release SHA 52 E2E+cleanup
- production ALIGO 설정
- exact-SHA production deploy
- 첫 운영 회차와 `salesMode` 전환

`salesMode`는 최신 운영 확인 기준 `legacy`다.

## F-001 현재 main 판정

2026-08-23 current `main` 직접 재검증:

- 신규 Kakao driver → `driverApproved: true`
- 승인 필드 없는 기존 driver → 로그인 시 자동 `true`
- `/driver/orders` → `@Roles('driver', 'seller')`
- `DriverService.getOrders(driverId, ...)` → driverId 미필터, 상태 조건 전체 주문 반환
- Firestore `orders` read → role이 driver이면 전체 허용
- custom token/Rules에서 최신 `driverApproved`/`suspended` enforcement 불충분

따라서 관리자가 승인한 driver만 제한된 주문에 접근한다는 목표 보안 계약은 현재 `main`에서 완료되지 않았다.

추적: Issue #37.

**Issue #37 완료 전 actual release SHA를 고정하지 않는다.**

## 배포 안전 기준선

- 세 프런트 `git.deploymentEnabled.main=false`
- docs-only `main` push의 Preview sync/E2E 제외
- docs-only Vercel build skip
- deployment safety CI
- direct `main` 작업 금지

GitHub 관리자 enforcement는 Issue #32가 남아 있다.

`main` merge는 production 배포 수단이 아니다. production은 검증된 exact release SHA/artifact를 명시적으로 deploy/promote한다.

## 출시 게이트 요약

| 순서 | 게이트 | 상태 |
|---|---|---|
| 0 | repo-side 자동배포 차단 | 완료 |
| 0A | F-001 driver 보안 remediation `main` 통합 | **미완료 — Issue #37** |
| 0B | GitHub `main` protection/ruleset | **미완료 — Issue #32** |
| 1 | ALIGO 8종 provider 최종 승인 | **검수중** |
| 2 | 실제 알림톡 정상 발송 | 미실행 |
| 3 | SMS fallback 실제 검증 | 미실행 |
| 4 | 판매 활성화 legal docs/test | 미실행 |
| 5 | actual release SHA 확정 | 미실행 |
| 6 | exact SHA 원격 회차 E2E 52건+cleanup | 미실행 |
| 7 | 운영 Firebase 재조회 | 미실행 |
| 8 | 운영 ALIGO 설정 | 미실행 |
| 9 | exact-SHA production 배포 | 미실행 — 별도 Task 3.1 승인 |
| 10 | 첫 회차 검수 | 미실행 |
| 11 | 최종 출시 판정 | 미실행 |
| 12 | `round_direct` 전환 | 미실행 |

## Agent Completion Contract

1. repository 변경은 최신 `main`에서 목적별 branch를 만들고 PR로 통합한다.
2. direct `main` commit/push 금지.
3. Issue #37과 Issue #32는 ALIGO 심사와 병렬로 해결 가능하다.
4. Issue #37 완료 전 release SHA 고정 금지.
5. 외부 서비스·실제 발송·운영 변수·Firebase 운영 변경·production deploy·운영 데이터·`salesMode` 변경은 별도 승인 게이트를 따른다.
6. 비밀값·고객 개인정보·사진 원본·서명 URL을 Git/문서에 남기지 않는다.
7. actual release SHA E2E 52건+cleanup 전 production deploy 금지.
8. Issue #32 완료 전 production release 금지.
9. `main` merge·빈 commit·재-push를 production deploy trigger로 사용하지 않는다.
10. production 배포 전후 provider metadata Git SHA가 승인 release SHA와 일치해야 한다.
11. ALIGO 실제 발송 검증 실패 시 알림 없는 출시를 임의 승인하지 않는다.
12. 첫 회차가 검수된 `SCHEDULED`가 아니면 `salesMode` 전환 금지.

## Execution Plan

### Phase 0 — 내부 P0와 통합 안전성

#### Task 0.1 — 회차 직배송 코드 통합
- Status: done
- Evidence: PR #11, 기능 통합 SHA `e55f259...`

#### Task 0.2 — `main` 자동 production deploy 분리
- Status: done
- Evidence: PR #30/#31, 반복 docs-only merge 신규 Vercel deployment 0건

#### Task 0.3 — F-001 driver 승인·주문 접근 remediation
- Dependency: 없음
- Tracking: Issue #37
- Required:
  - 신규 driver `driverApproved: false`
  - API 요청에서 승인·정지 최신 재검증
  - Firebase token/Rules 최신 상태 재검증
  - `/driver/orders` driver 전용
  - 미배정 선점 가능 + 본인 배정 주문만 서버 필터
  - 주문 선점 transaction
  - suspend/refresh/session 무효화 검증
  - API/Rules tests
  - 최신 `main` 기준 PR 통합
- Status: todo_p0

#### Task 0.4 — GitHub `main` protection/ruleset
- Dependency: 없음
- Tracking: Issue #32
- Required: PR required, safety verify required check, force push/delete 차단
- Status: todo_admin

### Phase 1 — ALIGO 알림 게이트

#### Task 1.1 — 템플릿 8종 최종 승인
- Current: 8종 전부 `검수중`
- Status: blocked_external_review

#### Task 1.2 — 승인 tpl_code 매핑 검사
- Dependency: 8종 승인
- Status: todo

#### Task 1.3 — 격리 실제 알림톡 정상 발송 [승인 게이트]
- Dependency: Task 1.2
- Status: todo

#### Task 1.4 — SMS fallback 실제 검증 [승인 게이트]
- Dependency: Task 1.3
- Status: todo

### Phase 2 — 판매 공개 계약과 release SHA

#### Task 2.1 — legal docs/test 재정합화
- Dependency: 실제 알림 검증
- Contract: `docs/specs/legal/README.md`
- Status: todo

#### Task 2.2 — actual release SHA 확정
- Dependency: Task 0.3, Task 0.4, Task 2.1
- Goal: 운영에 올릴 단 하나의 exact `main` SHA 고정
- Status: todo

#### Task 2.3 — exact SHA 원격 회차 E2E
- Dependency: Task 2.2
- Goal: chromium 26 + mobile 26 = 52, cleanup 성공
- Status: todo

#### Task 2.4 — 운영 Firebase 읽기 전용 재조회
- Dependency: Task 2.3
- 확인: indexes, Firestore Rules, Storage Rules 및 F-001 보안 rules 실제 반영 상태
- Status: todo

#### Task 2.5 — 운영 ALIGO 변수·매핑 반영 [승인 게이트]
- Dependency: 실제 알림 검증, Task 2.3
- Status: todo

### Phase 3 — exact-SHA production 배포

#### Task 3.0 — deploy/promotion 절차 확정
- Dependency: Task 2.3
- Goal: exact SHA/artifact 기반 명시적 배포 및 metadata SHA 검사
- Status: todo

#### Task 3.1 — API production 배포 [별도 승인 게이트]
- Dependency: Task 0.3, Task 0.4, Task 2.3, Task 2.4, Task 2.5, Task 3.0
- 별도 `Task 3.1 승인` 필수
- Status: todo

#### Task 3.2 — 세 프런트 production 배포 [승인 게이트]
- Dependency: Task 3.1
- 동일 승인 release SHA 사용
- Status: todo

#### Task 3.3 — 운영 무변경 smoke
- Dependency: Task 3.2
- health, auth, legacy, round-direct read, legal pages
- Status: todo

### Phase 4 — 첫 회차와 출시

1. 첫 회차 `DRAFT` 생성 [승인]
2. 일정·지역·상품·가격·한도 검수
3. `SCHEDULED` 전환 [승인]
4. 운영 역할·비상 연락·rollback dry-run
5. 최종 출시 판정
6. `salesMode: round_direct` 전환 [최종 승인]
7. 전환 직후 smoke
8. 외부 유입 링크 공개 [승인]
9. 첫 두 회차 집중 모니터링·Closeout

## Completion Criteria

- Issue #37 F-001 remediation `main` 통합 및 검증 완료
- Issue #32 branch protection/ruleset 완료
- ALIGO 8종 최종 승인
- 실제 알림톡·SMS fallback 검증
- 판매 활성화 legal docs/test 정합화
- actual release SHA E2E 52건+cleanup 성공
- 운영 Firebase와 F-001 Rules 상태 확인
- production ALIGO 설정 검증
- exact-SHA production deploy 및 metadata SHA 일치
- 첫 회차 검수 완료
- 최종 출시 승인과 rollback 준비 완료

이 조건 중 하나라도 미충족이면 `salesMode`를 전환하지 않는다.
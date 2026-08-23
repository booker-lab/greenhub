<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

> 현재 실행 순서·의존성·승인 게이트만 관리한다. 현재 상태는 `docs/memory.md`, 세부 미완료·Acceptance Criteria는 `docs/BACKLOG.md`, 도메인 계약은 각 current spec을 따른다.

## 문서 메타

- 작성일: 2026-07-28
- 최종 정합화: 2026-08-24 KST
- 상태: `paused_external_review`
- Priority: P0
- 현재 외부 차단점: ALIGO 회차 알림 템플릿 8종 provider 심사 완료
- 현재 상태 SSOT: `docs/memory.md`
- 현재 재개 지점: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 미완료 상세: `docs/BACKLOG.md`
- 인증 계약: `docs/specs/api/auth.md`
- 주문 계약: `docs/specs/api/orders.md`
- 결제 계약: `docs/specs/api/payments.md`
- 정산 계약: `docs/specs/api/settlements.md`
- 관리자 계약: `docs/specs/api/admin.md`
- 판매 활성화 법적 게이트: `docs/specs/legal/README.md`
- 배포 안전 계약: `docs/plans/PLAN_deployment_safety_guards_20260823.md`

## 현재 출시 게이트

| ID | 게이트 | 상태 |
|---|---|---|
| 0A | GitHub `main` branch protection/ruleset | 미완료 — Issue #32 |
| 0B | 결제 finalization 비`PAID` 최종 차단 | 미완료 — P0 |
| 0C | 주문 mutation authorization 직접 거부 회귀 | 미완료 — P0 COVERAGE GAP |
| 0D | 주문 direct Firestore read authorization·데이터 최소화 | 미완료 — P0 IMPLEMENTATION FINDING |
| 0E | driver 승인 게이트 + 세션/claims revocation | 미완료 — P0 IMPLEMENTATION FINDING / DECISION REQUIRED |
| 0F | admin 강제 환불 lifecycle 정합성 | 미완료 — P0 IMPLEMENTATION FINDING |
| 1 | ALIGO 8종 provider 최종 승인 | 검수중 |
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
| 12 | `salesMode: round_direct` 전환 | 미실행 |

## Agent Completion Contract

1. 모든 repository 변경은 최신 `main`에서 목적별 branch를 만들고 PR로 통합한다.
2. direct `main` commit/push를 하지 않는다.
3. Task 0A~0F는 ALIGO 심사와 병렬 수행할 수 있다.
4. 문서 정합성 감사에서 발견한 P0 구현 결함을 문구 변경만으로 정상화하지 않는다.
5. `IMPLEMENTED / UNVERIFIED`, `COVERAGE GAP`, `IMPLEMENTATION FINDING`, P0 `DECISION REQUIRED`는 완료가 아니다.
6. 비밀값·고객 개인정보·사진 원본·서명 URL을 Git/문서/증거에 남기지 않는다.
7. actual release SHA는 Task 0A~0F와 법적 게이트가 모두 해결된 뒤에만 확정한다.
8. exact release SHA의 원격 회차 E2E 52건과 cleanup 통과 전 production 배포 금지.
9. `main` merge·빈 commit·재-push를 production 배포 트리거로 사용하지 않는다.
10. production 배포는 검증된 exact SHA/artifact와 별도 승인 게이트를 사용한다.
11. provider metadata Git SHA가 승인 release SHA와 다르면 traffic/domain 전환을 진행하지 않는다.
12. ALIGO 실제 발송 검증 실패 시 알림 없는 출시를 임의 승인하지 않는다.
13. 첫 회차가 검수된 `SCHEDULED`가 아니면 `salesMode`를 전환하지 않는다.

## Phase 0 — 출시 전 코드·권한·금전 안전성

### Task 0.1 — 회차 직배송 코드 `main` 통합
- Status: done
- Evidence: PR #11, 기능 통합 기준 SHA `e55f25914cc7d01576fbd4639583daaf0fe6385e`.

### Task 0.2 — `main` 자동 production deploy 분리
- Status: done
- Evidence: PR #30, PR #31.

### Task 0.3 — GitHub `main` protection/ruleset
- Dependency: 없음.
- Required: PR required, `Deployment safety guard / verify`, force-push/delete 차단.
- Tracking: Issue #32.
- Status: todo_admin

### Task 0.4 — 결제 finalization `PAID` 최종 방어
- Dependency: 없음.
- Goal: `finalizePaidOrder()`가 호출자에 의존하지 않고 비`PAID` provider 상태를 차단한다.
- Verify: `PENDING`, `FAILED`, `CANCELLED`, `PAID`, 금액 불일치, legacy/group/round 경로.
- Contract: `docs/specs/api/payments.md`
- Backlog: `PAYMENT-FINALIZATION-PAID-GUARD`
- Status: todo_code

### Task 0.5 — 주문 mutation authorization 직접 회귀
- Dependency: 없음.
- Goal: seller 타-store, 비담당 driver, 미배정 first-claim 경계와 거부 side-effect 0을 직접 고정한다.
- Contract: `docs/specs/api/orders.md`
- Backlog: `ORDER-MUTATION-AUTHORIZATION-COVERAGE`
- Status: todo_test

### Task 0.6 — 주문 direct Firestore read authorization·데이터 최소화
- Dependency: 없음.
- Goal: 필요한 미배정 주문 discovery는 유지하되 arbitrary raw order read와 역할에 불필요한 필드 노출을 제거한다.
- Verify: Rules + app/API 정상 discovery/assigned detail + 타주문/타store 거부.
- Contract: `docs/specs/api/orders.md`
- Legal dependency: `docs/specs/legal/README.md`
- Backlog: `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`
- Status: todo_code_security

### Task 0.7 — Driver 승인 게이트·세션/claims revocation
- Dependency: 없음.
- Goal: 관리자 승인 전 driver 권한 획득을 차단하고, suspension/role/store/approval 변경이 정의된 revocation window 안에 API·Firebase claims에 수렴하도록 한다.
- Verify: 신규/legacy 자동 승인 제거, 승인 전후 접근, refresh/current claims, logout/rotation 회귀.
- Contract: `docs/specs/api/auth.md`, `docs/specs/api/admin.md`
- Backlog: `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`
- Coupling: Task 0.6 broad driver read와 결합 회귀를 확인한다.
- Status: todo_code_security

### Task 0.8 — Admin 강제 환불 lifecycle 정합화
- Dependency: 없음.
- Goal: `POST /admin/orders/:orderId/refund`가 provider 본 결제 환불과 주문 `CANCELLED` 직접 write만 수행해 정상 cancellation orchestration을 우회하는 구조를 제거한다.
- Required:
  - admin 환불의 허용 주문 상태를 명시하고 완료/배송 중 등 비의도 상태를 fail-closed
  - 본 결제 환불과 이미 결제된 재배송비/추가 charge 처리 정책 일치
  - 회차 주문 `reservationId` release와 sale-round/item ordered counter 반환
  - `DELIVERY_HELD` 취소 시 `heldOrderCount` 정합성 유지
  - 연결 settlement의 `pending|confirmed → cancelled` 수렴
  - 이미 `paid` settlement인 주문 환불은 단순 `paid → cancelled` 역전이 아닌 별도 회계 조정 정책 결정
  - provider 환불 성공 뒤 local cancellation 실패 시 재시도 가능한 cancellation state/operation issue 또는 동등 복구 계약
  - seller/consumer/round cancellation과 admin force-refund 동시 실행이 이중환불·이중 capacity release 없이 수렴
  - 거부/실패 경로의 부수효과를 직접 테스트
- Contract: `docs/specs/api/admin.md`, `docs/specs/api/payments.md`, `docs/specs/api/settlements.md`, `docs/specs/api/orders.md`
- Backlog: `ADMIN-FORCE-REFUND-CONSISTENCY`
- Status: todo_code_financial

## Phase 1 — ALIGO 알림 게이트

### Task 1.1 — 발신 프로필·코드 매핑 기반
- Status: done

### Task 1.2 — 템플릿 8종 최종 승인
- Current: 상태 상세는 `docs/memory.md`.
- Status: blocked_external_review

### Task 1.3 — 승인 `tpl_code` 1:1 매핑 검사
- Dependency: Task 1.2
- Status: todo

### Task 1.4 — 격리 실제 알림톡 정상 발송 [승인 게이트]
- Dependency: Task 1.3
- Status: todo

### Task 1.5 — SMS fallback 실제 검증 [승인 게이트]
- Dependency: Task 1.4
- Status: todo

## Phase 2 — 판매 공개 계약·release SHA

### Task 2.1 — 판매 활성화 법적 문서 재정합화
- Dependency: Task 1.5, Task 0.6, Task 0.8
- Required: 실제 주문·취소·환불·배송·재배송비·보류, PortOne/결제사업자, ALIGO, seller/driver 최소 접근, 시행일·이전 버전, legal tests.
- Contract: `docs/specs/legal/README.md`
- Status: todo

### Task 2.2 — actual release SHA 확정
- Dependency: Task 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, Task 2.1
- Goal: 운영에 올릴 단 하나의 exact `main` SHA 고정.
- Status: todo

### Task 2.3 — exact SHA 전체 원격 회차 E2E
- Dependency: Task 2.2
- Goal: chromium 26 + mobile 26 = 52, unexpected/skipped/flaky 0, 양쪽 cleanup 성공.
- Status: todo

### Task 2.4 — 운영 Firebase 읽기 전용 재조회
- Dependency: Task 2.3
- Status: todo

### Task 2.5 — 운영 ALIGO 변수·매핑 반영 [승인 게이트]
- Dependency: Task 1.5, Task 2.3
- Status: todo

## Phase 3 — exact-SHA production 배포

### Task 3.0 — production deploy/promotion 절차 확정
- Dependency: Task 2.3
- Goal: exact SHA/artifact 기반 명시적 배포·promotion과 사후 SHA 검증.
- Status: todo

### Task 3.1 — API production 배포 [별도 승인 게이트]
- Dependency: Task 0.3, Task 2.3, Task 2.4, Task 2.5, Task 3.0
- Important: 사용자의 별도 `Task 3.1 승인` 없이는 실행하지 않는다.
- Status: todo

### Task 3.2 — consumer·seller·driver production 배포 [승인 게이트]
- Dependency: Task 3.1
- Status: todo

### Task 3.3 — 운영 무변경 smoke
- Dependency: Task 3.2
- 확인: health, Kakao auth, legacy, 회차 read, `/privacy`, `/terms`.
- Status: todo

### Task 3.4 — 배포 후 오류 관찰
- Dependency: Task 3.3
- Status: todo

## Phase 4 — 첫 회차

### Task 4.1 — 첫 회차 `DRAFT` 생성 [승인 게이트]
- Dependency: Task 3.4
- Status: todo

### Task 4.2 — 일정·지역·상품·가격·한도 검수
- Dependency: Task 4.1
- Status: todo

### Task 4.3 — `SCHEDULED` 전환 [승인 게이트]
- Dependency: Task 4.2
- Status: todo

## Phase 5 — 최종 출시 판정

### Task 5.1 — 운영 역할·비상 연락·승인자 확인
- Dependency: Task 4.3
- Status: todo

### Task 5.2 — 전환·롤백 dry-run
- Dependency: Task 5.1
- Status: todo

### Task 5.3 — 최종 출시 판정
- Dependency: Task 5.2
- 대조: exact SHA, Task 0A~0F, Firebase, ALIGO, legal, 첫 회차, 운영 예외, rollback.
- Status: todo

## Phase 6 — 판매 모드 전환

### Task 6.1 — `round_direct` 전환 [최종 승인 게이트]
- Dependency: Task 5.3 승인
- Status: todo

### Task 6.2 — 전환 직후 smoke·rollback 판정
- Dependency: Task 6.1
- Status: todo

### Task 6.3 — 외부 유입 링크 공개 [승인 게이트]
- Dependency: Task 6.2 통과
- Status: todo

## Phase 7 — 초기 안정화

### Task 7.1 — 첫 두 회차 집중 모니터링
- Dependency: Task 6.3
- Status: todo

### Task 7.2 — 출시 Closeout
- Dependency: Task 7.1
- Status: todo

## Completion Criteria

- Task 0A~0F가 모두 해결되고 P0 권한·금전 계약이 필요한 직접 테스트 증거와 함께 `main`에 포함됨.
- admin 강제 환불이 정상 주문 취소와 동일한 금전·capacity·settlement 불변식을 보존하거나, 예외 정책이 명시적·테스트된 별도 orchestration으로 구현됨.
- Issue #32 branch protection/ruleset 완료.
- ALIGO 8종 최종 승인 및 실제 알림톡·SMS fallback 검증.
- 판매 활성화 legal docs/test 정합화.
- actual release SHA 원격 E2E 52건+cleanup 성공.
- 운영 Firebase 상태 확인 및 production ALIGO 설정 검증.
- production deploy/promotion이 exact SHA를 사용하고 provider metadata가 일치.
- 첫 회차 `SCHEDULED`.
- 최종 승인 뒤 `round_direct` 전환·smoke 또는 rollback 성공.
- 비밀값·개인정보·사진·서명 URL이 증거에 포함되지 않음.

## 현재 Closeout Roll-up

- 코드 통합: 완료
- driver 승인 게이트·세션/claims revocation: 미완료 — P0
- 주문 direct Firestore read authorization·데이터 최소화: 미완료 — P0
- 결제 finalization `PAID` 최종 방어: 미완료 — P0
- 주문 mutation authorization 직접 회귀: 미완료 — P0
- admin 강제 환불 lifecycle 정합성: 미완료 — P0
- repo-side production auto-deploy 분리: 완료
- GitHub `main` protection: 미완료 — Issue #32
- ALIGO 8종 승인: 검수중
- 실제 알림 발송: 미실행
- 판매 활성화 법적 문서: 미실행
- actual release SHA/E2E: 미실행
- production 설정/배포: 미실행
- 첫 회차: 미생성
- `salesMode`: `legacy`

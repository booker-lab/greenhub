<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

> 이 문서는 현재 재개 순서만 유지한다. 과거 출시 준비 상세 증거는 `docs/plans/REPORT_mvp_round_direct_launch.md`와 Git 이력에서 확인한다.

## 현재 상태 — 2026-08-23 KST

회차 직배송 MVP 코드는 PR #11을 통해 `main`에 통합됐다. 통합 기준 SHA는 `e55f25914cc7d01576fbd4639583daaf0fe6385e`이며, 병합 직후 기존 개발 branch `codex/mvp-sales-round-direct`와 `main`은 동일했다. 이후 문서 정합화 commit은 `main`에 추가될 수 있다.

카카오 비즈니스 채널 승인, ALIGO 발신 프로필 1건 등록, `senderkey` 발급, 내부 논리 코드↔ALIGO `tpl_code` 분리와 필수 본문 변수 검증 구현까지 완료됐다. 실제 도달 가능한 회차 알림 템플릿 8종은 2026-08-23 provider에 신규 등록·심사 요청됐고 현재 모두 `검수중`이다.

따라서 현재 차단점은 **템플릿 등록 자체가 아니라 8종의 provider 심사 완료**다. 심사 완료 전 실제 알림톡·SMS 발송, 운영 ALIGO 변수 반영, 운영 애플리케이션 배포, 첫 회차 생성, `salesMode` 전환을 진행하지 않는다.

## Git·통합 상태

- 저장소: `booker-lab/greenhub`
- 기본 브랜치: `main`
- 통합 완료 branch: `codex/mvp-sales-round-direct`
- 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- PR #11: `MERGED`·`CLOSED`
- 병합 직후 비교: `main` ↔ `codex/mvp-sales-round-direct` = `identical`, ahead 0 / behind 0
- PR #11의 과거 본문은 ALIGO 등록 전 상태를 담고 있으므로 현재 상태 SSOT로 사용하지 않는다.
- 신규 코드 작업은 최신 `main`에서 목적별 새 branch를 만드는 것을 기본으로 한다.

## 현재 운영 상태

| 항목 | 상태 |
|---|---|
| 회차 직배송 코드 | `main` 통합 완료 |
| 카카오 비즈니스 채널 | 최종 승인 완료 |
| consumer 법적 고지 | main·production 반영 및 운영 검증 완료 |
| ALIGO 발신 프로필 | 정상 1건 |
| `senderkey` | 발급 완료, 원문 미기록 |
| 내부↔외부 템플릿 코드 분리 | 구현 완료 |
| 필수 본문 변수 검증 | 구현 완료 |
| 회차 알림 템플릿 8종 | **등록 완료·전부 검수중** |
| 실제 알림톡 정상 발송 | 미실행 |
| SMS fallback 검증 | 미실행 |
| 운영 ALIGO 자격 증명 4개 | 미반영 |
| `ALIGO_TEMPLATE_CODES_JSON` | 운영 미반영 |
| 운영 Firebase 인덱스·Firestore·Storage 규칙 | 반영 완료 상태 |
| 회차 출시 후보 운영 앱 배포 | 미실행 |
| 첫 운영 회차 | 미생성 |
| `salesMode` | `legacy` 유지 |

## ALIGO 템플릿 심사 현황

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

- 신규 등록·심사 요청: 8종
- 중복·오류·반려: 없음
- 대체 SMS 사용: 없음
- 실제 알림톡·SMS 발송: 0건
- 비밀값 원문은 기록하지 않는다.

## 검증 기준

- 마지막 전체 원격 회차 E2E 성공 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`
- chromium 26건 + mobile 26건 = 총 52건 성공
- 양쪽 fixture cleanup 성공
- 이후 commit에 이 과거 run을 그대로 확장 적용하지 않는다.
- 운영 배포 전에 **실제 출시 대상 SHA**에서 전체 원격 회차 E2E와 cleanup을 다시 통과해야 한다.

## 지금 하지 말아야 할 작업

- 심사 중 템플릿을 중복 등록하거나 임의 수정하지 않는다.
- 승인 전 실제 알림톡·SMS를 발송하지 않는다.
- ALIGO 자격 증명이나 `tpl_code` 원문을 문서·Git에 기록하지 않는다.
- 별도 승인 없이 Railway·Vercel production을 배포하거나 재배포하지 않는다.
- 별도 승인 없이 Firebase 운영 상태를 변경하지 않는다.
- 운영 회차를 만들거나 `salesMode`를 변경하지 않는다.
- 과거 PR #11을 다시 활성 통합 경로로 취급하지 않는다.

## 재개 순서

1. ALIGO 템플릿 8종의 심사 결과를 확인한다.
2. 8종 모두 승인됐는지, 수정 요청·반려·중복이 없는지 기록한다.
3. 승인 결과에 따라 실제 `tpl_code` 매핑 준비상태를 값 비공개 방식으로 검증한다.
4. 별도 사용자 승인 후 격리된 승인 수신자에게 실제 알림톡 정상 발송을 검증한다.
5. 별도 사용자 승인 후 SMS fallback을 검증한다.
6. 실제 출시 대상 SHA를 확정하고 해당 SHA에서 전체 원격 회차 E2E 52건과 fixture cleanup을 다시 통과시킨다.
7. 별도 사용자 승인 후 운영 ALIGO 자격 증명 4개와 `ALIGO_TEMPLATE_CODES_JSON`을 반영하고 존재·매핑 검사를 통과시킨다.
8. `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`의 Task 3.1 승인 게이트를 다시 확인한다.
9. 사용자의 별도 `Task 3.1 승인`이 있을 때만 운영 API·프런트 배포 단계로 진행한다.
10. 이후 첫 회차 검수 → 최종 출시 판정 → `salesMode` 전환은 각 게이트별 승인 후 순차 진행한다.

## 재개 완료 조건

- [x] consumer 개인정보처리방침·이용약관 main·production 반영 및 운영 검증
- [x] 카카오 비즈니스 채널 최종 승인
- [x] 회차 직배송 코드 `main` 통합
- [x] ALIGO 발신 프로필과 `senderkey` 준비
- [x] 내부↔외부 템플릿 코드 분리와 필수 본문 변수 검증 구현
- [x] 회차 알림 템플릿 8종 provider 등록·심사 요청
- [ ] 회차 알림 템플릿 8종 최종 승인
- [ ] 실제 알림톡 정상 발송 검증 통과
- [ ] SMS fallback 검증 통과
- [ ] 실제 출시 대상 SHA 전체 원격 회차 E2E·cleanup 통과
- [ ] 운영 ALIGO 자격 증명 4개와 템플릿 코드 매핑 검사 통과
- [ ] Task 3.1 별도 승인

미완료 조건을 충족하기 전에는 회차 출시 후보를 운영에 배포하거나 `salesMode`를 전환하지 않는다.

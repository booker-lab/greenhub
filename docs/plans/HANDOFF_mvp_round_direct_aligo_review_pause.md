<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

> 현재 재개 순서만 유지한다. 과거 출시 준비 상세 증거는 `docs/plans/REPORT_mvp_round_direct_launch.md`와 Git 이력에서 확인한다.

## 현재 상태 — 2026-08-23 KST

회차 직배송 MVP 코드는 PR #11을 통해 `main`에 통합됐다. 기능 통합 기준 SHA는 `e55f25914cc7d01576fbd4639583daaf0fe6385e`다. 기존 `codex/mvp-sales-round-direct`는 통합 완료 branch로 취급한다.

카카오 비즈니스 채널 승인, ALIGO 발신 프로필, `senderkey`, 내부 논리 템플릿↔provider `tpl_code` 분리와 필수 변수 검증까지 완료됐다. 회차 알림 템플릿 8종은 2026-08-23 provider에 등록·심사 요청됐고 현재 모두 `검수중`이다.

따라서 **현재 즉시 차단점은 ALIGO 8종 provider 심사 완료**다. 다만 심사가 끝난 뒤 곧바로 release SHA를 고정하면 안 된다. 현재 공개 `/terms`, `/privacy`는 2026-08-19의 비판매 상태를 전제로 하므로 실제 판매 공개 전에 법적 문서·공개 페이지 재정합화가 필요하다.

## 현재 운영 상태

| 항목 | 상태 |
|---|---|
| 회차 직배송 코드 | `main` 통합 완료 |
| 카카오 비즈니스 채널 | 최종 승인 완료 |
| consumer 법적 고지 | **비판매 상태 버전 production 반영 완료; 판매 활성화 전 개정 필요** |
| ALIGO 발신 프로필 | 정상 1건 |
| `senderkey` | 발급 완료 |
| 회차 알림 템플릿 8종 | 등록 완료·전부 `검수중` |
| 실제 알림톡 정상 발송 | 미실행 |
| SMS fallback 검증 | 미실행 |
| 운영 ALIGO 자격 증명·매핑 | 미반영 |
| 운영 Firebase Rules·indexes | 이전 준비에서 반영 완료 상태 |
| 회차 출시 후보 production 배포 | 미실행 |
| 첫 운영 회차 | 미생성 |
| `salesMode` | `legacy` 유지 |

## 법적 공개 문서 주의

현재 이용약관과 개인정보처리방침은 다음 전제를 명시한다.

- 현재 상용 주문·결제·배송을 운영하지 않음
- PortOne·결제사업자를 현재 상용 처리 수탁자로 운영하지 않음
- 실제 고객 ALIGO 알림 공급자 처리는 별도 현재 공개 고지에 반영되지 않음

따라서 판매 활성화 전 `docs/specs/legal/README.md`의 P0 게이트를 수행한다. 이 변경은 consumer 법적 페이지 코드와 테스트를 바꾸므로 **실제 출시 대상 SHA를 확정하기 전에** 끝내야 한다.

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

- 중복·오류·반려: 없음
- 실제 알림톡·SMS 발송: 0건
- 비밀값 원문은 기록하지 않는다.

## 검증 기준

- 마지막 전체 원격 회차 E2E 성공 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`
- chromium 26 + mobile 26 = 52건, fixture cleanup 성공
- 과거 run은 현재 release SHA 검증을 대신하지 않는다.

## 지금 하지 말아야 할 작업

- 심사 중 템플릿을 중복 등록하거나 임의 수정하지 않는다.
- 승인 전 실제 알림톡·SMS를 발송하지 않는다.
- ALIGO 자격 증명·`tpl_code` 원문을 문서·Git에 기록하지 않는다.
- 별도 승인 없이 production 배포·환경 변수·Firebase·운영 데이터를 변경하지 않는다.
- 운영 회차를 만들거나 `salesMode`를 변경하지 않는다.
- 현재 비판매 약관을 그대로 둔 채 판매기능을 공개하지 않는다.
- 반대로 판매가 아직 공개되지 않았는데 약관을 임의로 `현재 판매 중` 상태로 선반영하지 않는다.

## 재개 순서

1. ALIGO 템플릿 8종의 심사 결과를 확인한다.
2. 8종 모두 승인됐는지, 수정 요청·반려가 없는지 기록한다.
3. 승인된 실제 `tpl_code`와 논리 템플릿 8종의 매핑 준비상태를 값 비공개 방식으로 검증한다.
4. 별도 승인 후 격리 수신자 실제 알림톡 정상 발송을 검증한다.
5. 별도 승인 후 SMS fallback을 검증한다.
6. **판매 활성화 법적 문서 재정합화**를 수행한다: `/terms`, `/privacy`, PortOne/결제사업자, ALIGO 고객 알림, 배송정보 접근, 취소·환불·배송 정책, 시행일·이전 버전, 법적 문서 테스트를 실제 MVP와 일치시킨다.
7. 법적 페이지 변경까지 포함된 실제 출시 대상 `main` SHA를 확정한다.
8. 해당 SHA에서 전체 원격 회차 E2E 52건과 fixture cleanup을 통과시킨다.
9. 운영 Firebase 상태를 읽기 전용 재확인한다.
10. 별도 승인 후 운영 ALIGO 자격 증명·매핑을 반영한다.
11. `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`의 Task 3.1 승인 게이트를 확인한다.
12. 사용자의 별도 `Task 3.1 승인`이 있을 때만 production 배포로 진행한다.
13. 배포 후 새 `/privacy`, `/terms`를 포함한 무변경 smoke → 첫 회차 검수 → 최종 출시 판정 → `salesMode` 전환 순으로 진행한다.

## 재개 완료 조건

- [x] 카카오 비즈니스 채널 최종 승인
- [x] 회차 직배송 코드 `main` 통합
- [x] ALIGO 발신 프로필·`senderkey` 준비
- [x] 회차 알림 템플릿 8종 provider 등록·심사 요청
- [ ] 회차 알림 템플릿 8종 최종 승인
- [ ] 실제 알림톡 정상 발송 검증
- [ ] SMS fallback 검증
- [ ] **판매 활성화용 개인정보처리방침·이용약관 재정합화**
- [ ] 법적 페이지를 포함한 실제 출시 대상 SHA 확정
- [ ] 해당 SHA 전체 원격 회차 E2E·cleanup 통과
- [ ] 운영 ALIGO 설정·템플릿 매핑 검사 통과
- [ ] Task 3.1 별도 승인

미완료 조건을 충족하기 전에는 회차 출시 후보를 production에 공개하거나 `salesMode`를 전환하지 않는다.

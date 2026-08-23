<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 완료 이력과 상세 증거는 기본 Context로 읽지 않는다.

## 검증 기준

- Git·GitHub 직접 재검증: `2026-08-23 KST`
- 외부 환경 상태 기준: `2026-08-23 KST`
- GitHub PR #11 병합 상태와 `main`↔기존 회차 branch 비교를 직접 재조회했다.
- ALIGO 템플릿 상태는 2026-08-23 provider 등록 결과를 기준으로 한다.
- Firebase·Railway·Vercel 운영 상태와 `salesMode`는 활성 HANDOFF의 최신 확인 결과를 사용한다. 별도 승인 없이 외부 운영 상태를 변경하지 않는다.

## Git 기준선

- 저장소: `booker-lab/greenhub`
- 기본 브랜치: `main`
- 회차 직배송 개발 branch: `codex/mvp-sales-round-direct`
- 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- PR #11은 2026-08-23 KST에 `MERGED`·`CLOSED` 됐다.
- 병합 직후 `main`과 `codex/mvp-sales-round-direct`는 `e55f25914cc7d01576fbd4639583daaf0fe6385e`에서 `identical`(`ahead 0 / behind 0`)이었다.
- 이 문서를 포함한 후속 문서 정합화 commit은 `main`을 기능 통합 기준 SHA보다 앞서게 할 수 있으므로, 새 코드 작업을 시작할 때는 현재 `main` HEAD를 다시 확인한다.
- 기존 회차 branch는 통합 완료 branch로 취급하며 새 기능 작업의 장기 기준 branch로 사용하지 않는다. 새 작업은 목적별 새 branch를 만드는 것을 기본으로 한다.

## 제품 현재 상태

- 회차 직배송 MVP 구현은 `main`에 통합됐다.
- API에는 `SaleRoundsModule`, 회차 주문·결제 최종화·환불·재배송비 청구, `OperationsModule`, `RetentionModule`, 배송 사진 처리가 포함된다.
- consumer에는 회차 구매 흐름, seller에는 회차 관리 및 주문 운영 흐름, driver에는 직배송 흐름이 구현돼 있다.
- 공통 회차 계약은 `packages/shared/src/sale-round.types.ts`가 소유한다.
- 카카오 비즈니스 채널 승인, ALIGO 발신 프로필 1건 등록, `senderkey` 발급은 완료됐다.
- 내부 논리 템플릿 코드와 ALIGO `tpl_code` 분리 및 필수 본문 변수 검증은 구현됐다.
- 실제 도달 가능한 회차 알림 템플릿 8종은 2026-08-23 provider에 신규 등록·심사 요청을 완료했다.
- 현재 8종 모두 `검수중`이며 중복·오류·반려는 확인되지 않았다.
- 등록 과정에서 대체 SMS는 모두 사용하지 않았고 실제 알림톡·SMS 발송은 0건이다.
- 실제 알림톡 정상 발송과 SMS fallback 검증은 아직 수행하지 않았다.
- 운영 ALIGO 자격 증명 4개와 `ALIGO_TEMPLATE_CODES_JSON`은 아직 반영하지 않았다.
- 회차 출시 후보의 운영 애플리케이션 배포, 첫 운영 회차 생성, `salesMode` 전환은 실행되지 않았다.
- 판매 모드는 최신 운영 확인 기준 `legacy`다.
- 운영 Firebase 인덱스·Firestore 규칙·Storage 규칙은 기존 출시 준비 작업에서 반영 완료 상태다.
- 따라서 회차 직배송 MVP 코드는 `main`에 통합됐지만 운영 기능 공개는 아직 하지 않은 `paused_external_review` 상태다.

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

- 발신 프로필: 정상 1건
- 신규 등록·심사 요청: 8종
- 중복·오류·반려: 없음
- 실제 알림톡·SMS 발송: 0건
- 비밀값 원문은 기록하지 않는다.

## 검증 상태

- 마지막 전체 원격 회차 E2E 성공 증거는 SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`다.
- 해당 run은 chromium 26건 + mobile 26건, 총 52건 및 양쪽 fixture cleanup 성공 증거다.
- 이후 기능·문서 commit에 대해 이 과거 run을 전체 E2E 성공으로 확장해서 기록하지 않는다.
- 운영 배포 전 실제 출시 대상 SHA에서 요구되는 전체 원격 회차 E2E와 fixture cleanup을 다시 통과해야 한다.
- PR/Vercel/Railway 자동 검사 성공은 전체 원격 회차 E2E 성공을 대신하지 않는다.

## 활성 문서

- 저장소 작업 규칙: `AGENTS.md`
- Context 라우터: `docs/PROJECT_MAP.md`
- 현재 상태 SSOT: 이 문서
- 현재 재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 출시 실행 계약: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- 현재 미완료 작업: `docs/BACKLOG.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`
- 완료 보고서·과거 계획·archive는 증거가 필요한 경우에만 검색한다.

동작 계약이 충돌하면 현재 `main`의 코드·설정·테스트를 기준으로 현행 spec을 정합화한다. 운영·진행 상태가 충돌하면 직접 재검증 결과, 이 문서, 최신 HANDOFF·PLAN, 역사 자료 순으로 판정한다.

## 외부 승인 경계

사용자의 명시적 승인 없이 다음 작업을 수행하지 않는다.

- ALIGO 템플릿 추가 등록·변경 또는 실제 알림톡·SMS 발송
- 운영 자격 증명·환경 변수·데이터 변경
- Railway·Vercel·Firebase 운영 변경 또는 배포
- 운영 회차 생성·상태 변경 또는 `salesMode` 전환

비밀값과 개인정보 원문은 문서, 명령 출력, 로그, Git에 기록하지 않는다.

## 다음 작업

1. ALIGO 회차 알림 템플릿 8종의 심사 결과를 기다린다. 심사 결과가 바뀌기 전에는 실제 발송·운영 변수·배포 단계로 진행하지 않는다.
2. 문서 정합성 검토는 현재 상태 문서부터 계속 수행한다. `HANDOFF`, 출시 `PLAN`, `BACKLOG`의 과거 상태 표현을 현재 상태와 분리한다.
3. 템플릿 8종이 모두 승인된 뒤 별도 승인 범위에서 격리 실제 알림톡 정상 발송 → SMS fallback 검증 → 운영 ALIGO 변수/매핑 반영 → 실제 출시 대상 SHA 전체 원격 검증 순서로 재개한다.
4. 모든 선행 게이트를 통과해도 운영 애플리케이션 배포에는 별도의 `Task 3.1 승인`이 필요하다.
5. 이후 코드 작업은 통합 완료된 기존 회차 branch를 재사용하기보다 최신 `main`에서 목적별 새 branch를 만드는 것을 기본으로 한다.

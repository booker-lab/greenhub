<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (전수 리뷰 보정 Unit 7 완료)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Unit 7 시작 SHA: `7f44ca3dda73fabc7269bd36e43d2c36b58a5f8a`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_pre_4_2_full_review_remediation.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`의 `CL-167`
- 완료: Unit 1~7
- 다음: Unit 8 운영 예외 작성·조치 분리
- 원 계획 `PLAN_mvp_sales_round_direct_delivery.md` Task 4.2는 Unit 10 완료까지 보류한다.

## Unit 7 확정 계약

- 알림 본문과 `#{변수}` 치환은 API 템플릿 카탈로그를 정본으로 사용한다.
- 발송 결과는 실제 성공 채널과 알림톡·문자 시도 횟수를 반환한다.
- 주문자 거래 알림은 주문 `deliveryPhone`을 프로필 연락처보다 우선한다.
- 실제 성공 채널·본문·총 시도를 알림 기록에 저장한다.
- 연락처 누락과 최종 발송 실패는 성공으로 기록하지 않고 운영 예외로 남긴다.
- 운영 문자 재발송은 SMS를 직접 호출하고 별도 시도 결과를 기록한다.
- 알림 설정은 최소 한 필드와 각 필드 boolean 조건을 동시에 강제한다.
- 배송 보류·재배송 요청·재배송 예정 전환은 주문 알림 상태표에 연결된다.

## 검증 상태

- shared typecheck 통과
- 알림 전달 10개, 설정 14개, 회차 주문 흐름 27개 통과
- 결제 서비스 10개 통과
- Unit 1~7 지정 회귀 85개 통과
- consumer `tsc --noEmit` 통과
- 전체 `pnpm build` 통과
- 변경 파일 Biome 오류 0건
- `git diff --check` 통과

## 핸드오프 규칙

- 새 대화에서는 Unit 8만 구현하고 실패 테스트를 먼저 확인한다.
- 기존 사용자 변경, 배포·push 금지, Unit 1~7 회귀 계약을 보존한다.
- 완료 후 계획의 Unit 8 상태와 결론을 갱신하고 Unit 8 파일만 커밋한다.
- 15개 항목 보고 마지막에 Unit 9 전체 실행 프롬프트를 작성한다.

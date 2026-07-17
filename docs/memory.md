<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (전수 리뷰 보정 Unit 8 완료)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Unit 8 시작 SHA: `1d62f1b704d21335a29c87c1521245529bea3b06`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_pre_4_2_full_review_remediation.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`의 `CL-167`
- 완료: Unit 1~8
- 다음: Unit 9 법정 보관·Storage 안전성
- 원 계획 `PLAN_mvp_sales_round_direct_delivery.md` Task 4.2는 Unit 10 완료까지 보류한다.

## Unit 8 확정 계약

- 운영 예외 writer는 결제·알림 외부 의존성 없이 결정 식별자와 트랜잭션으로 동시 생성을 한 문서에 수렴시킨다.
- 같은 실패 재발은 최신 스냅샷을 병합하고 기존 감사 기록을 보존한 채 `OPEN`으로 재개방한다.
- `AUTO_REFUND_FAILED`에는 `RETRY_REFUND`, `CUSTOMER_NOTICE_FAILED`에는 `RESEND_SMS`만 허용한다.
- 외부 조치는 5분 claim을 먼저 획득한 한 요청만 실행한다.
- 알림·재배송·결제 조회·자동 환불 최종 실패는 독립 writer로 기록한다.
- 운영 예외에는 허용된 상태·단계만 저장하고 개인정보·Secret·제공자 오류 본문은 저장하지 않는다.

## 검증 상태

- shared typecheck 통과
- 운영 13개, 알림 전달 10개, 결제 13개, 회차 주문 흐름 27개 통과
- Unit 1~8 지정 회귀 87개 통과
- consumer `tsc --noEmit` 통과
- 전체 `pnpm build` 통과
- 변경 파일 Biome 오류 0건
- `git diff --check` 통과

## 핸드오프 규칙

- 새 대화에서는 Unit 9만 구현하고 실패 테스트를 먼저 확인한다.
- 기존 사용자 변경, 배포·push 금지, Unit 1~8 회귀 계약을 보존한다.
- 완료 후 계획의 Unit 9 상태와 결론을 갱신하고 Unit 9 파일만 커밋한다.
- 15개 항목 보고 마지막에 Unit 10 전체 실행 프롬프트를 작성한다.

<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (전수 리뷰 보정 Unit 6 완료)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Unit 6 시작 SHA: `e27de9c2bb6b5c13f5d4b8dd1f735f0306d4d1e5`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_pre_4_2_full_review_remediation.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`의 `CL-167`
- 완료: Unit 1~6
- 다음: Unit 7 알림 본문·채널·연락처 정합성
- 원 계획 `PLAN_mvp_sales_round_direct_delivery.md` Task 4.2는 Unit 10 완료까지 보류한다.

## Unit 6 확정 계약

- 재배송비 청구는 안정적인 `order-charge-{chargeId}` paymentId와 PortOne 요청 파라미터를 반환한다.
- 같은 배송 보류의 중복 요청은 같은 청구와 paymentId를 반환한다.
- 전용 서비스가 청구·주문·사용자·스토어·금액 관계를 서버에서 검증한다.
- 상태는 `PENDING → PAID|FAILED → REFUNDED`로 전이한다.
- 같은 웹훅과 환불 요청은 트랜잭션과 환불 claim으로 멱등 처리한다.
- 주문 취소는 본 결제와 PAID 재배송비를 환불하며 실패 시 재시도 상태를 보존한다.

## 검증 상태

- shared typecheck 통과
- 회차 주문 흐름 26개 통과
- 결제 서비스 10개 통과
- Unit 1~6 지정 회귀 60개 통과
- consumer `tsc --noEmit` 통과
- 전체 `pnpm build` 통과
- 변경 파일 Biome 오류 0건
- `git diff --check` 통과

## 핸드오프 규칙

- 새 대화에서는 Unit 7만 구현하고 실패 테스트를 먼저 확인한다.
- 기존 사용자 변경, 배포·push 금지, Unit 1~6 회귀 계약을 보존한다.
- 완료 후 계획의 Unit 7 상태와 결론을 갱신하고 Unit 7 파일만 커밋한다.
- 15개 항목 보고 마지막에 Unit 8 전체 실행 프롬프트를 작성한다.

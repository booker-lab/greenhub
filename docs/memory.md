<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (전수 리뷰 보정 Unit 5 완료)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Unit 5 시작 SHA: `5bb44cab1bc3cd663779aa4bed79f9e9f3543dc5`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_pre_4_2_full_review_remediation.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`의 `CL-167`
- 완료: Unit 1 결제·예약, Unit 2 조회·웹훅 보안, Unit 3 주문 수명주기, Unit 4 회차 상태, Unit 5 주문 생성 원자성·요청 멱등성
- 다음: Unit 6 재배송비 실제 결제 수명주기
- 원 계획 `PLAN_mvp_sales_round_direct_delivery.md` Task 4.2는 Unit 10 완료까지 보류한다.

## Unit 5 확정 계약

- 회차 주문 요청은 클라이언트 결제 시도 ID를 가진다.
- 같은 결제 시도 ID와 같은 payload는 기존 주문·예약 응답을 반환한다.
- 같은 결제 시도 ID와 다른 payload는 409 충돌로 거부한다.
- 주문번호 카운터, 예약, 회차 카운터, 상품 카운터, 주문 문서는 한 Firestore 트랜잭션에서 기록한다.
- 주문 저장 직전 실패해도 예약·카운터·주문 부분 데이터가 남지 않는다.
- 최신 회차가 `OPEN`이고 cancellation이 없으며 마감 전일 때만 새 주문을 허용한다.
- `round_direct` 생성만 전용 서비스로 위임하고 legacy 전화번호·배송일 계약은 유지한다.
- 단일 결제 오류 재시도와 장바구니 항목 재시도는 같은 결제 시도 ID를 재사용한다.

## 검증 상태

- shared typecheck 통과
- 회차 주문 흐름 24개 통과
- Unit 1~5 지정 회귀 54개 통과
- consumer `tsc --noEmit` 통과
- 전체 `pnpm build` 통과
- 변경 파일 Biome lint 오류 0건
- `git diff --check` 통과

## 핸드오프 규칙

- 새 대화에서는 Unit 6만 구현하고 실패 테스트를 먼저 확인한다.
- 기존 사용자 변경, 배포·push 금지, Unit 1~5 회귀 계약을 보존한다.
- 완료 후 계획의 Unit 6 상태와 결론을 갱신하고 Unit 6 파일만 커밋한다.
- 15개 항목 보고 마지막에 Unit 7 전체 실행 프롬프트를 작성한다.

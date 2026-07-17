<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.2 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.2 시작 SHA: `ba744f773bc6bd46633fe6cfb978d372fc434670`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.2 `apps/consumer/src/hooks/useSaleRounds.ts`
- 다음: Task 4.3 `apps/consumer/src/lib/acquisition.ts`
- Task 4.4 이후 홈·상세·장바구니·결제 화면은 선행하지 않는다.

## Task 4.2 확정

- 공개 목록 API와 회차별 상세 API를 결합해 회차 상품을 포함한 데이터를 제공한다.
- `loading`, `error`, `empty`, `success`와 전체·현재·지난 회차를 한 훅에서 제공한다.
- 현재 회차는 `OPEN`, `SCHEDULED`, `CLOSED` 우선순위와 최신 주문 시작 시각으로 선택한다.
- 지난 회차는 현재 회차를 제외한 `CLOSED`, `COMPLETED`를 최신순으로 제공한다.
- 요청 식별자로 스토어 전환·재조회 중 늦게 도착한 응답의 상태 덮어쓰기를 막는다.
- legacy 스토어와 주문·결제·배송 동작은 변경하지 않았다.

## 검증 상태

- Task 4.2 Node 테스트 4개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 0건
- `git diff --check` 통과

## 명시적 후속 위험

- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- 소비자 계약 24개는 Task 4.4~4.18 화면 구현 전 `test.fixme`다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.5 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.5 시작 SHA: `58e93aa7b865566010dcb7cd847146c6ad653813`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.5 `apps/consumer/src/app/category/page.tsx`
- 다음: Task 4.6 `apps/consumer/src/components/BottomNav.tsx`
- Task 4.7 이후 공동구매 리다이렉트·상세·장바구니·결제 화면은 선행하지 않는다.

## Task 4.5 확정

- 공개 상품의 단일 `storeId`와 공개 스토어 `salesMode`로 상품 화면을 분기한다.
- `round_direct`는 `useSaleRounds`의 현재·지난 회차 판정을 그대로 사용한다.
- 회차 항목을 공개 상품과 `productId`로 결합해 활성 `orchid`이면서 같은 스토어인 상품만 표시한다.
- `HIDDEN` 회차 항목은 제외하고 회차 표시 순서를 유지한다.
- 카드에 이번 주·지난 회차 구분과 회차 가격을 표시한다.
- 링크는 `/products/{productId}?round={roundId}`로 두 식별자를 보존한다.
- 판매 모드와 회차의 로딩·오류·빈 상태를 명시한다.
- legacy 카테고리 탭·색상·상품 목록 흐름은 유지한다.

## 검증 상태

- Task 4.5 Node 테스트 5개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 0건, `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 HEAD 상태로 복원했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 후속 화면과 실행 데이터 준비 전이라 `test.fixme`다.
- 당근 주문 유입 스냅샷 전달은 후속 결제 Task에서 연결한다.
- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

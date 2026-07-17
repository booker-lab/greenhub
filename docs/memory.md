<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.4 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.4 시작 SHA: `20b05f51c69e73943df8838d42ab1f997e3574d6`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.4 `apps/consumer/src/components/HomeProductList.tsx`
- 다음: Task 4.5 `apps/consumer/src/app/category/page.tsx`
- Task 4.6 이후 내비게이션·상세·장바구니·결제 화면은 선행하지 않는다.

## Task 4.4 확정

- 공개 상품의 단일 `storeId`로 스토어를 찾고 공개 문서의 `salesMode`로 홈을 분기한다.
- `round_direct`는 `useSaleRounds`의 현재·지난 회차 판정을 그대로 사용한다.
- 현재 회차, 주문 마감, 이천 직접배송, 화요일 오전 9시 배송 약속, 지난 회차 순서를 제공한다.
- 회차 카드는 회차 가격을 표시하고 링크에 `productId`와 `roundId`를 함께 보존한다.
- 로딩·오류·빈 상태를 명시하고 legacy·여러 스토어 경로는 기존 홈을 유지한다.
- `captureAcquisition`은 홈의 client effect에서만 실행하며 주문 스냅샷 연결은 후속 Task다.

## 검증 상태

- Task 4.4 Node 테스트 4개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 0건
- `git diff --check` 통과

## 명시적 후속 위험

- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- 소비자 계약 24개는 Task 4.5~4.18 화면 구현 전 `test.fixme`다.
- 당근 주문 유입 스냅샷 전달은 후속 결제 Task에서 연결해야 한다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

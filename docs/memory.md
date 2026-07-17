<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.6 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.6 시작 SHA: `0463a16e09c6a3548e109277743d7d93c146e42e`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.6 `apps/consumer/src/components/BottomNav.tsx`
- 다음: Task 4.7 `apps/consumer/src/app/groupbuy/page.tsx`
- Task 4.8 이후 상세·장바구니·결제 화면은 선행하지 않는다.

## Task 4.6 확정

- 공개 상품의 단일 `Product.storeId`와 공개 스토어 `salesMode`로 하단 내비게이션을 분기한다.
- `round_direct`에는 홈·상품·장바구니·MY 네 항목만 표시한다.
- 상품 항목은 Task 4.5의 `/category` 화면으로 연결한다.
- 확인된 legacy에는 기존 홈·카테고리·공구·장바구니·MY를 보존한다.
- legacy 장바구니 배지와 결제·주문 성공·상품 상세의 기존 숨김 경로를 보존한다.
- 상품·판매 모드 판정 중이거나 공개 조회 오류이면 내비게이션을 숨긴다.
- Task 4.7 공동구매 직접 진입 리다이렉트는 구현하지 않았다.

## 검증 상태

- Task 4.6 Node 테스트 4개 통과
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

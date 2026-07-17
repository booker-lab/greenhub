<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.11 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.11 시작 SHA: `851b49362480f83aa3e7a410f4ef05401a90712a`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.11 `apps/consumer/src/hooks/useCart.ts`
- 다음: Task 4.12 `apps/consumer/src/app/cart/page.tsx`
- Task 4.13 이후 결제 훅·결제 화면·주문 요청은 선행하지 않는다.

## Task 4.11 확정

- 회차 항목은 검증된 `roundId`, `roundItemId`, `roundPrice`만 기존 CartItem에 추가한다.
- 완전한 회차 필드와 `price === roundPrice`를 만족할 때만 구매 가능한 회차 항목으로 복원한다.
- 동일 항목은 `roundId + roundItemId + productId`로 판정하고 같은 회차 항목만 함께 담는다.
- 다른 회차와 legacy/회차 혼합은 기존 장바구니를 보존한 실패 결과로 거부하고 호출부에서 알린다.
- 기존 CartItem localStorage는 계속 읽으며 `isPurchasable=false` 구매 차단도 유지한다.

## 검증 상태

- Task 4.11 전용 9개와 Task 4.8~4.10 계약 16개 등 Node 테스트 25개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 HEAD 상태로 복원했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 후속 화면과 실행 데이터 준비 전이라 `test.fixme`다.
- 서버 장바구니 재검증은 Task 4.12, 결제·주문 요청과 당근 유입 연결은 후속 Task에서 구현한다.
- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.10 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.10 시작 SHA: `d432b36eaba93a75f7450260abc4b39f7ade55cb`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.10 `apps/consumer/src/app/products/[id]/_components/ProductActions.tsx`
- 다음: Task 4.11 `apps/consumer/src/hooks/useCart.ts`
- Task 4.12 이후 장바구니 화면·결제·주문 요청은 선행하지 않는다.

## Task 4.10 확정

- Task 4.8의 `item`, `state`, `isPurchasable`을 `ProductActions` 회차 분기에 그대로 전달한다.
- 회차 구매는 `SaleRoundItem.roundPrice`, `deliveryMethod: direct`, 일반 판매 의미만 사용한다.
- 택배·거점픽업·공동구매·배송 희망일 선택은 회차 분기에서만 제거하고 legacy 흐름은 별도 구성요소로 보존한다.
- `isPurchasable=false`이면 장바구니 담기와 바로 구매를 버튼·핸들러 양쪽에서 차단한다.
- Task 4.11의 `roundId`·회차 상품 ID 장바구니 모델은 구현하지 않았다.

## 검증 상태

- Task 4.10 전용 5개, Task 4.8 상세 5개, Task 4.9 패널 6개 등 Node 테스트 16개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 HEAD 상태로 복원했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 후속 화면과 실행 데이터 준비 전이라 `test.fixme`다.
- 회차 장바구니 모델은 Task 4.11, 결제·주문 요청과 당근 유입 연결은 후속 Task에서 구현한다.
- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

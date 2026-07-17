<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.8 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.8 시작 SHA: `e93f9572bfa586e81a9b96020f83cd33f94fae23`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.8 `apps/consumer/src/app/products/[id]/page.tsx`
- 다음: Task 4.9 `apps/consumer/src/app/products/[id]/_components/RoundPurchasePanel.tsx`
- Task 4.10 이후 ProductActions 단순화·장바구니·결제 화면은 선행하지 않는다.

## Task 4.8 확정

- Next.js Promise `searchParams`의 `round`는 단일 안전 문자열만 허용하며 임의 기본 회차를 만들지 않는다.
- 공개 상품 `storeId`, 공개 스토어 `salesMode`, `useSaleRounds` 현재·지난 회차 정본을 순서대로 확인한다.
- 회차·항목·상품·스토어 관계가 하나로 일치할 때만 현재·마감 상태와 구매 가능 여부를 상세 경계에 전달한다.
- 다른 스토어·숨김·중복·없는 회차 상품은 무효 처리하고 외부 이동이나 반복 리다이렉트를 만들지 않는다.
- 판매 모드·회차 판정 전에는 상세 본문을 숨기고 확인된 legacy에는 기존 이미지·정보·구매 동작을 보존한다.
- Task 4.9 회차 가격·마감·배송 고지 UI와 Task 4.10 ProductActions 단순화는 구현하지 않았다.

## 검증 상태

- Task 4.8 Node 테스트 5개 통과
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

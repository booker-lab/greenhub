<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.9 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.9 시작 SHA: `000521f33e0709f4b7138bcfe000677d13609d18`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.9 `apps/consumer/src/app/products/[id]/_components/RoundPurchasePanel.tsx`
- 다음: Task 4.10 `apps/consumer/src/app/products/[id]/_components/ProductActions.tsx`
- Task 4.11 이후 장바구니 모델·결제 화면은 선행하지 않는다.

## Task 4.9 확정

- Task 4.8이 검증한 `round`, `item`, `state`, `isPurchasable`을 그대로 받아 별도 조회나 기본 회차를 만들지 않는다.
- 회차 가격은 `SaleRoundItem.roundPrice`, 주문 마감은 `schedule.orderCloseAt`의 `Asia/Seoul` 표시를 정본으로 쓴다.
- 경기도 이천시 직접배송, 화요일 오전 9시 문 앞 배송, 기상 연기 시 재배송비 없는 새 일정을 고지한다.
- 주문 마감 후 생화 가치 감소 조건과 표시·광고 또는 계약 불이행 예외를 함께 안내한다.
- 현재·마감은 제목·배지·테두리로 구분하고 `isPurchasable=false`에는 판매 마감 또는 판매 예정만 표시한다.
- Task 4.10 ProductActions 단순화와 구매 동작 위임은 구현하지 않았다.

## 검증 상태

- Task 4.9 전용 Node 테스트 6개, Task 4.8 상세 계약 포함 11개 통과
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

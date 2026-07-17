<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.12 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.12 시작 SHA: `4b2d305d0cd8e153efd5291937183136784a7ecd`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.12 `apps/consumer/src/app/cart/page.tsx`
- 다음: Task 4.13 `apps/consumer/src/hooks/usePayment.ts`
- Task 4.14 이후 결제 화면·주문 요청은 선행하지 않는다.

## Task 4.12 확정

- Task 4.11의 `CartItem`, `RoundCartItem`, `isRoundCartItem` 계약을 그대로 재사용한다.
- 기존 인증 `validate-cart` API로 각 항목의 회차 상태·가격·수량을 확인하고 통과 후보 전체를 다시 검증한다.
- 서버 식별자·수량·가격·합계가 모두 일치한 같은 회차 항목만 결제 대상으로 선별한다.
- 가격 변경·마감·품절·구매 불가·검증 실패·손상 응답 항목은 남겨 사유와 결제 제외를 표시한다.
- legacy CartItem은 서버 회차 검증 없이 기존 장바구니·결제 이동 흐름을 유지한다.

## 검증 상태

- Task 4.12 전용 8개와 Task 4.8~4.11 계약 25개 등 Node 테스트 33개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 HEAD 상태로 복원했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 후속 화면과 실행 데이터 준비 전이라 `test.fixme`다.
- 다중 상품 한 주문·한 결제는 Task 4.13~4.14, 결제 직전 변경 재확인과 당근 유입 연결은 후속 Task다.
- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

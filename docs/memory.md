<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 4.14 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.14 시작 SHA: `655816581819738afb8976586969626429893e3c`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.14 `apps/consumer/src/app/checkout/page.tsx`
- 다음: Task 4.15 `apps/consumer/src/app/checkout/_components/CheckoutForm.tsx`
- Task 4.16 이후 주문 완료·MY 화면과 당근 유입 연결은 선행하지 않는다.

## Task 4.14 확정

- `checkout_cart`는 Task 4.12의 검증 통과 `RoundCartItem[]` 계약으로 다시 복원한다.
- 빈 배열·손상 metadata·다른 회차·다른 스토어·legacy 혼합은 결제 전에 거부한다.
- 공개 회차의 스토어·상품·가격 관계와 `Asia/Seoul` 배송 일정을 확인해 배송일을 결정한다.
- 회차 배열 전체를 Task 4.13 `usePayment`에 한 번 전달해 주문·PortOne 결제를 각각 한 번 실행한다.
- `done`과 단일 `orderId` 확인 후에만 `checkout_cart`를 삭제하고 성공 화면으로 이동한다.
- 기존 단일 상품 checkout과 legacy 장바구니 결제 계약은 유지한다.

## 검증 상태

- Task 4.14 전용 5개와 Task 4.8~4.13 계약 39개 등 Node 테스트 44개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 HEAD 상태로 복원했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 후속 화면과 실행 데이터 준비 전이라 `test.fixme`다.
- 주소·전화번호·필수 고지·변경 재확인은 Task 4.15, 당근 유입 연결은 후속 Task다.
- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

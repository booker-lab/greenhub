<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.13 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.13 시작 SHA: `fca7f9910b1283deeaf822d23e1e6d10b1698502`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.13 `apps/consumer/src/hooks/usePayment.ts`
- 다음: Task 4.14 `apps/consumer/src/app/checkout/page.tsx`
- Task 4.15 이후 주소·전화번호·변경 재확인과 당근 유입 연결은 선행하지 않는다.

## Task 4.13 확정

- Task 4.12의 검증 통과 `RoundCartItem[]`만 회차 결제 입력으로 사용한다.
- 같은 회차·스토어의 직배송 일반 상품 전체를 `roundId + roundItems` 한 요청으로 전송한다.
- 주문 응답의 단일 `orderId`와 회차 합계가 일치해야 PortOne 결제를 한 번만 시작한다.
- 빈 배열·혼합 회차·손상 입력·손상 응답은 주문 또는 SDK 호출 전에 닫힌 방식으로 거부한다.
- 동시 클릭은 단일화하고 네트워크 오류 재시도에는 같은 `clientOrderRequestId`를 재사용한다.
- 기존 단일 상품·legacy `usePayment` 계약은 유지한다.

## 검증 상태

- Task 4.13 전용 6개와 Task 4.8~4.12 계약 33개 등 Node 테스트 39개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 HEAD 상태로 복원했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 후속 화면과 실행 데이터 준비 전이라 `test.fixme`다.
- checkout 반복 주문·결제 제거는 Task 4.14, 결제 직전 변경 재확인과 당근 유입 연결은 후속 Task다.
- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

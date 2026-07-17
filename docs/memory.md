<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 4.17 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.17 시작 SHA: `d3ba84cda0ef9cb523ee0ff997314f20ebe9154a`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.17 `apps/consumer/src/app/mypage/_client.tsx`
- 다음: Task 4.18 `apps/consumer/src/app/mypage/orders/[id]/_client.tsx`
- Task 4.19 이후 화면과 당근 유입 연결은 선행하지 않는다.

## Task 4.17 확정

- 주문 목록 대표명은 서버가 정규화한 `orderItems[0].productName`만 사용한다.
- 추가 상품 수, 상품 종류, 총수량도 같은 `orderItems` 배열에서 계산한다.
- 빈 배열·잘못된 상품 식별자·상품명·수량·중복 항목은 상품 요약으로 승격하지 않는다.
- 손상 배열에는 주문 최상위 `productName`을 임의 폴백으로 사용하지 않는다.
- `DELIVERY_HELD`는 `배송 보류` 위험 배지와 강조선으로 명확히 표시한다.
- 단일 legacy 정규화 배열과 기존 배송 방식·수량·금액 목록 계약을 보존한다.
- Task 4.14~4.16 주문·결제·완료 계약과 checkout_cart는 변경하지 않았다.

## 검증 상태

- Task 4.17 전용 4개와 Task 4.8~4.16 계약 55개 등 Node 테스트 59개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 SHA 상태로 복원해 범위에서 제외했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 후속 화면과 실행 데이터 준비 전이라 `test.fixme`다.
- 주문 상세의 다중 상품·보류·재배송비·완료 사진·마감 전 취소는 Task 4.18이다.
- 마케팅 동의 화면과 당근 유입 연결은 후속 Task로 남아 있다.
- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

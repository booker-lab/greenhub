<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 4.15 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.15 시작 SHA: `94faaeb996be5aca3496a6278e793532f1d3a0d2`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.15 `apps/consumer/src/app/checkout/_components/CheckoutForm.tsx`
- 다음: Task 4.16 `apps/consumer/src/app/order/success/page.tsx`
- Task 4.17 이후 MY 화면과 당근 유입 연결은 선행하지 않는다.

## Task 4.15 확정

- 회차 폼은 서버와 같은 주소 선두 행정구역 경계로 경기도 이천시 주소만 허용한다.
- 배송 연락처는 정보성 주문·결제·배송 안내 목적이며 선택 마케팅 동의와 분리한다.
- 카카오톡·문자 마케팅 동의는 기본 해제하고 동의 시각·문구 버전·채널을 주문에 전달한다.
- 이천 직접배송·화요일 오전 9시·기상 연기·청약철회 제한과 계약 불이행 예외를 고지한다.
- 상품·가격·회차 확인은 기본 해제하고 요약 변경 시 다시 해제해 확인 전 결제를 막는다.
- Task 4.14 한 주문·한 PortOne 결제와 완료 후 `checkout_cart` 삭제 계약을 유지한다.
- 기존 단일 상품 checkout과 legacy 장바구니 흐름은 회차 UI 영향을 받지 않는다.

## 검증 상태

- Task 4.15 전용 6개와 Task 4.8~4.14 계약 44개 등 Node 테스트 50개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 HEAD 상태로 복원해 범위에서 제외했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 후속 화면과 실행 데이터 준비 전이라 `test.fixme`다.
- 주문 완료의 회차 주문번호·상품 요약·화요일 배송 약속은 Task 4.16이다.
- 당근 유입 스냅샷 주문 연결은 후속 Task로 남아 있다.
- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

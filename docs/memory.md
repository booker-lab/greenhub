<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.7 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.7 시작 SHA: `83ed9505025a0ece2559595fdb210e82113da346`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.7 `apps/consumer/src/app/groupbuy/page.tsx`
- 다음: Task 4.8 `apps/consumer/src/app/products/[id]/page.tsx`
- Task 4.9 이후 회차 구매 패널·장바구니·결제 화면은 선행하지 않는다.

## Task 4.7 확정

- 전체 공개 상품의 단일 `Product.storeId`와 공개 스토어 `salesMode`로 공동구매 진입을 분기한다.
- `round_direct`의 `/groupbuy` 직접 진입은 내부 홈 `/`로 대체 이동한다.
- 판매 모드 판정 전·공개 조회 오류·홈 이동 중에는 legacy 공동구매 화면을 노출하지 않는다.
- 확인된 legacy에는 기존 공동구매 상품 조회와 모집 중·완료·빈·오류 화면을 보존한다.
- 외부 경로, 임의 store ID, Secret은 추가하지 않았다.
- Task 4.8 상품 상세 회차 분기는 구현하지 않았다.

## 검증 상태

- Task 4.7 Node 테스트 4개 통과
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

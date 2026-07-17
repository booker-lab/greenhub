<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (원 계획 Task 4.3 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.3 시작 SHA: `2953516bc85269b927cb907d2e51a4074ca8831b`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.3 `apps/consumer/src/lib/acquisition.ts`
- 다음: Task 4.4 `apps/consumer/src/components/HomeProductList.tsx`
- Task 4.5 이후 목록·내비게이션·상세·장바구니·결제 화면은 선행하지 않는다.

## Task 4.3 확정

- `utm_source=carrot|daangn|당근` 유입만 `sessionStorage`의 탭 수명주기로 보관한다.
- 캠페인·콘텐츠는 128자 안전 문자로 제한하고 도착 URL은 `http(s)`와 `round`만 남긴다.
- 주문용 조회는 공유 계약의 다섯 필드만 새 객체로 반환하고 저장값을 매번 재검증한다.
- SSR, 저장소 접근 거부, 잘못된 JSON·필드·시각·URL을 예외 없이 처리한다.
- 화면 유입 캡처와 주문 요청 연결은 Task 4.4 이후 각 대상 파일에서 수행한다.
- legacy 스토어와 주문·결제·배송 동작은 변경하지 않았다.

## 검증 상태

- Task 4.3 Node 테스트 6개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 0건
- `git diff --check` 통과

## 명시적 후속 위험

- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- 소비자 계약 24개는 Task 4.4~4.18 화면 구현 전 `test.fixme`다.
- 당근 유입 캡처와 주문 요청 전달은 후속 화면·결제 Task에서 연결해야 한다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

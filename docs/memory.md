<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 5.5 셀러 회차 상세 운영 연결 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 5.5 시작 SHA: `837c6a0f4b51c17db7a8a0b9a3237caff9a9a431`
- 완료 계획: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 5.5 `apps/seller/src/app/sale-rounds/[id]/page.tsx`
- 다음: Task 5.6 `apps/seller/src/components/BottomNav.tsx`

## 선행 계약 확정

- 소비자 리뷰 보정은 예정 회차 선택, 단일 회차 바로 구매, 당근 유입 재검증, 마케팅 설정 진입까지 완료했다.
- Task 5.1의 상호 배타적 6개 fixture와 chromium·mobile 12개 `test.fixme` 화면 계약은 그대로 유지한다.
- Task 5.2 훅은 셀러 인증과 `apiJson`으로 목록·상세·생성·저장·복사·상태 변경·완료를 캡슐화한다.
- Task 5.3 목록은 상태·KST 일정·지역·한도·예약·주문·배송 보류를 표시하고 복사를 훅에만 위임한다.

## Task 5.5 확정

- Next.js 16 Promise `params`를 `use()`로 읽고 안전한 단일 회차 ID만 `getRound`에 전달한다.
- 검증된 상세 회차와 같은 스토어의 현재 상품만 `RoundForm`에 전달하며 로딩·오류·재조회·빈 상태를 분리한다.
- 저장 callback은 `saveRound`의 검증된 상세 응답이 완료된 뒤에만 resolve한다.
- `DRAFT→SCHEDULED`, `OPEN→CLOSED`, `CLOSED→COMPLETED` 동작만 현재 상태에서 확인 모달과 함께 노출한다.
- 상태 변경·완료 실패는 기존 상태를 유지하며 서버 오류를 명시하고, 확인 필요 건수는 배송 보류·취소 실패 응답만 사용한다.
- 당근 링크는 안전한 회차·상품 ID와 `https://greenlove.co.kr` 범위에서만 구성하며 손상 URL·제어문자·중복 ID를 거부한다.
- 보안·상태 경계를 위해 `page.logic.ts`, `page.test.ts`를 최소 인접 추가했고 Vitest 15개가 통과했다.
- seller 타입검사, 전체 typecheck·build, 대상 Biome, 셀러 12개·소비자 24개 목록 수집과 diff 검사가 통과했다.
- build가 갱신한 tracked 생성물 5개는 시작 상태와 비교해 범위에서 제외했다.
- Task 5.6 BottomNav는 시작하지 않았다.

## 후속 Task 실행 원칙

- 다음 작업은 Task 5.6이며 원 계획의 Dependency와 후속 위험 처리 게이트에서 현재 Task 위험만 확인한다.
- 소비자 E2E 24개와 셀러 E2E 12개는 실행 데이터·상세 화면 준비 전까지 `test.fixme`다.
- 사진 업로드·서명 URL·드라이버 연결은 Task 5.12, 인덱스·보안 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않는다.
- 현재 작업 트리의 기존 미커밋 API·소비자·문서·스크립트·인덱스 변경은 사용자 작업으로 보존한다.

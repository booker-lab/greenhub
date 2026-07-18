<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 5.4 셀러 회차 편집 폼 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 5.4 시작 SHA: `27fc4f45ce463f0cda8e992cd1d8bea41d627198`
- 완료 계획: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 5.4 `apps/seller/src/app/sale-rounds/[id]/RoundForm.tsx`
- 다음: Task 5.5 `apps/seller/src/app/sale-rounds/[id]/page.tsx`

## 선행 계약 확정

- 소비자 리뷰 보정은 예정 회차 선택, 단일 회차 바로 구매, 당근 유입 재검증, 마케팅 설정 진입까지 완료했다.
- Task 5.1의 상호 배타적 6개 fixture와 chromium·mobile 12개 `test.fixme` 화면 계약은 그대로 유지한다.
- Task 5.2 훅은 셀러 인증과 `apiJson`으로 목록·상세·생성·저장·복사·상태 변경·완료를 캡슐화한다.
- Task 5.3 목록은 상태·KST 일정·지역·한도·예약·주문·배송 보류를 표시하고 복사를 훅에만 위임한다.

## Task 5.4 확정

- `RoundForm`은 검증된 회차·상품·당근 링크와 저장 callback만 받고 API·raw fetch·라우트 조회를 수행하지 않는다.
- KST 로컬 입력을 ISO8601로 변환하고 주문 시작 < 주문 마감 <= 경매 시각 <= 배송 시작 < 배송 종료를 검증한다.
- 배송 지역 활성 상태와 양의 배송지·판매 수량 한도를 편집하며 검증된 지역 식별 정보는 보존한다.
- 포함 상품은 중복을 거부하고 회차 가격·상품별 한도는 양수, 노출 순서는 0 이상 정수로 검증한다.
- 새 상품의 가격·한도·순서는 빈 값으로 두어 입력이나 서버 응답을 임의 성공값으로 승격하지 않는다.
- 유일한 상품 식별자에 대응하는 http(s) 당근 대표·상품 링크만 표시·복사하고 성공·실패를 명시한다.
- 500줄 제한과 검증 가능성을 위해 표시 섹션·순수 로직·Vitest 9개를 인접 파일로 최소 분리했다.
- seller 타입검사, 전체 typecheck·build, 대상 Biome, 셀러 12개·소비자 24개 목록 수집과 diff 검사가 통과했다.
- build가 갱신한 tracked 생성물 5개는 시작 상태와 비교해 범위에서 제외했다.
- Task 5.5 상세 라우트와 `getRound`·`saveRound`·상태 변경 연결은 시작하지 않았다.

## 후속 Task 실행 원칙

- 다음 작업은 Task 5.5이며 원 계획의 Dependency와 후속 위험 처리 게이트에서 현재 Task 위험만 확인한다.
- 소비자 E2E 24개와 셀러 E2E 12개는 실행 데이터·상세 화면 준비 전까지 `test.fixme`다.
- 사진 업로드·서명 URL·드라이버 연결은 Task 5.12, 인덱스·보안 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않는다.
- 현재 작업 트리의 기존 미커밋 API·소비자·문서·스크립트·인덱스 변경은 사용자 작업으로 보존한다.

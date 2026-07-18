<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 5.10 드라이버 직배송 화면 계약 수집 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 5.10 시작 SHA: `eea43c55ea5c2db36c5bb9a80251799ec83d0f36`
- 완료 계획: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 5.10 `apps/e2e/tests/driver-direct-delivery.spec.ts`
- 다음: Task 5.11 `apps/driver/src/app/board/[orderId]/page.tsx`

## 선행 계약 확정

- 소비자 리뷰 보정은 예정 회차 선택, 단일 회차 바로 구매, 당근 유입 재검증, 마케팅 설정 진입까지 완료했다.
- Task 5.1의 상호 배타적 6개 fixture와 chromium·mobile 12개 `test.fixme` 화면 계약은 그대로 유지한다.
- Task 5.2 훅은 셀러 인증과 `apiJson`으로 목록·상세·생성·저장·복사·상태 변경·완료를 캡슐화한다.
- Task 5.3 목록은 상태·KST 일정·지역·한도·예약·주문·배송 보류를 표시하고 복사를 훅에만 위임한다.

## Task 5.10 확정

- 드라이버 보드는 직접배송 주문만 노출하고 준비 주문에서 배송 시작을 제공하는 화면 계약을 고정했다.
- 기상·출입·주소·연락 실패를 독립 fixture로 분리하고 고객 책임·재배송비·다음 연락·새 배송 일정을 관찰한다.
- 사진 없는 직접 완료는 차단하고 촬영 화면의 완료 동작은 사진 전까지 비활성화한다.
- 아직 없는 사진 업로드 성공은 추정하지 않고 Task 5.11·5.12 구현과 실행 seed 전까지 7개 계약을 `test.fixme`로 유지한다.
- 독립 주문 fixture 9개, 논리 계약 7개, chromium·mobile 14개 목록을 수집했다.
- 기존 셀러 12개·소비자 24개 목록, 전체 typecheck·build, Biome 오류 수준 검사와 diff 검사가 통과했다.
- build가 갱신한 tracked 생성물 5개는 시작 상태로 되돌려 범위에서 제외했다.
- 드라이버·API·공유 타입·인덱스·보안 규칙 구현은 변경하지 않았다.

## 후속 Task 실행 원칙

- 다음 작업은 Task 5.11이며 드라이버 주문 상세의 직접배송 시작·보류 기록만 구현한다.
- 드라이버 E2E 14개, 소비자 E2E 24개와 셀러 E2E 12개는 실행 데이터·화면 준비 전까지 `test.fixme`다.
- 사진 업로드·서명 URL·드라이버 연결은 Task 5.12, 인덱스·보안 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않는다.
- 현재 작업 트리의 기존 미커밋 API·소비자·문서·스크립트·인덱스 변경은 사용자 작업으로 보존한다.

<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 5.8 셀러 주문 업무 우선순위 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 5.8 시작 SHA: `3ee02cd3da6ceb0c5c40618ae823b033c3a68984`
- 완료 계획: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 5.8 `apps/seller/src/app/orders/page.tsx`
- 다음: Task 5.9 `apps/seller/src/app/orders/[id]/page.tsx`

## 선행 계약 확정

- 소비자 리뷰 보정은 예정 회차 선택, 단일 회차 바로 구매, 당근 유입 재검증, 마케팅 설정 진입까지 완료했다.
- Task 5.1의 상호 배타적 6개 fixture와 chromium·mobile 12개 `test.fixme` 화면 계약은 그대로 유지한다.
- Task 5.2 훅은 셀러 인증과 `apiJson`으로 목록·상세·생성·저장·복사·상태 변경·완료를 캡슐화한다.
- Task 5.3 목록은 상태·KST 일정·지역·한도·예약·주문·배송 보류를 표시하고 복사를 훅에만 위임한다.

## Task 5.8 확정

- 선택한 일반 주문·공동구매 범위의 배송 보류와 확인 필요 건수를 화면 상단 업무 우선순위로 표시한다.
- `DELIVERY_HELD`는 별도 보류 건수이면서 기존 `ACTION_REQUIRED`에도 포함되는 의미를 유지한다.
- 두 우선순위 항목은 기존 확인 필요 탭으로 진입하며 날짜 필터·상태 탭·주문 카드를 보존한다.
- 중첩 집계와 다른 상태 비승격 계약을 인접 Vitest 2개로 고정했다.
- seller 타입검사, 전체 typecheck·build, 대상 Biome, 인접 테스트, 셀러 12개·소비자 24개 목록 수집과 diff 검사가 통과했다.
- build가 갱신한 tracked 생성물 5개는 시작 상태와 비교해 범위에서 제외했다.
- Task 5.9 주문 상세 조치는 시작하지 않았다.

## 후속 Task 실행 원칙

- 다음 작업은 Task 5.9이며 주문 상세에서 새 일정·재배송비·연락·환불 재시도·분쟁 기록 조치만 제공한다.
- 소비자 E2E 24개와 셀러 E2E 12개는 실행 데이터·상세 화면 준비 전까지 `test.fixme`다.
- 사진 업로드·서명 URL·드라이버 연결은 Task 5.12, 인덱스·보안 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않는다.
- 현재 작업 트리의 기존 미커밋 API·소비자·문서·스크립트·인덱스 변경은 사용자 작업으로 보존한다.

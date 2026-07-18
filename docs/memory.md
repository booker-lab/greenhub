<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 5.9 셀러 주문 상세 운영 조치 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 5.9 시작 SHA: `8cbd11abd99189d141ab710477229c46337c66c2`
- 완료 계획: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 5.9 `apps/seller/src/app/orders/[id]/page.tsx`
- 다음: Task 5.10 `apps/e2e/tests/driver-direct-delivery.spec.ts`

## 선행 계약 확정

- 소비자 리뷰 보정은 예정 회차 선택, 단일 회차 바로 구매, 당근 유입 재검증, 마케팅 설정 진입까지 완료했다.
- Task 5.1의 상호 배타적 6개 fixture와 chromium·mobile 12개 `test.fixme` 화면 계약은 그대로 유지한다.
- Task 5.2 훅은 셀러 인증과 `apiJson`으로 목록·상세·생성·저장·복사·상태 변경·완료를 캡슐화한다.
- Task 5.3 목록은 상태·KST 일정·지역·한도·예약·주문·배송 보류를 표시하고 복사를 훅에만 위임한다.

## Task 5.9 확정

- 주문 상세는 서버 `deliveryHold`의 보류 사유·책임·재배송비·다음 연락·새 배송 일정을 그대로 표시한다.
- 현재 주문의 안전한 `operationIssues` 응답만 읽어 연락·환불·재배송 분쟁 상태와 성공·실패 감사 기록을 표시한다.
- 열린 자동 환불 실패에는 환불 재시도, 열린 고객 안내 실패에는 문자 재발송만 제공하고 실행 직전 서버 `refresh`로 최신 상태와 허용 조치를 재확인한다.
- 결제 조회·재배송 실패·해결 항목, 주문자 전용 재배송비 생성, 법정 분쟁 원문은 셀러 조치로 추정하지 않는다.
- 응답 판독·허용 조치 Vitest 3개와 Task 5.8 회귀 2개, seller 타입검사, 전체 typecheck·build, Biome, 셀러 12개·소비자 24개 목록 수집과 diff 검사가 통과했다.
- build가 갱신한 tracked 생성물 5개는 시작 상태와 비교해 범위에서 제외했다.
- 기존 준비·택배 발송·강제 취소·읽기 전용 상태와 Task 5.8 목록 계약을 보존했다.

## 후속 Task 실행 원칙

- 다음 작업은 Task 5.10이며 드라이버 직배송의 배송 시작·보류·사진 완료 Playwright 계약 수집만 수행한다.
- 소비자 E2E 24개와 셀러 E2E 12개는 실행 데이터·상세 화면 준비 전까지 `test.fixme`다.
- 사진 업로드·서명 URL·드라이버 연결은 Task 5.12, 인덱스·보안 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않는다.
- 현재 작업 트리의 기존 미커밋 API·소비자·문서·스크립트·인덱스 변경은 사용자 작업으로 보존한다.

<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (전수 리뷰 보정 Unit 9 완료)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Unit 9 시작 SHA: `422258d494b2b54c0771f15f564843ea946653b4`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_pre_4_2_full_review_remediation.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`의 `CL-167`
- 완료: Unit 1~9
- 다음: Unit 10 계약·통합 검증·4.2 복귀
- 원 계획 `PLAN_mvp_sales_round_direct_delivery.md` Task 4.2는 Unit 10 완료까지 보류한다.

## Unit 9 확정 계약

- 보관 metadata는 목적별 allowlist만 저장하고 전화번호·주소·Secret·원문 결제 응답·환불 사유 원문을 제외한다.
- 주문 계약·마케팅 동의, 결제 확정, 환불 완료 기록은 원 상태 변경과 같은 트랜잭션에 저장한다.
- 매일 만료 항목만 조회해 450건씩 파기하며 재실행 가능하다.
- Storage 삭제는 3회 시도 후 `RETENTION_DELETE_FAILED`로 안전한 상태만 기록하고 문서는 유지한다.
- 배송 사진은 권한 조회 전에 5MB 제한과 실제 JPEG 시작·종료 시그니처를 검증한다.
- 배송 사진 record의 실제 업로드 API 연결은 원 계획 Task 5.12에 유지한다.

## 검증 상태

- shared typecheck 통과
- 보관 13개, Storage 8개, 결제 15개, 회차 주문 흐름 28개, 운영 13개 통과
- Unit 1~9 지정 회귀 9개 스위트 111개 통과
- consumer `tsc --noEmit` 통과
- 전체 `pnpm build` 통과
- 변경 파일 Biome 오류 0건
- `git diff --check` 통과

## 핸드오프 규칙

- 새 대화에서는 Unit 10만 실행하고 Unit 1~9 계약을 보존한다.
- 실제 서비스 통합 E2E와 전체 검증을 통과한 뒤 원 계획 Task 4.2 복귀 조건과 보정 Closeout을 명시한다.
- 기존 사용자 변경, 배포·push 금지를 유지한다.

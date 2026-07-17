<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (전수 리뷰 보정 Unit 10 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Unit 10 시작 SHA: `aad26cd71aec198a42f31c7a702b43988bdcdf24`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_pre_4_2_full_review_remediation.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`의 `CL-167`
- 완료: 전수 리뷰 보정 Unit 1~10
- Task 4.2 복귀 조건: 충족
- 다음: 원 계획 Task 4.2 `apps/consumer/src/hooks/useSaleRounds.ts`
- Task 4.3 이후 화면·유입·장바구니·결제 구현은 선행하지 않는다.

## Unit 10 확정

- 실제 서비스 통합 E2E가 결제·예약·회차·상품의 단일 확정과 취소 환불·예약 반환을 검증한다.
- 소비자·판매자·기사 주문 조회 관계와 용량 반환 후 회차 자동 재개를 실제 서비스로 검증한다.
- Nest 앱 E2E는 provider 런타임 DI 조립을 통과하고 테스트마다 앱을 정상 종료한다.
- 소비자 계약은 보류·완료·활성 주문 상세을 분리하고 같은 회차 장바구니 조건을 명시한다.
- 보정된 권한·상태·멱등·알림·운영 예외·보관 계약은 구현 명세와 두 계획 Closeout에 반영했다.

## 검증 상태

- API 단위 22개 스위트 169개 통과
- API E2E 3개 스위트 7개 통과
- 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 0건
- `git diff --check` 통과

## 명시적 후속 위험

- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- 소비자 계약 24개는 Task 4.2~4.18 구현 전 `test.fixme`다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 5.3 셀러 회차 목록 화면 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 5.3 시작 SHA: `761c6fe60ec29d095abf38d09b0b9c6e32856925`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 5.3 `apps/seller/src/app/sale-rounds/page.tsx`
- 다음: Task 5.4 `apps/seller/src/app/sale-rounds/[id]/RoundForm.tsx`
- Task 5.5 이후 편집 라우트·드라이버 화면·인덱스 작업은 선행하지 않는다.

## Task 4.19 확정

- 인증된 서버 응답만 마케팅 동의 상태로 사용하고 정보성 연락과 선택 마케팅을 분리한다.

## Task 5.1~5.2 확정

- 회차 복사·예약·마감·완료 거부·정상 완료·확인 필요 진입을 상호 배타적인 6개 fixture로 분리했다.
- 셀러 세션과 `apiJson`으로 목록·상세·생성·저장·복사·상태 변경·완료 API를 `useSaleRounds`에 캡슐화했다.
- 12개 셀러 화면 계약은 실행 데이터와 상세 화면 준비 전까지 `test.fixme`이며, 훅은 손상 응답을 빈 회차나 성공으로 승격하지 않는다.

## Task 5.3 확정

- 작성 중·판매 예정·판매 중·주문 마감·배송 완료와 취소 상태, KST 주문 기간, 배송 지역을 목록에 표시한다.
- 주문 배송지·판매 수량·한도·결제 진행 중 확보량과 서버의 배송 보류·취소 실패만 확인 필요로 표시한다.
- 로딩·오류·빈 상태와 재조회를 분리하고 `useSaleRounds`의 `copyRound` 외 네트워크 경계를 만들지 않았다.
- 복사는 이름·주문 시작·마감만 받아 기존 경매·배송 간격과 상품·가격·한도를 보존하며 Task 5.4 편집 폼은 시작하지 않았다.
- seller 타입검사, 전체 typecheck·build, Biome, 셀러 12개·소비자 24개 목록 수집과 diff 검사가 통과했다.
- build가 갱신한 tracked 생성물 5개는 시작 상태로 되돌려 제외했고 별도 인접 테스트는 기존 화면 계약과 중복돼 추가하지 않았다.

## 명시적 후속 위험

- 소비자 E2E 24개와 셀러 E2E 12개는 실행 데이터·상세 화면 준비 전이라 `test.fixme`다.
- 사진 record의 실제 업로드 API·서명 URL 라우트·드라이버 연결은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.

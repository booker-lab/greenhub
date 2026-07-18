<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 5.11 드라이버 직배송 시작·보류 기록 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 5.11 시작 SHA: `20204c90cecc7b3d5d921875405ebfb0c896179f`
- 완료 계획: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 5.11 드라이버 회차 직배송 시작·보류 기록
- 다음: Task 5.12 인증된 서버 비공개 배송 사진 업로드 연결

## 선행 계약 확정

- 소비자 리뷰 보정은 예정 회차 선택, 단일 회차 바로 구매, 당근 유입 재검증, 마케팅 설정 진입까지 완료했다.
- Task 5.1의 상호 배타적 6개 fixture와 chromium·mobile 12개 `test.fixme` 화면 계약은 그대로 유지한다.
- Task 5.2 훅은 셀러 인증과 `apiJson`으로 목록·상세·생성·저장·복사·상태 변경·완료를 캡슐화한다.
- Task 5.3 목록은 상태·KST 일정·지역·한도·예약·주문·배송 보류를 표시하고 복사를 훅에만 위임한다.

## Task 5.11 확정

- `schemaVersion: 2`, `roundId`, `deliveryMethod: direct`를 함께 확인해 회차 직배송만 신규 흐름으로 구분한다.
- `PREPARING → DELIVERING` 시작과 `PREPARING|DELIVERING → DELIVERY_HELD` 보류 저장을 서버 API에 연결한다.
- 기상·출입·주소·연락 실패 코드를 서버 DTO와 일치시키고 책임·재배송비·다음 연락·새 배송 일정을 그대로 표시한다.
- 기상 보류는 고객 책임 `false`, 재배송비 `null`, 새 배송 예정 필수 계약을 화면과 요청에서 강제한다.
- 서버 응답의 주문 ID·상태를 확인하기 전 화면을 성공으로 바꾸지 않으며 Firestore 스냅샷을 상태 정본으로 유지한다.
- 사진 없는 회차 직배송 완료와 아직 안전하지 않은 기존 사진 화면 진입을 모두 제공하지 않는다.
- 보류 모달을 인접 파일로 분리해 수정 코드 파일을 각각 500줄 미만으로 유지했다.
- 드라이버 타입검사, 전체 typecheck·build, Playwright 목록 50개, Biome 오류 수준과 diff 검사가 통과했다.
- build가 갱신한 tracked 생성물 5개는 시작 상태로 되돌려 범위에서 제외했다.
- API·공유 타입·인덱스·보안 규칙과 사진 업로드 구현은 변경하지 않았다.

## 후속 Task 실행 원칙

- 다음 작업은 Task 5.12이며 드라이버 사진 화면의 클라이언트 Storage 직접 쓰기를 인증된 서버 업로드로 교체한다.
- 드라이버 E2E 14개, 소비자 E2E 24개와 셀러 E2E 12개는 실행 데이터·화면 준비 전까지 `test.fixme`다.
- 사진 업로드·서명 URL·드라이버 연결은 Task 5.12, 인덱스·보안 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않는다.
- 현재 작업 트리의 기존 미커밋 API·소비자·문서·스크립트·인덱스 변경은 사용자 작업으로 보존한다.

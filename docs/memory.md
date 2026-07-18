<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 6.1 실제 쿼리 복합 인덱스 보정 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 5.12 시작 SHA: `d4d47d577bd861278dd986d7edfb06e9746d2b7b`
- 완료 계획: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 6.1 실제 서비스 쿼리 기반 복합 인덱스와 누락 검출 계약
- 다음: Task 6.2 Firestore 서버 전용 컬렉션 클라이언트 직접 접근 차단

## 선행 계약 확정

- 소비자 리뷰 보정은 예정 회차 선택, 단일 회차 바로 구매, 당근 유입 재검증, 마케팅 설정 진입까지 완료했다.
- Task 5.1의 상호 배타적 6개 fixture와 chromium·mobile 12개 `test.fixme` 화면 계약은 그대로 유지한다.
- Task 5.2 훅은 셀러 인증과 `apiJson`으로 목록·상세·생성·저장·복사·상태 변경·완료를 캡슐화한다.
- Task 5.3 목록은 상태·KST 일정·지역·한도·예약·주문·배송 보류를 표시하고 복사를 훅에만 위임한다.

## Task 5.12 확정

- JWT multipart API가 실제 JPEG·5MB·스토어·회차 직배송·담당 기사·`DELIVERING`을 서버에서 검증한다.
- 요청 키 해시를 단일 사진 ID로 사용해 비공개 `deliveryPhotos/{orderId}/{photoId}.jpg` 경로를 유지한다.
- 업로드 성공 뒤 사진 ID와 90일 보관 기록을 트랜잭션으로 연결하고 기존 주문 수명주기로만 완료한다.
- 사진 없는 직접 완료와 회차 주문의 공개 URL 저장을 거부하며 같은 요청 재시도는 사진·완료를 중복 생성하지 않는다.
- 주문자 본인·스토어 소유자·담당 기사·관리자만 연결 사진의 15분 V4 서명 URL을 받을 수 있다.
- 드라이버는 `FormData` 서버 응답을 검증하고 회차 직배송만 완료하며 기존 거점 사진 의미는 legacy helper로 보존한다.
- 사진 API 계약 21개, 드라이버 타입검사, API·전체 build, 전체 typecheck, Playwright 목록 50개가 통과했다.
- build가 갱신한 tracked 생성물 5개는 시작 상태로 되돌려 범위에서 제외했다.
- 인덱스·Firestore 규칙·Storage 규칙은 변경하지 않았다.

## 후속 Task 실행 원칙

- Task 6.1은 `users(role, createdAt DESC)`, `orders(status, createdAt DESC)`, `orders(status, deliveryMethod, preparedAt ASC)`, `varieties(subCategory, name ASC)`만 새 복합 인덱스로 확정했다.
- 회차 공개 조회, 예약 직접 조회, 보관 만료 단일 범위, 운영 예외 스토어 조회, 주문 목록 동등 조건, 결제 주문 조회는 자동 인덱스 또는 인덱스 병합으로 충분하다.
- 실제 호출부·JSON 계약 23개와 관련 API 128개, API·전체 build, 타입 검사, JSON 파싱, Biome 검사가 통과했다.
- Firebase CLI 15.18.0은 설치돼 있지만 현재 JDK 17로는 JDK 21 이상을 요구하는 에뮬레이터를 실행할 수 없다.
- 다음 작업은 Task 6.2이며 JDK 21 이상에서 Firestore 규칙 에뮬레이터 실패 테스트를 먼저 고정한다.
- 드라이버 E2E 14개, 소비자 E2E 24개와 셀러 E2E 12개는 실행 데이터·화면 준비 전까지 `test.fixme`다.
- 인덱스는 Task 6.1, Firestore·Storage 보안 규칙은 Task 6.2~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않는다.
- 현재 작업 트리의 기존 미커밋 API·소비자·문서·스크립트·인덱스 변경은 사용자 작업으로 보존한다.

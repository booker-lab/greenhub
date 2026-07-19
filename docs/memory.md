<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-20 (원 계획 Task 6.6 운영 런북 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 5.12 시작 SHA: `d4d47d577bd861278dd986d7edfb06e9746d2b7b`
- 완료 계획: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 6.6 주간 운영·장애 대응·롤백·수동 환불 런북
- 다음: 별도 요청 후 Task 6.7 사용자 흐름 준비조건 확인

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

- Task 6.1은 실제 범위·정렬 쿼리에 필요한 복합 인덱스 4개만 추가했고 관련 계약 23개와 API 128개, 타입 검사와 build가 통과했다.
- Task 6.3은 중첩 회차 배송 사진의 모든 클라이언트 접근을 차단하고 공개 상품·배너·로고와 기사 전용 legacy 평면 사진을 보존했다.
- 사용자 전용 Temurin 21.0.11로 실제 Storage Emulator 계약 11개와 관련 API 37개가 통과했으며 시스템 기본 JDK 17은 유지했다.
- 다음 작업은 Task 6.4 서버 통합 계약이며 Storage 규칙·`salesMode`·애플리케이션 로직을 더 변경하지 않는다.
- 드라이버 E2E 14개, 소비자 E2E 24개와 셀러 E2E 12개는 실행 데이터·화면 준비 전까지 `test.fixme`다.
- 인덱스는 Task 6.1, Firestore·Storage 보안 규칙은 Task 6.2~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않는다.
- 현재 작업 트리의 기존 미커밋 API·소비자·문서·스크립트·인덱스 변경은 사용자 작업으로 보존한다.

## Task 6.6 확정

- `docs/specs/ops/mvp-sales-round-runbook.md`가 일요일 마감, 월요일 매입, 화요일 00:00~09:00 배송과 회차 상태별 운영 증거·중단·에스컬레이션을 고정한다.
- 실제 전환은 Task 6.7 통과와 별도 승인 뒤에만 가능하며, 소비자 장애 롤백 뒤에도 기존 회차 주문을 삭제·변환하지 않고 처리한다.
- 수동 환불은 PortOne 원격 재조회, 로컬 결제 대조, 열린 `AUTO_REFUND_FAILED`의 claim 기반 재시도를 우선해 중복을 막는다.
- 결제 조회·재배송·보관 파기 예외에는 현재 자동 조치가 없고, 늦은 결제 직접 환불 실패도 항상 전용 예외로 수렴하지 않으므로 기술 담당자에게 에스컬레이션한다.
- 비밀키·토큰·전체 개인정보·사진 원본·서명 URL을 로그와 증거에 남기지 않는다.
- 실제 운영 명령·Firestore 쓰기·환불·문자·상태 변경·배포·push는 수행하지 않았다.

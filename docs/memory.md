<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-22 (원 계획 Task 6.8 Closeout 완료)
## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- 리뷰 보정 기준 SHA: `b4ba7ff0719dd760ab56b1d78bcd656afd5ee10c`
- 완료 계획: `docs/plans/PLAN_mvp_sales_round_task5_review_remediation.md`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: 보완 계획 Task 5.4와 원 계획 Task 6.8
- 다음: 운영 전환은 별도 승인 뒤에만 진행

## 선행 계약 확정

- 소비자 리뷰 보정은 예정 회차 선택, 단일 회차 바로 구매, 당근 유입 재검증, 마케팅 설정 진입까지 완료했다.
- Task 5.1의 상호 배타적 6개 fixture와 chromium·mobile 12개 `test.fixme` 화면 계약은 그대로 유지한다.
- Task 5.12의 JWT multipart 비공개 사진 업로드와 legacy 거점 사진 경로 분리는 유지한다.
- 리뷰 보정은 원 계획 Task 6.1의 기존 미커밋 인덱스 변경을 수정하지 않았다.

## Task 5 리뷰 보정 확정

- `WEATHER`는 서버에서 판매자 책임·재배송비 없음·유효한 새 일정을 강제하고 손상 문서 청구도 차단한다.
- 배송 사진은 생성 전용 precondition과 SHA-256 metadata로 같은 요청의 다른 JPEG 덮어쓰기를 막는다.
- 업로드 연결 실패는 현재 요청이 만든 신규 미연결 객체만 정리한다.
- 최초 완료와 이미 `DELIVERED`인 재시도는 주문 ID 멱등 정산과 내구성 있는 완료 알림을 재조정한다.
- 권한 있는 완료·리뷰 단건 상세만 첫 연결 사진의 15분 URL을 반환하고 목록은 URL을 만들지 않는다.
- 담당 기사는 자신의 배송 중·보류 주문을 함께 보고 `DELIVERY_HELD → DELIVERING`으로 재개한다.
- 집중 API 78개, API 전체 199개, 타입 검사, production build, 드라이버 E2E 16개 목록 수집이 통과했다.
- build가 갱신한 기존 추적 생성물 5개는 임의 복원하지 않고 작업 트리에 보존했다.
- 인덱스·Firestore 규칙·Storage 규칙, `salesMode`, 배포 상태는 변경하지 않았다.

## 후속 Task 실행 원칙

- Task 6.1은 실제 범위·정렬 쿼리에 필요한 복합 인덱스 4개만 추가했고 관련 계약 23개와 API 128개, 타입 검사와 build가 통과했다.
- Task 6.3은 중첩 회차 배송 사진의 모든 클라이언트 접근을 차단하고 공개 상품·배너·로고와 기사 전용 legacy 평면 사진을 보존했다.
- 사용자 전용 Temurin 21.0.11로 실제 Storage Emulator 계약 11개와 관련 API 37개가 통과했으며 시스템 기본 JDK 17은 유지했다.
- Task 6.8은 전체 build와 필수 회귀 통과 및 잔여 위험 기록으로 닫혔다.
- 드라이버 E2E 16개, 소비자 E2E 24개와 셀러 E2E 12개는 `test.fixme` 없이 모두 통과했다.
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

## Task 6.8 Closeout

- `pnpm build`, API 단위 249개·E2E 10개, 소비자 78개, 셀러 43개, 드라이버 10개, fixture 7개와 Playwright 52개 목록 수집이 통과했다.
- shared·소비자·셀러·드라이버·E2E 타입 검사는 통과했고 API 전체 `tsc --noEmit`의 알려진 6개 오류는 기존 사용자 변경으로 남겼다.
- Task 6.7에서 생긴 드라이버 쿼리·인덱스 계약과 소비자 마감 문구·테스트 계약 불일치만 최소 보정했다.
- Node 모듈 형식, 기존 비 null 단언, webpack cache 경고는 비차단 잔여 위험으로 기록했고 legacy checkout 비 null 경고는 재현되지 않았다.
- 운영 `salesMode`·Firebase·Storage, 실제 결제·환불·알림, 배포·마이그레이션·push는 변경하거나 실행하지 않았다.

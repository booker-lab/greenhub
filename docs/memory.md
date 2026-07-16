# Green Love 프로젝트 메모

> **SSOT**: 세션 종료 시 최신 상태만 유지한다. 200라인 초과 시 아카이브하고 50라인 이내 요약으로 갱신한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-17 (전수 리뷰 보정 Unit 4 완료)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- 전수 리뷰 기준 SHA: `7cbd068`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_pre_4_2_full_review_remediation.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`의 `CL-167`
- 완료: Unit 1 결제·예약 정합성, Unit 2 주문 조회·웹훅 보안, Unit 3 주문 수명주기 원자성, Unit 4 회차 상태 정합성
- 다음: Unit 5 주문 생성 원자성·요청 멱등성
- 원 계획 `PLAN_mvp_sales_round_direct_delivery.md` Task 4.2는 Unit 10 완료 전까지 보류한다.

## 완료 계약

- 결제 최종화·timeout 취소는 예약 상태와 같은 트랜잭션에서 처리한다.
- 환불 claim은 멱등 처리하고 닫힌·만료 예약 소비를 차단한다.
- 소비자는 본인 주문, 판매자는 실제 소유 스토어 주문, 기사는 실제 배정 주문만 조회한다.
- admin 주문 조회 계약은 기존 전체 조회 정책을 유지한다.
- 주문 컨트롤러는 JWT 주체와 역할을 조회 서비스에 전달한다.
- PortOne 웹훅은 서명·Secret·raw body·필수 헤더·5분 timestamp가 유효해야 한다.
- 웹훅 서명은 `timingSafeEqual`로 비교하며 인증 정보 누락은 fail closed 처리한다.
- 회차 주문 상태 전환은 최신 주문 상태와 회차 카운터를 같은 트랜잭션에서 비교·갱신한다.
- 중복 배송 보류는 한 번만 반영하고 오래된 상태 기반 전환은 충돌로 거부한다.
- 회차 주문 취소는 환불과 로컬 정리를 단계 상태로 기록해 환불 성공 뒤 로컬 실패를 재시도한다.
- 재시도 시 완료된 외부 환불은 반복하지 않고 예약 반환과 주문 취소 상태만 다시 적용한다.
- legacy 주문 수명주기와 소비자·판매자·기사·admin 역할별 전환 계약은 유지한다.
- 판매자는 실제 소유 스토어의 회차만 목록·상세 조회·변경할 수 있고 admin은 기존 권한을 유지한다.
- 회차 상태 변경은 최신 상태 CAS로 보호하고 자동 마감은 `CAPACITY`와 `SCHEDULE_ENDED` 원인을 구분한다.
- `CAPACITY` 자동 마감만 마감 전 용량 회복 시 다시 열며 일정·수동 마감은 유지한다.
- 회차 취소는 Unit 3 주문 취소 saga로 활성 주문을 모두 정리한 뒤 확정하고 실패 시 `LOCAL_FAILED`로 재시도한다.

## 검증 상태

- Unit 4 회차 계약 11개, 회차·주문 회귀 33개, 전체 지정 회귀 52개 통과.
- shared typecheck, API 빌드, 변경 코드 Biome 오류 수준 검사, `git diff --check` 통과.

## 핸드오프 규칙

- 새 대화에서는 한 Unit만 구현하고 실패 테스트를 먼저 확인한다.
- 완료 후 계획표 상태·판정 근거를 갱신하고 Unit당 실제 커밋 하나를 남긴다.
- 15개 항목 완료 보고 마지막에 다음 Unit 전체 실행 프롬프트를 작성한다.
- 실행하지 않은 검증 결과나 존재하지 않는 커밋 SHA는 기록하지 않는다.
- 사전 사용자 변경, 배포·push, 원 계획 Task 4.2는 건드리지 않는다.

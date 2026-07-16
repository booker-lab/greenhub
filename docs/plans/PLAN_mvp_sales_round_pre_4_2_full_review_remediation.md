<!-- Language: ko -->

# Project Blueprint: 회차 직배송 4.2 진입 전 전수 리뷰 보정

## 문서 메타

- **작성일**: 2026-07-17
- **상태**: 실행 대기
- **Priority**: 0
- **Labels**: `bugfix`, `security`, `payment`, `order`, `notification`, `retention`, `handoff`
- **SSOT Check**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`, `docs/specs/mvp-sales-round-direct-delivery.md`, `docs/CRITICAL_LOGIC.md` #CL-166~167
- **Architectural Goal**: Task 1.1~4.1 전수 리뷰에서 확인된 정합성·권한·운영 연결 결함을 닫은 뒤 원 계획 Task 4.2 진입을 허용한다.
- **기준 브랜치**: `codex/mvp-sales-round-direct`
- **기준 커밋**: `7cbd068`
- **선행 관계**: 이 계획 전체가 완료되기 전 `PLAN_mvp_sales_round_direct_delivery.md` Task 4.2를 시작하지 않는다.

## 📋 업무 요약 (협업용)

### 개요

현재 구현은 단위 테스트와 빌드를 통과하지만 결제 확정 경쟁, 주문 조회 권한, 회차 취소, 중복 주문, 재배송비 실제 결제, 알림·운영 예외·보관 연결에 배포 차단급 결함이 남아 있다. 이번 계획은 화면 확장을 시작하기 전에 서버 상태와 개인정보 경계를 먼저 복구한다.

### 끝났을 때 확인할 것

- 결제·예약·주문 상태가 동시 실행에서도 한 상태로 수렴한다.
- 소비자·판매자·기사는 허용된 주문과 회차만 조회한다.
- 회차 취소가 주문 환불·예약 반환·카운터 정리까지 완료한다.
- 동일 결제 시도는 주문과 예약을 한 번만 만든다.
- 재배송비는 PortOne 결제부터 환불까지 실제 상태를 가진다.
- 알림 대체 채널과 운영 조치 기록이 실제 실행 결과와 일치한다.
- 법정 기록은 실제 주문·결제 흐름에서 생성되고 만료 배치로 파기된다.
- Task 4.1 계약은 동시에 성립할 수 있는 화면 상태별 시나리오로 분리된다.

### 이번 계획에서 하지 않는 것

- 소비자 화면 Task 4.2~4.19 구현
- 셀러·드라이버 화면 Task 5.x 구현
- 배송 사진 업로드 API와 드라이버 호출 경로 연결
- Firestore 인덱스·보안 규칙 배포
- 디어오키드 `salesMode` 전환
- Railway·Vercel·Firebase·PortOne 운영 환경 변경
- push·PR 생성

## 🎯 Origin Intent

- **출처**: `codex/mvp-sales-round-direct` Task 1.1~4.1 전수 리뷰 후속 요청
- **원래 목적**: 리뷰 결함을 독립 작업 단위로 나눠 새 대화에서 순차 구현할 수 있게 한다.
- **완료 관찰**: 각 Unit은 테스트·커밋·15개 항목 보고를 남기고 다음 Unit 전체 프롬프트를 생성한다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | 심각도 | Unit | 안전 조건 |
| :--- | :---: | :---: | :--- |
| 결제 확정과 timeout 정리 동시 실행 | P0 | 1 | 확정 잠금과 최신 주문 상태를 한 트랜잭션에서 검사 |
| 반환·만료 예약의 결제 소비 | P0 | 1 | `HELD`와 미만료 예약만 `CONSUMED` 허용 |
| 동일 환불의 동시 호출 | P1 | 1 | 환불 claim과 완료 상태를 멱등 기록 |
| 소비자·미배정 기사의 타인 주문 조회 | P0 | 2 | 역할과 주문 관계를 서버에서 검사 |
| 서명·Secret 없는 웹훅 | P1 | 2 | 운영 설정에서 fail closed |
| 보류 전환 중복으로 카운터 증가 | P1 | 3 | 주문 상태 비교와 카운터 변경을 같은 트랜잭션에 둠 |
| 외부 환불 성공 뒤 로컬 취소 실패 | P1 | 3 | 취소 saga 상태를 재시도 가능하게 기록 |
| 임시 예약 만석 뒤 회차 영구 마감 | P1 | 4 | 마감 원인을 기록하고 용량 회복 시 재개 |
| 회차 취소 뒤 활성 주문·카운터 잔류 | P1 | 4 | 모든 주문 취소 완료 뒤 회차 취소 확정 |
| 중복 클릭·네트워크 재시도로 주문 중복 | P1 | 5 | 클라이언트 생성 요청 ID로 주문 문서와 예약을 결정 |
| 예약 저장 뒤 주문 저장 전 프로세스 종료 | P1 | 5 | 주문·예약·카운터를 같은 트랜잭션에 기록 |
| 재배송비 문서만 생성되고 결제 미완료 | P1 | 6 | 별도 paymentId로 웹훅 확정·실패·환불 처리 |
| 문자 대체 성공을 알림톡 성공으로 기록 | P1 | 7 | 실제 성공 채널과 시도 횟수를 저장 |
| 배송 연락처가 프로필과 다른 주문 | P1 | 7 | 주문 `deliveryPhone`을 거래 알림 우선 연락처로 사용 |
| 해결된 운영 예외의 같은 실패 재발 | P1 | 8 | 최신 스냅샷 갱신 뒤 항목 재개방 |
| 예외 유형과 맞지 않는 운영 조치 | P1 | 8 | 유형별 허용 action 표로 차단 |
| 보관 대상 500건 초과 | P1 | 9 | 제한 이하 배치로 나눠 멱등 파기 |
| 보관 metadata에 전화번호·주소 포함 | P1 | 9 | 목적별 허용 필드만 저장 |
| 주문 상세에서 상호 배타 상태 동시 요구 | P1 | 10 | 보류·완료·취소를 별도 fixture로 분리 |
| 실제 서비스가 아닌 mock E2E만 통과 | P1 | 10 | 실제 도메인 서비스를 사용하는 통합 계약 추가 |

## 🔍 Diagnosis & Findings

- `PaymentsService`는 확정 잠금과 timeout 정리가 서로의 상태를 확인하지 않는다.
- `OrderCapacityService`는 만료·반환 예약을 소비 요청에서 오류 없이 반환한다.
- 주문 조회 계층은 소비자와 기사에게 스토어 전체 주문을 노출할 수 있다.
- 회차 조회는 판매자 역할만 확인하고 스토어 소유권을 확인하지 않는다.
- 회차 자동 마감은 용량이 반환돼도 다시 열리지 않는다.
- 회차 취소는 환불만 실행하고 주문 상태와 예약 카운터를 정리하지 않는다.
- 회차 주문 생성은 요청 멱등 키가 없고 예약과 주문을 서로 다른 트랜잭션에 저장한다.
- 재배송비는 `PENDING` 문서만 생성하며 PortOne 확정 경로가 없다.
- 알림톡 본문, 실제 대체 채널, 주문 배송 연락처, 문자 재발송 조치가 런타임 계약과 어긋난다.
- 운영 예외 작성과 운영 조치가 한 서비스에 결합돼 결제·알림 순환 의존성이 커졌다.
- 보관 서비스는 실제 생성 호출과 정기 파기 실행 경로가 없다.
- 핵심 서비스 네 개가 442~498줄이라 결함 코드를 직접 추가하면 500줄 제한을 넘는다.

## 🏗️ Architectural Deepening

- **Seam**: 결제 확정·환불, 회차 주문 생성·수명주기, 회차 상태 변경을 전용 서비스로 먼저 분리한다.
- **Consistency**: Firestore 상태 변경은 최신 문서를 다시 읽는 트랜잭션과 명시적 claim으로 보호한다.
- **Side Effect**: PortOne 환불·문자 발송 같은 외부 동작은 시작·완료·실패 상태를 저장해 재시도 가능하게 만든다.
- **Security**: 컨트롤러의 JWT 역할과 서비스의 실제 소유권·배정 관계를 함께 검사한다.
- **Operations**: 예외 작성 전용 서비스와 운영 조치 서비스를 분리해 결제·알림 호출 경로의 순환 의존성을 줄인다.
- **Retention**: 임의 metadata를 폐기하고 목적별 허용 필드와 트랜잭션용 record builder를 제공한다.
- **Compatibility**: `legacy` 주문 경로는 유지하고 `round_direct` 분기에서만 신규 요청 멱등 계약을 강제한다.

## Agent Completion Contract

1. Unit를 1부터 10까지 순서대로 한 번에 하나만 실행한다.
2. 각 Unit 내부 Task를 표 순서대로 진행한다.
3. 신규 동작은 실패 테스트를 먼저 추가한다.
4. 기존 사용자 미커밋 변경을 되돌리거나 덮어쓰지 않는다.
5. 코드 파일은 500줄 미만을 유지한다.
6. 외부 서비스 호출은 단위 테스트에서 mock으로 격리한다.
7. staging·production 배포는 별도 사용자 승인 전 실행하지 않는다.
8. Unit 검증이 모두 통과한 뒤에만 Unit 전용 커밋을 만든다.
9. 커밋 메시지는 표의 권장 메시지를 사용하되 실제 범위에 맞게 한국어로 조정할 수 있다.
10. Unit 완료 후 이 계획의 해당 Task `Status`와 `Conclusion`만 실제 결과로 갱신한다.
11. Unit 완료 응답은 아래 15개 항목을 모두 포함한다.
12. 완료 응답 15번은 다음 Unit을 새 대화에서 그대로 실행할 수 있는 전체 프롬프트다.
13. 다음 프롬프트 안에도 동일한 15개 항목 보고와 재귀 핸드오프 규칙을 포함한다.
14. 아직 실행하지 않은 테스트 결과와 존재하지 않는 커밋 SHA를 추정하지 않는다.
15. Unit 10 완료 전 원 계획 Task 4.2를 시작하지 않는다.

### Unit 완료 보고 15개 항목

1. 완료한 Unit
2. 목표와 판정
3. 시작 브랜치와 시작 SHA
4. 범위 내 구현
5. 범위 밖으로 유지한 항목
6. 핵심 설계 결정
7. 상태·데이터 정합성 영향
8. 보안·개인정보 영향
9. 실제 변경 파일
10. 추가·수정한 테스트
11. 실행한 검증 명령과 실제 결과
12. 실패 후 보정 이력
13. 실제 커밋 SHA
14. 잔여 위험과 다음 Unit 선행조건
15. 다음 Unit 전체 실행 프롬프트

### 다음 Unit 프롬프트 필수 내용

- 브랜치와 직전 커밋 SHA
- 이 계획 파일 경로
- 실행할 Unit 번호와 허용 범위
- 필수 사전 읽기 파일
- 보존해야 할 기존 미커밋 변경
- Task 순서
- 테스트 선행 규칙
- Unit 검증 명령
- 권장 커밋 메시지
- 15개 항목 완료 보고
- 그다음 Unit 전체 프롬프트 재작성 규칙

> **에이전트 스코프**: 사용자가 이 PLAN 전체 실행을 요청하면 아래 Unit를 Dependency 순서로 진행한다. Unit 하나를 완료하고 커밋한 뒤 15개 항목 보고와 다음 Unit 프롬프트를 제공하고 턴을 종료한다.

## Execution Plan

### Unit 1. 결제·예약 최종 정합성 [P0]

- **Dependency**: 없음
- **Pre-read**: `payments.service.ts`, `order-capacity.service.ts`, 두 서비스의 spec
- **권장 커밋**: `fix(api): 결제 예약 확정 경쟁 조건 보정`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1.1 | `apps/api/src/payments/payments.service.spec.ts` | 결제 확정·timeout·환불 경쟁의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | 중복 확정, scheduler 경쟁, 늦은 결제, 환불 재시도 6개 계약 통과. | done |
| 1.2 | `apps/api/src/orders/mvp-order-flow.spec.ts` | 예약 재사용·만료·닫힌 상태 소비의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | `RELEASED`, `EXPIRED`, 타 주문 `CONSUMED`, 만료 `HELD` 소비 차단 포함 18개 통과. | done |
| 1.3 | `apps/api/src/payments/payment-refund.service.ts` | 환불 claim과 완료 기록을 멱등 서비스로 구현한다. | `pnpm --filter api build` | 환불 claim 만료와 완료·실패 해제를 기록해 동시 호출과 완료 뒤 재시도를 멱등 처리함. | done |
| 1.4 | `apps/api/src/payments/payment-finalization.service.ts` | 결제 claim·예약 소비·주문 확정을 최신 상태 기반으로 구현한다. | `pnpm --filter api build` | 최신 주문 확인 뒤 예약 소비·주문 확정·결제 기록을 단일 트랜잭션으로 적용함. | done |
| 1.5 | `apps/api/src/orders/order-capacity.service.ts` | 미만료 `HELD` 예약만 소비하도록 상태 전이를 강화한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 동일 주문 멱등 재호출만 허용하고 닫힌·만료 예약의 신규 소비를 거부함. | done |
| 1.6 | `apps/api/src/payments/payments.service.ts` | 웹훅·scheduler·환불 진입을 분리 서비스에 위임한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | 조회·권한 facade를 보존하고 웹훅·scheduler·환불 상태 변경을 전용 서비스에 위임함. | done |
| 1.7 | `apps/api/src/payments/payments.module.ts` | 결제 확정 서비스와 환불 서비스를 provider로 등록한다. | `pnpm --filter api build` | 두 전용 서비스를 provider로 등록하고 API 빌드 통과. | done |

- **Unit Verify**: `pnpm --filter api test -- payments.service.spec.ts mvp-order-flow.spec.ts --runInBand`
- **Exit**: 결제된 주문은 반드시 `CONSUMED`, 취소된 주문은 반드시 `RELEASED|EXPIRED`다.

### Unit 2. 주문 조회·웹훅 보안 경계 [P0]

- **Dependency**: Unit 1
- **Pre-read**: `orders-query.service.ts`, `orders.controller.ts`, `portone.client.ts`, `payments.controller.ts`
- **권장 커밋**: `fix(api): 주문 조회와 결제 웹훅 권한 강화`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2.1 | `apps/api/src/orders/orders-query.service.spec.ts` | 역할별 목록·상세 조회 권한의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- orders-query.service.spec.ts --runInBand` | 소비자·판매자·기사 권한 실패와 admin 보존을 포함한 6개 계약이 통과했다. | done |
| 2.2 | `apps/api/src/orders/orders-query.service.ts` | 소비자 본인·판매자 소유 스토어·배정 기사만 주문을 읽게 한다. | `pnpm --filter api test -- orders-query.service.spec.ts --runInBand` | 소비자 `userId`, 기사 `driverId`, 판매자 스토어 `ownerId`를 서버에서 강제해 6개 테스트가 통과했다. | done |
| 2.3 | `apps/api/src/orders/orders.controller.ts` | JWT 역할을 조회 서비스에 전달한다. | `pnpm --filter api build` | 목록·상세 조회에 JWT 주체와 역할을 전달하고 API 빌드가 통과했다. | done |
| 2.4 | `apps/api/src/payments/portone.client.spec.ts` | 누락 서명·누락 Secret·오래된 timestamp의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- portone.client.spec.ts --runInBand` | 누락 서명·Secret과 5분 초과 timestamp 실패를 포함한 7개 테스트가 통과했다. | done |
| 2.5 | `apps/api/src/payments/portone.client.ts` | 서명 검증을 fail closed와 상수 시간 비교로 강화한다. | `pnpm --filter api test -- portone.client.spec.ts --runInBand` | 필수 입력·Secret·timestamp를 닫힌 방식으로 검증하고 `timingSafeEqual` 비교를 적용해 7개 테스트가 통과했다. | done |
| 2.6 | `apps/api/src/payments/payments.controller.ts` | raw body와 필수 웹훅 헤더 누락을 인증 실패로 처리한다. | `pnpm --filter api build` | raw body와 3개 필수 헤더를 선검증해 누락 요청을 인증 실패로 처리하고 API 빌드가 통과했다. | done |

- **Unit Verify**: `pnpm --filter api test -- orders-query.service.spec.ts portone.client.spec.ts --runInBand`
- **Exit**: 타인 주문 개인정보와 미서명 웹훅이 모두 차단된다.

### Unit 3. 주문 상태·취소·보류 원자성 [P1]

- **Dependency**: Unit 2
- **Pre-read**: `orders-lifecycle.service.ts`, `orders.helpers.ts`, `mvp-order-flow.spec.ts`
- **권장 커밋**: `fix(api): 회차 주문 상태 전환 원자성 보정`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 3.1 | `apps/api/src/orders/mvp-order-flow.spec.ts` | 중복 보류·오래된 전환·부분 취소의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 중복 보류 1회 반영, 오래된 상태 거부, 환불 뒤 로컬 실패 재시도와 역할별 전환 보존을 포함한 22개 계약 통과. | done |
| 3.2 | `apps/api/src/orders/round-order-lifecycle.service.ts` | 회차 주문 보류·취소 saga를 전용 서비스로 구현한다. | `pnpm --filter api build` | 최신 주문·회차를 같은 트랜잭션에서 비교하고 보류 카운터를 원자 갱신하며 취소를 `REFUNDING → LOCAL_PENDING|FAILED → COMPLETED`로 기록함. | done |
| 3.3 | `apps/api/src/orders/orders-lifecycle.service.ts` | 신규 주문 처리를 전용 서비스에 위임하고 legacy 경로를 보존한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | `schemaVersion: 2` 회차 주문만 전용 서비스에 위임하고 공동구매·legacy 주문 수명주기 경로를 유지해 22개 계약 통과. | done |
| 3.4 | `apps/api/src/orders/orders.helpers.ts` | 역할별 상태표를 보류 해소 계약과 일치시킨다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 소비자 리뷰, 판매자 보류 해소·취소, 기사 배송 재개, admin 합집합 전환 계약을 명시적으로 보존함. | done |
| 3.5 | `apps/api/src/orders/orders.module.ts` | 회차 주문 수명주기 서비스를 등록하고 export한다. | `pnpm --filter api build` | 회차 주문 수명주기 서비스를 provider와 export에 등록하고 API 빌드 통과. | done |

- **Unit Verify**: `pnpm --filter api test -- mvp-order-flow.spec.ts payments.service.spec.ts --runInBand`
- **Exit**: 보류 카운터는 정확히 한 번 변하고 취소 재시도는 외부 환불을 반복하지 않는다.

### Unit 4. 회차 소유권·마감·취소 정합성 [P1]

- **Dependency**: Unit 3
- **Pre-read**: `sale-rounds.service.ts`, `sale-rounds.controller.ts`, `sale-rounds.service.spec.ts`
- **권장 커밋**: `fix(api): 판매 회차 상태와 취소 정합성 보정`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 4.1 | `packages/shared/src/sale-round.types.ts` | 회차 마감 원인과 운영 예외 action 정본의 확장 지점을 정의한다. | `pnpm --filter @greenhub/shared typecheck` | [판정 대기 — 회차 공통 계약 확장. 검증 결과] | todo |
| 4.2 | `apps/api/src/sale-rounds/sale-rounds.service.spec.ts` | 조회 소유권·상태 경쟁·용량 재개·취소 정리의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- sale-rounds.service.spec.ts --runInBand` | [판정 대기 — 회차 상태 실패 계약. 검증 결과] | todo |
| 4.3 | `apps/api/src/sale-rounds/sale-round-state.service.ts` | 상태 CAS·용량 재개·회차 취소 조정을 전용 서비스로 구현한다. | `pnpm --filter api build` | [판정 대기 — 회차 상태 서비스 분리. 검증 결과] | todo |
| 4.4 | `apps/api/src/sale-rounds/sale-rounds.service.ts` | CRUD·목록 facade에 판매자 소유권 검사를 적용한다. | `pnpm --filter api test -- sale-rounds.service.spec.ts --runInBand` | [판정 대기 — 회차 facade 권한 보정. 검증 결과] | todo |
| 4.5 | `apps/api/src/sale-rounds/sale-rounds.controller.ts` | 판매자 회차 읽기 요청에 인증 주체와 역할을 전달한다. | `pnpm --filter api build` | [판정 대기 — 회차 읽기 권한 연결. 검증 결과] | todo |
| 4.6 | `apps/api/src/sale-rounds/sale-rounds.module.ts` | 회차 상태 서비스와 주문 수명주기 의존성을 등록한다. | `pnpm --filter api build` | [판정 대기 — 회차 모듈 연결. 검증 결과] | todo |

- **Unit Verify**: `pnpm --filter api test -- sale-rounds.service.spec.ts mvp-order-flow.spec.ts --runInBand`
- **Exit**: 취소 회차에 활성 주문과 점유 카운터가 남지 않는다.

### Unit 5. 주문 생성 원자성·요청 멱등성 [P1]

- **Dependency**: Unit 4
- **Pre-read**: `orders-create.service.ts`, `create-order.dto.ts`, `usePayment.ts`, `checkout/page.tsx`
- **권장 커밋**: `fix(order): 회차 주문 생성과 결제 요청 멱등화`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 5.1 | `packages/shared/src/order.types.ts` | 회차 결제 시도 식별자 계약을 주문 요청 타입에 추가한다. | `pnpm --filter @greenhub/shared typecheck` | [판정 대기 — 주문 요청 멱등 계약. 검증 결과] | todo |
| 5.2 | `apps/api/src/orders/dto/create-order.dto.ts` | 배송일 검증을 서비스 모드 판정과 충돌하지 않게 정리한다. | `pnpm --filter api build` | [판정 대기 — 주문 DTO 보정. 검증 결과] | todo |
| 5.3 | `apps/api/src/orders/mvp-order-flow.spec.ts` | 중복 요청·원자 저장·legacy 배송일의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | [판정 대기 — 주문 생성 실패 계약. 검증 결과] | todo |
| 5.4 | `apps/api/src/orders/round-order-create.service.ts` | 주문·예약·카운터를 한 트랜잭션에 기록하는 회차 생성 서비스를 구현한다. | `pnpm --filter api build` | [판정 대기 — 회차 주문 생성 분리. 검증 결과] | todo |
| 5.5 | `apps/api/src/orders/orders-create.service.ts` | 회차 생성을 위임하고 legacy 전화번호·배송일 계약을 보존한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | [판정 대기 — 주문 생성 facade 축소. 검증 결과] | todo |
| 5.6 | `apps/api/src/orders/orders.module.ts` | 회차 주문 생성 서비스를 provider로 등록한다. | `pnpm --filter api build` | [판정 대기 — 주문 생성 모듈 연결. 검증 결과] | todo |
| 5.7 | `apps/consumer/src/hooks/usePayment.ts` | 오류 재시도에서 같은 결제 시도 ID를 재사용한다. | `pnpm --filter consumer exec tsc --noEmit` | [판정 대기 — 단일 결제 훅 멱등화. 검증 결과] | todo |
| 5.8 | `apps/consumer/src/app/checkout/page.tsx` | 장바구니 반복 요청에 상품별 안정적인 결제 시도 ID를 전달한다. | `pnpm --filter consumer exec tsc --noEmit` | [판정 대기 — 기존 장바구니 재시도 보호. 검증 결과] | todo |

- **Unit Verify**: `pnpm build`
- **Exit**: 같은 결제 시도 ID는 주문·예약 한 건만 반환한다.

### Unit 6. 재배송비 실제 결제 수명주기 [P1]

- **Dependency**: Unit 5
- **Pre-read**: `order-charges.service.ts`, 결제 확정 서비스, 관련 주문 spec
- **권장 커밋**: `feat(api): 재배송비 결제 확정과 환불 연결`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 6.1 | `apps/api/src/orders/mvp-order-flow.spec.ts` | 재배송비 결제 파라미터·중복 요청·취소 환불의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | [판정 대기 — 재배송비 주문 계약. 검증 결과] | todo |
| 6.2 | `apps/api/src/payments/payments.service.spec.ts` | 재배송비 웹훅 확정·실패·중복의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | [판정 대기 — 재배송비 결제 계약. 검증 결과] | todo |
| 6.3 | `apps/api/src/orders/order-charges.service.ts` | 안정적인 PortOne paymentId와 결제 요청 파라미터를 생성한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | [판정 대기 — 재배송비 청구 생성. 검증 결과] | todo |
| 6.4 | `apps/api/src/payments/order-charge-payment.service.ts` | 재배송비 결제 확정·실패·환불을 멱등 서비스로 구현한다. | `pnpm --filter api build` | [판정 대기 — 재배송비 결제 서비스. 검증 결과] | todo |
| 6.5 | `apps/api/src/payments/payments.service.ts` | 재배송비 paymentId를 전용 결제 서비스로 라우팅한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | [판정 대기 — 재배송비 웹훅 라우팅. 검증 결과] | todo |
| 6.6 | `apps/api/src/payments/payments.module.ts` | 재배송비 결제 서비스를 provider로 등록한다. | `pnpm --filter api build` | [판정 대기 — 재배송비 모듈 연결. 검증 결과] | todo |
| 6.7 | `apps/api/src/orders/round-order-lifecycle.service.ts` | 주문 취소에서 결제된 재배송비를 함께 환불한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | [판정 대기 — 재배송비 취소 환불. 검증 결과] | todo |

- **Unit Verify**: `pnpm --filter api test -- mvp-order-flow.spec.ts payments.service.spec.ts --runInBand`
- **Exit**: 재배송비는 `PENDING → PAID|FAILED → REFUNDED` 상태를 실제 웹훅과 환불로 가진다.

### Unit 7. 알림 본문·채널·연락처 정합성 [P1]

- **Dependency**: Unit 6
- **Pre-read**: notification shared 타입, `aligo.client.ts`, `notifications.service.ts`
- **권장 커밋**: `fix(api): 거래 알림 채널과 배송 연락처 정합성 보정`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 7.1 | `packages/shared/src/notification.types.ts` | API와 소비자가 공유할 거래 알림 코드 정본을 확정한다. | `pnpm --filter @greenhub/shared typecheck` | [판정 대기 — 알림 공통 계약. 검증 결과] | todo |
| 7.2 | `apps/api/src/notifications/notification-templates.ts` | 승인 본문과 변수 치환 규칙을 템플릿 카탈로그로 정의한다. | `pnpm --filter api build` | [판정 대기 — 알림 템플릿 카탈로그. 검증 결과] | todo |
| 7.3 | `apps/api/src/notifications/notifications-delivery.spec.ts` | 실제 채널·배송 연락처·문자 재발송의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand` | [판정 대기 — 알림 전달 실패 계약. 검증 결과] | todo |
| 7.4 | `apps/api/src/notifications/notifications-preferences.spec.ts` | 두 채널 동시 잘못된 타입과 빈 입력의 실패 테스트를 고정한다. | `pnpm --filter api test -- notifications-preferences.spec.ts --runInBand` | [판정 대기 — 알림 설정 실패 계약. 검증 결과] | todo |
| 7.5 | `apps/api/src/notifications/aligo.client.ts` | 템플릿 본문과 실제 성공 채널을 반환하도록 발송기를 구현한다. | `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand` | [판정 대기 — 알리고 발송기 보정. 검증 결과] | todo |
| 7.6 | `apps/api/src/notifications/notifications.service.ts` | 주문 배송 연락처·실제 채널·문자 재발송을 거래 알림에 적용한다. | `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand` | [판정 대기 — 거래 알림 서비스 보정. 검증 결과] | todo |
| 7.7 | `apps/api/src/notifications/notifications.controller.ts` | 알림 설정의 최소 한 필드와 boolean 검증을 동시에 강제한다. | `pnpm --filter api test -- notifications-preferences.spec.ts --runInBand` | [판정 대기 — 알림 설정 DTO 보정. 검증 결과] | todo |
| 7.8 | `apps/api/src/orders/orders.helpers.ts` | 배송 보류·재배송 요청·재배송 예정 알림 전환을 상태표에 연결한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | [판정 대기 — 주문 알림 전환 연결. 검증 결과] | todo |

- **Unit Verify**: `pnpm --filter api test -- notifications-delivery.spec.ts notifications-preferences.spec.ts mvp-order-flow.spec.ts --runInBand`
- **Exit**: 알림 로그 채널과 실제 발송 채널이 일치하고 거래 연락처 누락이 운영 예외로 남는다.

### Unit 8. 운영 예외 작성·조치 분리 [P1]

- **Dependency**: Unit 7
- **Pre-read**: `operations.service.ts`, 운영 spec, 결제·알림 실패 생성 경로
- **권장 커밋**: `refactor(api): 운영 예외 작성과 조치 경계 분리`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 8.1 | `packages/shared/src/sale-round.types.ts` | 운영 예외 유형과 action 응답 구조를 런타임 정본에 맞춘다. | `pnpm --filter @greenhub/shared typecheck` | [판정 대기 — 운영 예외 공통 계약. 검증 결과] | todo |
| 8.2 | `apps/api/src/operations/operations.service.spec.ts` | 재개방·최신 병합·action 매트릭스·동시 조치의 실패 테스트를 고정한다. | `pnpm --filter api test -- operations.service.spec.ts --runInBand` | [판정 대기 — 운영 예외 실패 계약. 검증 결과] | todo |
| 8.3 | `apps/api/src/operations/operation-issue-writer.service.ts` | 예외 생성·병합·재개방을 외부 의존성 없는 서비스로 구현한다. | `pnpm --filter api build` | [판정 대기 — 운영 예외 writer. 검증 결과] | todo |
| 8.4 | `apps/api/src/operations/operation-issues.module.ts` | 예외 writer를 독립 모듈로 제공한다. | `pnpm --filter api build` | [판정 대기 — 운영 예외 writer 모듈. 검증 결과] | todo |
| 8.5 | `apps/api/src/operations/operations.service.ts` | 유형별 action 허용과 조치 claim을 적용한다. | `pnpm --filter api test -- operations.service.spec.ts --runInBand` | [판정 대기 — 운영 조치 서비스 보정. 검증 결과] | todo |
| 8.6 | `apps/api/src/operations/operations.module.ts` | 조치 서비스가 독립 writer 모듈을 사용하게 연결한다. | `pnpm --filter api build` | [판정 대기 — 운영 모듈 의존성 보정. 검증 결과] | todo |
| 8.7 | `apps/api/src/notifications/notifications.service.ts` | 알림 실패 생성을 writer 서비스로 전환한다. | `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand` | [판정 대기 — 알림 예외 writer 전환. 검증 결과] | todo |
| 8.8 | `apps/api/src/orders/order-charges.service.ts` | 재배송 실패 생성을 writer 서비스로 전환한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | [판정 대기 — 재배송 예외 writer 전환. 검증 결과] | todo |
| 8.9 | `apps/api/src/payments/payment-finalization.service.ts` | 결제 조회 최종 실패를 운영 예외로 기록한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | [판정 대기 — 결제 조회 예외 연결. 검증 결과] | todo |
| 8.10 | `apps/api/src/payments/payment-refund.service.ts` | 자동 환불 최종 실패를 운영 예외로 기록한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | [판정 대기 — 자동 환불 예외 연결. 검증 결과] | todo |

- **Unit Verify**: `pnpm --filter api test -- operations.service.spec.ts notifications-delivery.spec.ts payments.service.spec.ts mvp-order-flow.spec.ts --runInBand`
- **Exit**: 같은 실패는 최신 상태로 한 항목에 모이고 잘못된 조치는 외부 호출 전에 거부된다.

### Unit 9. 법정 보관·Storage 안전성 [P1]

- **Dependency**: Unit 8
- **Pre-read**: `retention.service.ts`, `storage.service.ts`, 주문 생성·결제 확정 서비스
- **권장 커밋**: `fix(api): 법정 보관 생성과 만료 파기 연결`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 9.1 | `apps/api/src/retention/retention.service.spec.ts` | 허용 metadata·500건 초과·정기 파기의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- retention.service.spec.ts --runInBand` | [판정 대기 — 보관 실패 계약. 검증 결과] | todo |
| 9.2 | `apps/api/src/retention/retention.service.ts` | 목적별 허용 필드·분할 배치·정기 파기를 구현한다. | `pnpm --filter api test -- retention.service.spec.ts --runInBand` | [판정 대기 — 보관 서비스 보정. 검증 결과] | todo |
| 9.3 | `apps/api/src/retention/retention.module.ts` | 운영 예외 writer 의존성을 보관 모듈에 연결한다. | `pnpm --filter api build` | [판정 대기 — 보관 모듈 연결. 검증 결과] | todo |
| 9.4 | `apps/api/src/orders/round-order-create.service.ts` | 주문 생성 트랜잭션에 계약 기록과 마케팅 동의 기록을 추가한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | [판정 대기 — 주문 보관 기록 연결. 검증 결과] | todo |
| 9.5 | `apps/api/src/payments/payment-finalization.service.ts` | 결제 확정 트랜잭션에 법정 결제 기록을 추가한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | [판정 대기 — 결제 보관 기록 연결. 검증 결과] | todo |
| 9.6 | `apps/api/src/payments/payment-refund.service.ts` | 환불 완료에 분쟁·고객응대 기록을 추가한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | [판정 대기 — 환불 보관 기록 연결. 검증 결과] | todo |
| 9.7 | `apps/api/src/firestore/storage.service.spec.ts` | 파일 크기·JPEG 시그니처·content type 위장의 실패 테스트를 고정한다. | `pnpm --filter api test -- storage.service.spec.ts --runInBand` | [판정 대기 — Storage 입력 실패 계약. 검증 결과] | todo |
| 9.8 | `apps/api/src/firestore/storage.service.ts` | 배송 사진 업로드 크기와 실제 JPEG 형식을 검증한다. | `pnpm --filter api test -- storage.service.spec.ts --runInBand` | [판정 대기 — Storage 업로드 보정. 검증 결과] | todo |

- **Unit Verify**: `pnpm --filter api test -- retention.service.spec.ts storage.service.spec.ts mvp-order-flow.spec.ts payments.service.spec.ts --runInBand`
- **Exit**: 주문·결제·환불 기록은 실제 흐름에서 생성되고 파기는 500건을 넘어도 완료된다.
- **명시적 후속 유지**: 배송 사진 record 생성은 실제 업로드 API를 연결하는 원 계획 Task 5.12에서 완료한다.

### Unit 10. 계약·통합 검증·4.2 복귀 [Gate]

- **Dependency**: Unit 9
- **Pre-read**: 소비자 4.1 spec, API E2E, 구현 명세, 원 계획 Closeout
- **권장 커밋**: `test: 회차 직배송 보정 통합 계약 확정`

| Task | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 10.1 | `apps/e2e/tests/consumer-round-direct.spec.ts` | 상호 배타 주문 상태를 분리하고 회차·장바구니 단언을 강화한다. | `pnpm --filter e2e exec playwright test consumer-round-direct.spec.ts --list` | [판정 대기 — 소비자 계약 보정. 검증 결과] | todo |
| 10.2 | `apps/api/test/helpers/in-memory-firestore.ts` | 실제 도메인 서비스용 트랜잭션 테스트 어댑터를 제공한다. | `pnpm --filter api test:e2e -- mvp-sales-round-consistency.e2e-spec.ts --runInBand` | [판정 대기 — 통합 테스트 어댑터. 검증 결과] | todo |
| 10.3 | `apps/api/test/mvp-sales-round-consistency.e2e-spec.ts` | 실제 서비스로 결제·취소·권한·회차 정합성을 검증한다. | `pnpm --filter api test:e2e -- mvp-sales-round-consistency.e2e-spec.ts --runInBand` | [판정 대기 — 서버 통합 계약. 검증 결과] | todo |
| 10.4 | `apps/api/test/app.e2e-spec.ts` | Nest 애플리케이션을 테스트 종료 시 정상적으로 닫는다. | `pnpm --filter api test:e2e -- app.e2e-spec.ts --runInBand` | [판정 대기 — E2E 열린 handle 해소. 검증 결과] | todo |
| 10.5 | `docs/specs/mvp-sales-round-direct-delivery.md` | 보정된 권한·상태·멱등·알림·보관 계약을 명세에 반영한다. | `git diff --check -- docs/specs/mvp-sales-round-direct-delivery.md` | [판정 대기 — 구현 명세 갱신. 검증 결과] | todo |
| 10.6 | `docs/plans/PLAN_mvp_sales_round_direct_delivery.md` | Task 4.2 진입 조건과 명시적 후속 위험을 Closeout에 기록한다. | `git diff --check -- docs/plans/PLAN_mvp_sales_round_direct_delivery.md` | [판정 대기 — 원 계획 복귀 지점. 검증 결과] | todo |
| 10.7 | `docs/plans/PLAN_mvp_sales_round_pre_4_2_full_review_remediation.md` | 전체 검증 결과와 잔여 위험을 Closeout에 기록한다. | `git diff --check -- docs/plans/PLAN_mvp_sales_round_pre_4_2_full_review_remediation.md` | [판정 대기 — 보정 계획 종결. 검증 결과] | todo |
| 10.8 | `docs/memory.md` | 완료 결과와 원 계획 Task 4.2 진입점을 50줄 이내로 기록한다. | `git diff --check -- docs/memory.md` | [판정 대기 — 프로젝트 memory 갱신. 검증 결과] | todo |

- **Unit Verify**:
  - `pnpm --filter api test -- --runInBand`
  - `pnpm --filter api test:e2e -- --runInBand`
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm --filter e2e exec playwright test consumer-round-direct.spec.ts --list`
  - `git diff --check`
- **Exit**: 범위 내 P0·P1 결함이 닫히고 원 계획 Task 4.2가 다음 진입점으로 기록된다.

## Handoff 실행 규칙

각 새 대화는 하나의 Unit만 실행한다. 시작 시 `git status --short`, 현재 브랜치, HEAD를 확인하고 기존 사용자 변경을 보존한다. Unit의 모든 Task와 Unit Verify가 통과하면 계획의 해당 Conclusion·Status를 실제 결과로 닫고 하나의 커밋을 만든다. 계획 수립 문서가 아직 미커밋이면 Unit 1 커밋에서 이 계획, `CL-167`, 최신 `memory.md`와 그 아카이브만 함께 고정하고 그 밖의 기존 사용자 변경은 포함하지 않는다. 완료 응답 15번에 다음 Unit 전체 프롬프트를 작성한 뒤 종료한다.

## 완료 기준

- Unit 1~10의 모든 Task가 `done`이다.
- Unit별 커밋 SHA와 실제 검증 결과가 기록돼 있다.
- API 단위 테스트와 실제 서비스 통합 E2E가 통과한다.
- 전체 typecheck와 build가 통과한다.
- 소비자 Task 4.1 계약 목록이 상태별로 실행 가능하게 분리돼 있다.
- `git diff --check`가 통과한다.
- 기존 사용자 미커밋 변경이 보존돼 있다.
- 배송 사진 실제 호출 경로와 보안 규칙·인덱스는 원 계획 후속 Task로 명시돼 있다.

## Closeout Roll-up

- **Status**: 실행 대기
- **현재 진입점**: Unit 1 결제·예약 최종 정합성
- **원 계획 상태**: Task 4.2 보류
- **잔여 위험**: 각 Unit 실행 전 최신 HEAD와 워킹트리 변경을 다시 확인해야 한다.

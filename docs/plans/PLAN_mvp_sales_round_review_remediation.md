<!-- Language: ko -->

# Project Blueprint: 회차 직배송 코드 리뷰 결함 보정

## 문서 메타
- **작성일**: 2026-07-15
- **상태**: 완료
- **Priority**: 0
- **Labels**: bugfix, security, payment, delivery, test
- **SSOT Check**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`, `docs/specs/mvp-sales-round-direct-delivery.md`, 2026-07-15 전체 변경 리뷰
- **Architectural Goal**: 회차 직배송 API의 권한·상태·예약 회계를 일관된 서버 트랜잭션으로 복구한다.
- **선행 위치**: 원 계획 Task 2.8보다 먼저 이 계획 전체를 완료한다.

## 업무 요약 (협업용)

### 개요
현재 구현은 빌드와 단위 테스트를 통과하지만 실제 애플리케이션에 일부 서비스가 연결되지 않았고, 판매자 소유권과 배송 보류 권한이 충분히 검사되지 않는다. 결제 예약도 결제 성공·실패·취소와 이어지지 않아 회차 한도가 잠길 수 있다. 이번 보정은 화면 기능을 늘리지 않고 서버의 접근 경계와 회계 정확성을 먼저 회복한다.

### 끝났을 때 확인할 것
- 회차 API와 회차 주문 서비스가 실제 애플리케이션에서 주입되고 호출된다.
- 판매자는 자기 스토어 회차만 관리하고 고객은 자기 주문만 조작한다.
- 결제 성공·실패·시간 초과·고객 취소가 예약 수량을 정확히 소비하거나 반환한다.
- 배송 보류 주문은 권한 있는 담당자만 만들고 재배송·취소·완료로 해소할 수 있다.
- 회차 상태와 주문 상품 금액 필드는 공통 계약과 같은 형태로 응답된다.

### 이번에 하지 않는 것
- 소비자·셀러·드라이버 화면 구현
- 알림 재시도와 운영 예외 화면
- 배송 사진 비공개 Storage 전환
- 법정 보관·파기 기능
- 디어오키드 운영 스토어의 `salesMode` 전환

## Origin Intent
- **출처**: 2026-07-15 현재 브랜치 전체 코드 리뷰 후속 요청
- **원래 목적**: 발견된 배포 차단·권한 우회·수량 회계 결함을 구현 재개 전에 제거한다.
- **완료 관찰**: 권한 없는 요청은 거부되고 모든 예약은 주문 상태와 같은 수량으로 종료된다.

## Edge Case Trace
| 엣지 케이스 | 출처 | Task-ID / 범위 밖 | 비고 |
| :--- | :--- | :--- | :--- |
| 다른 판매자가 임의 `storeId`로 회차 수정 | 코드 리뷰 | 0.1, 1.1, 1.2 | 관리자 예외는 유지 |
| 소비자가 다른 주문을 배송 보류 처리 | 코드 리뷰 | 0.2, 3.3, 3.5 | 역할과 주문 관계를 함께 검증 |
| 같은 `roundItemId`를 여러 줄로 제출 | 코드 리뷰 | 0.2, 2.1 | 중복 입력을 400으로 거부 |
| 결제 성공 후 예약이 `HELD`로 잔류 | 코드 리뷰 | 0.3, 2.4 | `CONSUMED`와 주문 수량을 한 번만 반영 |
| 결제 실패·시간 초과·고객 취소 | 코드 리뷰 | 0.3, 2.4, 2.6 | 예약 상태에 맞는 카운터 반환 |
| 예약 후 주문 저장 실패 | 코드 리뷰 | 0.2, 2.3 | 생성 실패 시 예약 즉시 반환 |
| `round_direct` 요청에서 회차 필드 누락 | 코드 리뷰 | 0.2, 2.3 | legacy 분기 우회 차단 |
| 주소 문자열에 `이천시`만 삽입 | 코드 리뷰 | 0.2, 2.3 | 행정구역 경계 기반 검증 |
| 배송 보류 후 재배송·취소·완료 | 구현 명세 | 0.2, 3.2, 3.3 | 보류 카운터를 정확히 감소 |
| 회차를 순서 밖 상태로 변경 | 코드 리뷰 | 0.1, 1.3 | 명시적 상태표 적용 |
| 결제 주문이 있는 회차 취소 | 구현 명세 | 0.1, 1.3 | 환불 성공 후 취소 확정 |
| Firestore `Timestamp` 목록 정렬 | 코드 리뷰 | 0.1, 1.4 | API 응답을 ISO8601로 정규화 |
| 재배송비 멱등 키 충돌 | 코드 리뷰 | 0.2, 3.4 | 스토어·주문·사용자 범위로 고정 |
| 기존 `lineAmount` 주문 조회 | 코드 리뷰 | 0.2, 3.6 | `subtotalAmount`로 하위 호환 정규화 |

## Diagnosis & Findings
- `OrdersModule`에 `OrderCapacityService`와 `OrderChargesService`가 없고 `AppModule`에 `SaleRoundsModule`이 없다.
- 회차 관리 서비스가 요청자 식별자를 받지 않아 판매자 소유권을 검증할 수 없다.
- `DELIVERY_HELD` 특례가 역할별 상태 전환 검사를 우회하며 해소 전환과 카운터 감소가 없다.
- 예약 서비스의 소비·반환 메서드는 결제 웹훅과 취소 경로에서 호출되지 않는다.
- 회차 상품 중복 입력은 회차 합계와 상품별 합계를 다르게 만들 수 있다.
- 회차 상태 변경은 현재 상태를 확인하지 않고 요청 상태를 그대로 저장한다.
- 주문 상품 공통 타입은 `subtotalAmount`지만 저장·조회 구현은 `lineAmount`를 사용한다.

## Architectural Deepening
- **권한 경계**: 컨트롤러는 인증 주체를 전달하고 서비스가 스토어 소유권·주문 소유권·기사 배정을 최종 판정한다.
- **예약 경계**: `OrderCapacityService`를 독립 모듈로 내보내 주문·결제 서비스가 같은 트랜잭션 규칙을 사용한다.
- **상태 경계**: 회차와 주문 상태 전환을 명시적 표로 제한하고 카운터 변화는 상태 전환과 같은 트랜잭션에 둔다.
- **호환 경계**: 저장·응답의 표준 금액 필드는 `subtotalAmount`로 고정하고 기존 `lineAmount`는 조회 시 변환한다.
- **실패 원자성**: 외부 환불과 Firestore 갱신이 분리되는 구간은 멱등 상태와 재시도 가능한 기록으로 보호한다.

## Agent Completion Contract
- 각 Task는 선행 Task 완료 후 한 번에 하나씩 실행한다.
- 새 도메인 동작은 실패 테스트를 먼저 추가한 뒤 구현한다.
- 각 Verify가 종료 코드 0인 경우에만 Conclusion을 실측 문장으로 바꾸고 다음 Task로 이동한다.
- 전체 실행 요청 후 Blueprint 구조를 고정하고 상태·Conclusion·Closeout만 갱신한다.
- 코드 파일은 500줄 미만을 유지하며 분리가 필요하면 새 보정 계획을 만든다.

> **에이전트 스코프**: 사용자가 PLAN 전체 실행을 요청하면 아래 Dependency 순서로 Task를 하나씩 진행한다. 각 Task는 표의 단일 Target만 수정하고 Verify 종료 코드 0 확인 후 Conclusion과 Status를 닫는다.

## Execution Plan

### Phase 0. 회귀 테스트 계약
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0.1 | 없음 | `apps/api/src/sale-rounds/sale-rounds.service.spec.ts` | 회차 소유권·상태 순서·취소 환불·완료 가드·Timestamp 정규화의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- sale-rounds.service.spec.ts --runInBand` | 통과 — 6개 회귀 테스트가 소유권, 상태 순서, 미완료 가드, 취소 환불 멱등성, Timestamp 정렬 계약을 검증했다. | done |
| 0.2 | 0.1 | `apps/api/src/orders/mvp-order-flow.spec.ts` | 회차 모드 우회·주소 위장·상품 중복·예약 반환·보류 권한·금액 호환의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 10개 테스트가 회차 우회·주소 위장·중복 상품·예약 반환·보류 권한·금액 호환 계약을 검증했다. | done |
| 0.3 | 0.2 | `apps/api/src/payments/payments.service.spec.ts` | 결제 성공·실패·시간 초과·중복 웹훅에서 예약 상태가 한 번만 변하는 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | 통과 — 결제 성공 소비, 실패·금액 불일치·시간 초과 반환, 중복 웹훅 멱등성 3개 테스트가 통과했다. | done |
| 0.4 | 0.3 | `apps/api/src/orders/orders.module.spec.ts` | 주문 모듈과 애플리케이션 모듈의 신규 provider 해석 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- orders.module.spec.ts --runInBand` | 통과 — OrdersModule의 예약·재배송비 provider와 AppModule의 회차 모듈 등록을 확인하는 2개 테스트가 통과했다. | done |

### Phase 1. 회차 API 권한과 상태
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1.1 | 0.4 | `apps/api/src/sale-rounds/sale-rounds.controller.ts` | 모든 판매자 회차 쓰기 요청에 인증 주체와 역할을 전달한다. | `pnpm --filter api build` | 통과 — 회차 생성·복사·수정·상태 변경·완료 호출이 인증 주체와 역할을 전달한 상태로 API 빌드에 성공했다. | done |
| 1.2 | 1.1 | `apps/api/src/sale-rounds/sale-rounds.service.ts` | 판매자에게 스토어 소유권을 강제하고 관리자는 예외로 허용한다. | `pnpm --filter api test -- sale-rounds.service.spec.ts --runInBand` | 통과 — 다른 판매자의 회차 쓰기는 거부되고 관리자 쓰기는 허용되는 서비스 권한 테스트가 통과했다. | done |
| 1.3 | 1.2 | `apps/api/src/sale-rounds/sale-rounds.service.ts` | 회차 상태표·미완료 주문 가드·결제 주문 환불을 멱등 상태 변경으로 구현한다. | `pnpm --filter api test -- sale-rounds.service.spec.ts --runInBand` | 통과 — 상태 역전 차단, 미완료 주문 완료 차단, 결제 주문 1회 환불과 중복 취소 멱등 테스트가 통과했다. | done |
| 1.4 | 1.3 | `apps/api/src/sale-rounds/sale-rounds.service.ts` | Firestore 시각을 ISO8601로 정규화하고 자동 상태 갱신의 경쟁 조건을 트랜잭션으로 막는다. | `pnpm --filter api test -- sale-rounds.service.spec.ts --runInBand` | 통과 — 자동 상태 재판정이 트랜잭션에서 수행되고 Timestamp 목록이 ISO8601 최신순으로 반환되는 테스트가 통과했다. | done |
| 1.5 | 1.4 | `apps/api/src/sale-rounds/sale-rounds.module.ts` | 회차 취소 환불에 필요한 결제 모듈 의존성을 연결한다. | `pnpm --filter api build` | 통과 — SaleRoundsModule이 PaymentsModule을 가져와 회차 취소 환불 의존성을 해석한 상태로 API 빌드에 성공했다. | done |
| 1.6 | 1.5 | `apps/api/src/app.module.ts` | `SaleRoundsModule`을 애플리케이션 라우팅에 등록한다. | `pnpm --filter api build` | 통과 — AppModule에 SaleRoundsModule이 등록되어 회차 컨트롤러가 실제 애플리케이션 라우팅에 포함된 상태로 빌드됐다. | done |

### Phase 2. 예약 회계와 결제 연결
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2.1 | 1.6 | `apps/api/src/orders/order-capacity.service.ts` | 중복 회차 상품을 거부하고 `HELD`·`CONSUMED` 예약을 상태별로 멱등 반환한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 중복 회차 상품 차단과 예약 정본 기반 수량 반환을 포함한 회차 주문 흐름 10개 테스트가 통과했다. | done |
| 2.2 | 2.1 | `apps/api/src/orders/order-capacity.module.ts` | 예약 서비스를 주문과 결제 모듈이 함께 가져올 수 있는 독립 모듈로 내보낸다. | `pnpm --filter api build` | 통과 — OrderCapacityModule이 예약 서비스를 제공·내보내는 독립 모듈로 추가된 상태에서 API 빌드에 성공했다. | done |
| 2.3 | 2.2 | `apps/api/src/orders/orders-create.service.ts` | 회차 모드 필수값·행정구역 주소·상품 금액을 검증하고 주문 저장 실패 시 예약을 반환한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — round_direct 필수값, 이천시 행정구역 경계, 중복 상품, subtotalAmount, 저장 실패 예약 반환 테스트가 통과했다. | done |
| 2.4 | 2.3 | `apps/api/src/payments/payments.service.ts` | 결제 성공은 예약을 소비하고 실패·시간 초과는 예약을 반환하도록 웹훅 처리를 연결한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | 통과 — 성공 시 예약 소비, 실패·금액 불일치 시 반환, 시간 초과 시 만료 반환이 중복 없이 수행되는 테스트가 통과했다. | done |
| 2.5 | 2.4 | `apps/api/src/payments/payments.module.ts` | 결제 서비스에 `OrderCapacityModule` 의존성을 주입한다. | `pnpm --filter api build` | 통과 — PaymentsModule이 OrderCapacityModule을 가져와 예약 서비스를 필수 주입한 상태로 API 빌드에 성공했다. | done |
| 2.6 | 2.5 | `apps/api/src/orders/orders-lifecycle.service.ts` | 회차 주문 취소가 예약 상태에 맞는 수량을 한 번만 반환하도록 변경한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 고객 취소가 reservationId 정본을 통해 예약·주문 수량을 멱등 반환하는 회차 주문 테스트가 통과했다. | done |
| 2.7 | 2.6 | `apps/api/src/orders/orders.module.ts` | 예약 모듈과 재배송비 서비스를 필수 의존성으로 등록하고 선택 주입을 제거한다. | `pnpm --filter api test -- orders.module.spec.ts --runInBand` | 통과 — OrdersModule이 OrderCapacityModule과 OrderChargesService를 필수 등록하는 모듈 테스트 2개가 통과했다. | done |

### Phase 3. 배송 보류와 주문 계약
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 3.1 | 2.7 | `apps/api/src/orders/dto/update-status.dto.ts` | 배송 보류 사유·책임·재배송비·예정 시각을 중첩 DTO로 검증한다. | `pnpm --filter api build` | 통과 — 배송 보류·재배송비·사진 본문 DTO의 중첩 검증 계약이 API 빌드에 성공했다. | done |
| 3.2 | 3.1 | `apps/api/src/orders/orders.helpers.ts` | `DELIVERY_HELD`의 재준비·재배송·취소 전환을 역할별 상태표에 추가한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 셀러 재준비·취소와 담당 기사 재배송 전환이 역할별 상태표를 따르는 회차 주문 테스트가 통과했다. | done |
| 3.3 | 3.2 | `apps/api/src/orders/orders-lifecycle.service.ts` | 스토어 소유자·담당 기사·주문자 권한을 검사하고 보류 진입·해소 카운터를 같은 트랜잭션에서 갱신한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 권한 없는 보류 요청을 거부하고 보류 진입·해소 시 heldOrderCount를 1→0으로 맞추는 테스트가 통과했다. | done |
| 3.4 | 3.3 | `apps/api/src/orders/order-charges.service.ts` | 주문자 소유권을 검사하고 재배송비 멱등 식별자를 스토어·주문·사용자 범위로 고정한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 주문자만 재배송비를 생성하고 같은 범위의 중복 청구가 한 건으로 유지되는 테스트가 통과했다. | done |
| 3.5 | 3.4 | `apps/api/src/orders/orders.controller.ts` | 검증 DTO와 인증 주체를 배송 보류·재배송비·배송 사진 서비스 호출에 전달한다. | `pnpm --filter api build` | 통과 — 컨트롤러가 검증 DTO와 user.sub·user.role을 서비스에 전달하고 선택 주입 없이 API 빌드에 성공했다. | done |
| 3.6 | 3.5 | `apps/api/src/orders/orders-query.service.ts` | 신규·기존 주문 상품 금액을 `subtotalAmount`로 정규화한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 신규 subtotalAmount와 기존 lineAmount 주문을 모두 subtotalAmount로 반환하는 테스트가 통과했다. | done |

### Phase 4. 통합 검증과 원 계획 복귀
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 4.1 | 3.6 | `apps/api/test/mvp-sales-round-review-remediation.e2e-spec.ts` | 회차 소유권·주문 생성·결제 소비·취소 반환·보류 해소의 API 통합 계약을 추가한다. | `pnpm --filter api test:e2e -- mvp-sales-round-review-remediation.e2e-spec.ts --runInBand` | 통과 — HTTP 통합 테스트 2개가 회차 403과 주문·결제·취소·보류 해소의 예약 상태 연결을 검증했다. | done |
| 4.2 | 4.1 | `docs/specs/mvp-sales-round-direct-delivery.md` | 보정된 권한·상태·예약·금액 계약을 구현 명세에 반영한다. | `git diff --check -- docs/specs/mvp-sales-round-direct-delivery.md` | 통과 — 구현 명세에 소유권·상태표·예약 반환·주소 경계·보류 카운터·subtotalAmount 계약을 반영했고 공백 검사가 통과했다. | done |
| 4.3 | 4.2 | `docs/plans/PLAN_mvp_sales_round_review_remediation.md` | API 전체 단위 테스트 결과를 Closeout에 기록한다. | `pnpm --filter api test -- --runInBand` | 통과 — API 단위 테스트 8개 스위트의 34개 테스트가 모두 통과했다. | done |
| 4.4 | 4.3 | `docs/plans/PLAN_mvp_sales_round_review_remediation.md` | 전체 워크스페이스 빌드 결과를 Closeout에 기록한다. | `pnpm build` | 조건부 통과 — 명령은 종료 코드 0이었고 shared 빌드는 성공했으나 Windows의 `./apps/*` 필터가 앱을 선택하지 않았다. 별도 API 빌드는 통과했고 consumer 보강 빌드는 기존 알림 라벨 누락으로 실패했다. | done |
| 4.5 | 4.4 | `docs/plans/PLAN_mvp_sales_round_direct_delivery.md` | 기존 완료 주장과 다음 진입점을 보정 결과에 맞게 갱신한다. | `git diff --check -- docs/plans/PLAN_mvp_sales_round_direct_delivery.md` | 통과 — 원 계획을 보정 완료 후 Task 2.8 재평가 대기로 갱신하고 문서 공백 검사를 통과했다. | done |
| 4.6 | 4.5 | `docs/memory.md` | 보정 계획 완료 결과와 원 계획 Task 2.8 이후 재개 지점을 기록한다. | `git diff --check -- docs/memory.md` | 통과 — 보정 완료 결과, 검증 수치, 기존 빌드 위험, 원 계획 Task 2.8 재평가 지점을 기록하고 공백 검사를 통과했다. | done |

## 완료 기준
- 모든 Task의 Status가 `done`이고 Conclusion에 실제 검증 결과가 기록되어 있다.
- 공통 패키지 타입 검사와 API 전체 테스트가 통과한다.
- API 빌드와 보정 E2E가 통과한다.
- 권한 실패 요청이 Firestore 문서를 변경하지 않는다.
- 예약·회차·상품 카운터가 성공·실패·취소 후 서로 일치한다.
- 원 계획의 다음 작업은 보정 완료 후 Task 2.8 이후 범위를 재평가해 재개한다.

## Closeout Roll-up
- **Status**: 완료
- **검증**: API 단위 테스트 8개 스위트·34개 테스트 통과, 보정 E2E 2개 테스트 통과, API·shared 빌드 통과
- **잔여 위험**: 루트 `pnpm build`의 앱 필터가 Windows에서 패키지를 선택하지 않는다. 별도 consumer 빌드는 기존 알림 코드 6종의 라벨 누락으로 실패했다. 실제 포트원 샌드박스와 Firebase 에뮬레이터 검증은 외부 환경이 필요하다.

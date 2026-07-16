<!-- Language: ko -->

# Project Blueprint: PortOne 결제 미생성 timeout 복구 보정

## 문서 메타

- **작성일**: 2026-07-16
- **상태**: 완료
- **Priority**: P0
- **Labels**: `payment`, `portone`, `timeout`, `staging`, `remediation`
- **SSOT Check**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md` Task 2.10, `docs/memory.md`
- **Architectural Goal**: PortOne에서 생성되지 않은 결제를 안전하게 식별해 timeout 주문과 예약 한도를 복구하되 인증·권한·통신 장애에서는 주문 상태를 보존한다.

## 📋 업무 요약 (협업용)

### 개요

Railway staging의 V2 API Secret 인증은 정상화됐다. 기존 주문의 결제 조회는 `404 PAYMENT_NOT_FOUND`를 반환하지만, 현재 scheduler는 이를 장애로 취급해 주문을 취소하지 못한다. 그 결과 만료 주문이 `PENDING`, 회차 예약이 `HELD`, 예약 한도가 점유 상태로 남아 있다.

### 끝났을 때 확인할 것

- 결제창에서 실제 결제가 생성되지 않은 timeout 주문은 자동 취소된다.
- 회차 예약은 `EXPIRED`가 되고 배송지·상품 예약 한도가 반환된다.
- 인증·권한·속도 제한·PortOne 장애·네트워크 오류에서는 주문과 예약을 변경하지 않는다.
- 한 주문의 조회 실패가 다른 timeout 주문 처리를 막지 않는다.
- 실제 `PAID` 조회, 중복 웹훅, 늦은 결제와 환불 검증은 후속 staging 게이트로 유지한다.

### 이번 계획에서 하지 않는 것

- Task 2.11 착수
- 실제 PortOne 테스트 결제 수행
- 운영 Railway·Vercel Production·운영 Firebase·운영 PortOne 변경
- Secret·토큰·Authorization 헤더·서비스 계정 JSON 출력 또는 저장
- 커밋·푸시

## 🎯 Origin Intent

- **출처**: Task 2.10 PortOne staging 외부 환경 재검증
- **원래 목적**: 인증이 통과한 PortOne `PAYMENT_NOT_FOUND` 응답을 timeout 미결제로 안전하게 처리한다.
- **완료 관찰**: 두 staging 주문이 timeout 취소되고 회차 예약과 예약 한도가 복구되며 scheduler 404 예외가 사라진다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | Task-ID | 안전 조건 |
| :--- | :--- | :--- |
| `404 PAYMENT_NOT_FOUND` | 0.1, 1.1, 1.3 | timeout 미결제로만 처리 |
| 알 수 없는 404 | 0.1, 1.1, 1.3 | 주문 유지 후 오류 기록 |
| `401`, `403` | 1.2, 1.3 | 주문·예약 변경 금지 |
| `429`, `5xx`, 네트워크 오류 | 1.2, 1.3 | 다음 scheduler 재시도 |
| 여러 주문 중 한 건 조회 실패 | 1.2, 1.3 | 주문별 오류 격리 |
| scheduler 중복 실행 | 1.2, 1.3 | 예약과 한도 중복 반환 금지 |
| legacy 직접배송 주문 | 1.2, 1.3 | `requestedDeliveryDate` 기준 한도 반환 |
| `PAID` 응답 | 1.2, 1.3 | 기존 결제 확정 흐름 유지 |

## 🔍 Diagnosis & Findings

- Railway staging V2 API Secret 로그인은 `200`으로 통과했다.
- 결제 ID `292cdd33-0da3-4309-8c2d-286a09a5b80e` 조회는 `404 PAYMENT_NOT_FOUND`다.
- 새 deployment 로그에는 기존 401이 없고 scheduler의 404 예외가 반복된다.
- legacy 주문 `ce923abb-d34e-4bd5-b7a2-4c07838dc525`와 회차 주문 `292cdd33-0da3-4309-8c2d-286a09a5b80e`는 `PENDING`이다.
- 예약 `af5c5e49ce6b41d42dee41f57bc1512c`는 만료됐지만 `HELD`다.
- 회차 카운터와 회차 상품은 예약 수량 1개를 계속 점유한다.
- 근본 원인은 `PortoneClient.getPayment()`가 모든 비정상 응답을 동일 예외로 변환하고 `cleanupPendingOrders()`가 주문별 예외를 격리하지 않는 것이다.

## 🏗️ Architectural Deepening

- **Seam**: PortOne HTTP 오류 해석은 `PortoneClient`, 주문 상태 결정은 `PaymentsService`가 담당한다.
- **Leverage**: 기존 `cancelOrderWithSlotRecovery()`와 `OrderCapacityService.releaseReservation(..., 'EXPIRED')`를 재사용한다.
- **Safety**: `status === 404`와 `type === 'PAYMENT_NOT_FOUND'`가 동시에 맞을 때만 timeout 취소한다.
- **Resilience**: 주문별 처리 결과를 격리해 외부 장애 한 건이 전체 scheduler를 중단하지 않게 한다.
- **Compatibility**: `PAID` 확정, 중복 웹훅, 늦은 결제 환불 흐름은 변경하지 않는다.

## Agent Completion Contract

1. Task를 Dependency 순서대로 한 번에 하나씩 진행한다.
2. 실패 테스트를 먼저 추가하고 구현 전 실패 이유를 확인한다.
3. 각 Task는 지정된 단일 Target만 수정한다.
4. 기존 미커밋 변경을 되돌리거나 덮어쓰지 않는다.
5. PortOne 응답에서는 HTTP status와 정제한 `type`, `message`만 기록한다.
6. `401`, `403`, `429`, `5xx`, 네트워크 오류에서는 주문·예약·한도를 변경하지 않는다.
7. 운영 환경을 조회·변경하지 않고 모든 Railway 명령에 `-e staging -s api`를 명시한다.
8. staging 배포는 로컬 작업 트리를 사용하되 커밋·푸시는 하지 않는다.
9. 실제 데이터 검증 성공 전 원 계획 Task 2.10을 `done`으로 변경하지 않는다.
10. Task 2.11은 시작하지 않는다.

> **에이전트 스코프**: 이 계획은 PortOne 오류 분류, timeout scheduler 복구, 관련 단위 테스트, Railway staging 실측, 계획·memory 갱신만 허용한다.

## Execution Plan

### Phase 0 — 실패 계약 고정

#### Task 0.1 — PortOne 결제 미존재 오류 계약 추가

- **Task-ID**: 0.1
- **Dependency**: 없음
- **Target**: `apps/api/src/payments/portone.client.spec.ts`
- **Goal**: `404 PAYMENT_NOT_FOUND`와 일반 404·401 응답이 구분되는 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- portone.client.spec.ts --runInBand`
- **Conclusion**: 실패 계약 확인 후 통과 — `404 PAYMENT_NOT_FOUND`, 일반 404, 401 응답을 전용 오류의 `status`, 정제된 `type`, `message`로 구분하는 테스트 5개를 고정했다.
- **Status**: done

### Phase 1 — 오류 분류와 timeout 복구

#### Task 1.1 — PortOne 안전 오류 타입 구현

- **Task-ID**: 1.1
- **Dependency**: Task 0.1
- **Target**: `apps/api/src/payments/portone.client.ts`
- **Goal**: 비정상 응답의 HTTP status와 정제한 `type`, `message`를 보존하는 전용 오류 타입을 구현한다.
- **Verify**: `pnpm --filter api test -- portone.client.spec.ts --runInBand`
- **Conclusion**: 통과 — `PortoneError`가 비정상 HTTP 응답의 `status`, 정제된 `type`, `message`만 보존하며 허용하지 않은 응답 필드와 Secret을 노출하지 않는다.
- **Status**: done

#### Task 1.2 — scheduler 안전성 실패 테스트 추가

- **Task-ID**: 1.2
- **Dependency**: Task 1.1
- **Target**: `apps/api/src/payments/payments.service.spec.ts`
- **Goal**: 결제 미존재 취소·외부 장애 상태 보존·주문별 오류 격리·legacy 배송일 한도 반환의 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- payments.service.spec.ts --runInBand`
- **Conclusion**: 실패 계약 확인 후 통과 — 결제 미존재 취소, 회차 예약 `EXPIRED`, 외부 오류 무변경, 주문별 격리, 재실행 멱등성, legacy 배송일 한도 반환 계약을 포함해 결제 서비스 테스트 16개를 고정했다.
- **Status**: done

#### Task 1.3 — scheduler 결제 미생성 복구 구현

- **Task-ID**: 1.3
- **Dependency**: Task 1.2
- **Target**: `apps/api/src/payments/payments.service.ts`
- **Goal**: `PAYMENT_NOT_FOUND`만 timeout 취소하고 나머지 외부 오류를 주문별로 격리하는 scheduler를 구현한다.
- **Verify**: `pnpm --filter api test -- payments.service.spec.ts --runInBand`
- **Conclusion**: 통과 — 정확한 `404 PAYMENT_NOT_FOUND`만 기존 취소·한도 복구 경로로 처리하고 나머지 조회 실패는 주문별로 격리한다. 최신 주문 상태 재확인과 `requestedDeliveryDate` 우선 반환도 반영했다.
- **Status**: done

### Phase 2 — 회귀 검증과 staging 실측

#### Task 2.1 — 결제 단위 회귀 검증

- **Task-ID**: 2.1
- **Dependency**: Task 1.3
- **Target**: `docs/plans/PLAN_portone_payment_not_found_timeout_remediation.md`
- **Goal**: PortOne 클라이언트와 결제 서비스 단위 테스트 전체 결과를 기록한다.
- **Verify**: `pnpm --filter api test -- portone.client.spec.ts payments.service.spec.ts --runInBand`
- **Conclusion**: 통과 — `portone.client.spec.ts`, `payments.service.spec.ts` 2개 스위트의 21개 테스트가 모두 통과했다.
- **Status**: done

#### Task 2.2 — API 빌드 검증

- **Task-ID**: 2.2
- **Dependency**: Task 2.1
- **Target**: `docs/plans/PLAN_portone_payment_not_found_timeout_remediation.md`
- **Goal**: 오류 타입과 scheduler 보정이 API 빌드에 포함되는지 기록한다.
- **Verify**: `pnpm --filter api build`
- **Conclusion**: 통과 — `pnpm --filter api build`가 종료 코드 0으로 완료됐고 `git diff --check`도 통과했다.
- **Status**: done

#### Task 2.3 — Railway staging 배포

- **Task-ID**: 2.3
- **Dependency**: Task 2.2
- **Target**: `docs/plans/PLAN_portone_payment_not_found_timeout_remediation.md`
- **Goal**: 검증된 로컬 작업 트리를 Railway staging API에만 배포한다.
- **Verify**: `railway up -e staging -s api --ci -m "PortOne 결제 미생성 timeout 복구 보정"`
- **Conclusion**: 통과 — 최종 Railway staging API deployment `00851584-79a3-419e-8097-d7ba1b08cfb5`가 `SUCCESS`이고 health 200이다. 중간 deployment `f6bb5ba6-c634-4431-a69b-f8f7139cb166`은 기존 `ConfigService` type-only import의 런타임 DI 손실로 실패했으며 일반 import로 보정 후 재배포했다.
- **Status**: done

#### Task 2.4 — PortOne 인증과 결제 미존재 재검증

- **Task-ID**: 2.4
- **Dependency**: Task 2.3
- **Target**: `docs/plans/PLAN_portone_payment_not_found_timeout_remediation.md`
- **Goal**: staging V2 인증 성공과 지정 결제의 `PAYMENT_NOT_FOUND` 결과를 재확인한다.
- **Verify**: `railway run -e staging -s api node scripts/diagnose-portone-v2.mjs`
- **Conclusion**: 통과 — staging 런타임 진단에서 지정 결제 ID가 `404`, `type=PAYMENT_NOT_FOUND`, `message=payment not found`를 반환했고 V2 인증 401은 재현되지 않았다.
- **Status**: done

#### Task 2.5 — timeout 주문과 예약 한도 실측

- **Task-ID**: 2.5
- **Dependency**: Task 2.4
- **Target**: `docs/plans/PLAN_portone_payment_not_found_timeout_remediation.md`
- **Goal**: scheduler 실행 후 두 주문·회차 예약·회차 카운터·상품 예약 수량의 실제 복구 결과를 기록한다.
- **Verify**: `railway logs -e staging -s api --since 15m --filter "PaymentsScheduler"`
- **Conclusion**: 통과 — scheduler가 2건을 처리해 legacy·회차 주문은 `CANCELLED`, `cancelReason=timeout`, 예약은 `EXPIRED`가 됐다. 회차 예약 카운터와 상품 `reservedQuantity`는 0, `orderedQuantity`는 0이며 두 결제 문서는 생성되지 않았다. 최종 deployment 로그에는 `getPayment` 401·404 오류가 없다.
- **Status**: done

### Phase 3 — 다음 진입점 갱신

#### Task 3.1 — 원 계획 Task 2.10 근거 갱신

- **Task-ID**: 3.1
- **Dependency**: Task 2.5
- **Target**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- **Goal**: 401 해소와 `PAYMENT_NOT_FOUND` timeout 복구 실측을 Task 2.10 Conclusion에 기록한다.
- **Verify**: `git diff --check -- docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- **Conclusion**: 통과 — 원 계획 Task 2.10 Conclusion과 Closeout에 V2 인증 정상화, `PAYMENT_NOT_FOUND` timeout 복구, 남은 실제 결제 게이트를 기록했고 상태는 `todo` 검증 대기로 유지했다.
- **Status**: done

#### Task 3.2 — 프로젝트 memory 갱신

- **Task-ID**: 3.2
- **Dependency**: Task 3.1
- **Target**: `docs/memory.md`
- **Goal**: timeout 보정 결과와 실제 결제 게이트를 다음 진입점으로 기록한다.
- **Verify**: `git diff --check -- docs/memory.md`
- **Conclusion**: 통과 — `docs/memory.md`를 staging 복구 결과와 실제 결제 다음 진입점으로 갱신했고 44줄로 200줄 미만이다.
- **Status**: done

#### Task 3.3 — 전체 변경 검사

- **Task-ID**: 3.3
- **Dependency**: Task 3.2
- **Target**: `docs/plans/PLAN_portone_payment_not_found_timeout_remediation.md`
- **Goal**: 전체 변경의 공백 오류와 금지 파일 외 범위 이탈 여부를 확인한다.
- **Verify**: `git diff --check`
- **Conclusion**: 통과 — 전체 `git diff --check`가 종료 코드 0이며 Task 2.11은 `todo`로 유지됐다. 기존 사용자 변경은 되돌리지 않았고 커밋·푸시하지 않았다.
- **Status**: done

## Completion Criteria

- V2 Secret 인증은 `200`이고 지정 결제 조회는 `404 PAYMENT_NOT_FOUND`로 유지된다.
- scheduler 로그에서 결제 조회 401·404 예외가 사라진다.
- 두 주문은 `CANCELLED`, `cancelReason: timeout`이다.
- 예약은 `EXPIRED`다.
- 회차의 `reservedDeliveryAddresses`, `reservedItemQuantity`는 0이다.
- 회차 상품의 `reservedQuantity`는 0이고 `orderedQuantity`는 0이다.
- 결제·환불 기록은 생성되지 않는다.
- `401`, `403`, `429`, `5xx`, 네트워크 오류 테스트에서 주문과 예약은 유지된다.
- `payments.service.spec.ts`, `portone.client.spec.ts`, API 빌드, `git diff --check`가 통과한다.
- Task 2.10은 실제 `PAID` 게이트가 남아 있으므로 `검증 대기`를 유지한다.
- Task 2.11은 시작하지 않는다.

## Closeout Roll-up

- **Status**: 완료
- **검증 결과**: `PortoneError` 분류와 주문별 scheduler 격리를 구현했고 단위 테스트 21개, API 빌드, `git diff --check`, Railway staging 배포와 실제 timeout 복구가 통과했다.
- **완료 후 다음 진입점**: Preview 정상 로그인 후 100원 PortOne 테스트 결제와 `PAID`·중복 웹훅·늦은 결제·전액 환불 계약 실측

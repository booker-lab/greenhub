<!-- Language: ko -->

# Project Blueprint: 회차 직배송 Task 5.1~5.12 리뷰 보정

## 문서 메타

- **작성일**: 2026-07-18
- **상태**: 완료
- **Priority**: P0
- **Labels**: `seller`, `driver`, `delivery-hold`, `delivery-photo`, `idempotency`, `recovery`, `e2e`
- **SSOT Check**: `docs/specs/mvp-sales-round-direct-delivery.md`, `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`, `docs/CRITICAL_LOGIC.md` #CL-166
- **Architectural Goal**: Task 5 리뷰에서 확인된 서버 불변식·사진 증거·완료 후속효과·드라이버 복구 경로를 닫은 뒤 원 계획 Task 6.1 진입을 다시 허용한다.
- **기준 브랜치**: `codex/mvp-sales-round-direct`
- **기준 커밋**: `b4ba7ff0719dd760ab56b1d78bcd656afd5ee10c`
- **리뷰 범위**: `9e6d886^..b4ba7ff`
- **선행 관계**: 이 계획 완료 전 Task 5 결과를 배포 가능 상태로 판정하지 않는다.
- **작업 트리 보호**: 계획 작성 시점의 Task 6.1·소비자 보정 관련 미커밋 변경을 보존하며 범위 밖 파일을 복원하지 않는다.

---

## 📋 업무 요약 (협업용)

### 개요

Task 5.1~5.12 구현은 셀러 회차 운영, 드라이버 보류, 비공개 배송 사진 업로드까지 연결했지만 실제 운영 경로에는 여섯 결함이 남아 있다. 소비자는 완료 사진을 볼 수 없고, 보류 주문은 기사 화면에서 다시 시작할 수 없다. 기상 보류의 과금 금지 규칙은 브라우저에만 있으며, 완료 증거 사진은 같은 요청 키 재사용으로 덮어쓸 수 있다. 주문 상태 저장 뒤 정산이나 알림이 실패하면 재시도로 복구되지 않으며, 드라이버 E2E 계약은 현재 화면의 역할·이름과 어긋난다.

### 완료 모습

- 기상 보류는 조작된 API 요청으로도 고객 책임이나 재배송비를 만들 수 없다.
- 같은 업로드 키는 같은 JPEG만 재사용하며 기존 완료 사진을 바꾸지 못한다.
- 주문이 이미 `DELIVERED`여도 재시도가 누락된 정산과 완료 알림을 복구한다.
- 인증된 완료 주문 상세은 15분 서명 사진 URL을 제공한다.
- 담당 기사는 `DELIVERY_HELD` 주문을 보드에서 찾아 `DELIVERING`으로 재개한다.
- 드라이버 E2E 선택자와 접근 가능한 화면 이름이 일치한다.
- API 전체 테스트의 시간 의존 실패가 제거된다.

### 이번 계획에서 하지 않는 것

- 새 회차 생성 UX 추가
- 실제 E2E seed·세션 생성
- `test.fixme` 전면 해제
- Firestore·Storage 규칙 배포
- Task 6.1의 인덱스 전체 재설계
- `salesMode` 전환
- Railway·Vercel·Firebase 운영 배포
- 기존 소비자 보정 파일 재수정

---

## 🎯 Origin Intent

- 사용자는 Task 5.1~5.12 종료 결과를 리뷰한 뒤 발견된 문제를 다음 대화에서 해결할 계획으로 정리해 달라고 요청했다.
- 리뷰 기준은 Task 5 첫 커밋의 부모부터 Task 5.12 완료 커밋까지다.
- 발견된 여섯 결함을 실패 테스트로 먼저 고정하고 데이터 안전성부터 사용자 복구 경로 순서로 보정한다.

---

## ⚠️ Edge Case Trace

| Edge Case | Failure Mode | Guard | Task-ID |
| :--- | :--- | :--- | :--- |
| `WEATHER`에 `customerResponsible: true` 전송 | 고객에게 부당한 재배송비 청구 가능 | 서버 정책이 조합 자체를 거부 | 1.1~1.5 |
| `WEATHER`에 양수 재배송비 전송 | 손상된 보류 스냅샷과 결제 문서 생성 가능 | 보류 저장과 청구 생성 양쪽에서 차단 | 1.1~1.5 |
| `WEATHER`에 새 배송 일정 누락 | 해소 시점 없는 보류가 영구 잔류 | 유효한 `nextDeliveryAt` 필수 | 1.1~1.4 |
| 같은 업로드 키와 같은 JPEG 재시도 | 중복 객체·중복 사진·중복 완료 가능 | 생성 전용 저장 뒤 같은 해시만 멱등 성공 | 2.1~2.4 |
| 같은 업로드 키와 다른 JPEG 재시도 | 완료 증거가 새 바이트로 덮어써짐 | 기존 해시 불일치 시 `409 Conflict` | 2.1~2.4 |
| 동시 같은 키 업로드 | 한 요청의 정리가 다른 요청 객체를 삭제할 수 있음 | 실제 생성자만 미연결 객체를 조건부 정리 | 2.1~2.4 |
| 상태는 `DELIVERED`, 정산 없음 | 재시도가 상태 전환을 건너뛰어 정산 영구 누락 | 완료 후속효과 재조정 경로를 항상 호출 | 3.1~3.6 |
| 정산 성공 뒤 알림 실패 | 재시도에서 정산 중복 또는 알림 누락 가능 | 정산 멱등 문서와 완료 알림 멱등 키 사용 | 3.1~3.6 |
| 알림 성공 응답 뒤 클라이언트 재시도 | 소비자에게 완료 알림 중복 가능 | 완료 전환별 내구성 있는 단일 알림 기록 | 3.2~3.4 |
| 완료 주문 목록 대량 조회 | 주문마다 서명 URL을 만들어 비용·지연 증가 | 단건 상세에서만 URL 발급 | 4.1~4.3 |
| 사진 ID는 있지만 권한 없음 | 비공개 증거 사진 노출 | 기존 주문 관계 권한 검사 뒤 URL 생성 | 4.1~4.3 |
| 서명 URL 생성 실패 | 손상 URL을 성공 상세로 반환 | 상세 요청 실패를 명시하고 공개 URL로 우회하지 않음 | 4.1~4.3 |
| 보류 주문이 기사 보드에서 누락 | 기사가 해소 동작에 도달하지 못함 | 담당 기사 `DELIVERING|DELIVERY_HELD` 구독 | 5.0~5.3 |
| 세션 기사 ID 로딩 전 구독 | 다른 기사 주문이 잠깐 노출될 수 있음 | 기사 ID가 없으면 배정 주문 쿼리를 시작하지 않음 | 5.0~5.1 |
| 보류 재개를 여러 번 클릭 | 중복 상태 전환과 잘못된 성공 표시 | 서버 응답 ID·상태 검증 뒤 한 번만 성공 처리 | 5.0, 5.3 |
| 실제 E2E seed 없음 | `test.fixme`를 풀어도 신뢰할 실행이 불가능 | 선택자 정합만 보정하고 실제 실행은 Task 6.7에 유지 | 5.4~6.5 |
| 고정 “미래” 날짜가 실행 시각을 지남 | 전체 API 테스트가 날짜에 따라 실패 | 테스트 시스템 시각을 명시적으로 고정 | 0.1 |
| 기존 미커밋 변경 존재 | 다음 대화가 사용자 작업을 덮어씀 | 시작 상태 기록 뒤 지정 Target만 수정 | 전체 |

---

## 🔎 Diagnosis & Findings

1. `DeliveryPhotosService.attachPhoto`는 `deliveryPhotoIds`만 저장하고 주문 상세 조회는 서명 URL을 만들지 않는다.
2. 소비자 주문 상세 판독기는 완료 상태의 `deliveryPhotoUrl`만 읽으므로 비공개 사진을 렌더링할 값이 없다.
3. 드라이버 보드는 `PREPARING`, `DELIVERING`만 구독하고 상세 CTA도 두 상태에만 열린다.
4. 서버 상태표는 기사에게 `DELIVERY_HELD → DELIVERING`을 허용하지만 화면 호출 경로가 없다.
5. 기상 보류의 고객 책임 해제·재배송비 제거·새 일정 필수 규칙은 `DeliveryHoldModal`에만 있다.
6. `RoundOrderLifecycleService`는 전달된 보류 스냅샷을 신뢰하고 `OrderChargesService`는 고객 책임과 금액만 검사한다.
7. `StorageService.uploadDeliveryPhoto`는 기존 객체에도 `save`를 호출해 같은 사진 ID의 내용을 덮어쓴다.
8. 사진 연결 뒤 상태가 `DELIVERED`가 되면 동일 요청 재시도는 수명주기를 생략한다.
9. 상태 트랜잭션 뒤 실행되는 정산·알림이 실패해도 완료 후속효과의 복구 표식과 재조정 진입점이 없다.
10. 드라이버 E2E는 링크 역할, 제목 heading, 촬영 버튼 이름, 완료 버튼 이름, 카드 test id를 현재 UI와 다르게 기대한다.
11. 소비자·셀러·드라이버 Playwright 계약은 seed 준비 전이라 모두 `test.fixme`이며 목록 수집만 통과한다.
12. 전체 API 회귀는 `2026-07-18T01:00:00Z`를 미래로 가정한 보관 테스트 한 건 때문에 현재 시각에 따라 실패한다.

---

## 🧱 Architectural Deepening

### 배송 보류 정책

- 보류 조합 검증은 UI가 아니라 서버 도메인 함수가 정본이다.
- `WEATHER`는 `customerResponsible === false`, `redeliveryFee === null`, 유효한 `nextDeliveryAt`을 강제한다.
- 회차·legacy 수명주기는 같은 정책 함수를 호출해 서비스 직접 호출에서도 우회되지 않게 한다.
- 재배송비 생성은 손상된 과거 문서를 고려해 `WEATHER`를 한 번 더 차단한다.

### 배송 사진 불변성

- 객체 경로는 기존처럼 주문 ID와 멱등 키에서 결정한 사진 ID를 사용한다.
- 최초 저장은 생성 조건을 걸고 SHA-256 해시를 비공개 객체 metadata에 기록한다.
- 이미 존재하면 metadata 해시가 같은 경우만 멱등 성공으로 간주한다.
- 해시가 다르면 원본을 유지한 채 충돌을 반환한다.
- 업로드 결과는 신규 생성 여부를 반환하며 정리는 신규 생성된 미연결 객체에만 허용한다.

### 완료 후속효과 복구

- `DELIVERED` 상태 커밋과 정산·알림 외부 효과를 한 원자 연산으로 가장하지 않는다.
- 상태 전환 직후와 사진 업로드 재시도 모두 같은 완료 후속효과 재조정 함수를 호출한다.
- 정산은 주문 ID 문서의 기존 트랜잭션 멱등성을 재사용한다.
- 완료 알림은 주문·전환별 멱등 키와 내구성 있는 처리 상태로 중복 정상 발송을 막는다.
- 후속효과 실패는 성공 응답으로 숨기지 않으며 같은 업로드 키 재시도로 회복할 수 있다.

### 비공개 사진 조회

- 주문 목록 응답은 사진 ID만 유지하고 서명 URL을 만들지 않는다.
- 권한 검사를 통과한 `DELIVERED|REVIEWED` 단건 상세에서 첫 연결 사진의 15분 URL을 `deliveryPhotoUrl`로 제공한다.
- 기존 소비자 상세의 HTTPS 검증을 그대로 사용한다.
- 공개 Firebase URL이나 장기 토큰은 저장하지 않는다.

### 보류 해소 UX

- 기사 보드의 “배송 중” 탭은 담당 기사의 `DELIVERING`, `DELIVERY_HELD`를 함께 보여준다.
- 보류 카드는 상태 배지로 구분하고 상세에서 “배송 재개”를 제공한다.
- 재개는 기존 상태 API의 `DELIVERY_HELD → DELIVERING`을 사용하며 담당 기사 배정을 유지한다.
- 기존 legacy 거점 배송 흐름은 삭제하지 않는다.
- 현재 인덱스의 `status + driverId + updatedAt` 조합을 재사용하고 Task 6.1 미커밋 인덱스 변경을 덮어쓰지 않는다.

---

## Agent Completion Contract

1. Unit 0부터 Unit 6까지 Dependency 순서로 실행한다.
2. 각 신규 동작은 지정된 실패 테스트를 먼저 추가한다.
3. 실패 테스트가 의도한 이유로 실패한 것을 확인한 뒤 구현 파일을 수정한다.
4. 각 Task는 지정된 단일 Target만 수정한다.
5. 현재 작업 트리의 기존 변경을 되돌리거나 정리하지 않는다.
6. `firestore.indexes.json`은 본 계획에서 수정하지 않는다.
7. 같은 업로드 키의 다른 JPEG를 멱등 성공으로 처리하지 않는다.
8. 이미 연결된 완료 사진을 삭제하거나 교체하지 않는다.
9. 완료 후속효과 실패를 `DELIVERED` 응답만으로 성공 처리하지 않는다.
10. 주문 목록에서 사진별 서명 URL을 생성하지 않는다.
11. 기사 ID가 없는 상태에서 배정 주문 전체 쿼리를 실행하지 않는다.
12. 드라이버 legacy 거점 사진 경로를 회차 직배송 경로로 합치지 않는다.
13. E2E `test.fixme` 해제와 실제 운영 seed 실행은 원 계획 Task 6.7에 유지한다.
14. 외부 배포·push·`salesMode` 전환은 별도 사용자 요청 전 실행하지 않는다.
15. 모든 Verify가 종료 코드 0일 때만 Task `Status`와 `Conclusion`을 실제 결과로 갱신한다.
16. Unit 6 완료 전 원 계획 Task 6.1을 완료 상태로 닫지 않는다.

---

## 📋 Execution Plan

> **에이전트 스코프**: 사용자가 다음 대화에서 이 PLAN 실행을 요청하면 아래 Task만 순차 실행한다. 각 Verify 뒤 Conclusion과 Status를 실제 결과로 갱신하며 범위 밖 미커밋 변경은 그대로 보존한다.

### Unit 0 — 회귀 기준선 안정화 [Gate]

#### Task 0.1 — 보관 scheduler 테스트 시각 고정

- **Dependency**: 없음
- **Target**: `apps/api/src/retention/retention.service.spec.ts`
- **Goal**: scheduler 파기 테스트가 시스템 시각을 고정해 만료 전후 fixture를 결정적으로 판정하도록 보정한다.
- **Verify**: `pnpm --filter api test -- retention.service.spec.ts --runInBand`
- **Conclusion**: 통과 — scheduler 테스트에서 시스템 시각을 `2026-07-17T01:00:00.000Z`로 고정해 만료 전후 fixture를 실행 날짜와 무관하게 판정했으며, 전용 테스트 13개가 통과했다.
- **Status**: done

### Unit 1 — 기상 보류 서버 불변식 [P0]

#### Task 1.1 — 기상 보류 조작 요청 실패 계약

- **Dependency**: Task 0.1
- **Target**: `apps/api/src/orders/mvp-order-flow.spec.ts`
- **Goal**: 기상 보류의 고객 책임·재배송비·새 일정 조합과 손상 주문 청구 차단 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand`
- **Conclusion**: 통과 — 회차·legacy 서비스 직접 호출의 고객 책임, 양수 재배송비, 일정 누락·손상 및 손상 문서 청구 우회를 실패 계약 6개로 재현했다.
- **Status**: done

#### Task 1.2 — 보류 정책 정본 구현

- **Dependency**: Task 1.1
- **Target**: `apps/api/src/orders/delivery-hold-policy.ts`
- **Goal**: 기상 보류의 고객 책임 금지·재배송비 금지·새 일정 필수를 검증하는 순수 정책 함수를 구현한다.
- **Verify**: `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand`
- **Conclusion**: 통과 — `WEATHER`의 고객 책임 `false`, 재배송비 `null`, 유효한 `nextDeliveryAt` 조합을 강제하는 공통 정책 함수를 구현했다.
- **Status**: done

#### Task 1.3 — 회차 주문 보류 정책 적용

- **Dependency**: Task 1.2
- **Target**: `apps/api/src/orders/round-order-lifecycle.service.ts`
- **Goal**: 회차 주문의 `DELIVERY_HELD` 저장 전에 서버 보류 정책을 적용한다.
- **Verify**: `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand`
- **Conclusion**: 통과 — 회차 주문의 보류 스냅샷 생성 전에 공통 기상 정책을 적용해 잘못된 조합과 회차 카운터 변경을 함께 차단했다.
- **Status**: done

#### Task 1.4 — legacy 주문 보류 정책 적용

- **Dependency**: Task 1.3
- **Target**: `apps/api/src/orders/orders-lifecycle.service.ts`
- **Goal**: legacy 주문의 `DELIVERY_HELD` 저장에도 같은 서버 보류 정책을 적용한다.
- **Verify**: `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand`
- **Conclusion**: 통과 — legacy 주문의 보류 저장 경계에도 동일 정책을 적용해 서비스 직접 호출 우회를 차단했다.
- **Status**: done

#### Task 1.5 — 기상 보류 청구 방어

- **Dependency**: Task 1.4
- **Target**: `apps/api/src/orders/order-charges.service.ts`
- **Goal**: 저장된 스냅샷이 손상돼도 `WEATHER` 보류에는 재배송비 결제를 만들지 않도록 차단한다.
- **Verify**: `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand`
- **Conclusion**: 통과 — 과거 손상 문서가 고객 책임과 양수 금액을 가져도 `reasonCode: WEATHER`이면 재배송비 문서를 생성하지 않으며, 전체 흐름 테스트 34개가 통과했다.
- **Status**: done

### Unit 2 — 완료 사진 불변성 [P0]

#### Task 2.1 — Storage 불변 업로드 실패 계약

- **Dependency**: Task 1.5
- **Target**: `apps/api/src/firestore/storage.service.spec.ts`
- **Goal**: 같은 키·같은 바이트 재시도와 같은 키·다른 바이트 충돌의 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- storage.service.spec.ts --runInBand`
- **Conclusion**: 통과 — 같은 사진 ID의 동일 JPEG 재시도와 다른 JPEG 충돌 계약을 추가해 기존 덮어쓰기 위험을 재현했다.
- **Status**: done

#### Task 2.2 — 생성 전용 사진 객체 저장

- **Dependency**: Task 2.1
- **Target**: `apps/api/src/firestore/storage.service.ts`
- **Goal**: 생성 조건과 SHA-256 metadata로 기존 사진 객체를 덮어쓰지 않는 업로드를 구현한다.
- **Verify**: `pnpm --filter api test -- storage.service.spec.ts --runInBand`
- **Conclusion**: 통과 — `ifGenerationMatch: 0` 생성 조건과 SHA-256 사용자 metadata를 사용해 동일 해시만 멱등 재사용하고 다른 해시는 `409 Conflict`로 거부했으며 Storage 테스트 12개가 통과했다.
- **Status**: done

#### Task 2.3 — 동시 업로드 정리 실패 계약

- **Dependency**: Task 2.2
- **Target**: `apps/api/src/orders/delivery-photos.service.spec.ts`
- **Goal**: 동시 재시도에서 기존 연결 객체를 삭제하지 않는 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- delivery-photos.service.spec.ts --runInBand`
- **Conclusion**: 통과 — 다른 동시 요청이 먼저 생성한 객체를 후속 연결 실패 요청이 삭제하는 결함을 실패 테스트로 재현했다.
- **Status**: done

#### Task 2.4 — 신규 미연결 객체만 정리

- **Dependency**: Task 2.3
- **Target**: `apps/api/src/orders/delivery-photos.service.ts`
- **Goal**: 업로드 결과의 신규 생성 여부를 사용해 이 요청이 만든 미연결 객체만 정리하도록 보정한다.
- **Verify**: `pnpm --filter api test -- delivery-photos.service.spec.ts --runInBand`
- **Conclusion**: 통과 — 업로드 결과의 `created` 표식을 사용해 현재 요청이 신규 생성한 미연결 객체만 정리하며 사진 서비스 테스트 8개가 통과했다.
- **Status**: done

### Unit 3 — 배송 완료 후속효과 재조정 [P0]

#### Task 3.1 — 완료 후속효과 복구 실패 계약

- **Dependency**: Task 2.4
- **Target**: `apps/api/src/orders/orders-lifecycle-completion.spec.ts`
- **Goal**: `DELIVERED` 상태에서 누락 정산·누락 알림만 재처리하는 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- orders-lifecycle-completion.spec.ts --runInBand`
- **Conclusion**: 통과 — 이미 `DELIVERED`인 주문의 누락 정산·알림과 각 단계 실패 뒤 재시도 복구를 전용 테스트 3개로 재현했다.
- **Status**: done

#### Task 3.2 — 완료 알림 멱등 실패 계약

- **Dependency**: Task 3.1
- **Target**: `apps/api/src/notifications/notifications-delivery.spec.ts`
- **Goal**: 같은 주문 완료 전환의 정상 알림을 한 번만 발송하는 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand`
- **Conclusion**: 통과 — 같은 주문 완료 전환을 두 번 처리할 때 기존 구현이 정상 알림을 중복 발송하는 계약 실패를 재현했다.
- **Status**: done

#### Task 3.3 — 주문 전환 알림 멱등 기록

- **Dependency**: Task 3.2
- **Target**: `apps/api/src/notifications/notifications.service.ts`
- **Goal**: 주문·전환 멱등 키로 정상 완료 알림의 재발송을 막는 내구성 있는 처리 기록을 구현한다.
- **Verify**: `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand`
- **Conclusion**: 통과 — 주문 전환 키의 SHA-256 문서에 `PROCESSING|SENT|FAILED` 상태를 기록해 정상 완료 알림 재발송을 차단했으며 알림 테스트 11개가 통과했다.
- **Status**: done

#### Task 3.4 — 완료 후속효과 재조정 진입점

- **Dependency**: Task 3.3
- **Target**: `apps/api/src/orders/orders-lifecycle.service.ts`
- **Goal**: 상태가 이미 `DELIVERED`여도 정산과 완료 알림을 멱등 재처리하는 공개 진입점을 구현한다.
- **Verify**: `pnpm --filter api test -- orders-lifecycle-completion.spec.ts --runInBand`
- **Conclusion**: 통과 — `DELIVERED` 정본을 다시 읽어 주문 ID 멱등 정산과 전환 키 완료 알림을 순서대로 재처리하는 공개 진입점을 구현했고 전용 테스트 3개가 통과했다.
- **Status**: done

#### Task 3.5 — 사진 재시도 복구 계약

- **Dependency**: Task 3.4
- **Target**: `apps/api/src/orders/delivery-photos.service.spec.ts`
- **Goal**: 이미 완료된 사진 업로드 재시도가 완료 후속효과 재조정을 호출하는 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- delivery-photos.service.spec.ts --runInBand`
- **Conclusion**: 통과 — 같은 사진 업로드 재시도에서 주문이 이미 완료됐을 때 후속효과 재조정이 호출되지 않는 단절을 실패 테스트로 재현했다.
- **Status**: done

#### Task 3.6 — 사진 재시도 재조정 연결

- **Dependency**: Task 3.5
- **Target**: `apps/api/src/orders/delivery-photos.service.ts`
- **Goal**: 첫 완료와 이미 완료된 재시도 모두 완료 후속효과 재조정 경로를 통과하도록 연결한다.
- **Verify**: `pnpm --filter api test -- delivery-photos.service.spec.ts orders-lifecycle-completion.spec.ts --runInBand`
- **Conclusion**: 통과 — 최초 완료는 상태 전환 내부 재조정을, 이미 완료된 같은 사진 재시도는 공개 재조정 진입점을 호출하며 사진·완료 통합 테스트 11개가 통과했다.
- **Status**: done

### Unit 4 — 소비자 완료 사진 조회 [P1]

#### Task 4.1 — 단건 상세 서명 URL 실패 계약

- **Dependency**: Task 3.6
- **Target**: `apps/api/src/orders/orders-query.service.spec.ts`
- **Goal**: 권한 있는 완료 주문 상세만 첫 연결 사진의 서명 URL을 반환하는 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- orders-query.service.spec.ts --runInBand`
- **Conclusion**: 통과 — 완료·리뷰 단건 상세의 첫 사진 URL, 목록·미완료 제외, 서명 실패 전파 계약을 추가해 기존 응답 단절을 재현했다.
- **Status**: done

#### Task 4.2 — 단건 상세 사진 URL 보강

- **Dependency**: Task 4.1
- **Target**: `apps/api/src/orders/orders-query.service.ts`
- **Goal**: 권한 검사 뒤 완료 단건 상세에만 15분 `deliveryPhotoUrl`을 보강한다.
- **Verify**: `pnpm --filter api test -- orders-query.service.spec.ts --runInBand`
- **Conclusion**: 통과 — 주문 관계 권한 확인 뒤 `DELIVERED|REVIEWED` 회차 직배송 단건 상세에만 첫 연결 사진의 15분 URL을 보강하고 저장된 공개 URL 폴백을 제거했으며 조회 테스트 10개가 통과했다.
- **Status**: done

#### Task 4.3 — 소비자 완료 사진 판독 회귀

- **Dependency**: Task 4.2
- **Target**: `apps/consumer/src/app/mypage/orders/[id]/_client.test.mjs`
- **Goal**: 완료·리뷰 상태의 HTTPS 서명 URL만 사진으로 표시하는 소비자 회귀 계약을 강화한다.
- **Verify**: `node --test "apps/consumer/src/app/mypage/orders/[id]/_client.test.mjs"`
- **Conclusion**: 통과 — 완료·리뷰 상태의 HTTPS URL만 표시하고 활성 상태와 HTTP·Storage 경로는 승격하지 않는 소비자 판독 계약을 강화했으며 실제 Node 테스트 6개가 통과했다.
- **Status**: done

### Unit 5 — 기사 보류 해소와 E2E 계약 [P1]

#### Task 5.0 — 기사 보류 해소 실패 계약

- **Dependency**: Task 4.3
- **Target**: `apps/driver/src/app/board/board-contract.test.mjs`
- **Goal**: 보류 주문 노출·배송 재개·사진 화면 역할의 실패 계약을 먼저 고정한다.
- **Verify**: `node --test apps/driver/src/app/board/board-contract.test.mjs`
- **Conclusion**: 통과 — 보류 주문 구독·카드 식별·배송 재개·사진 heading과 버튼 이름의 기존 단절 4개를 소스 계약 테스트로 재현했다.
- **Status**: done

#### Task 5.1 — 보류 주문 보드 구독

- **Dependency**: Task 5.0
- **Target**: `apps/driver/src/app/board/_client.tsx`
- **Goal**: 인증된 담당 기사의 `DELIVERING|DELIVERY_HELD` 주문만 배송 중 탭에서 구독하도록 보정한다.
- **Verify**: `pnpm --filter driver exec tsc --noEmit`
- **Conclusion**: 통과 — 기사 ID가 없으면 배정 주문 구독을 시작하지 않고, 확인된 기사 ID로 `DELIVERING|DELIVERY_HELD`와 `driverId`를 함께 제한했으며 driver 타입 검사가 통과했다.
- **Status**: done

#### Task 5.2 — 기사 주문 카드 상태 계약

- **Dependency**: Task 5.1
- **Target**: `apps/driver/src/components/OrderCard.tsx`
- **Goal**: 기사 주문 카드에 안정적인 test id와 배송 보류 상태 배지를 추가한다.
- **Verify**: `pnpm --filter driver exec tsc --noEmit`
- **Conclusion**: 통과 — 카드에 `driver-order-${order.id}` test id와 별도 `배송 보류` 배지를 추가했으며 driver 타입 검사가 통과했다.
- **Status**: done

#### Task 5.3 — 보류 주문 배송 재개

- **Dependency**: Task 5.2
- **Target**: `apps/driver/src/app/board/[orderId]/page.tsx`
- **Goal**: 담당 기사가 보류 주문을 `DELIVERING`으로 재개하고 검증된 응답 뒤 사진 완료 흐름으로 복귀하도록 연결한다.
- **Verify**: `pnpm --filter driver exec tsc --noEmit`
- **Conclusion**: 통과 — 회차 직배송 보류 상세에 `배송 재개`를 추가해 기존 상태 API로 `DELIVERING`을 요청하고 응답 ID·상태 검증 뒤 사진 흐름으로 복귀하게 했으며 driver 타입 검사가 통과했다.
- **Status**: done

#### Task 5.4 — 사진 화면 접근성 계약

- **Dependency**: Task 5.3
- **Target**: `apps/driver/src/app/board/[orderId]/photo/page.tsx`
- **Goal**: 사진 화면의 제목·촬영·최종 완료 동작을 역할 기반 선택자로 식별할 수 있게 보정한다.
- **Verify**: `pnpm --filter driver exec tsc --noEmit`
- **Conclusion**: 통과 — 사진 화면에 h1 제목, `사진 촬영` 버튼·shutter 이름, 촬영 전 비활성화되는 `사진을 등록하고 배송 완료` 버튼을 제공하고 legacy 거점 업로드를 유지했으며 driver 타입 검사가 통과했다.
- **Status**: done

#### Task 5.5 — 드라이버 E2E 계약 정합

- **Dependency**: Task 5.4
- **Target**: `apps/e2e/tests/driver-direct-delivery.spec.ts`
- **Goal**: 보류 재개와 사진 완료 시나리오의 선택자를 실제 접근성 역할과 안정적인 test id에 맞춘다.
- **Verify**: `pnpm --filter e2e exec playwright test driver-direct-delivery.spec.ts --list`
- **Conclusion**: 통과 — 보류 카드 진입·배송 재개와 실제 button 역할 기반 사진 흐름으로 선택자를 맞췄고 chromium·mobile 합계 16개가 목록 수집됐다.
- **Status**: done

### Unit 6 — 통합 회귀와 원 계획 복귀 [Gate]

#### Task 6.1 — API 사진·보류·완료 집중 회귀

- **Dependency**: Task 5.5
- **Target**: `docs/plans/PLAN_mvp_sales_round_task5_review_remediation.md`
- **Goal**: 사진·보류·완료 후속효과 집중 테스트 결과를 계획 종결 근거로 기록한다.
- **Verify**: `pnpm --filter api test -- storage.service.spec.ts delivery-photos.service.spec.ts orders-lifecycle-completion.spec.ts orders-query.service.spec.ts mvp-order-flow.spec.ts notifications-delivery.spec.ts --runInBand`
- **Conclusion**: 통과 — Storage·사진 연결·완료 복구·상세 조회·보류 정책·알림 멱등의 6개 suite, 78개 테스트가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 6.2 — API 전체 회귀

- **Dependency**: Task 6.1
- **Target**: `docs/plans/PLAN_mvp_sales_round_task5_review_remediation.md`
- **Goal**: API 전체 테스트가 시간 의존 실패 없이 통과한 결과를 기록한다.
- **Verify**: `pnpm --filter api test -- --runInBand`
- **Conclusion**: 통과 — 시간 의존 보관 회귀를 포함한 API 전체 26개 suite, 199개 테스트가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 6.3 — 전체 타입 검사

- **Dependency**: Task 6.2
- **Target**: `docs/plans/PLAN_mvp_sales_round_task5_review_remediation.md`
- **Goal**: shared·API·소비자·셀러·드라이버 타입 검사 결과를 기록한다.
- **Verify**: `pnpm typecheck`
- **Conclusion**: 통과 — workspace 재귀 `pnpm typecheck`가 shared 타입 검사를 포함해 종료 코드 0으로 완료됐다.
- **Status**: done

#### Task 6.4 — 전체 production build

- **Dependency**: Task 6.3
- **Target**: `docs/plans/PLAN_mvp_sales_round_task5_review_remediation.md`
- **Goal**: 전체 production build 결과와 생성물 보존 결과를 기록한다.
- **Verify**: `pnpm build`
- **Conclusion**: 통과 — 최초 build에서 주문 정규화 반환 타입 오류 1건을 확인해 명시적 응답 타입으로 보정한 뒤 shared·API·consumer·seller·driver production build가 종료 코드 0으로 통과했다. build가 갱신한 기존 추적 생성물 5개는 임의 복원하지 않고 보존했다.
- **Status**: done

#### Task 6.5 — 드라이버 E2E 계약 수집

- **Dependency**: Task 6.4
- **Target**: `docs/plans/PLAN_mvp_sales_round_task5_review_remediation.md`
- **Goal**: 드라이버 회차 직배송 E2E 계약의 수집 상태를 기록한다.
- **Verify**: `pnpm --filter e2e exec playwright test driver-direct-delivery.spec.ts --list`
- **Conclusion**: 통과 — 드라이버 회차 직배송 계약이 chromium·mobile 합계 16개로 수집됐으며 실제 seed 실행 전 `test.fixme`는 유지했다.
- **Status**: done

#### Task 6.6 — 원 계획 복귀 게이트 갱신

- **Dependency**: Task 6.5
- **Target**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- **Goal**: Task 5 리뷰 보정 결과와 Task 6.1 복귀 조건을 원 계획 Closeout에 기록한다.
- **Verify**: `git diff --check -- docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- **Conclusion**: 통과 — 기존 Task 6.1 미커밋 계획을 보존한 채 Task 5 리뷰 보정 결과, 검증 수치, 16개 드라이버 `test.fixme`와 Task 6.1 복귀점을 Closeout에 병합했고 대상 공백 검사가 통과했다.
- **Status**: done

#### Task 6.7 — 핵심 로직 결정 기록

- **Dependency**: Task 6.6
- **Target**: `docs/CRITICAL_LOGIC.md`
- **Goal**: 기상 보류·사진 불변성·완료 후속효과 복구 계약을 새 결정 항목으로 기록한다.
- **Verify**: `git diff --check -- docs/CRITICAL_LOGIC.md`
- **Conclusion**: 통과 — #CL-169에 기상 보류 서버 정책, 사진 생성 전용 해시, 완료 재조정, 단건 서명 URL, 기사 보류 복구 계약을 기록했고 대상 공백 검사가 통과했다.
- **Status**: done

#### Task 6.8 — 프로젝트 메모 복귀점 갱신

- **Dependency**: Task 6.7
- **Target**: `docs/memory.md`
- **Goal**: 리뷰 보정 완료 상태와 원 계획 Task 6.1을 다음 작업으로 기록한다.
- **Verify**: `git diff --check -- docs/memory.md`
- **Conclusion**: 통과 — 43줄 메모에 리뷰 보정 계약·검증 수치·보존 생성물·잔여 `test.fixme`와 원 계획 Task 6.1 복귀점을 기록했고 대상 공백 검사가 통과했다.
- **Status**: done

#### Task 6.9 — 계획 최종 완료 처리

- **Dependency**: Task 6.8
- **Target**: `docs/plans/PLAN_mvp_sales_round_task5_review_remediation.md`
- **Goal**: 전체 변경의 공백 오류를 확인해 Task 5 리뷰 보정 계획의 완료 상태를 확정한다.
- **Verify**: `git diff --check`
- **Conclusion**: 통과 — 전체 작업 트리의 공백 오류가 없고 기존 사용자 미커밋 변경과 build 생성물을 보존한 상태로 리뷰 보정 계획을 종결했다.
- **Status**: done

---

## ✅ Completion Criteria

- 조작된 `WEATHER` 요청이 고객 책임이나 재배송비를 저장하지 못한다.
- 기상 보류에는 유효한 새 배송 예정 시각이 반드시 존재한다.
- 손상된 기상 보류 주문도 재배송비 청구를 만들지 못한다.
- 같은 멱등 키와 같은 JPEG 재시도는 기존 객체를 변경하지 않는다.
- 같은 멱등 키와 다른 JPEG 재시도는 충돌하며 원본을 유지한다.
- 동시 업로드 실패가 다른 성공 요청의 사진 객체를 삭제하지 않는다.
- 이미 `DELIVERED`인 주문의 재시도가 누락 정산을 생성한다.
- 이미 `DELIVERED`인 주문의 재시도가 누락 완료 알림을 다시 처리한다.
- 이미 성공한 완료 알림은 정상 재시도에서 중복 발송되지 않는다.
- 인증된 완료 주문 단건 상세만 15분 `deliveryPhotoUrl`을 반환한다.
- 주문 목록은 사진별 서명 URL을 생성하지 않는다.
- 담당 기사는 보류 주문을 보드에서 찾아 배송을 재개할 수 있다.
- 사진 화면의 heading과 버튼 이름이 E2E 계약과 일치한다.
- 보관 scheduler 테스트가 실행 날짜와 무관하게 통과한다.
- API 전체 테스트, 전체 타입 검사, 전체 build가 종료 코드 0으로 끝난다.
- 드라이버 E2E 계약이 목록 수집되며 실제 실행은 Task 6.7에 남는다.
- 전체 `git diff --check`가 통과한다.
- 기존 사용자 미커밋 변경이 보존된다.
- 원 계획 Task 6.1이 다음 진입점으로 기록된다.

---

## 🧾 Closeout Roll-up

- **Status**: 완료
- **Completed Tasks**: Unit 0~6의 34개 Task 전체
- **Current Entry**: `PLAN_mvp_sales_round_direct_delivery.md` Task 6.1
- **Released Original Entry**: `PLAN_mvp_sales_round_direct_delivery.md` Task 6.1
- **Deferred Runtime Gate**: 실제 인증·seed 기반 Playwright 실행은 원 계획 Task 6.7
- **Verification**: API 집중 78개, API 전체 199개, workspace 타입 검사, production build, 드라이버 E2E 16개 목록 수집, 전체 `git diff --check` 통과
- **Deployment**: 배포·push·`salesMode`·Firebase 규칙 변경 없음

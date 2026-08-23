<!-- Language: ko -->

# Project Blueprint: 소비자 회차 직배송 Task 4.1~4.19 리뷰 보정

## 문서 메타

- **작성일**: 2026-07-18
- **상태**: 완료
- **Priority**: P1
- **Labels**: `consumer`, `sales-round`, `payment`, `acquisition`, `regression`
- **SSOT Check**: `docs/specs/mvp-sales-round-direct-delivery.md`, `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`, `docs/CRITICAL_LOGIC.md` #CL-168
- **Architectural Goal**: 소비자 회차 직배송의 바로 구매·당근 유입·회차 선택·마케팅 설정 진입을 실제 주문 계약과 일치시킨 뒤 원 계획 Task 5.1에 복귀한다.

---

## 📋 업무 요약 (협업용)

### 개요

Task 4.1~4.19 전수 리뷰에서 소비자 화면의 주요 계약이 정적 테스트를 통과했지만 실제 사용자 흐름에서는 다섯 결함이 남아 있음이 확인됐다. 회차 상품의 바로 구매는 회차 식별자를 잃고, 당근 유입은 직접 상품 진입에서 저장되지 않으며 주문 요청에도 포함되지 않는다. 여러 예정 회차가 있으면 가장 먼 회차가 선택되고, 마케팅 설정 화면은 사용자 메뉴에서 진입할 수 없다.

### 완료 모습

- 회차 상품의 장바구니 구매와 바로 구매가 같은 회차 checkout 계약을 사용한다.
- 당근 상품 광고 직접 진입이 허용된 유입 스냅샷을 저장한다.
- 저장된 유입 스냅샷이 회차 주문 생성 요청에 포함된다.
- 판매 중 회차가 없으면 가장 가까운 예정 회차가 선택된다.
- MY에서 마케팅 알림 설정 화면으로 이동할 수 있다.
- 소비자 Node 테스트·타입 검사·production build가 모두 통과한다.

### 이번 계획에서 하지 않는 것

- 셀러·드라이버 Task 5.x 구현
- 소비자 E2E용 실제 운영 데이터 생성
- `salesMode` 전환이나 배포
- 결제·주문 서버 계약 변경
- Firestore·Storage 규칙 변경
- 기존 legacy 구매 흐름 재설계

---

## 🎯 Origin Intent

- 사용자는 완료된 Task 4.1~4.19 결과를 리뷰한 뒤 발견된 문제를 해결할 실행 계획과 다음 대화용 인계를 요청했다.
- 리뷰 범위는 `7cbd068`부터 `fd62556`까지의 소비자 회차 직배송 구현이며 현재 작업 트리의 후속 미커밋 변경은 보존한다.
- 다섯 결함을 먼저 실패 테스트로 고정한 뒤 단일 파일 단위로 보정하고 전체 소비자 회귀를 통과시킨다.

---

## ⚠️ Edge Case Trace

| Edge Case | Failure Mode | Guard | Task-ID |
| :--- | :--- | :--- | :--- |
| 회차 상품에서 바로 구매 선택 | 일반 단일상품 checkout으로 이동해 서버가 회차 필드 누락을 거부함 | 검증된 단일 `RoundCartItem`을 `checkout_cart`에 저장해 회차 checkout을 재사용 | 0.2, 1.2 |
| 비로그인 사용자가 바로 구매 선택 | 로그인 후 회차 checkout 입력이 사라짐 | 로그인 이동 전에 현재 탭의 `sessionStorage`에 checkout 스냅샷 저장 | 0.2, 1.2 |
| 저장소 접근이 차단됨 | 바로 구매 클릭이 예외로 중단됨 | 저장 실패를 사용자 오류 상태로 닫고 일반 주문으로 우회하지 않음 | 0.2, 1.2 |
| 상품 상세 URL로 당근 광고 직접 진입 | 홈이 렌더되지 않아 UTM 캡처가 누락됨 | 상품 상세 client effect에서 기존 `captureAcquisition` 재사용 | 0.3, 1.3 |
| 당근이 아닌 상품 상세 진입 | 기존 당근 스냅샷이 잘못 덮어써짐 | 기존 캡처 함수의 당근 source 제한 계약 유지 | 0.3, 1.3 |
| SSR 또는 hydration 시 저장소 미사용 | 유입 스냅샷이 영구적으로 `null`이 됨 | 브라우저 effect에서 `getAcquisitionSnapshot`을 읽어 상태에 반영 | 0.4, 1.4 |
| 손상된 유입 저장값 | 임의 필드가 주문에 포함됨 | 기존 재검증 함수가 반환한 허용 필드만 주문 요청에 포함 | 0.4, 1.4 |
| 예정 회차가 둘 이상 존재 | 가장 먼 미래 회차가 현재 회차로 표시됨 | `OPEN` 우선 뒤 `orderOpenAt`이 가장 가까운 `SCHEDULED` 선택 | 0.1, 1.1 |
| 판매 중·예정 회차가 없음 | 과거 회차가 임의 구매 가능 상태로 승격됨 | 가장 최신 `CLOSED`만 표시용 현재 회차로 선택하고 구매 가능 판정은 유지 | 0.1, 1.1 |
| 마케팅 설정 URL을 모르는 사용자 | 철회 화면에 도달하지 못함 | MY 메뉴에 명시적 설정 진입 항목 추가 | 0.5, 1.5 |
| 기존 미커밋 변경이 존재함 | 범위 밖 사용자 작업이 덮어써짐 | 지정 Target 외 파일을 수정하지 않고 복원 명령을 사용하지 않음 | 전체 |
| 소비자 E2E가 `test.fixme`임 | 실제 브라우저 통합 회귀가 검증되지 않음 | 이번 보정은 Node·타입·build를 게이트로 삼고 실제 E2E는 원 계획 Task 6.7에 유지 | 2.1~2.4 |

---

## 🔎 Diagnosis & Findings

1. `RoundDirectProductActions.handleBuyNow`은 `roundId`, `roundItemId`, `roundPrice` 없이 `/checkout`으로 이동한다.
2. `CheckoutContent`는 `from=cart`가 없으면 `SingleCheckoutContent`를 사용하므로 회차 스토어에 일반 주문 요청을 보낸다.
3. 서버 회차 주문 생성은 `roundId`와 비어 있지 않은 `roundItems`를 필수로 검증한다.
4. `captureAcquisition`은 홈에서만 호출돼 상품 광고의 상세 직접 진입을 포착하지 못한다.
5. `getAcquisitionSnapshot`은 테스트 외 실제 호출자가 없고 회차 checkout의 `orderRequest`에 `acquisition`이 없다.
6. `useSaleRounds`는 주문 시작 시각 내림차순 정렬 뒤 첫 `SCHEDULED`를 선택해 가장 먼 예정 회차를 고른다.
7. 마케팅 설정 페이지는 구현됐지만 MY와 알림 내역에서 연결되지 않는다.
8. 현재 Node 테스트는 일부 소스 문자열 계약에 의존하고 소비자 Playwright 24건은 모두 `test.fixme`라 위 단절을 탐지하지 못했다.

---

## 🧱 Architectural Deepening

### 회차 바로 구매 경계

- 바로 구매는 legacy 단일상품 checkout을 확장하지 않는다.
- 검증된 회차 상품 하나를 기존 `RoundCartItem` 형식으로 직렬화한다.
- `checkout_cart`와 `from=cart` 경로를 사용해 Task 4.12~4.15의 서버 재검증·단일 주문·필수 고지를 그대로 재사용한다.
- 영구 장바구니 `greenhub_cart`는 바로 구매 때문에 변경하지 않는다.

### 당근 유입 수명주기

- 캡처 책임은 실제 광고 도착점인 홈과 상품 상세에 둔다.
- 주문 반영 책임은 회차 checkout 브라우저 경계에 둔다.
- SSR에서 저장소를 읽지 않고 mount 뒤 재검증된 스냅샷만 상태에 보관한다.
- 주문 서버 DTO와 `usePayment` 계약은 이미 `acquisition`을 지원하므로 서버 변경을 만들지 않는다.

### 회차 선택 규칙

- `OPEN` 회차가 있으면 최신 주문 시작 시각의 `OPEN`을 선택한다.
- `OPEN`이 없으면 현재 시각 이후 주문 시작 예정인 `SCHEDULED` 중 가장 가까운 회차를 선택한다.
- 예정 시각이 손상됐거나 과거인 `SCHEDULED`는 현재 예정 회차로 승격하지 않는다.
- 판매 중·예정 회차가 없으면 가장 최신 `CLOSED`를 표시용 현재 회차로 사용한다.
- `COMPLETED`는 지난 회차에만 포함한다.

### 설정 진입 경계

- MY의 기존 알림 내역 항목은 보존한다.
- 마케팅 알림 설정을 별도 항목으로 추가해 정보성 알림 내역과 선택 마케팅 설정의 의미를 분리한다.

---

## Agent Completion Contract

1. Task는 Dependency 순서대로 하나씩 실행한다.
2. Phase 0의 각 실패 테스트가 해당 구현 전 실패하는지 확인한다.
3. 각 Task는 지정된 단일 Target만 수정한다.
4. 회차 바로 구매는 legacy `SingleCheckoutContent`를 재사용하지 않는다.
5. 바로 구매는 영구 장바구니를 변경하지 않는다.
6. 당근 유입은 기존 `captureAcquisition`, `getAcquisitionSnapshot`의 검증 규칙을 우회하지 않는다.
7. 유입 저장값 원문을 직접 JSON 파싱해 주문에 넣지 않는다.
8. 회차 선택 테스트는 현재 시각을 고정해 시간대에 따라 흔들리지 않게 한다.
9. 마케팅 설정은 기존 인증·서버 상태 판독 계약을 변경하지 않는다.
10. 현재 작업 트리의 기존 변경을 되돌리거나 정리하지 않는다.
11. 소비자 E2E `test.fixme` 해제는 원 계획 Task 6.7에 유지한다.
12. 모든 Verify가 종료 코드 0일 때만 Task 상태와 Conclusion을 갱신한다.
13. 전체 build가 갱신한 생성물은 Task 시작 시점과 비교해 이번 계획이 소유하지 않는 변경만 원래 상태로 되돌린다.
14. 완료 전 원 계획 Task 5.1을 시작하지 않는다.

> **에이전트 스코프**: 이 계획은 리뷰에서 확인된 소비자 다섯 결함, 관련 실패 테스트, 원 계획·메모의 진입점 갱신만 허용한다. 서버 계약, 셀러·드라이버 기능, 인덱스, 보안 규칙, 배포는 포함하지 않는다.

---

## 📋 Execution Plan

### Phase 0 — 실패 계약 고정

#### Task 0.1 — 가장 가까운 예정 회차 선택 테스트

- **Dependency**: 없음
- **Target**: `apps/consumer/src/hooks/useSaleRounds.test.mjs`
- **Goal**: 판매 중 회차가 없을 때 현재 시각 이후 가장 가까운 예정 회차를 선택하는 실패 테스트를 먼저 고정한다.
- **Verify**: `node --test apps/consumer/src/hooks/useSaleRounds.test.mjs`
- **Conclusion**: 실패 고정 — 고정 시각 기준 가장 가까운 `round-nearest` 대신 가장 먼 `round-later`를 선택하는 결함을 재현했고, Task 1.1 보정 후 전용 5개 테스트가 통과했다.
- **Status**: done

#### Task 0.2 — 회차 바로 구매 checkout 연결 테스트

- **Dependency**: Task 0.1
- **Target**: `apps/consumer/src/app/products/[id]/_components/ProductActions.test.mjs`
- **Goal**: 바로 구매가 검증된 단일 회차 스냅샷으로 회차 checkout에 진입하는 실패 테스트를 먼저 고정한다.
- **Verify**: `node --test apps/consumer/src/app/products/[id]/_components/ProductActions.test.mjs`
- **Conclusion**: 실패 고정 — 기존 바로 구매가 `checkout_cart` 없이 legacy 단일상품 checkout으로 이동함을 재현했고, Task 1.2 보정 후 전용 6개 테스트가 통과했다.
- **Status**: done

#### Task 0.3 — 상품 직접 유입 캡처 테스트

- **Dependency**: Task 0.2
- **Target**: `apps/consumer/src/app/products/[id]/page.test.mjs`
- **Goal**: 상품 상세 mount가 기존 당근 유입 캡처 함수를 호출하는 실패 테스트를 먼저 고정한다.
- **Verify**: `node --test apps/consumer/src/app/products/[id]/page.test.mjs`
- **Conclusion**: 실패 고정 — 상품 상세에 `captureAcquisition` 호출이 없음을 재현했고, Task 1.3 보정 후 전용 6개 테스트가 통과했다.
- **Status**: done

#### Task 0.4 — 회차 주문 유입 스냅샷 테스트

- **Dependency**: Task 0.3
- **Target**: `apps/consumer/src/app/checkout/page.test.mjs`
- **Goal**: 브라우저에서 재검증한 당근 유입 스냅샷을 회차 주문 요청에 포함하는 실패 테스트를 먼저 고정한다.
- **Verify**: `node --test apps/consumer/src/app/checkout/page.test.mjs`
- **Conclusion**: 실패 고정 — 회차 checkout에 유입 상태와 주문 전달이 없음을 재현했고, Task 1.4 보정 후 전용 6개 테스트가 통과했다.
- **Status**: done

#### Task 0.5 — 마케팅 설정 진입 테스트

- **Dependency**: Task 0.4
- **Target**: `apps/consumer/src/app/mypage/_client.test.mjs`
- **Goal**: MY 화면이 마케팅 알림 설정 경로를 별도 메뉴로 제공하는 실패 테스트를 먼저 고정한다.
- **Verify**: `node --test apps/consumer/src/app/mypage/_client.test.mjs`
- **Conclusion**: 실패 고정 — MY에 마케팅 설정 경로가 없음을 재현했고, Task 1.5 보정 후 전용 5개 테스트가 통과했다.
- **Status**: done

### Phase 1 — 소비자 결함 보정

#### Task 1.1 — 예정 회차 선택 규칙 보정

- **Dependency**: Task 0.5
- **Target**: `apps/consumer/src/hooks/useSaleRounds.ts`
- **Goal**: 현재 시각을 기준으로 판매 중 회차 뒤 가장 가까운 예정 회차를 선택하도록 현재 회차 판독기를 보정한다.
- **Verify**: `node --test apps/consumer/src/hooks/useSaleRounds.test.mjs`
- **Conclusion**: 통과 — `OPEN` 우선 뒤 현재 시각 이후 가장 가까운 `SCHEDULED`, 없으면 표시용 최신 `CLOSED`를 선택하며 전용 5개 테스트가 통과했다.
- **Status**: done

#### Task 1.2 — 회차 바로 구매 연결

- **Dependency**: Task 1.1
- **Target**: `apps/consumer/src/app/products/[id]/_components/RoundDirectProductActions.tsx`
- **Goal**: 바로 구매가 영구 장바구니를 변경하지 않는 단일 회차 checkout 스냅샷을 저장하도록 연결한다.
- **Verify**: `node --test apps/consumer/src/app/products/[id]/_components/ProductActions.test.mjs`
- **Conclusion**: 통과 — 검증된 단일 `RoundCartItem`을 `checkout_cart`에 저장하고 로그인 전후 `/checkout?from=cart`를 사용하며 저장 실패를 닫힌 오류로 처리했다. 전용 6개 테스트가 통과했다.
- **Status**: done

#### Task 1.3 — 상품 상세 당근 유입 캡처

- **Dependency**: Task 1.2
- **Target**: `apps/consumer/src/app/products/[id]/page.tsx`
- **Goal**: 상품 상세 mount가 허용된 당근 UTM을 기존 탭 세션 스냅샷으로 캡처하도록 연결한다.
- **Verify**: `node --test apps/consumer/src/app/products/[id]/page.test.mjs`
- **Conclusion**: 통과 — 상품 상세 Client Page mount에서 기존 `captureAcquisition`을 호출해 기존 당근 source 제한과 탭 세션 계약을 재사용했다. 전용 6개 테스트가 통과했다.
- **Status**: done

#### Task 1.4 — 회차 주문 유입 스냅샷 연결

- **Dependency**: Task 1.3
- **Target**: `apps/consumer/src/app/checkout/page.tsx`
- **Goal**: 회차 checkout이 mount 뒤 재검증한 당근 유입 스냅샷을 `usePayment` 주문 요청에 전달하도록 연결한다.
- **Verify**: `node --test apps/consumer/src/app/checkout/page.test.mjs`
- **Conclusion**: 통과 — 초기 상태는 `null`로 두고 mount 뒤 `getAcquisitionSnapshot` 반환값만 회차 `orderRequest.acquisition`에 포함했다. 전용 6개 테스트가 통과했다.
- **Status**: done

#### Task 1.5 — MY 마케팅 설정 진입 추가

- **Dependency**: Task 1.4
- **Target**: `apps/consumer/src/app/mypage/_client.tsx`
- **Goal**: MY 내 정보 영역에 마케팅 알림 설정 전용 진입 항목을 추가한다.
- **Verify**: `node --test apps/consumer/src/app/mypage/_client.test.mjs`
- **Conclusion**: 통과 — 기존 알림 내역을 보존하고 MY 내 정보에 `/mypage/notifications/settings` 전용 진입을 추가했다. 전용 5개 테스트가 통과했다.
- **Status**: done

### Phase 2 — 소비자 회귀 게이트

#### Task 2.1 — 소비자 Node 전체 회귀

- **Dependency**: Task 1.5
- **Target**: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- **Goal**: 소비자 전체 Node 테스트 결과를 계획 종결 근거로 기록한다.
- **Verify**: `node --test (Get-ChildItem apps/consumer/src -Recurse -Filter *.test.mjs).FullName`
- **Conclusion**: 통과 — 소비자 Node 테스트 78개가 모두 통과했다.
- **Status**: done

#### Task 2.2 — 소비자 타입 검사

- **Dependency**: Task 2.1
- **Target**: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- **Goal**: 소비자 타입 검사 결과를 계획 종결 근거로 기록한다.
- **Verify**: `pnpm --filter consumer exec tsc --noEmit`
- **Conclusion**: 통과 — `pnpm --filter consumer exec tsc --noEmit`가 종료 코드 0으로 완료됐다.
- **Status**: done

#### Task 2.3 — 소비자 production build

- **Dependency**: Task 2.2
- **Target**: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- **Goal**: 소비자 production build 결과를 계획 종결 근거로 기록한다.
- **Verify**: `pnpm --filter consumer build`
- **Conclusion**: 통과 — Next.js 16.2.5 production build와 14개 정적 페이지 생성이 완료됐고 build 전후 추적 상태가 동일했다.
- **Status**: done

#### Task 2.4 — 기존 소비자 E2E 계약 수집

- **Dependency**: Task 2.3
- **Target**: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- **Goal**: 기존 소비자 회차 E2E 계약의 수집 상태를 보정 후 회귀 근거로 기록한다.
- **Verify**: `pnpm --filter e2e exec playwright test consumer-round-direct --list`
- **Conclusion**: 통과 — chromium·mobile에서 소비자 회차 계약 24개가 수집됐고 실제 실행은 원 계획 Task 6.7에 유지했다.
- **Status**: done

### Phase 3 — 원 계획 복귀

#### Task 3.1 — 원 계획 진입 게이트 갱신

- **Dependency**: Task 2.4
- **Target**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- **Goal**: 리뷰 보정 완료 근거를 기록해 원 계획 Task 5.1 진입 조건을 다시 연다.
- **Verify**: `git diff --check -- docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- **Conclusion**: 통과 — 리뷰 보정 결과와 Node 78개·타입 검사·production build·Playwright 24개 목록 근거를 기록하고 Task 5.1을 다음 진입점으로 다시 열었다.
- **Status**: done

#### Task 3.2 — 프로젝트 메모 복귀점 갱신

- **Dependency**: Task 3.1
- **Target**: `docs/memory.md`
- **Goal**: 리뷰 보정 완료 상태와 원 계획 Task 5.1을 다음 작업으로 기록한다.
- **Verify**: `git diff --check -- docs/memory.md`
- **Conclusion**: 통과 — 완료 계획과 검증 결과를 요약하고 실행 SSOT와 다음 작업을 원 계획 Task 5.1로 갱신했다.
- **Status**: done

#### Task 3.3 — 계획 최종 완료 처리

- **Dependency**: Task 3.2
- **Target**: `docs/plans/PLAN_mvp_sales_round_consumer_review_remediation.md`
- **Goal**: 전체 변경의 공백 오류를 확인해 리뷰 보정 계획의 완료 상태를 확정한다.
- **Verify**: `git diff --check`
- **Conclusion**: 통과 — 전체 `git diff --check`가 종료 코드 0으로 완료됐다.
- **Status**: done

---

## ✅ Completion Criteria

- 회차 바로 구매가 `roundId`, `roundItemId`, `roundPrice`를 보존한 회차 checkout으로 진입한다.
- 바로 구매가 영구 장바구니를 변경하지 않는다.
- 비로그인 바로 구매가 로그인 뒤 같은 회차 checkout을 복원한다.
- 상품 상세 직접 당근 유입이 탭 세션 스냅샷으로 저장된다.
- 재검증된 당근 유입 스냅샷이 회차 주문 요청에 포함된다.
- `OPEN`이 없을 때 가장 가까운 미래 `SCHEDULED`가 현재 회차로 선택된다.
- MY 화면에서 마케팅 알림 설정으로 이동할 수 있다.
- 소비자 전체 Node 테스트가 종료 코드 0으로 끝난다.
- 소비자 타입 검사와 production build가 종료 코드 0으로 끝난다.
- 소비자 Playwright 24건 목록이 유지되고 실제 실행은 원 계획 Task 6.7에 남는다.
- 전체 `git diff --check`가 종료 코드 0으로 끝난다.
- 원 계획 Task 5.1은 이 계획 완료 뒤에만 다음 진입점으로 복구된다.

---

## 🧾 Closeout Roll-up

- **Status**: 완료
- **Completed Tasks**: Task 0.1~3.3
- **Current Entry**: 원 계획 Task 5.1
- **Resumed Original Entry**: `PLAN_mvp_sales_round_direct_delivery.md` Task 5.1
- **Deferred Runtime Gate**: 소비자 실제 E2E 실행은 원 계획 Task 6.7

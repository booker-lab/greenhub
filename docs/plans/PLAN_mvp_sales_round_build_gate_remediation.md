<!-- Language: ko -->

# Project Blueprint: 회차 직배송 Task 2.8 전 빌드 게이트 보정

> **Created**: 2026-07-15
> **Status**: 완료
> **Priority**: P0
> **Labels**: `build`, `regression`, `consumer`, `sales-round`, `gate`
> **SSOT**: `docs/plans/PLAN_mvp_sales_round_review_remediation.md`, `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
> **Architectural Goal**: 루트 빌드가 모든 런타임 앱을 실제로 검증하고 신규 알림 템플릿 계약이 consumer 빌드를 깨뜨리지 않는 상태를 만든 뒤 원 계획 Task 2.8에 진입한다.

---

## 🤝 협업 요약

### 개요

회차 직배송 리뷰 보정은 완료됐지만, 전체 빌드 게이트에는 두 가지 결함이 남아 있다. 첫째, Windows에서 루트 빌드가 앱 패키지를 하나도 선택하지 않은 채 성공 종료한다. 둘째, 신규 알림 코드 6종이 consumer 알림 화면의 exhaustive map에 반영되지 않아 consumer 단독 빌드가 실패한다.

### 완료 모습

루트 빌드 한 번으로 공용 패키지와 API·소비자·판매자·기사 앱이 모두 실제 빌드되고, 소비자 앱의 알림 코드 매핑이 공용 타입과 일치한다. 이 게이트를 통과한 뒤에만 원 기능 계획의 Task 2.8을 시작한다.

### 이번 계획에서 하지 않는 것

- 원 기능 계획 Task 2.8 이후 구현
- PortOne 샌드박스 실결제 검증
- Firebase Emulator 기반 통합 검증
- 신규 알림 발송 정책 추가
- 기존 사용자 변경 정리나 커밋

---

## 🎯 Origin Intent

- 사용자는 회차 직배송 리뷰 보정 완료 뒤 남은 위험을 원 기능 계획 Task 2.8 전에 해소하기로 결정했다.
- 내부에서 바로 제거할 수 있는 위험은 루트 빌드의 앱 선택 누락과 consumer 알림 템플릿 타입 오류 두 가지다.
- 외부 환경이 필요한 PortOne 샌드박스와 Firebase Emulator 검증은 각각 원 계획 Task 2.10, Task 6.4 진입 게이트로 유지한다.
- 현재 작업 트리의 미커밋 변경은 사용자 작업으로 간주해 보존한다.

---

## ⚠️ Edge Case Trace

| Edge Case | Failure Mode | Guard | Verification |
|---|---|---|---|
| 앱 필터가 0개 패키지를 선택함 | 루트 `pnpm build`가 실제 앱을 빌드하지 않고 종료 코드 0을 반환함 | 필수 런타임 앱 4개 선택을 검사하는 회귀 계약 | `node scripts/check-workspace-build-selection.mjs` |
| 공용 패키지보다 앱이 먼저 빌드됨 | 앱이 오래된 공용 타입 산출물을 참조함 | 공용 패키지를 먼저 빌드하는 순서 보존 | `pnpm build` 출력 순서 확인 |
| 일부 런타임 앱만 선택됨 | 특정 앱의 타입 오류가 전체 빌드에서 숨겨짐 | `api`, `consumer`, `seller`, `driver`를 명시적 필수 집합으로 고정 | 선택 검사와 루트 빌드 |
| `e2e`가 런타임 앱 집합에 포함됨 | build 스크립트가 없는 패키지 때문에 게이트 의미가 흐려짐 | build 스크립트가 있는 런타임 앱만 필수 집합으로 정의 | 선택 검사 |
| 라벨 map만 보완됨 | 아이콘 map의 exhaustive 타입 오류가 남음 | 두 `Record<NotificationTemplateCode, ...>`를 모두 완전하게 유지 | consumer build |
| 향후 알림 코드가 다시 추가됨 | 화면 매핑 누락이 런타임까지 숨겨짐 | `Record`의 exhaustive typing을 유지하고 타입 우회를 금지 | consumer build |
| 외부 검증을 이번 게이트와 혼합함 | 자격 증명이나 에뮬레이터 부재로 내부 보정이 지연됨 | 외부 검증은 기존 후속 Task 진입 게이트로 분리 | 원 계획 문서 확인 |
| 기존 미커밋 변경과 충돌함 | 사용자 작업이 덮어써지거나 범위 밖 파일이 변함 | Task별 단일 Target 준수와 최종 diff 점검 | `git diff --check` |

---

## 🔎 Diagnosis & Findings

1. 루트 `package.json`의 build 스크립트는 `pnpm -r --filter './apps/*' build`를 사용한다.
2. 현재 Windows 실행에서는 해당 필터가 앱 패키지를 선택하지 못하고 `No projects matched the filters`를 출력하지만 명령 전체는 성공 종료한다.
3. 따라서 이전의 루트 빌드 성공은 API·consumer·seller·driver 전체 빌드 성공을 증명하지 못한다.
4. `NotificationTemplateCode`에는 회차 직배송 보정으로 추가된 코드 6종이 포함돼 있다.
5. consumer 알림 화면의 `TEMPLATE_LABELS`, `TEMPLATE_ICONS`는 exhaustive `Record`이지만 신규 코드 6종이 빠져 있어 consumer 빌드가 실패한다.
6. 두 결함은 저장소 내부에서 재현 가능하므로 원 계획 Task 2.8 전에 제거해야 한다.

---

## 🧱 Architectural Deepening

### 빌드 선택 계약

- 파일 경로 glob의 셸 해석에 의존하지 않는다.
- build 스크립트가 있는 런타임 앱을 패키지 이름으로 명시한다.
- 공용 패키지 빌드가 성공한 뒤 런타임 앱 빌드를 실행한다.
- 선택 검사기는 실제 빌드 전에 필수 패키지 집합이 선택되는지 빠르게 판정한다.
- 패키지 하나라도 빠지거나 선택 결과가 0개면 실패한다.

### 알림 표시 계약

- `TEMPLATE_LABELS`와 `TEMPLATE_ICONS`는 `NotificationTemplateCode` 전체를 다루는 `Record`로 유지한다.
- `as`, 부분 타입, 기본 객체 확장으로 exhaustive 검사를 약화하지 않는다.
- 신규 6종에는 고객이 의미를 이해할 수 있는 한국어 라벨과 기존 디자인 체계의 아이콘을 지정한다.
- 이번 보정은 표시 계약만 다루며 알림 생성 시점이나 발송 정책은 변경하지 않는다.

### 외부 환경 게이트

- PortOne 샌드박스 실결제 검증은 원 계획 Task 2.10 전에 완료한다.
- Firebase Emulator 검증은 원 계획 Task 6.4 전에 완료한다.
- 외부 환경 미준비는 이번 내부 빌드 보정 완료나 원 계획 Task 2.8 진입을 막지 않는다.

---

## Agent Completion Contract

1. Task는 아래 Dependency 순서대로 실행한다.
2. 각 Task는 지정된 단일 Target만 수정한다.
3. Task 0.1의 회귀 검사기를 먼저 작성하고 현재 build 스크립트에서 실패함을 확인한다.
4. 실패 재현은 예상 비정상 종료로 기록하되, Task 0.1의 공식 Verify는 검사기 문법 검증으로 종료 코드 0을 받아야 한다.
5. 이후 Task는 각 Verify가 종료 코드 0일 때만 Conclusion과 Status를 갱신한다.
6. `Record<NotificationTemplateCode, ...>`의 exhaustive 검사를 약화하지 않는다.
7. 현재 작업 트리의 기존 변경을 되돌리거나 정리하지 않는다.
8. 범위 밖 파일을 수정하지 않는다.
9. `pnpm build` 출력에 공용 패키지와 필수 런타임 앱 4개의 build 실행이 모두 확인돼야 한다.
10. 이번 계획 완료 전에는 원 기능 계획 Task 2.8을 시작하지 않는다.
11. 모든 출력과 새 코드 주석은 한국어로 작성한다. 기술 식별자는 원문을 유지한다.
12. 완료 시 변경 파일, 검증 결과, 외부 환경 의존성을 보고한다.

> **에이전트 스코프**: 이 계획은 루트 빌드 패키지 선택, consumer 알림 템플릿 표시 계약, 관련 계획·메모 갱신만 허용한다. 원 기능 계획 Task 2.8 이후 구현과 외부 서비스 검증은 포함하지 않는다.

---

## 📋 Execution Plan

### Phase 0 — 실패 계약 고정

#### Task 0.1 — 워크스페이스 빌드 선택 회귀 검사기 추가

- **Dependency**: 없음
- **Target**: `scripts/check-workspace-build-selection.mjs`
- **Goal**: 루트 build 스크립트가 필수 런타임 앱 4개를 모두 선택하지 않으면 실패하는 계약을 먼저 고정한다.
- **Verify**: `node --check scripts/check-workspace-build-selection.mjs`
- **Conclusion**: 통과 — 검사기 문법 검증이 종료 코드 0으로 끝났고, 수정 전 루트 build 설정에서는 필수 앱 이름을 명시하지 않았다는 오류와 함께 종료 코드 1로 실패했다.
- **Status**: done

실행 메모: Target 작성 직후 `node scripts/check-workspace-build-selection.mjs`를 실행해 현재 설정에서 실패하는지 기록한다. 이 실패 재현이 확인되기 전에는 Task 1.1로 진행하지 않는다.

### Phase 1 — 내부 결함 보정

#### Task 1.1 — 루트 build 패키지 선택 수정

- **Dependency**: Task 0.1
- **Target**: `package.json`
- **Goal**: 루트 build 스크립트를 명시적 패키지 필터로 바꿔 필수 런타임 앱 4개를 실제 실행 대상으로 만든다.
- **Verify**: `node scripts/check-workspace-build-selection.mjs`
- **Conclusion**: 통과 — 루트 build가 공용 패키지 뒤에 `api`, `consumer`, `seller`, `driver`를 명시적으로 선택하며 회귀 검사기가 종료 코드 0으로 끝났다.
- **Status**: done

#### Task 1.2 — consumer 알림 템플릿 매핑 완성

- **Dependency**: Task 1.1
- **Target**: `apps/consumer/src/app/mypage/notifications/_client.tsx`
- **Goal**: 신규 알림 코드 6종의 사용자 라벨과 아이콘을 exhaustive map에 채워 consumer 타입 오류를 제거한다.
- **Verify**: `pnpm --filter consumer build`
- **Conclusion**: 통과 — 신규 알림 코드 6종의 라벨·아이콘을 두 exhaustive map에 추가했고 consumer production build가 종료 코드 0으로 끝났다.
- **Status**: done

필수 코드: `ORDER_DELIVERY_HELD`, `ORDER_REDELIVERY_PAYMENT_REQUESTED`, `ORDER_REDELIVERY_SCHEDULED`, `ROUND_ORDER_CONFIRMED`, `OPERATION_ISSUE_CREATED`, `CUSTOMER_NOTICE_FAILED`.

### Phase 2 — 회귀 검증

#### Task 2.1 — 전체 워크스페이스 빌드 검증

- **Dependency**: Task 1.2
- **Target**: `docs/plans/PLAN_mvp_sales_round_build_gate_remediation.md`
- **Goal**: 루트 빌드가 공용 패키지와 필수 런타임 앱 4개를 실제로 빌드한 결과를 기록한다.
- **Verify**: `pnpm build`
- **Conclusion**: 통과 — 승인된 seller `DELIVERY_HELD` exhaustive map 선행 보정 후 `@greenhub/shared`가 먼저 빌드되고 `api`, `consumer`, `seller`, `driver`가 모두 `Done`으로 끝났다. 필터 0건 메시지 없이 종료 코드 0을 확인했다.
- **Status**: done

#### Task 2.2 — API 단위 회귀 검증

- **Dependency**: Task 2.1
- **Target**: `docs/plans/PLAN_mvp_sales_round_build_gate_remediation.md`
- **Goal**: 빌드 스크립트 보정 뒤 API 전체 단위 테스트 결과를 기록한다.
- **Verify**: `pnpm --filter api test -- --runInBand`
- **Conclusion**: 통과 — API 전체 단위 테스트 8개 스위트의 34개 테스트가 모두 통과했고 종료 코드 0을 확인했다.
- **Status**: done

### Phase 3 — 다음 진입점 확정

#### Task 3.1 — 원 기능 계획 진입 게이트 갱신

- **Dependency**: Task 2.2
- **Target**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- **Goal**: 원 기능 계획의 Task 2.8 진입 게이트를 빌드 보정 결과에 맞게 갱신한다.
- **Verify**: `git diff --check -- docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- **Conclusion**: 통과 — 원 기능 계획이 빌드 게이트 보정 완료 후 Task 2.8 진입 대기로 갱신됐고, Task 2.8은 `todo`를 유지한 채 문서 공백 검사가 종료 코드 0으로 끝났다.
- **Status**: done

#### Task 3.2 — 프로젝트 메모 다음 진입점 갱신

- **Dependency**: Task 3.1
- **Target**: `docs/memory.md`
- **Goal**: 빌드 게이트 완료 상태와 원 기능 계획 Task 2.8을 다음 작업으로 기록한다.
- **Verify**: `git diff --check -- docs/memory.md`
- **Conclusion**: 통과 — 프로젝트 메모에 빌드 게이트 완료와 Task 2.8 다음 진입점을 기록했고, 46라인 요약 한도를 지킨 상태로 문서 공백 검사가 종료 코드 0으로 끝났다.
- **Status**: done

#### Task 3.3 — 계획 최종 완료 처리

- **Dependency**: Task 3.2
- **Target**: `docs/plans/PLAN_mvp_sales_round_build_gate_remediation.md`
- **Goal**: 전체 변경의 공백 오류를 확인하고 이 계획의 완료 상태를 확정한다.
- **Verify**: `git diff --check`
- **Conclusion**: 통과 — build 검증이 만든 추적 생성물을 원래 상태로 복원한 뒤 전체 `git diff --check`가 종료 코드 0으로 끝났다.
- **Status**: done

---

## ✅ Completion Criteria

- 선택 회귀 검사기가 `api`, `consumer`, `seller`, `driver` 누락을 실패로 판정한다.
- 루트 `pnpm build`가 `No projects matched the filters` 없이 종료 코드 0으로 끝난다.
- 루트 빌드 출력에서 공용 패키지와 필수 런타임 앱 4개의 build 실행을 확인한다.
- consumer의 두 exhaustive map이 신규 알림 코드 6종을 모두 포함한다.
- `pnpm --filter consumer build`가 종료 코드 0으로 끝난다.
- `pnpm --filter api test -- --runInBand`가 종료 코드 0으로 끝난다.
- `git diff --check`가 종료 코드 0으로 끝난다.
- 원 기능 계획 Task 2.8은 미착수 상태를 유지하면서 다음 실행 진입점으로 지정된다.
- PortOne 샌드박스와 Firebase Emulator 검증은 기존 후속 게이트로 명시된다.

---

## 🧾 Closeout

- **Status**: 완료
- **Completed Tasks**: Task 0.1~3.3 전체
- **승인된 추가 보정**: 최초 루트 build가 발견한 seller `DELIVERY_HELD` exhaustive map 누락은 사용자 승인 후 `apps/seller/src/app/orders/_constants.ts` 한 파일에서 보정하고 seller build로 검증함
- **Next Entry**: 원 기능 계획 Task 2.8
- **Deferred External Gates**: PortOne 샌드박스는 원 계획 Task 2.10 전, Firebase Emulator는 원 계획 Task 6.4 전

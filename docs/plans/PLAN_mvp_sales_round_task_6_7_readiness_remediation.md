<!-- Language: ko -->

# Project Blueprint: 회차 직배송 Task 6.7 준비조건 보정과 실제 통과

> **Created**: 2026-07-20
> **Status**: done — Task 5.4 통과 커밋 생성
> **Priority**: P0
> **Labels**: `e2e`, `playwright`, `round-direct`, `preview`, `fixture`, `release-gate`
> **SSOT Check**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`, `docs/specs/mvp-sales-round-direct-delivery.md`, `docs/specs/ops/mvp-sales-round-runbook.md`, `docs/memory.md`
> **Architectural Goal**: 격리된 비운영 환경에서 동일 SHA의 소비자·셀러·드라이버 앱과 결정적 인증·데이터·외부 대역·Storage 경계를 마련해 Task 6.7 Playwright 52건을 실제 통과시키고 통과 커밋으로 Task 6.8 진입을 잠근다.

---

## 🤝 협업 요약

### 개요

원 계획 Task 6.7은 테스트 파일 3개에서 chromium·mobile 52건을 수집했지만 실제 흐름은 한 건도 실행하지 못했다. 세 앱 배포 SHA가 달랐고 드라이버 인증, 전용 fixture, 안전한 seed·cleanup, 외부 결제·환불·알림 대역, 별도 `round_direct` 스토어, 테스트 JPEG, 비운영 Storage 경계가 없었기 때문이다.

### 완료 모습

같은 커밋의 세 Preview 앱이 하나의 격리된 비운영 API·Firestore·Storage를 사용한다. 소비자·셀러·드라이버 인증이 실행 직전에 검증되고, chromium과 mobile은 서로 다른 fixture 네임스페이스를 사용한다. PortOne·환불·알림은 실제 외부 서비스로 나가지 않으며, 테스트 JPEG는 전용 Storage 접두사 안에서만 생성·조회·정리된다. 이 상태에서 52건이 건너뜀과 재시도 통과 없이 모두 성공하고 결과가 커밋된다.

### 이번 계획에서 하지 않는 것

- 원 계획 Task 6.8 Closeout 실행
- 운영 디어오키드 `salesMode` 전환
- 운영 Firestore·Storage에 fixture 생성
- 실제 PortOne 결제·환불 실행
- 실제 알림톡·문자 발송
- 일반 E2E 전체 개편
- 현재 작업 트리의 범위 밖 변경 정리·복원·커밋
- 운영 배포와 운영 데이터 마이그레이션

---

## 🎯 Origin Intent

- Task 6.8은 Task 6.7의 실제 통과 커밋이 생기기 전까지 시작하지 않는다.
- Task 6.7은 현재 `blocked`이며 52개 흐름은 목록만 수집됐으므로 통과로 간주하지 않는다.
- 준비조건을 별도 보정 계획에서 닫은 뒤 원 계획 Task 6.7을 다시 실행한다.
- 안전성은 운영 상태 비의존, 외부 호출 차단, 실행 실패 시 결정적 cleanup으로 증명한다.

---

## ⚠️ Edge Case Trace

| Edge Case | Failure Mode | Guard | Verification |
|---|---|---|---|
| 세 URL 별칭 중 하나가 이전 배포를 가리킴 | 서로 다른 코드로 52건을 실행해 결과가 무효가 됨 | 세 배포의 SHA와 별칭 연결을 실행 직전에 한 번 더 확인 | Task 1.1 |
| Preview 앱이 운영 API를 가리킴 | 테스트 주문·사진·환불 상태가 운영에 기록됨 | 허용된 비운영 API·Firebase 프로젝트·bucket의 정확한 식별자 검사 | Task 0.2, 3.2 |
| 드라이버 쿠키가 만료되거나 권한이 없음 | 드라이버 흐름이 로그인 화면에서 실패하거나 다른 역할로 실행됨 | 실행 시점에 전용 승인 드라이버 세션을 발급하고 `/api/auth/session`과 API 역할을 확인 | Task 1.2~1.4 |
| E2E 인증 경로가 운영에서 켜짐 | 테스트 전용 로그인으로 운영 접근 가능 | Preview·명시적 enable·공유 secret·허용 계정 네 조건을 모두 요구하고 하나라도 없으면 fail-closed | Task 1.2, 1.3 |
| chromium과 mobile이 같은 상태 변경 fixture를 공유함 | 앞 프로젝트가 예약·마감·완료한 상태로 뒤 프로젝트가 시작함 | 실행 ID와 프로젝트 이름을 포함한 fixture ID·계정·장바구니 분리 | Task 3.1~4.4 |
| seed가 일부만 성공함 | 손상된 데이터로 테스트가 시작되고 잔여물이 남음 | manifest 기반 idempotent seed와 완료 마커, 검증 실패 시 즉시 cleanup | Task 3.1, 3.2 |
| 테스트 중간 실패로 cleanup이 생략됨 | 다음 실행이 이전 데이터를 재사용함 | 워크플로 `always()`와 로컬 runner `finally`에서 같은 manifest cleanup 실행 | Task 3.2, 5.1 |
| cleanup 범위가 넓음 | 다른 테스트나 운영 데이터를 삭제함 | 실행 ID 접두사와 생성 manifest의 정확한 문서·객체만 삭제하고 컬렉션·bucket 전체 삭제 금지 | Task 3.1, 3.2 |
| PortOne·환불·알림 대역 설정이 빠짐 | 실제 외부 호출 또는 설정 누락 실패로 흐름이 중단됨 | 비운영 전용 provider mode와 외부 egress 거부를 준비 게이트에서 강제 | Task 2.1~2.6 |
| 대역이 성공 응답만 반환함 | 환불·알림 실패 분기의 연결이 검증되지 않음 | fixture별 성공·재시도·최종 실패 시나리오를 결정적으로 선택 | Task 2.2, 2.4 |
| 잘못된 파일이나 큰 파일이 업로드됨 | 사진 계약이 JPEG 보안 경계를 검증하지 못함 | 유효한 소형 JPEG의 MIME·magic bytes·크기 검사 | Task 3.3, 4.4 |
| 사진이 운영 bucket 또는 공용 경로에 저장됨 | 비공개 배송 사진이 운영·공개 영역과 섞임 | 비운영 bucket 정확 일치와 `e2e/round-direct/{runId}/` 접두사 제한 | Task 0.2, 3.2, 4.4 |
| `test.fixme`·`test.skip`이 남은 채 명령이 성공함 | 실제 실행 수가 52건보다 적음 | 준비 완료 전에는 해제 금지, 최종 게이트는 52 passed와 skip/fixme 0을 요구 | Task 4.2~5.3 |
| 재시도로만 통과함 | 불안정한 흐름이 정상으로 오인됨 | Task 6.7 게이트에서 retries 0과 flaky 0을 강제 | Task 4.1, 5.3 |
| 테스트 통과 뒤 문서만 수정되고 커밋이 없음 | Task 6.8 선행조건을 추적할 수 없음 | 52건 증거·환경 manifest·문서 갱신을 하나의 통과 커밋에 포함 | Task 5.4 |
| 기존 미커밋 변경이 함께 커밋됨 | 사용자 작업과 Task 6.7 증거가 섞임 | 시작 manifest와 task-owned 파일 목록을 비교해 범위 밖 변경을 stage하지 않음 | 모든 Task, Task 5.4 |

---

## 🔎 Diagnosis & Findings

1. 원 계획 Task 6.7은 `blocked`, Task 6.8은 Task 6.7 의존의 `todo`다.
2. `consumer-round-direct.spec.ts` 12건, `seller-sale-rounds.spec.ts` 6건, `driver-direct-delivery.spec.ts` 8건이 두 프로젝트에서 수집돼 총 52건이다.
3. 세 파일의 모든 대상 테스트가 `test.fixme`이므로 현재 실제 실행 수는 0건이다.
4. 셀러·소비자 인증은 `global-setup.ts`에서 Credentials 세션을 만들지만 드라이버는 Kakao 전용이라 정적 `DRIVER_SESSION_COOKIE`만 기대한다.
5. 현재 일반 E2E seed는 활성 상품의 실제 스토어를 동적으로 선택하고 `e2e-` 데이터를 cleanup 보존 대상으로 두므로 이번 상태 변경형 흐름에 사용할 수 없다.
6. PortOne과 Aligo 클라이언트는 실제 외부 주소를 직접 사용하므로 브라우저 route 대역만으로 서버 측 결제 조회·환불·알림 호출을 차단할 수 없다.
7. Storage는 `FIREBASE_STORAGE_BUCKET`을 지원하지만 실행 전 비운영 bucket과 객체 접두사를 강제하는 회차 E2E 게이트가 없다.
8. 셀러·드라이버 상태 변경 시나리오는 chromium과 mobile이 같은 고정 ID를 사용하면 프로젝트 간 상태 오염이 발생한다.
9. 기존 `wait-preview-deploy.mjs`는 세 Preview 앱이 같은 HEAD SHA로 성공했는지 확인할 기반을 이미 제공한다.

---

## 🧱 Architectural Contract

### 환경 경계

- `ROUND_DIRECT_E2E_ENABLED=true`만으로는 충분하지 않다.
- 배포 환경이 Preview이고, API·Firebase project·Storage bucket이 명시적 비운영 허용 목록과 정확히 일치하며, 실행 ID가 있어야 준비 게이트를 통과한다.
- 운영 프로젝트 ID, 운영 bucket, 운영 디어오키드 storeId 중 하나라도 감지되면 읽기 전용 준비 검사 단계에서 종료 코드 1로 중단한다.
- 세 프런트 앱은 동일 SHA 배포여야 하며 동일한 비운영 API를 가리켜야 한다.

### 인증 경계

- 셀러·소비자·드라이버 모두 실행 전용 계정을 사용한다.
- 드라이버는 Preview에서만 열리는 E2E Credentials 경로로 짧은 세션을 발급한다.
- E2E Credentials 경로는 명시적 enable, Preview 환경, 공유 secret, 허용 계정과 승인 역할을 모두 검사한다.
- 정적 장기 `DRIVER_SESSION_COOKIE`를 통과 증거로 사용하지 않는다.

### 데이터 경계

- seed 명령은 `seed`, `verify`, `cleanup` 세 동작을 제공한다.
- fixture ID는 `round-direct-e2e-{runId}-{project}-*` 형식을 사용한다.
- chromium·mobile별 전용 소비자·드라이버 사용자 상태, 장바구니, 회차, 상품, 주문, 사진 metadata를 만든다.
- 별도 테스트 스토어만 `salesMode: round_direct`로 만들며 운영 디어오키드 문서는 읽거나 쓰지 않는다.
- cleanup은 seed가 기록한 manifest의 정확한 문서와 Storage 객체만 삭제한다.

### 외부 provider 경계

- 브라우저 PortOne SDK와 서버 PortOne 조회·환불을 모두 결정적 대역으로 바꾼다.
- 알림톡·문자는 실제 네트워크를 사용하지 않고 시도 횟수·채널·결과만 비운영 기록으로 남긴다.
- 대역은 비운영 provider mode에서만 선택되며 운영 환경에서 설정되면 API 시작 자체가 실패한다.
- 외부 provider 호스트로 나가는 요청이 한 건이라도 관측되면 Task 6.7을 실패 처리한다.

### 통과 판정

- 최종 명령은 원 계획 Task 6.7의 세 spec과 두 Playwright 프로젝트를 실제 실행한다.
- 통과 기준은 `52 passed`, `0 failed`, `0 skipped`, `0 fixme`, `0 flaky`다.
- 목록 수집, 일부 프로젝트 통과, 재시도 통과, cleanup 실패는 통과가 아니다.
- 통과 결과와 fixture cleanup 결과가 포함된 커밋 SHA가 생기기 전 Task 6.8을 시작하지 않는다.

---

## Agent Completion Contract

1. 아래 Task를 Dependency 순서대로 한 번에 하나씩 실행한다.
2. 각 Task는 Target을 중심으로 수정하고 필요한 실패 테스트만 인접 파일로 최소 확장한다.
3. 준비 게이트가 하나라도 실패하면 `test.fixme`를 유지하고 실제 흐름을 실행하지 않는다.
4. seed·provider mode·Storage 설정은 운영 식별자를 fail-closed로 거부해야 한다.
5. 외부 provider 대역을 운영 코드의 기본값으로 만들지 않는다.
6. chromium·mobile fixture는 상태와 인증을 공유하지 않는다.
7. 각 Verify가 종료 코드 0일 때만 Conclusion과 Status를 갱신한다.
8. 테스트 실패 시 같은 Task 안에서 원인을 수정하고 전체 52건을 처음부터 다시 실행한다.
9. 현재 작업 트리의 기존 변경을 복원·정리·stage하지 않는다.
10. Task 5.4는 task-owned 파일과 검증 증거만 커밋한다.
11. 통과 커밋 생성 전에는 원 계획 Task 6.8과 `pnpm build` Closeout을 실행하지 않는다.
12. 단일 코드 파일은 500라인 미만, `docs/memory.md`는 200라인 미만을 유지한다.
13. 비밀키·세션·개인정보·사진 원본을 로그와 Playwright artifact에 남기지 않는다.
14. 모든 출력과 새 코드 주석은 한국어로 작성한다. 기술 식별자는 원문을 유지한다.

> **에이전트 스코프**: 이 계획은 Task 6.7의 동일 SHA Preview, 역할별 인증, 비운영 fixture·seed·cleanup, 외부 provider 대역, 테스트 스토어·JPEG·Storage 경계, Playwright 52건 실행, 통과 커밋만 허용한다. Task 6.8 Closeout과 운영 전환은 명시적으로 범위 밖이다.

---

## 📋 Execution Plan

### Phase 0 — 비운영 계약과 fail-closed 준비 게이트

#### Task 0.1 — 회차 E2E 환경 명세 고정

- **Dependency**: 없음
- **Target**: `docs/specs/ops/mvp-sales-round-e2e-environment.md`
- **Goal**: 허용 Preview·API·Firestore·Storage·provider mode·fixture namespace·비밀정보 배제 계약을 단일 운영 명세로 고정한다.
- **Verify**: `git diff --check -- docs/specs/ops/mvp-sales-round-e2e-environment.md`
- **Conclusion**: 통과 — Preview 명시 활성화, 비운영 API·Firebase·Storage 허용 목록, 운영 식별자 거부, 역할별 단기 인증, 프로젝트별 fixture, provider egress 차단, manifest 제한 cleanup 계약을 단일 명세로 고정했고 공백 검사가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 0.2 — 준비조건 검사기 실패 계약 작성

- **Dependency**: Task 0.1
- **Target**: `scripts/check-round-direct-e2e-readiness.spec.mjs`
- **Goal**: 운영 식별자·SHA 불일치·인증 누락·provider 실연결·Storage 경계 누락을 거부하는 실패 테스트를 먼저 고정한다.
- **Verify**: `node --check scripts/check-round-direct-e2e-readiness.spec.mjs`
- **Conclusion**: 통과 — 운영 Firebase·디어오키드 store, 세 앱 SHA 불일치, 역할 인증·드라이버 승인 누락, 실제 provider mode·egress, Storage·JPEG·cleanup·프로젝트 격리 누락을 거부하는 계약을 작성했고 문법 검사가 종료 코드 0으로 통과했다. 구현 전 실행은 대상 모듈 부재로 예상 실패했다.
- **Status**: done

실행 메모: 문법 검증 뒤 테스트를 실행해 구현 전 실패를 기록하고, Task 0.3에서 같은 테스트를 종료 코드 0으로 만든다.

#### Task 0.3 — 준비조건 검사기 구현

- **Dependency**: Task 0.2
- **Target**: `scripts/check-round-direct-e2e-readiness.mjs`
- **Goal**: 쓰기 없이 전체 준비조건과 비운영 경계를 검사해 JSON manifest와 종료 코드로 판정한다.
- **Verify**: `node --test scripts/check-round-direct-e2e-readiness.spec.mjs`
- **Conclusion**: 통과 — 환경 입력에서 비밀값을 제외한 증거만 정규화하고 운영 식별자·SHA·역할 인증·provider egress·Storage·JPEG·fixture·cleanup 경계를 실패 코드와 JSON으로 판정하는 읽기 전용 검사기를 구현했으며 Node 계약 9개가 종료 코드 0으로 통과했다.
- **Status**: done

### Phase 1 — 동일 SHA 배포와 역할별 인증

#### Task 1.1 — 세 Preview 앱 동일 SHA 게이트 강화

- **Dependency**: Task 0.3
- **Target**: `scripts/wait-preview-deploy.mjs`
- **Goal**: 소비자·셀러·드라이버 별칭이 하나의 지정 SHA를 가리킨다는 기계 판독 증거를 준비 manifest에 제공한다.
- **Verify**: `node --check scripts/wait-preview-deploy.mjs`
- **Conclusion**: 통과 — 지정 SHA의 세 GitHub Preview deployment와 최신 성공 상태를 앱별로 확인하고 `deploymentShas` JSON 증거를 제공하는 일회·폴링 모드를 추가했으며 문법 검사가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 1.2 — 드라이버 E2E 인증 보안 계약 작성

- **Dependency**: Task 1.1
- **Target**: `apps/driver/src/auth.e2e.test.mjs`
- **Goal**: Preview·enable·공유 secret·승인 계정 조건이 빠지면 드라이버 E2E Credentials 인증을 거부하는 실패 테스트를 먼저 고정한다.
- **Verify**: `node --check apps/driver/src/auth.e2e.test.mjs`
- **Conclusion**: 통과 — Credentials 등록, Preview·enable, 상수 시간 공유 secret, 허용 이메일, API의 driver 역할·승인 상태, fail-closed 반환을 요구하는 소스 계약을 작성했고 문법 검사가 종료 코드 0으로 통과했다. 구현 전 계약 6개는 모두 예상 실패했다.
- **Status**: done

실행 메모: 문법 검증 뒤 테스트를 실행해 구현 전 실패를 기록하고, Task 1.3에서 같은 테스트를 종료 코드 0으로 만든다.

#### Task 1.3 — 드라이버 Preview 전용 세션 발급 구현

- **Dependency**: Task 1.2
- **Target**: `apps/driver/src/auth.ts`
- **Goal**: 네 가지 보안 조건을 모두 만족하는 승인 드라이버에만 짧은 E2E Credentials 세션을 발급한다.
- **Verify**: `pnpm --filter driver build`
- **Conclusion**: 통과 — Preview·명시적 enable·상수 시간 공유 secret·허용 이메일·API driver 역할·승인 상태를 모두 만족한 Credentials 요청만 15분 세션으로 발급하도록 구현했고 보안 계약 6개와 driver production build가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 1.4 — Playwright 역할별 인증 상태 생성

- **Dependency**: Task 1.3
- **Target**: `apps/e2e/global-setup.ts`
- **Goal**: 소비자·셀러·드라이버 전용 세션을 실행 직전에 발급하고 역할·만료·대상 도메인을 검증한다.
- **Verify**: `pnpm --filter e2e exec tsc --noEmit`
- **Conclusion**: 통과 — 회차 E2E 활성화 시 chromium·mobile별 서로 다른 소비자·셀러·드라이버 자격을 필수로 요구하고 대상 도메인의 세션 역할·accessToken·만료·쿠키를 확인한 별도 storage state를 생성하도록 연결했다. 누락돼 있던 E2E tsconfig를 최소 인접 범위로 추가했으며 `tsc --noEmit`이 종료 코드 0으로 통과했다.
- **Status**: done

### Phase 2 — PortOne·환불·알림 서버 대역

#### Task 2.1 — 비운영 provider mode 실패 계약 작성

- **Dependency**: Task 1.4
- **Target**: `apps/api/src/common/e2e-provider-mode.spec.ts`
- **Goal**: 운영 환경의 대역 활성화와 비운영 환경의 실제 provider 연결을 모두 거부하는 실패 테스트를 먼저 고정한다.
- **Verify**: `pnpm --filter api test -- --listTests`
- **Conclusion**: 통과 — 운영 런타임·운영 Firebase의 대역 활성화, 비운영 회차 E2E의 live provider, Preview·공유 secret·허용 프로젝트·실행 ID 누락, 비활성 stub 우회를 거부하는 계약을 작성했고 Jest 수집이 종료 코드 0으로 통과했다. 구현 전 대상 모듈 부재 실패도 확인했다.
- **Status**: done

실행 메모: Jest 수집 뒤 대상 테스트를 실행해 구현 전 실패를 기록하고, Task 2.2에서 같은 테스트를 종료 코드 0으로 만든다.

#### Task 2.2 — 비운영 provider mode 가드 구현

- **Dependency**: Task 2.1
- **Target**: `apps/api/src/common/e2e-provider-mode.ts`
- **Goal**: Preview·enable·공유 secret·허용 프로젝트 조건을 모두 만족할 때만 provider 대역 선택을 허용한다.
- **Verify**: `pnpm --filter api test -- e2e-provider-mode.spec.ts --runInBand`
- **Conclusion**: 통과 — 일반 실행은 기존 live provider를 유지하고, 회차 E2E 활성화 시 비운영 런타임·Preview 표식·stub mode·공유 secret·허용 Firebase project·실행 ID를 모두 fail-closed로 검증하도록 구현했다. 대상 Jest 11개가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 2.3 — PortOne 조회·결제·환불 대역 구현

- **Dependency**: Task 2.2
- **Target**: `apps/api/src/payments/e2e-portone.client.ts`
- **Goal**: 실행 ID별 결제 성공·재조회·환불 성공·환불 실패를 외부 네트워크 없이 결정적으로 재현한다.
- **Verify**: `pnpm --filter api test -- e2e-provider-mode.spec.ts --runInBand`
- **Conclusion**: 통과 — 실행 namespace와 명시 fixture만 허용하고 결제 재조회 상태, 성공 환불 뒤 CANCELLED 고정, 환불 실패, 호출 순서를 외부 네트워크 없이 결정적으로 재현하는 PortOne 대역을 구현했다. provider mode와 PortOne 계약 14개가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 2.4 — 결제 모듈의 fail-closed provider 선택

- **Dependency**: Task 2.3
- **Target**: `apps/api/src/payments/payments.module.ts`
- **Goal**: 검증된 비운영 mode에서만 PortOne 대역을 주입하고 그 밖에는 기존 실제 client를 유지한다.
- **Verify**: `pnpm --filter api test -- payments.module.spec.ts --runInBand`
- **Conclusion**: 통과 — `PortoneClient` 주입 token을 단일 factory로 유지하고 일반 실행에는 기존 live client, 검증된 비운영 stub mode에만 E2E 대역을 선택하며 운영 우회는 생성 전에 거부하도록 연결했다. 모듈 계약 4개가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 2.5 — 알림톡·문자 대역 구현

- **Dependency**: Task 2.4
- **Target**: `apps/api/src/notifications/e2e-aligo.client.ts`
- **Goal**: 알림톡 성공·3회 실패 뒤 문자 성공·최종 실패를 외부 네트워크 없이 결정적으로 기록한다.
- **Verify**: `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand`
- **Conclusion**: 통과 — 알림톡 즉시 성공, 3회 실패 뒤 문자 성공, 알림톡·문자 최종 실패와 비민감 호출 증거를 외부 네트워크 없이 결정적으로 반환하는 대역을 구현했다. 신규 대역 3개와 기존 사용자 변경을 보존한 알림 회귀 11개가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 2.6 — 알림 모듈의 fail-closed provider 선택

- **Dependency**: Task 2.5
- **Target**: `apps/api/src/notifications/notifications.module.ts`
- **Goal**: 검증된 비운영 mode에서만 알림 대역을 주입하고 실제 알림 egress를 차단한다.
- **Verify**: `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand`
- **Conclusion**: 통과 — `AligoClient` 주입 token을 단일 factory로 유지하고 일반 실행에는 기존 live client, 검증된 비운영 stub mode에만 E2E 대역을 선택하며 운영 우회는 생성 전에 거부하도록 연결했다. 모듈 계약 4개와 기존 알림 회귀 11개가 종료 코드 0으로 통과했다.
- **Status**: done

### Phase 3 — 격리 fixture·테스트 스토어·JPEG·Storage

#### Task 3.1 — seed·verify·cleanup 안전 계약 작성

- **Dependency**: Task 2.6
- **Target**: `scripts/round-direct-e2e-fixtures.spec.mjs`
- **Goal**: 프로젝트별 fixture 분리·운영 거부·manifest 제한 cleanup·부분 seed 복구의 실패 테스트를 먼저 고정한다.
- **Verify**: `node --check scripts/round-direct-e2e-fixtures.spec.mjs`
- **Conclusion**: 통과 — 비운영 project·bucket만 허용하고 chromium·mobile의 문서·객체·계정을 분리하며 별도 round_direct store와 필수 fixture 컬렉션, 반복 seed, 부분 실패 복구, manifest 제한 cleanup을 요구하는 계약을 작성했다. 문법 검사가 종료 코드 0으로 통과했다.
- **Status**: done

실행 메모: 문법 검증 뒤 테스트를 실행해 구현 전 실패를 기록하고, Task 3.2에서 같은 테스트를 종료 코드 0으로 만든다.

#### Task 3.2 — 회차 E2E fixture 관리자 구현

- **Dependency**: Task 3.1
- **Target**: `scripts/round-direct-e2e-fixtures.mjs`
- **Goal**: 별도 `round_direct` 스토어와 chromium·mobile별 회차·상품·계정·장바구니·주문·사진 metadata를 seed·verify·cleanup한다.
- **Verify**: `node --test scripts/round-direct-e2e-fixtures.spec.mjs`
- **Conclusion**: 통과 — 실행·project별 manifest를 만들고 다른 소유 문서 덮어쓰기를 거부하며 seed·verify·cleanup과 부분 실패 자동 복구를 제공하는 450줄 fixture 관리자를 구현했다. 운영 서비스 계정 fallback 없이 명시된 비운영 자격만 허용하며 계약 7개가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 3.3 — 유효한 테스트 JPEG 추가

- **Dependency**: Task 3.2
- **Target**: `apps/e2e/fixtures/round-direct-delivery.jpg`
- **Goal**: 개인정보·위치정보가 없고 JPEG MIME·magic bytes·크기 제한을 만족하는 소형 업로드 fixture를 고정한다.
- **Verify**: `node scripts/check-round-direct-e2e-readiness.mjs --check-jpeg`
- **Conclusion**: 통과 — `imagegen`으로 사람·위치·개인정보·문자·로고가 없는 합성 테스트 카드를 생성하고 256px JPEG로 변환해 metadata 없이 저장했다. 2,006 bytes, `image/jpeg`, 시작 `FF D8 FF`, 종료 `FF D9`가 준비검사 종료 코드 0으로 확인됐다.
- **Status**: done

### Phase 4 — 52개 실제 흐름 전환

#### Task 4.1 — 프로젝트별 fixture와 브라우저 대역 도우미 추가

- **Dependency**: Task 3.3
- **Target**: `apps/e2e/tests/_helpers/round-direct.ts`
- **Goal**: 실행 ID·Playwright 프로젝트별 fixture ID와 브라우저 PortOne 대역을 한 경계에서 제공한다.
- **Verify**: `pnpm --filter e2e exec tsc --noEmit`
- **Conclusion**: 통과 — 실행 ID와 Playwright project로 store·상품·회차·주문·장바구니·storage state를 분리하고 브라우저 PortOne 성공 대역을 선주입하며 PortOne·Aligo host egress를 차단·검출하는 도우미를 추가했다. E2E 전체 `tsc --noEmit`이 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 4.2 — 소비자 24건 실제 실행 전환

- **Dependency**: Task 4.1
- **Target**: `apps/e2e/tests/consumer-round-direct.spec.ts`
- **Goal**: 소비자 12개 계약의 `test.fixme`를 제거하고 두 프로젝트의 격리 fixture로 실제 화면·결제·환불 흐름을 검증한다.
- **Verify**: `pnpm --filter e2e exec playwright test consumer-round-direct --list`
- **Conclusion**: [PASS] 소비자 12개 계약의 `test.fixme`를 제거하고 chromium·mobile별 격리 fixture·인증 상태·장바구니·PortOne stub·egress 검출을 연결했다. Verify `pnpm --filter e2e exec playwright test consumer-round-direct --list` exit 0, chromium 12건·mobile 12건으로 총 24건을 수집했으며 실제 Playwright 흐름은 실행하지 않았다.
- **Status**: done

#### Task 4.3 — 셀러 12건 실제 실행 전환

- **Dependency**: Task 4.2
- **Target**: `apps/e2e/tests/seller-sale-rounds.spec.ts`
- **Goal**: 셀러 6개 계약의 `test.fixme`를 제거하고 프로젝트별 회차로 복사·예약·마감·완료·확인 필요 흐름을 검증한다.
- **Verify**: `pnpm --filter e2e exec playwright test seller-sale-rounds --list`
- **Conclusion**: [PASS] 셀러 6개 계약의 `test.fixme`를 제거하고 chromium·mobile별 격리 fixture·인증 상태·회차 ID·PortOne stub·egress 검출을 연결했다. Verify `pnpm --filter e2e exec playwright test seller-sale-rounds --list` exit 0, chromium 6건·mobile 6건으로 총 12건을 수집했으며 실제 Playwright 흐름은 실행하지 않았다.
- **Status**: done

#### Task 4.4 — 드라이버 16건 실제 실행 전환

- **Dependency**: Task 4.3
- **Target**: `apps/e2e/tests/driver-direct-delivery.spec.ts`
- **Goal**: 드라이버 8개 계약의 `test.fixme`를 제거하고 승인 세션·프로젝트별 주문·테스트 JPEG로 보드·보류·재개·사진 완료 흐름을 검증한다.
- **Verify**: `pnpm --filter e2e exec playwright test driver-direct-delivery --list`
- **Conclusion**: [PASS] 드라이버 8개 계약의 `test.fixme`를 제거하고 chromium·mobile별 격리 fixture·승인 드라이버 인증 상태·프로젝트별 주문 ID·기존 테스트 JPEG·비운영 Storage 경계를 연결했다. Verify `pnpm --filter e2e exec playwright test driver-direct-delivery --list` exit 0, chromium 8건·mobile 8건으로 총 16건을 수집했으며 실제 Playwright 흐름은 실행하지 않았다.
- **Status**: done

### Phase 5 — 비운영 실행, Task 6.7 재판정, 통과 커밋

#### Task 5.1 — 전용 비운영 E2E 워크플로 구성

- **Dependency**: Task 4.4
- **Target**: `.github/workflows/e2e-round-direct.yml`
- **Goal**: 지정 SHA 확인부터 readiness·seed·52건·artifact·항상 cleanup까지 수동 승인형 비운영 워크플로로 직렬화한다.
- **Verify**: `git diff --check -- .github/workflows/e2e-round-direct.yml`
- **Conclusion**: [PASS] 전용 GitHub Environment 승인, 지정 SHA·readiness·프로젝트별 seed·verify·52건 무건너뜀 판정·비민감 artifact·프로젝트별 `always()` cleanup을 직렬화했다. Verify `git diff --check -- .github/workflows/e2e-round-direct.yml` exit 0이며 실제 fixture 명령과 Playwright 흐름은 실행하지 않았다.
- **Status**: done

#### Task 5.2 — 준비조건 전체 통과

- **Dependency**: Task 5.1
- **Target**: `docs/plans/PLAN_mvp_sales_round_task_6_7_readiness_remediation.md`
- **Goal**: 동일 SHA·세 역할 인증·비운영 데이터·provider 대역·Storage·JPEG·cleanup 준비조건의 실측 통과를 기록한다.
- **Verify**: `node scripts/check-round-direct-e2e-readiness.mjs`
- **Conclusion**: [PASS] readiness가 Preview 환경의 소비자·셀러·드라이버 배포 SHA `745dee55ca7aee3df362ea7996a2a8583d0f80b4` 일치와 세 역할 인증 검증(드라이버 승인 포함), 비운영 API `https://api-staging-94af.up.railway.app`·Firebase `greenhub-round-direct-e2e`·Storage `greenhub-round-direct-e2e.firebasestorage.app`, provider 외부 egress 0, 유효한 2,006 bytes JPEG, chromium·mobile fixture namespace, manifest 제한 cleanup 구성을 비민감 판정 결과로 확인했다. Verify `node scripts/check-round-direct-e2e-readiness.mjs`는 `ready: true`, `failureCodes: []`, exit 0으로 통과했으며 비밀값은 출력·기록하지 않았다.
- **Status**: done

#### Task 5.3 — 원 계획 Task 6.7 Playwright 52건 실제 통과

- **Dependency**: Task 5.2
- **Target**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- **Goal**: 준비된 비운영 환경에서 소비자·셀러·드라이버 chromium·mobile 52건을 건너뜀·fixme·재시도 없이 통과시키고 Task 6.7을 done으로 닫는다.
- **Verify**: `pnpm --filter e2e exec playwright test consumer-round-direct seller-sale-rounds driver-direct-delivery --reporter=list`
- **Conclusion**: [PASS] 새 실행 ID `task-6-7-20260722-q4f9d6`에서 readiness `ready: true`, `failureCodes: []`, provider 외부 egress 0, chromium·mobile seed·verify exit 0을 확인했다. `workers=1`, `retries=0`으로 소비자·셀러·드라이버 chromium·mobile 52건을 실행해 `52 passed`, `0 failed`, `0 skipped/fixme`, `0 flaky`로 통과했다. 성공 뒤 양쪽 manifest에 제한한 cleanup과 cleanup 후 부재 검증도 모두 exit 0이었고 잔여 Firestore 문서·Storage 객체는 각각 0이었다.
- **Status**: done

#### Task 5.4 — 통과 커밋과 Task 6.8 잠금 증거 생성

- **Dependency**: Task 5.3
- **Target**: `docs/memory.md`
- **Goal**: Task 6.7 통과 결과·cleanup 결과·task-owned 변경을 커밋하고 그 SHA를 Task 6.8의 유일한 진입점으로 기록한다.
- **Verify**: `git show -1 --format=%H`
- **Conclusion**: [PASS] Task 5.3 소유 변경과 성공 실행 `task-6-7-20260722-q4f9d6`의 비민감 JSON 증거만 선별해 통과 커밋을 생성했다. 계정 이메일·전화번호가 포함된 manifest, 인증 상태 파일, 로그, 사진 원본과 기존 사용자 변경은 제외했다. Task 6.8은 이 커밋의 SHA를 유일한 진입점으로 별도 요청에서만 시작한다.
- **Status**: done

---

## ✅ Completion Criteria

- 세 Preview 앱이 하나의 지정 SHA를 가리킨다는 실측 증거가 있다.
- 세 앱이 허용된 단일 비운영 API·Firestore·Storage 경계를 사용한다.
- 소비자·셀러·승인 드라이버 세션이 실행 직전에 발급되고 역할이 검증된다.
- 별도 `round_direct` 테스트 스토어가 운영 디어오키드와 독립적으로 존재한다.
- chromium·mobile의 계정·장바구니·회차·주문 fixture가 서로 분리된다.
- seed가 반복 가능하고 부분 실패·테스트 실패 뒤에도 manifest 제한 cleanup이 성공한다.
- PortOne 결제 조회·환불과 알림톡·문자가 실제 외부 서비스로 나가지 않는다.
- 유효한 테스트 JPEG가 비운영 bucket의 실행 ID 접두사 안에서만 저장·조회·삭제된다.
- 세 spec에 `test.fixme`가 남아 있지 않다.
- 최종 실행이 `52 passed`, `0 failed`, `0 skipped`, `0 fixme`, `0 flaky`로 끝난다.
- Task 6.7이 `done`으로 닫히고 통과 증거를 포함한 커밋 SHA가 생성된다.
- 현재 작업 트리의 범위 밖 변경은 통과 커밋에 포함되지 않는다.
- Task 6.8은 이 계획에서 실행되지 않으며 통과 커밋 이후 별도 요청으로만 시작한다.

---

## 🧾 Handoff Gate

- **현재 진입점**: 통과 커밋 SHA를 인계한 뒤 별도 요청에서만 Task 6.8 시작
- **현재 원 계획 상태**: Task 6.7 `done`, Task 6.8 `todo`
- **Task 6.7 완료 근거**: 실행 `task-6-7-20260722-q4f9d6`의 52건 실제 통과와 manifest 제한 cleanup·부재 검증
- **Task 6.8 재진입 조건**: 이 문서를 포함하는 Task 5.4 통과 커밋의 SHA
- **금지**: 운영 상태 변경, 운영 Firestore·Storage 쓰기, 운영 `salesMode` 전환, push, 이번 계획에서 Task 6.8 실행

### 2026-07-20 실행 차단 실측

- Task 0.1~4.1은 각 Verify 종료 코드 0으로 완료했다.
- 현재 HEAD `f4d3cbc91d8ddad21af74530ba17ebb022e0020e`에 해당하는 셀러·소비자·드라이버
  GitHub Preview deployment가 모두 없었다.
- Railway staging API의 최신 성공 배포는 현재 HEAD와 다른 이전 배포이며 이번 provider
  대역과 fixture 경계를 포함하지 않는다.
- chromium·mobile별 소비자·셀러·드라이버 6개 계정 자격과 승인 드라이버가 없다.
- 회차 E2E enable·Preview·run ID·expected SHA·stub provider·공유 secret·비운영 API
  허용 목록이 없다.
- 허용된 비운영 Firebase project·전용 Storage bucket·서비스 계정이 없다. 로컬 서비스
  계정은 운영 `green-e4fe3`이므로 사용하지 않았다.
- 인증·배포 증거 JSON, 전용 테스트 store ID, manifest cleanup 설정이 없다.
- 테스트 JPEG와 chromium·mobile fixture 설계는 준비됐지만 seed를 실행하지 않아 manifest와
  cleanup 대상은 없었다.
- 준비검사는 종료 코드 1과 18개 실패 코드를 반환했다. 따라서 Task 4.2~5.4,
  `test.fixme` 해제, 실제 Playwright 흐름, stage·commit을 실행하지 않았다.

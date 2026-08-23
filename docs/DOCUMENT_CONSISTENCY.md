<!-- Language: ko -->

# Greenhub 문서 정합성 감사 기준

> 상태: Current
> 기준 확정: 2026-08-24 KST
> 목적: 문서끼리 같은 말을 하게 만드는 것이 아니라 **현재 사실·의도된 계약·검증된 보장**이 서로 일치하도록 유지한다.

## 1. 계약 계층형 판정

정보 유형별 정본을 구분한다.

| 정보 | 우선 기준 |
|---|---|
| 실제 동작 | 현재 `main` 코드·설정 |
| 검증된 동작 | 직접 관련 테스트 |
| 의도된 공개 계약 | current spec |
| 현재 프로젝트 상태 | 직접 재검증 → `docs/memory.md` |
| 현재 미완료 작업 | `docs/BACKLOG.md` |
| 실행 순서·dependency | `docs/memory.md`가 활성화한 PLAN |
| 재개 지점 | 활성 HANDOFF |
| 과거 증거·결과 | REPORT, archive, Git history, 과거 SHA/run |

코드가 현재 동작의 정본이라는 이유만으로 문서를 무조건 코드에 맞추지 않는다. 코드가 current spec 또는 안전 계약을 위반하면 문서 drift가 아니라 implementation finding으로 분류한다.

## 2. 불일치 위험도

### L1 — 문서 오류

예: 완료된 작업이 todo, 오래된 branch/SHA, 존재하지 않는 endpoint, historical 문서가 current처럼 보임.

- 문서를 직접 정합화한다.
- 출시·운영 판단에 영향이 없으면 `memory`/Backlog/PLAN으로 확대하지 않는다.

### L2 — 계약 불명확·검증 부족

예: 구현과 spec은 대체로 일치하지만 보장 범위가 모호하거나 직접 테스트가 없음.

- 현재 실제 상태를 과대보장 없이 문서화한다.
- 필요한 경우 `IMPLEMENTED / UNVERIFIED`, `COVERAGE GAP`, `DECISION REQUIRED`로 남긴다.

### L3 — 실제 위험

예: 결제, 환불, 권한, 개인정보, 배포, 운영 데이터, 금전적 상태 전이의 계약 위반 가능성.

- 문서를 코드에 맞춰 조용히 닫지 않는다.
- P0/P1 implementation finding 또는 출시 blocker로 승격한다.
- remediation은 별도 코드 Task로 분리한다.

**정합화가 버그를 숨기면 안 된다.**

## 3. 사실 소유권과 제한적 요약

같은 현재 상태를 여러 문서에 상세 복제하지 않는다.

- `docs/memory.md`: 현재 상태와 현재 차단점
- `docs/BACKLOG.md`: 해결해야 할 미완료 작업과 완료 조건
- 활성 PLAN: 실행 순서와 dependency
- 활성 HANDOFF: 재개 지점과 지금 하지 말아야 할 것
- current spec: 기술·도메인 계약
- REPORT/archive/Git history: 상세 증거와 과거 실행 기록

다른 문서에는 해당 사실이 그 문서의 역할에 미치는 영향만 최소 요약한다.

## 4. Historical 보존과 오해 방지

과거 PLAN·REPORT·검증 기록은 가능한 한 보존한다.

- 현재 지시처럼 보이면 `Historical` 또는 역사 자료임을 명시한다.
- 과거 `TODO`, `next`, `blocked`, 배포·seed·운영 변경 지시를 현재 명령으로 자동 승계하지 않는다.
- 과거 위험한 실행 절차나 자격정보가 현재 보안 원칙과 충돌하면 경고·비식별화·제거가 필요한지 검토한다.
- 현재 계약이 필요하면 과거 계획을 억지로 current화하지 말고 current spec/router를 둔다.

역사를 지우지 않되, 역사가 현재 명령처럼 보이지 않게 한다.

## 5. 증거 기반 확장 감사

문서 전체와 저장소 전체를 무조건 읽지 않는다.

1. 문서에서 검증 가능한 주장을 찾는다.
2. 해당 주장을 소유한 코드·설정·shared type을 확인한다.
3. 직접 관련 테스트를 확인한다.
4. 충돌이 있을 때만 caller/callee, 인접 도메인, E2E, 외부 상태로 확장한다.
5. 충분한 근거가 확보되면 탐색을 중단한다.

## 6. 중요도별 증거 강도

| 등급 | 최소 증거 |
|---|---|
| P0/L3 | 코드 + 직접 회귀 테스트 + 필요 시 설정/외부 상태 |
| P1/L2 중요 동작 | 코드 + 관련 테스트 또는 명확한 구현 근거 |
| P2/L1 구조 | 실제 파일·구조·설정 확인 |
| 외부 상태 | provider/GitHub/Vercel 등 직접 재조회 |
| 역사 기록 | 당시 SHA/run/REPORT 등 당시 증거 |

증거가 없으면 완료로 추론하지 않는다.

## 7. Spec · Code · Test 삼각 검증

- **Spec**: 의도된 계약
- **Code**: 실제 구현
- **Test**: 검증된 보장

판정 기준:

| 상태 | 판정 |
|---|---|
| Spec + Code + 필요한 Test 일치 | `VERIFIED` |
| Code + Spec 일치, 필요한 Test 없음 | `IMPLEMENTED / UNVERIFIED` 또는 `COVERAGE GAP` |
| Code + Test 일치, Spec 불일치 | `DOCUMENTATION DRIFT` |
| Spec + Test와 Code가 불일치 | `IMPLEMENTATION FINDING` / regression |
| Code만 있고 의도 불명확 | `DECISION REQUIRED` |
| 현재 계약이 아닌 과거 기록 | `HISTORICAL` |

**구현되어 있다**와 **보장된다**를 구분한다.

## 8. 위험도별 테스트 필수

결제·환불·권한·개인정보·배포 안전·운영 데이터·금전적 상태 전이는 코드 존재만으로 `VERIFIED` 처리하지 않는다. 직접적인 성공·거부·실패·중복/race 등 해당 위험에 대응하는 회귀 테스트가 필요하다.

중요하지만 비-P0인 API/FSM/workflow도 테스트가 없으면 `IMPLEMENTED / UNVERIFIED`로 표시할 수 있다.

## 9. Finding 영향 기반 전파

같은 내용을 여러 문서에 복사하지 않는다.

예: P0 결제 finding 발견 시

- payments spec: 정확한 기술 계약·현재 한계
- `memory`: 현재 P0가 존재한다는 최소 상태
- Backlog: remediation 범위·Acceptance Criteria
- 활성 PLAN: release dependency
- HANDOFF: 재개 순서에 실제 영향이 있을 때만 최소 반영

P2 문서 라우팅 오류라면 router/current 문서만 고치고 프로젝트 상태 문서까지 확대하지 않는다.

## 10. 감사와 remediation 분리

문서 정합성 감사는 다음까지 수행한다.

1. 불일치 발견
2. 위험도 판정
3. 정확한 현재 계약·한계 기록
4. 필요한 SSOT/Backlog/PLAN 영향 반영
5. 코드 수정 Task의 범위·Acceptance Criteria 정의

실제 코드 수정·기능 변경은 별도 Task에서 수행하고, 검증이 끝난 뒤 문서를 `VERIFIED`로 승격한다.

## 11. 변동 정보는 Snapshot + 재검증

다음은 영구 현재값으로 취급하지 않는다.

- `main` HEAD
- GitHub branch protection/ruleset
- Vercel/Railway deployment 상태
- ALIGO/provider 심사·승인 상태
- production 환경 설정
- 최근 E2E 성공 run

필요하면 `마지막 검증 시각 + 당시 상태 + 대상 SHA/run` 형태로 기록한다. 새 작업 시작 시 현재성이 필요한 값은 직접 재조회한다.

Snapshot은 증거이지 영구적인 현재값이 아니다.

## 12. Current 최소 계약 / Evidence 분리

Current 문서에는 현재 행동 판단에 필요한 내용만 유지한다.

- 지금 무엇이 사실인지
- 현재 계약과 예외
- 현재 차단점
- 다음 행동/의존성

긴 조사 과정, 과거 실패 로그, 세션별 상세 증거는 REPORT/archive/Git history에 둔다.

## 13. 기존 문서 수정 vs 새 Current 생성

파일이 오래됐는지가 아니라 **문서 역할이 같은지**로 판단한다.

기존 문서를 수정하는 경우:

- 같은 도메인의 같은 current 계약
- 과거 내용을 걷어내도 역할이 유지됨

새 current spec/router를 두는 경우:

- 원래 목적이 과거 실행 PLAN/검증 기록
- current 계약과 history가 심하게 혼재
- 기존 문서를 고치면 역사적 의사결정 기록이 훼손됨
- 여러 문서가 동시에 SSOT를 주장함

## 감사 결과 표준 분류

문서 감사 결과는 가능하면 아래 용어를 사용한다.

- `VERIFIED`
- `IMPLEMENTED / UNVERIFIED`
- `DOCUMENTATION DRIFT`
- `COVERAGE GAP`
- `IMPLEMENTATION FINDING`
- `DECISION REQUIRED`
- `HISTORICAL`

## 완료 판정

문서 정합성 작업의 완료는 “문서 간 문구가 같음”이 아니다.

- 현재 사실의 소유 위치가 명확하고,
- current spec이 실제 구현을 과대보장하지 않으며,
- P0/P1 계약은 필요한 증거와 검증 상태가 구분되고,
- 구현 결함이 문서 수정으로 숨겨지지 않으며,
- historical 자료가 현재 지시와 분리되어 있고,
- 시간에 따라 변하는 상태가 snapshot으로 취급될 때

해당 범위의 정합성이 확보된 것으로 판단한다.

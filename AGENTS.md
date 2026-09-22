# Greenhub 작업 규칙

## 0. Git-native 실행 Kernel

Greenhub 개발의 기본 실행 모델은 별도 coordination control plane이 아니라 **현재 repository authority + bounded semantic task + Git-native publication**이다.

Canonical invariants:

1. **Current truth first**  
   현재 repository/runtime의 직접 증거를 우선한다. 과거 branch, worktree, exact SHA, launcher, task state, report는 필요성을 다시 입증하지 않는 한 다음 실행의 권위가 아니다.

2. **Bounded semantic ownership**  
   하나의 mutating task는 하나의 independently closable semantic outcome을 소유한다. 파일 겹침보다 semantic owner, shared contract, proof dependency를 우선한다. 실행 중 다른 semantic boundary가 필요해져도 조용히 소유 범위를 넓히지 않는다.

3. **Freshness dimensions stay separate**  
   semantic freshness, proof freshness, publication freshness를 구분한다. Git revision movement만으로 완료된 구현이나 유효한 proof를 무효화하지 않는다. 영향을 받은 dimension만 다시 판정한다.

4. **Nearest faithful proof**  
   Acceptance Criterion을 실제로 falsify/confirm할 수 있는 가장 가까운 충실한 proof부터 실행한다. full-suite-first를 기본값으로 사용하지 않고, cross-cutting risk·repository gate·release requirement·더 높은 runtime fidelity가 필요할 때만 확대한다.

5. **Outcome-relative completion**  
   완료는 현재 bounded outcome 기준이다. local-only task라면 publication을 요구하지 않는다. publication이 outcome에 포함되면 fresh remote 확인, safe publication, remote read-back까지 closure에 포함한다.

6. **Scoped uncertainty and closure**  
   UNKNOWN이나 blocker는 정확히 영향을 받는 transition에만 적용한다. 독립적으로 완료된 work/proof는 보존한다. 종료 전에는 현재 task가 직접 만들거나 supersede한 transient residue만 reconcile하고, foreign/shared/uncertain ownership state는 임의 cleanup하지 않는다.

7. **Existing primitives before new systems**  
   Git, repository, test runner, CI/provider, OS/runtime primitive로 충분히 해결 가능한 문제를 위해 새 registry, queue, scheduler, daemon, lease/heartbeat, task database, proof graph, second SSOT를 만들지 않는다. 새 durable automation은 반복되는 material failure와 기존 primitive의 불충분함이 직접 증명될 때만 검토한다.

Default flow:

```text
current authority
→ bounded semantic outcome
→ smallest root-cause-complete change
→ nearest faithful proof
→ affected freshness only
→ publication when required
→ remote read-back
→ task-owned residue reconciliation
→ stop
```

Transient coordination view는 병렬 작업을 이해하는 임시 도구로 사용할 수 있지만 repository authority나 durable lifecycle state로 승격하지 않는다.

## 1. 우선순위와 범위

- 상위 지침, 사용자 요청, 현재 Task의 범위와 제외 범위를 우선한다.
- 요청받지 않은 리팩터링, 정리, 문서 갱신을 함께 수행하지 않는다.
- 하위 `AGENTS.md`는 해당 디렉터리에서 이 규칙을 보충한다.
- 관찰이나 `friction_observed`는 자동으로 새 작업을 만들지 않는다. 현재 evidence가 실제 변경 필요성을 보여줄 때만 별도 bounded task로 다룬다.

## 2. Repository authority와 workspace

작업 전에 필요한 범위에서 다음을 확인한다.

- 현재 branch/ref와 `HEAD`
- current remote `main`/target ref
- 작업 트리의 modified/untracked 상태
- 현재 task의 semantic owner와 mutation boundary
- 기존 proof가 의존하는 surface가 바뀌었는지 여부

과거 prompt/report에 기록된 branch, worktree, SHA, command sequence를 기계적으로 재사용하지 않는다.

### Workspace / isolation

- branch, worktree, detached workspace는 **opt-in execution mechanics**다.
- current checkout에 foreign dirty state가 있거나, 다른 live mutator와 physical isolation이 실제로 필요하거나, recovery identity가 필요한 경우에만 사용한다.
- 동일한 mutable semantic/runtime surface에는 동시에 하나의 active mutator만 둔다.
- read-only 조사와 서로 독립적인 mutation은 실제 mutable surface가 분리되어 있을 때 병렬 수행할 수 있다.
- 사용자나 다른 작업의 dirty/untracked/ignored/recovery state를 reset, restore, stash, clean, stage, commit, delete하지 않는다.
- task-local topology를 다음 task의 authority로 자동 승계하지 않는다.

필요할 때 task context에만 다음 transient evidence를 둘 수 있다.

```text
DIRECT_PATHS
SEMANTIC_OWNERS
PROOF_OWNERS
```

이 정보를 위한 global ownership registry는 만들지 않는다.

## 3. 최소 Context 로딩

다음 순서로 필요한 범위만 읽는다.

1. 적용되는 `AGENTS.md`
2. `docs/memory.md`
3. `docs/PROJECT_MAP.md`의 관련 부분
4. 현재 Task
5. 대상 코드와 직접 연결된 테스트

문서 정합성 감사 Task라면 `docs/DOCUMENT_CONSISTENCY.md`를 추가로 적용한다.

`docs/` 전체를 재귀적으로 읽지 않는다. archive, 완료 계획, 보고서, 프롬프트 등 역사 문서는 기본 Context로 로드하지 않는다.

추가 Context는 증거에 따라 단계적으로 확장한다.

1. 대상 심볼과 파일
2. 직접 import, caller, callee
3. 공통 타입과 해당 API·도메인 명세
4. 실제 의존 증거가 있는 인접 도메인

세션이 사라져도 repository truth와 durable decision을 복원할 수 있어야 한다. cross-session continuity가 정말 필요하고 기존 project authority에서 재구성할 수 없는 정보만 현재 canonical owner에 남긴다.

## 4. 설계와 변경 원칙

- 동작이나 공개 계약을 바꾸기 전에 관련 `docs/specs/`와 현재 계약을 확인한다.
- 신규 기능이나 계약 변경은 권한이 있는 Task에서 명세와 구현을 함께 정합화한다.
- 비즈니스 규칙과 인프라·외부 공급자 코드를 분리한다.
- current task의 root cause를 닫는 smallest coherent change를 만든다. 최소 LOC나 최소 파일 수가 목표가 아니다.
- 다른 semantic owner가 필요한 boundary drift를 발견하면 현재 boundary 안에서 독립적으로 가능한 작업은 계속하고, cross-boundary mutation은 별도 dependency/reframe 대상으로 남긴다.

### 문서 정합성 감사

- 문서끼리 표현을 맞추는 것보다 현재 사실·의도된 계약·검증된 보장의 일치를 우선한다.
- 실제 동작은 코드·설정, 검증된 보장은 테스트, 의도된 계약은 current spec으로 구분한다.
- historical 문서의 과거 TODO·실행 지시를 현재 작업으로 자동 승계하지 않는다.
- current 상태는 사실 소유 문서에만 유지하고 다른 문서에는 역할상 필요한 최소 요약만 둔다.
- 세부 판정·분류는 `docs/DOCUMENT_CONSISTENCY.md`를 따른다.

## 5. 승인 경계

- 외부 서비스, 운영 환경, 배포, 환경 변수, 비밀값, 운영 데이터, 마이그레이션, 알림 발송은 명시적 승인 없이 변경하지 않는다.
- `commit`, `push`, PR 생성·수정·병합, GitHub 설정 변경은 현재 사용자 요청의 bounded intent 안에서만 수행한다.
- 삭제, 대량 이동, 이력 변경 등 복구가 어려운 작업은 정확한 대상과 소유권을 확인한다.
- blocker나 proof 부족은 더 넓은 외부 mutation 권한을 자동으로 만들지 않는다.

## 6. 검증

Criterion first.

- 먼저 “어떤 테스트를 추가할까”가 아니라 “이 criterion을 가장 싸고 충실하게 falsify/confirm할 evidence가 무엇인가”를 묻는다.
- focused unit/contract/static proof로 충분하면 거기서 멈춘다.
- 실제 DB transaction, browser, process lifecycle, device/OS, concurrency/timing이 criterion이면 그 boundary에서 검증한다.
- broad/full verification은 실제 cross-cutting risk, shared contract 영향, repository/release gate, targeted proof로 해결되지 않는 uncertainty가 있을 때만 확대한다.
- unrelated broad-gate failure는 현재 change delta인지 분류한 뒤 active failure domain에 속할 때만 수정한다.
- 실행하지 못했거나 실패한 검증은 숨기지 않고 outcome과 분리해 보고한다.

Git publication safety의 focused regression은 다음으로 실행할 수 있다.

```bash
pnpm test:git-safety
```

## 7. Publication과 closure

Publication이 current bounded outcome에 포함된 경우에만 수행한다.

기본:

```text
semantic result
→ nearest faithful proof
→ fresh remote authority
→ semantic / proof / publication freshness classification
→ minimum necessary binding
→ normal non-force publication
→ remote read-back
```

- remote SHA movement만으로 semantic work를 재구현하거나 unrelated proof를 다시 돌리지 않는다.
- semantic owner가 바뀌었으면 affected semantics를 re-evaluate한다.
- proof owner만 바뀌었으면 affected proof만 다시 실행한다.
- topology-only movement이면 semantic work와 still-valid proof를 보존하고 publication binding만 갱신한다.
- exact owned-path publication 중복/충돌 판정이 필요한 경우 `scripts/git/publication-admission.mjs`를 사용한다.
- temporary remote transport가 필요한 경우 `scripts/git/publication-transport.mjs`의 non-force exact-candidate transport를 사용한다.
- push/merge 명령 성공만으로 publication 완료를 선언하지 않고 canonical remote를 직접 read-back한다.
- 반복적인 same-target publication contention이 직접 증명되기 전에는 publication queue, daemon, custom lock service를 추가하지 않는다. 필요성이 입증되면 최종 publication critical section만 가장 작게 serialize하고 provider-native 기능을 우선한다.

Task 종료 전 current task가 직접 만든 transient workspace/ref/artifact만 reconcile한다. repository 전체 cleanup은 수행하지 않는다.

## 8. UNKNOWN / blocker / 사람에게 묻기

UNKNOWN은 lifecycle state가 아니라 **현재 결론에 필요한데 아직 확인되지 않은 정확한 fact**로 취급한다.

- 현재 outcome의 필수 precondition이 아니면 독립 작업을 계속하고 residual로 남긴다.
- 직접 evidence로 확인 가능하면 nearest faithful observation으로 해결한다.
- product/domain/security/policy/risk/irreversible authority처럼 사용자 소유의 material fork가 남을 때만 질문한다.
- failed test, debugging difficulty, ordinary implementation choice, stale historical mechanics는 그 자체로 human escalation 조건이 아니다.
- 안전성이나 authority가 불명확하면 전체 task가 아니라 해당 unsafe transition만 fail closed한다.

## 9. Automation admission

자동화의 기본 대상은 deterministic하고 직접 검증 가능한 개발 단계다.

허용되는 기본 예:

- focused tests / lint / typecheck / build
- Git status/fresh remote/read-back
- non-force publication guard
- exact owned-delta check
- task-owned temporary artifact의 안전한 closure
- CI/repository-native gate

현재 기본적으로 만들지 않는 것:

- task queue / scheduler
- persistent task or ownership registry
- READY/IN_FLIGHT/claim/lease/heartbeat lifecycle
- coordinator daemon / wake loop
- executor report transport/reconciliation control plane
- custom publication queue/lock platform
- context/proof/session database

향후 autonomous execution 수요가 실제로 입증되면 먼저 stateless 또는 thin local runner로 시작하고, persistent state는 기존 primitive로 해결할 수 없는 반복적 실패가 직접 증명될 때만 추가한다.

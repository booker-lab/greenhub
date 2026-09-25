# Greenhub 개발 실행 권위 (Development Authority)

> **상태**: Current
> **Canonical owner**: 이 문서는 Greenhub 개발 실행의 상세 규칙을 소유한다. compact executor kernel과 invariant 요약은 `AGENTS.md` section 0이 소유한다.
> **역사**: 이 문서는 이전 control-tower coordination policy가 소유하던 still-valid Git/개발 안전 의미를 Git-native workflow로 재구성한 것이다. coordination control plane은 현재 실행 모델이 아니며, 이 문서는 어떤 persistent lifecycle 상태, task queue, ownership registry도 요구하지 않는다.

## 1. Semantic scope와 task contract

- 하나의 mutating task는 하나의 independently closable semantic outcome을 소유한다.
- 파일 겹침보다 semantic owner, shared contract, proof dependency를 우선한다.
- 실행 중 다른 semantic boundary가 필요해지면 현재 boundary 안에서 독립적으로 안전한 작업은 계속하고, dependency를 드러내며, 영향을 받는 mutation만 reframe/serialize한다.
- persistent ownership registry를 만들지 않는다.
- normal executor handoff는 다음으로 수렴한다.

```text
OUTCOME
PRESERVE
PROOF
ESCALATE ONLY IF
```

material하게 필요한 경우에만 `SEMANTIC OWNER`, `LOCAL UNKNOWN`, `PUBLICATION AUTHORITY`를 추가한다. 별도 task ontology를 만들지 않는다.

## 2. Workspace / isolation

- branch, worktree, detached workspace는 **opt-in execution mechanics**이며 모든 task에 필수가 아니다.
- 다음 경우에만 사용한다: current checkout의 foreign dirty state, 다른 live mutator와의 physical isolation 필요, recovery identity 필요.
- 동일한 mutable semantic/runtime surface에는 동시에 하나의 active mutator만 둔다.
- read-only 조사와 서로 독립적인 mutation은 실제 mutable surface가 분리되어 있을 때 병렬 수행할 수 있다.
- 사용자나 다른 작업의 dirty/untracked/ignored/recovery state를 reset, restore, stash, clean, stage, commit, delete하지 않는다.
- task-local topology를 다음 task의 authority로 자동 승계하지 않는다.
- canonical checkout은 source locator, remote locator, operator entrypoint다. invocation의 correctness authority가 아니다. 다른 프로세스가 그 checkout의 branch, HEAD, index, tracked/untracked file을 이동시킨 사실은 diagnostic일 뿐이며 독립 invocation을 실패시키지 않는다. correctness는 fresh live main, exact pinned baseline Git object, task-owned disposable workspace, Git으로 관찰한 owned mutation surface, proof/publication evidence로만 판정한다. 단 task-owned workspace 자체의 foreign mutation과 실제 semantic/mutation surface overlap은 계속 fail closed한다.
- 필요할 때 task context에만 다음 transient evidence를 둔다.

```text
DIRECT_PATHS
SEMANTIC_OWNERS
PROOF_OWNERS
```

generic Git workspace 안전(foreign dirty 보존, transport-only ref cleanup)은 `scripts/git/**`가 소유한다.

## 3. Dimensional freshness

- semantic freshness, proof freshness, publication freshness를 구분한다.
- Git revision movement만으로 완료된 semantic work나 유효한 proof를 무효화하지 않는다.
- semantic owner가 바뀌었으면 affected semantics만 re-evaluate한다.
- proof owner가 바뀌었으면 affected proof만 다시 실행한다.
- topology-only movement이면 semantic work와 still-valid proof를 보존하고 publication binding만 갱신한다.
- 하나의 bounded task 안에서 live `main`이 이동해도 movement가 task-owned path와 선언된 proof owner를 침범하지 않으면 기존 task delta를 fresh main에 re-bind해 publication binding만 갱신한다. OpenCode를 다시 호출하지 않는다.
- 선언된 proof owner와 겹치는 movement는 affected proof만 다시 검증하고, 겹치지 않는 proof는 보존한다.
- unknown fact는 실제로 그 fact에 의존하는 transition만 막는다.

## 4. Risk-directed verification (nearest faithful proof)

- Criterion first: "어떤 테스트를 추가할까"보다 "이 criterion을 가장 싸고 충실하게 falsify/confirm할 evidence가 무엇인가"를 먼저 묻는다.
- focused unit/contract/static proof로 충분하면 거기서 멈춘다. full-suite-first를 기본값으로 사용하지 않는다.
- 실제 DB transaction, browser, process lifecycle, device/OS, concurrency/timing이 criterion이면 그 boundary에서 검증한다.
- broad/full verification은 실제 cross-cutting risk, shared contract 영향, repository/release gate, targeted proof로 해결되지 않는 uncertainty가 있을 때만 확장한다.
- unrelated broad-gate failure는 현재 change delta와 분류한 뒤 active failure domain에 속할 때만 수정한다.
- 실행하지 못했거나 실패한 검증은 숨기지 않고 outcome과 분리해 보고한다.
- Git publication safety focused regression은 다음으로 실행할 수 있다.

```bash
pnpm test:git-safety
```

## 5. Uncertainty / blocker handling

- UNKNOWN은 lifecycle state가 아니라 **현재 결론에 필요한데 아직 확인되지 않은 정확한 fact**로 취급한다.
- 현재 outcome의 필수 precondition이 아니면 독립 작업을 계속하고 residual로 남긴다.
- 직접 evidence로 확인 가능하면 nearest faithful observation으로 해결한다.
- product/domain/security/policy/risk/irreversible authority처럼 사용자 소유의 material fork가 남을 때만 질문한다.
- failed test, debugging difficulty, ordinary implementation choice, stale historical mechanics는 그 자체로 human escalation 조건이 아니다.
- 안전성이나 authority가 불명확하면 전체 task가 아니라 해당 unsafe transition만 fail closed한다.

## 6. Outcome-relative publication

Publication은 current bounded outcome에 포함된 경우에만 수행한다. local/candidate-only task라면 publication을 요구하지 않는다.

```text
semantic result
→ nearest faithful proof
→ fresh remote authority
→ semantic / proof / publication freshness classification
→ minimum necessary binding
→ normal non-force publication
→ canonical remote read-back
→ closure
```

- local commit은 publication proof가 아니다.
- push/merge 명령 성공만으로 publication 완료를 선언하지 않고 canonical remote를 직접 read-back한다.
- remote SHA movement만으로 semantic work를 재구현하거나 unrelated proof를 다시 실행하지 않는다.
- exact owned-path publication 중복/충돌 판정이 필요하면 `scripts/git/publication-admission.mjs`를 사용한다.
- temporary remote transport가 필요하면 `scripts/git/publication-transport.mjs`의 non-force exact-candidate transport를 사용한다. transport ref 때문에 shared checkout을 checkout/switch하지 않는다.
- ordinary shared-history rewrite, force push, protected ref 직접 push를 수행하지 않는다.
- semantic/integration conflict 또는 semantic-owner overlap은 local merge/rebase fallback 없이 fail closed한다.
- live `main` movement가 task-owned semantic/proof boundary와 겹치지 않으면 같은 foreground process가 기존 task delta를 fresh main 위에 exact Git evidence(parent = fresh main, owned-path entry equality, tree delta ⊆ owned paths)로 재구성해 publication을 계속할 수 있다. 이 rebind는 OpenCode 재호출, force push, shared checkout의 local merge/rebase, foreign change 흡수를 수행하지 않는다.
- owned path의 foreign edit, non-ancestor live main, 재구성 실패, proof 재검증 실패, bounded attempt 소진은 fail closed한다.
- 반복적인 same-target publication contention이 직접 증명되기 전에는 publication queue, daemon, custom lock service를 추가하지 않는다. 필요성이 입증되면 provider-native 기능을 우선하고 최종 publication critical section만 가장 작게 serialize한다.
- `main` 통합은 production 배포 승인이 아니다. production 배포는 별도 승인 게이트와 exact release SHA 확인 뒤에만 수행한다.

## 7. Closure와 task-owned residue

- 완료는 현재 bounded outcome 기준으로 판정한다.
- 종료 전 current task가 직접 만들거나 supersede한 transient resource만 reconcile한다. 예: task-owned worktree, temporary publication ref, scratch/proof artifact, migration-only compatibility, temporary config/suppression.
- shared/foreign/durable/uncertain ownership state는 시각적 cleanliness를 위해 cleanup하지 않는다.
- historical 문서·보고서는 provenance로 보존한다. 다만 실행 권위, freshness 권위, queue, lifecycle owner로 승격하지 않는다.

### 7.1 Spec temporary fixture lifecycle

- `run-build` / `run-goal`을 포함한 모든 agent spec이 만든 temporary fixture(root checkout, bare remote, request/goal directory, selector/proof/batch workspace)의 lifetime owner는 그것을 만든 test/helper다.
- fixture는 success, assertion failure, exception 경로 모두에서 cleanup된다. fixture setup 도중 실패해도 그 전에 만든 디렉터리를 남기지 않는다.
- cleanup 실패는 조용히 성공으로 처리하지 않는다. 정리되지 않은 fixture와 오류는 evidence로 노출한다.
- provenance가 확인되지 않은 pre-existing temp residue는 wildcard로 삭제하지 않는다. test-owned residue임이 deterministic하게 증명된 경우에만 별도 bounded cleanup을 수행한다.
- invariant는 "기존 residue 정리"가 아니라 "새 residue가 발생하지 않음"이다.

## 8. Automation complexity admission

자동화의 기본 대상은 deterministic하고 직접 검증 가능한 개발 단계다.

허용되는 기본 예:

- focused tests / lint / typecheck / build
- Git status/fresh remote/read-back
- non-force publication guard
- exact owned-delta check
- task-owned temporary artifact의 안전한 closure
- CI/repository-native gate

기본적으로 만들지 않는 것:

- task queue / scheduler
- persistent task or ownership registry
- coordinator daemon / wake loop
- executor report transport/reconciliation control plane
- custom publication queue/lock platform
- context/proof/session database

새 durable automation은 반복되는 material failure와 기존 primitive(Git, repository, test runner, CI/provider, OS/runtime)의 불충분함이 직접 증명될 때만 검토한다. 향후 autonomous execution 수요가 실제로 입증되면 먼저 stateless 또는 thin local runner로 시작하고, persistent state는 기존 primitive로 해결할 수 없는 반복적 실패가 직접 증명될 때만 추가한다.

## 9. Natural-language BUILD front door

`MODE: BUILD` 자연어 요청 하나는 `scripts/agent/run-build.mjs`가 소유한다. 이 thin adapter는 자체 executor나 control plane이 아니라 기존 loop의 front door이며, 다음 순서만 소유한다.

```text
BUILD request (MODE: BUILD + 자연어)
→ fresh live main pin
→ 요청이 지명한 authority의 exact-SHA 확인 (없으면 대체 파일 없이 fail closed)
→ disposable workspace의 read-only frontier selector 1회
→ selector 판정의 deterministic 검증 (live main 재평가와 불일치하면 fail closed)
→ ephemeral Goal Contract
→ 기존 run-goal 1회 (run-once / run-publish-once / 5-way batch 재사용)
→ finite BUILD terminal
```

- Goal Contract는 durable queue, backlog, registry로 저장하지 않는다. invocation당 정확히 하나의 frontier만 닫고, 완료 후 다음 frontier를 자동 선택하지 않는다.
- selector는 writer가 아니며, workspace mutation이 관찰되면 executor invocation 없이 판정을 거부한다.
- 이미 satisfied인 frontier는 다시 구현하지 않고, higher-priority open frontier가 남아 있으면 lower-priority를 선택하지 않는다.
- 새로운 product meaning, UX·정책 fork, security·privacy authority, clinical·safety·financial·legal 정책, 되돌릴 수 없는 외부 action, acceptance 의미 변경은 구현하지 않고 `HUMAN_DECISION_REQUIRED`로 종료한다.
- BUILD terminal은 `FRONTIER_COMPLETE`, `ALREADY_SATISFIED`, `HUMAN_DECISION_REQUIRED`, `BLOCKED_EXTERNAL`, `NO_EXECUTABLE_FRONTIER`, `PROOF_FAILED`, `PUBLICATION_FAILED`다. 요청 형식 자체가 invalid하면 executor invocation 없이 `INVALID_BUILD_REQUEST`로 거부한다.
- publication은 기존 `run-publish-once`만 사용하고, publication 뒤 canonical remote read-back을 필수로 한다. canonical local mirror 동기화는 BUILD 성공 판정의 authority가 아니다.
- focused deterministic proof: `pnpm test:agent-build`.

### 9.1 Selector contract authority

- BUILD selector의 generator-visible generation contract와 deterministic validator는 하나의 authoritative selector contract(constants layer)에서 파생한다.
- required/optional fields, allowed fields, enums, check별 criterion field set, identifier/path/authority requirement, considered·batch frontier count limit, text length limit은 그 contract가 소유한다. prompt와 validator에 같은 constraint를 각각 magic literal로 복제하지 않는다.
- validator는 contract가 선언한 constraint만 강제한다. prompt에 없는 hidden rule을 추가하지 않는다.
- malformed output, missing/invalid authority, contract 밖 field는 계속 fail closed한다. invalid output을 truncate하거나 `INVALID_OUTPUT`을 무시하거나 validation을 완화해 성공률을 높이지 않는다.
- generated decision은 retry 없이 deterministic validation을 통과해야 하며, 실패형 regression은 focused spec으로 고정한다.

### 9.2 Current-evidence reconciliation

- selector는 frontier candidate를 만들기 전에 현재 문서의 미완료 표현과 current implementation/direct proof를 대조해 다음 중 하나로 분류한다.
  - `IMPLEMENTATION_GAP`: intended contract와 구현/proof 사이에 실제 gap이 있다.
  - `STALE_SPEC`: current spec, current implementation, direct proof가 같은 의미를 가리키는데 spec 표현만 뒤처져 있다.
  - `SEMANTIC_CONFLICT`: spec과 implementation이 서로 다른 계약을 주장한다.
- 판정 기준은 current intended semantic contract, current source behavior, nearest faithful direct proof다. 코드가 존재한다는 이유만으로 semantic spec을 덮어쓰지 않고, test가 존재한다는 이유만으로 intended contract가 바뀌었다고 추론하지 않는다.
- `IMPLEMENTATION_GAP`만 product frontier 후보다. `STALE_SPEC`은 product gap으로 취급하지 않으며 같은 bounded task 안에서 authoritative spec line을 current contract에 맞게 sync할 수 있다. `SEMANTIC_CONFLICT`는 자동 수정하지 않고 `HUMAN_DECISION_REQUIRED`로 escalation한다.
- reconciliation 결과를 durable registry나 별도 state로 저장하지 않는다.

### 9.3 Multi-frontier batch admission

- BUILD front door는 product priority 순으로 considered frontier를 최대 5개까지 평가하고, 하나의 bounded batch에 여러 independently closable frontier를 admission할 수 있다.
- 병렬 독립성은 파일 개수가 아니라 semantic_owner, mutation allow surface, proof_owner, depends_on, shared contract/runtime boundary로 판정한다.
- admission한 frontier들은 하나의 ephemeral Goal Contract로 합성되어 기존 run-goal의 bounded batch executor로 전달된다. 겹치는 frontier는 이번 batch에서 시작하지 않고 다음 live-main recomputation 대상으로 남으며, exclusion 때문에 실패로 기록되지 않는다.
- batch가 settle되면 fresh live main을 다시 읽고 criterion을 재평가한다. 새 scheduler, queue, durable frontier registry, coordinator를 만들지 않는다.
- 각 frontier는 기존 `run-publish-once` publication path와 freshness/rebind 계약을 그대로 사용한다.

## 10. Foreground Night Run

`RUN NIGHT`는 여러 BUILD cycle을 밤새 연속 실행하는 얇은 foreground wrapper이며 `scripts/agent/run-night.mjs`가 소유한다. 새 planner나 control plane이 아니라 기존 BUILD front door의 반복/lifetime 실행자다.

```text
RUN NIGHT
→ fresh live main 관찰 (기록용)
→ BUILD cycle 1 (run-build 자식 process 1회)
→ cycle terminal 해석
→ FRONTIER_COMPLETE + provable progress일 때만 다음 cycle
→ finite max-cycles / max-minutes / operator stop / terminal
→ deterministic summary 1회
→ process exit
```

- Night Run은 product frontier를 선택하거나 semantic decision을 내리지 않는다. 각 cycle은 기존 `run-build`가 fresh live main에서 독립적으로 다시 판단한다. 이전 cycle의 selector decision, candidate, batch 결과를 다음 cycle authority로 넘기지 않는다.
- `--max-cycles`는 필수 positive integer finite bound다. unattended 실행은 finite bound 없이 시작하지 않는다. `--max-minutes`는 cycle 사이에서만 검사하는 선택적 wall-clock bound다. scheduler, daemon, durable queue, watchdog, polling service를 만들지 않는다.
- continuation은 `FRONTIER_COMPLETE`만이다. `ALREADY_SATISFIED`, `NO_EXECUTABLE_FRONTIER`, `HUMAN_DECISION_REQUIRED`, `BLOCKED_EXTERNAL`, `PROOF_FAILED`, `PUBLICATION_FAILED`, `INVALID_BUILD_REQUEST`, selector/planner failure, parse할 수 없는 child terminal, `--max-cycles`/`--max-minutes` 도달은 새 BUILD 없이 즉시 종료한다. 기존 BUILD status vocabulary를 그대로 매핑하며 Night 전용 status를 최소화한다.
- progress guard: `FRONTIER_COMPLETE`인데 live main이 이동하지 않았거나 movement를 증명할 수 없거나, 동일한 `(start main, end main, frontier, batch, terminal)` fingerprint가 반복되면 fail closed한다. durable loop-state 없이 process-local 비교만 사용한다.
- BUILD request는 process 시작 시 정확히 한 번 읽어 memory에 보관하고 모든 cycle에 동일하게 전달한다. durable coordination state로 저장하지 않는다.
- 각 BUILD cycle은 별도 child process이며 parent와 다른 process group(detached, Windows에서는 자체 console 없음)에서 실행한다. 따라서 console Ctrl+C는 mutation/proof/publication critical section에 전달되지 않는다. parent는 child의 JSON terminal을 읽어 continue/stop만 판정하고 child stderr/live progress는 operator에게 relay한다.
- operator stop: 첫 SIGINT/Ctrl+C는 process-local `STOP_REQUESTED`만 설정한다. cycle 사이면 새 BUILD 없이 즉시 summary를 출력하고, cycle 중이면 현재 BUILD가 자신의 bounded terminal에 도달한 뒤 새 cycle 없이 summary를 출력한다. 반복 SIGINT는 diagnostic만 출력하고 hard kill로 승격하지 않는다. Task Manager 종료, 콘솔 강제 닫기, reboot는 graceful stop 계약이 아니다.
- summary는 status, stop reason, live main start/end, cycles, completed frontier, human/blocked/failure, operator stop, bound, task-owned residue를 deterministic JSON으로 출력한다. child stdout 전체를 복제하지 않고 필요한 structured evidence만 aggregate한다.
- focused deterministic proof: `pnpm test:agent-night`.

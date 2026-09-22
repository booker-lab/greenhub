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

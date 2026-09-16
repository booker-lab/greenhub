# GREENHUB_BRANCH_RECURRENCE_PREVENTION_AND_CONTROL_TOWER_CLOSURE_POLICY

Status: **GLOBAL_CANONICAL**  
Effective: **IMMEDIATELY**  
Applies to: ChatGPT/Codex coordination, Blueprint Framer, Problem Framer, Coordination Control Tower, Portfolio/Scheduler, Runtime/Executor, Task Prompt Generator, Result Intake/Closure, publication workflow, shared task ledger/coordination state, and future Greenhub development prompts.

This is not a task-local instruction. If an older active execution rule conflicts with this policy, this policy wins. Historical records are preserved; the active canonical surfaces are aligned instead of rewriting history.

## 0. Core purpose

Greenhub must not recreate the failure structure already experienced:

long-lived/task/parallel branches
→ independent baselines
→ main divergence
→ stale baseline
→ duplicate semantic implementation
→ large merge/rebase/cherry-pick
→ commit explosion
→ difficult regression/omission judgement
→ CI/Vercel cascades
→ canonical checkout mismatch
→ repeated integration work.

Therefore “do not use branches” is a canonical coordination invariant, not a stylistic preference.

## 1. Branch recurrence — absolute rule

```text
BRANCH_REQUIRED_FOR_TASK = NO
TASK_BRANCH = PROHIBITED
FEATURE_BRANCH = PROHIBITED
AGENT_BRANCH = PROHIBITED
PARALLELISM_BRANCH = PROHIBITED
LONG_LIVED_INTEGRATION_BRANCH = PROHIBITED
```

Do not create development branches merely to increase parallelism, avoid conflicts, improve isolation, or pin a baseline. Do not recreate a structure where Task A/B/C each accumulate independent commits and are later integrated into main.

A short-lived publication transport ref may exist only when PR transport is required. It is not a development branch, must not be checked out as a development workspace, must not accumulate unrelated history, and must be retired after publication/closure.

## 2. Main role

```text
MAIN_ROLE = CANONICAL_MIRROR_ONLY
```

Normal main state:

- branch/ref authority = `main`
- `HEAD = LIVE_MAIN`
- worktree = `CLEAN`

`main` is not a development workspace. It must not accumulate:

- task-local commits
- unpublished candidate history
- independent changes from multiple executors
- publication-preparation commits
- stale integration commits
- temporary changes from another task

`main` mirrors the current remote canonical truth.

## 3. Mutation without branch recurrence

Source mutation must not be isolated by creating a named development branch.

Any mutation surface must satisfy all of the following:

- starts from the exact live-main SHA
- has no named development branch
- contains no long-lived history from another task
- has exactly one bounded semantic owner
- is never reused as the next task workspace
- does not preserve stale state long term
- does not turn main into a checkout workspace
- can be retired immediately after publication
- shares no mutable state with another parallel task

The invariant outranks the mechanism.

If an environment appears to require new branch/worktree-based parallel development to satisfy these conditions, do not create it automatically. Default judgement:

```text
MUTATION_COLLISION
→ SERIALIZE
```

Reducing parallelism is preferred over reintroducing branch divergence.

## 4. Worktree / isolation rule

A worktree must not become a branch factory for parallel tasks.

Prohibited:

- task-per-branch + worktree
- agent-per-worktree
- reuse of stale worktrees by a later task
- long-lived local commit accumulation in a worktree
- developing while a publication branch/ref is checked out
- solving shared-checkout problems by multiplying branches/worktrees

Before an isolated execution surface is allowed, Control Tower must prove:

1. no branch recurrence is introduced;
2. no long-lived independent history is introduced;
3. the surface starts at exact live main;
4. the surface is fully retireable at task end;
5. mutable state is not shared with another semantic owner.

If these cannot be proven, parallel mutation is not admitted; serialize instead.

## 5. Parallelism policy

Parallelism is not the goal. Safe throughput is the goal.

```text
READ_ONLY
→ parallel encouraged

MUTATION + NON_OVERLAPPING_SEMANTIC_OWNER
→ parallel only when physical mutation-surface independence is proven

MUTATION + POSSIBLE_COLLISION
→ SERIAL

MUTATION + SAME_SEMANTIC_OWNER
→ SERIAL or RE-SPLIT

UNKNOWN_OVERLAP
→ parallel execution prohibited
```

Never answer “create branches so these can run in parallel.” The correct response is to narrow/re-split the tasks or serialize them.

## 6. Mutating-task admission

Every mutating task must pass admission before mutation. The newly supplied policy text established Gate 1 and the global ordering intent, but the user message received by the coordination system ended in the middle of the Gate 1 text. Missing clauses must not be invented.

The active rule therefore is:

### Gate 1 — Canonical mirror health

At minimum:

- directly read live main;
- verify canonical-main mirror health;
- check for dirty state and local commits;
- do not turn dirty/stale main into a task workspace.

Where the newer text is silent because it was truncated, retain the previously compatible Greenhub three-gate admission contract until a continuation explicitly supersedes it:

1. canonical mirror/worktree health;
2. exact live-main verification using independent current reads;
3. overlapping semantic-mutator check for the owned surface.

Unknown overlap or unresolved physical isolation fails closed to serial execution.

## 7. Publication transport

Publication transport is not source development.

- Re-read live main immediately before PR/publication admission.
- Re-evaluate the owned effective delta against current live main.
- If the owned delta is already present, close as already published/superseded without a new PR, CI, or deploy.
- A temporary publication ref must not take over the shared checkout.
- Do not use local merge/rebase/cherry-pick in a foreign dirty/shared checkout as a publication fallback.
- If transport conflicts or semantic ownership overlaps, fail closed and re-split/re-evaluate instead of reconciling histories broadly.
- Retire the temporary transport ref after the publication cycle is resolved.

## 8. Control Tower result intake and closure

Executor task closure is not Control Tower closure. Publication success alone is not closure.

Canonical closure requires:

```text
RESULT INTAKE
→ CURRENT CANONICAL STATE RECOMPUTE
→ LIVE MAIN RE-READ
→ PUBLICATION / EFFECTIVE DELTA CLASSIFICATION
→ CANONICAL MAIN MIRROR HEALTH CHECK
→ DIRTY / LOCAL COMMIT CLASSIFICATION
→ SAFE RETIREMENT OR PRESERVATION DECISION
→ MIRROR RECOVERY IF REQUIRED
→ branch/ref authority = main
→ HEAD = LIVE_MAIN
→ worktree = CLEAN
→ NEXT BOUNDED STATE TRANSITION
→ CONTROL TOWER CLOSED
```

A Control Tower response must not stop after summarizing an executor `RESULT`. It must classify what the evidence actually proves, update canonical state, close/reclassify the completed task, and emit the narrowest next bounded transition when one exists.

## 9. Future prompt contract

All future Greenhub mutating prompts must make the following explicit:

- no task/feature/agent/parallel development branch
- `MAIN_ROLE = CANONICAL_MIRROR_ONLY`
- exact live-main admission
- bounded semantic owner / owned surface
- overlap judgement
- physical mutation-surface independence or serialization
- publication transport is transport-only
- post-publication canonical mirror recovery/closure
- no automatic merge/rebase/cherry-pick for baseline movement
- unrelated semantic movement alone is not a reason to recreate source work

Task result formats must include:

```text
friction_observed:
- problems, repeated coordination friction, or policy/tooling gaps observed during this session
- NONE if no meaningful friction was observed
```

`friction_observed` is input for the next candidate-task decision; it is not permission to expand the current task.

## 10. Historical-record rule

Do not delete or rewrite historical documents merely because their old execution guidance is superseded. Preserve history and align the active canonical surfaces that own current execution rules.

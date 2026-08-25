<!-- Language: ko -->

# Task 2D — P0 Integration Candidate Document Closeout

## 범위와 기준

- Workspace: `C:/Develop/greenhub-task-2c-r1`
- Branch: `codex/task-2c-r1-reg001`
- Candidate HEAD: `c9d60f63af63a841f92ac56666fbafc6b49ec029`
- Task 2C result: `TASK_2C_REGRESSION_VERIFIED`
- Task 2C 당시 `origin/main`: `97674e97a4f2f763f83a51a79c65012425c4a50c`
- Task 2D 시작 시 current `origin/main`: `256abc705c6895a0d43936207382238be15bd976`
- Candidate/main merge-base: `97674e97a4f2f763f83a51a79c65012425c4a50c`

`origin/main`은 merge-base 이후 문서-only redelivery P0 정합화 커밋 12개가 진행됐다. candidate code 영역과 overlap은 0개였고, Task 2D에서는 rebase/merge하지 않았다. 최신 main의 문서 상태를 read-only로 검토해 current backlog/plan/handoff/orders spec에 반영했다.

## Candidate verified scope

- `F-001`: driver approval, JWT/current-user validation, stale/suspended/role-mismatch/session and assignment/ownership boundaries
- `P0-002`: cancelled order + late provider payment race, no order resurrection, safe refund/finalization convergence, idempotency
- `P0-001`: provider non-`PAID` finalization denial, `PAID` success, amount mismatch guard
- `REG-001`: candidate-added API spec lint remediation
- `ENV-001`: safe session-local Firebase config; driver typecheck/build

## Validation evidence

| Area | Result |
|---|---|
| API | 41 suites / 319 tests PASS |
| Focused candidate | 3 suites / 16 tests PASS |
| Consumer | 106 tests PASS |
| Seller | 7 files / 43 tests PASS |
| Driver | 11 tests PASS |
| Shared | 2 files / 9 tests PASS |
| Firestore Rules | 23 / 23 PASS |
| Candidate API ESLint | 0 errors / 0 warnings |
| Driver typecheck | PASS |
| API build | PASS |
| Consumer build | PASS |
| Seller build | PASS |
| Driver build | PASS |
| Deployment safety | PASS |
| `git diff --check` | PASS |

The root `pnpm build` orchestration hit the pre-existing parallel `copy-fonts.cjs` destination race. Sequential application builds all passed; this is not a candidate build regression.

## Current versus historical

- Current candidate is verified locally, but it is not yet in `origin/main`, has no PR, and is not a production release.
- Latest main redelivery payment-request/hold-resolution/resume P0 remains unresolved and outside this candidate.
- Production/Preview Playwright E2E, real PortOne side effects, ALIGO delivery, production Firebase mutation, and production Vercel deployment were not run.
- Firestore Java 17 failure and the initial Firebase `auth/invalid-api-key` are historical environment findings; `ENV-001` is closed.

## Known baseline debt

- `apps/api/src/payments/payments.service.spec.ts:90` — TS2698 spread type error, reproduced before REG-001.
- API global lint debt — 1,168 errors / 114 warnings, separate from candidate spec lint.
- Root aggregate build — existing `copy-fonts.cjs` parallel destination race.

## Next action

Review and, if approved, integrate this candidate into the current `main` through the repository's branch+PR process. Do not push, merge, deploy, or treat this candidate as production approval automatically.

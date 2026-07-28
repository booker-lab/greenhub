<!-- Language: ko -->

# Project Blueprint: Task 6.8 A+ 비밀값 대응과 분리 worktree 정리

## 문서 메타

- **작성일**: 2026-07-28
- **상태**: `done`
- **Priority**: P0
- **Labels**: `security`, `credentials`, `git`, `worktree`, `cleanup`
- **SSOT Check**: `docs/discussions/DISCUSS_task_6_8_a_plus_secure_cleanup.md`, `docs/plans/REPORT_task_6_8_final_closeout.md`, `docs/memory.md`
- **Architectural Goal**: 노출된 PortOne 비밀값을 먼저 무효화한 뒤 검증 SHA의 별도 worktree에서 후속 작업을 격리하고 기존 작업 트리에서는 승인된 항목만 정리한다.

## 📋 업무 요약 (협업용)

### 개요

Task 6.8 검증 결과는 유효하지만 현재 작업 폴더에는 그보다 앞선 사용자 변경과 생성물이 함께 남아 있다. 검증 기준을 현재 폴더에 바로 합치면 의존성 파일 충돌과 사용자 변경 손실 위험이 있다. 또한 과거 commit에 실재형 PortOne 비밀값이 있었으므로 작업 폴더 정리보다 비밀값 무효화가 먼저다.

### 끝났을 때 확인할 것

- 이전 PortOne 비밀값은 더 이상 인증에 사용할 수 없다.
- 새 PortOne 비밀값은 승인된 환경에서만 사용되고 인증 경계를 통과한다.
- 별도 작업 폴더는 최종 검증 SHA를 정확히 가리킨다.
- 기존 작업 폴더의 사용자 변경과 역사적 Closeout 증거는 보존된다.
- 삭제한 생성물과 TEMP 사본은 승인된 허용 목록으로 추적된다.
- readiness·credential JSON은 파일별 보존·삭제 근거가 남는다.

### 이번 계획에서 하지 않는 것

- Git 역사 재작성과 force push
- 애플리케이션 소스·테스트·도메인 동작 변경
- 운영 `salesMode` 전환과 일반 배포
- Task 6.8 역사적 `closeout-summary.json` 수정·삭제
- 비밀값·인증 상태·개인정보·사진 원본·fixture manifest 출력
- 승인되지 않은 tracked 변경 복원과 미추적 파일 삭제

## 🎯 Origin Intent

- **출처**: Task 6.8 Closeout 후속 위험 검토와 사용자 A+ 결정
- **원래 목적**: 보안 사고 대응과 Git 충돌 해결을 분리해 기존 사용자 작업을 잃지 않는다.
- **완료 관찰**: 이전 비밀값이 무효화되고 검증 SHA의 독립 worktree가 준비되며 기존 작업 트리는 승인 범위만 정리된다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | 출처 | Task-ID / 범위 밖 | 안전 조건 |
| :--- | :--- | :--- | :--- |
| 비밀값 활성 여부 불명확 | discuss | 1.1~1.4 | 활성으로 간주해 무효화를 선행 |
| 새 비밀값 검증 실패 | discuss | 1.3~1.4 | 이전 값 복구 금지, 소유자 에스컬레이션 |
| 비밀값이 여러 환경에 복제됨 | 작업 트리 감사 | 1.1, 1.4 | 값이 아닌 환경·변수명 단위로 전수 확인 |
| Git 역사에 무효화된 값이 남음 | 사용자 보고 | 2.1~2.2 | 역사 재작성은 별도 승인 계획으로 분리 |
| worktree 경로 또는 브랜치 충돌 | discuss | 3.1 | 덮어쓰기 없이 중단 |
| 현재 변경과 검증 SHA 변경이 겹침 | Git 실측 | 3.2~3.3 | 현재 폴더 동기화 금지, 새 worktree 사용 |
| cleanup 목록에 민감 artifact 포함 | discuss | 4.1, 4.4 | 원문 미출력, 파일별 소유권 판정 |
| 광범위한 ignore 삭제 | 이전 감사 | 4.1~4.2 | 명시적 허용 목록만 삭제 |
| TEMP 경로 오판 | 이전 감사 | 4.3 | 시스템 TEMP 내부 정확한 경로 확인 |
| 역사적 Closeout 증거 삭제 | 최종 보고서 | 범위 밖 | 항상 보존 |

## 🔍 Diagnosis & Findings

- 최종 검증 SHA `39fdb2c28c45b5c7658519181e41845bb24be2fd`는 로컬 commit 객체와 원격 추적 참조에 모두 존재한다.
- 현재 HEAD는 검증 SHA보다 정확히 2개 커밋 이전이며 merge-base는 현재 HEAD다.
- 두 commit은 `.github/workflows/e2e-round-direct.yml`, `pnpm-lock.yaml`, `scripts/package.json`을 바꾼다.
- 현재 작업 트리도 `pnpm-lock.yaml`과 `scripts/package.json`을 수정하고 있어 현재 폴더의 직접 동기화는 충돌 위험이 있다.
- 현재 의존성 범위는 `bcrypt: "*"`, 검증 SHA는 `bcrypt: "^6.0.0"`으로 서로 다르다.
- 시스템 TEMP에는 원격 비민감 증거 사본 10개, 2,901바이트가 남아 있다.
- `.artifacts/round-direct/`에는 여러 실행의 readiness·credential·fixture 관련 결과가 혼재한다.
- `just secret-scan`은 `trufflehog git file://. --only-verified`로 Git 역사를 검사한다.
- 실재형 비밀값이 commit 역사에 있었다면 문서 치환과 파일 삭제는 자격 증명을 무효화하지 못한다.

## 🏗️ Architectural Deepening

- **Seam**: 자격 증명 무효화, Git 기준 격리, 로컬 artifact 정리를 독립 게이트로 분리한다.
- **Leverage**: 이미 로컬에 존재하는 검증 SHA 객체를 사용해 fetch 없이 worktree를 만든다.
- **Safety**: 비밀값은 값 자체가 아니라 상태·환경·검증 결과만 기록한다.
- **Recovery**: 기존 작업 트리는 그대로 두고 새 worktree를 후속 작업의 안전한 기준으로 사용한다.
- **History**: 비밀값 회전은 즉시 수행하되 역사 재작성은 협업 영향 평가 뒤 별도 계획으로 넘긴다.
- **Cleanup**: 삭제는 허용 목록과 경로 검증을 통과한 항목에만 적용한다.

## Agent Completion Contract

1. Task를 Dependency 순서대로 한 번에 하나씩 실행한다.
2. 비밀값 원문·Authorization 헤더·인증 상태·개인정보를 터미널과 문서에 출력하지 않는다.
3. 외부 PortOne 자격 증명 폐기·생성·환경 반영은 실행 직전 별도 승인을 받는다.
4. 이전 비밀값 활성 여부가 불명확하면 활성으로 판정한다.
5. 이전 비밀값 무효화 확인 전 새 worktree와 cleanup Task를 시작하지 않는다.
6. Git 역사 재작성, force push, pull, reset, 현재 작업 트리 checkout을 수행하지 않는다.
7. 새 worktree 경로는 `C:\Develop\greenhub-verified-39fdb2c`로 고정한다.
8. 새 branch는 `codex/task-6-8-a-plus-cleanup`으로 고정한다.
9. 고정 경로나 branch가 이미 존재하면 덮어쓰지 않고 중단한다.
10. 현재 작업 트리의 tracked 변경은 복원·stage·commit하지 않는다.
11. 삭제 전 모든 대상의 절대 경로가 승인된 루트 안에 있는지 확인한다.
12. Task 6.8 역사적 `closeout-summary.json`과 최종 Closeout 문서를 삭제하지 않는다.
13. readiness·credential JSON은 파일별 승인 전 삭제하지 않는다.
14. 모든 증거는 비밀값을 제외한 상태·개수·SHA·종료 코드만 기록한다.
15. 각 Verify 종료 코드가 0일 때만 Conclusion과 Status를 닫는다.
16. 전체 실행 요청 뒤 Blueprint 구조를 고정하고 Conclusion·Status·Closeout만 갱신한다.

> **에이전트 스코프**: 사용자가 PLAN 전체 실행을 요청하면 승인된 PortOne 비밀값 대응, 검증 SHA worktree 생성, 기존 작업 트리의 허용 목록 cleanup, JSON 소유권 판정, 비민감 Closeout만 수행한다.

## Execution Plan

### Phase 0 — 비민감 기준선과 검사 경계

#### Task 0.1 — A+ 기준선 보고서 생성

- **Task-ID**: 0.1
- **Dependency**: 없음
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 현재 SHA·작업 트리·artifact·TEMP 상태를 비민감 기준선으로 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Conclusion**: 현재 SHA·사용자 변경·artifact·TEMP 기준선을 비밀값 없이 보고서에 고정했고 문서 공백 검사가 통과했다.
- **Status**: done

#### Task 0.2 — Git 역사 비밀 검사

- **Task-ID**: 0.2
- **Dependency**: Task 0.1
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 검증된 비밀 탐지 결과를 원문 없이 detector·commit·ref 단위로 기록한다.
- **Verify**: `powershell -NoProfile -Command "just secret-scan *> $null"`
- **Conclusion**: `trufflehog` 3.96.0의 검증된 탐지는 0건이었지만 수동 보강 감사에서 과거 노출 후보 commit 1개를 식별했다. 지정 검사는 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 0.3 — PortOne 판독기 안전성 확인

- **Task-ID**: 0.3
- **Dependency**: Task 0.2
- **Target**: `scripts/diagnose-portone-v2.mjs`
- **Goal**: PortOne 판독기가 비밀값을 응답과 오류에서 제거하는지 확인한다.
- **Verify**: `node --check scripts/diagnose-portone-v2.mjs`
- **Conclusion**: 판독기는 비밀값·Authorization을 출력하지 않고 상태 코드와 정제된 제한 필드만 반환하며 구문 검사가 통과했다.
- **Status**: done

### Phase 1 — PortOne 비밀값 무효화와 회전 [승인 게이트]

#### Task 1.1 — 영향 환경과 활성 상태 판정

- **Task-ID**: 1.1
- **Dependency**: Task 0.3
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 노출 후보의 활성 상태와 배치 환경을 값 없이 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Conclusion**: 영향 환경은 Railway `api`의 `staging`·`production`이며 두 환경 모두 대상 변수명이 배치돼 있다.
- **Status**: done

#### Task 1.2 — 이전 PortOne 비밀값 폐기

- **Task-ID**: 1.2
- **Dependency**: Task 1.1과 사용자 승인
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 승인된 이전 PortOne 비밀값을 provider 경계에서 폐기한다.
- **Verify**: `powershell -NoProfile -Command "$r = node scripts/diagnose-portone-v2.mjs | ConvertFrom-Json; if ($r.httpStatus -in 401,403) { exit 0 }; exit 1"`
- **Conclusion**: 과거 노출 후보가 동일 인증 경계에서 HTTP `401`로 거부되어 이미 폐기된 상태임을 확인했다. 별도 provider 변경은 필요하지 않았다.
- **Status**: done

#### Task 1.3 — 새 PortOne 비밀값 발급

- **Task-ID**: 1.3
- **Dependency**: Task 1.2와 사용자 승인
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 새 PortOne 비밀값을 승인된 대상 환경에만 반영한다.
- **Verify**: `powershell -NoProfile -Command "$r = node scripts/diagnose-portone-v2.mjs | ConvertFrom-Json; if ($null -ne $r.httpStatus -and $r.httpStatus -notin 401,403) { exit 0 }; exit 1"`
- **Conclusion**: 두 대상 환경의 현재 값은 노출 후보와 다르고 동일 인증 경계에서 HTTP `404`를 반환해 인증을 통과했다. 이미 발급·반영된 회전 값을 유지했다.
- **Status**: done

#### Task 1.4 — 환경별 회전 완료 증거 고정

- **Task-ID**: 1.4
- **Dependency**: Task 1.3
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 이전 값 거부와 새 값 인증 판정을 환경별 비민감 증거로 고정한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Conclusion**: 이전 값 `401`, `staging` 현재 값 `404`, `production` 현재 값 `404`를 값 없는 회전 완료 증거로 고정했다.
- **Status**: done

### Phase 2 — Git 역사 후속 결정

#### Task 2.1 — 영향 ref와 협업 범위 감사

- **Task-ID**: 2.1
- **Dependency**: Task 1.4
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 무효화된 비밀값이 포함된 ref와 협업 영향 범위를 원문 없이 기록한다.
- **Verify**: `powershell -NoProfile -Command "just secret-scan *> $null"`
- **Conclusion**: 영향 commit은 로컬 branch 12개와 원격 추적 ref 15개에 포함되며 검증된 비밀 재검사는 0건·종료 코드 0이었다.
- **Status**: done

#### Task 2.2 — 역사 재작성 별도 게이트 확정

- **Task-ID**: 2.2
- **Dependency**: Task 2.1
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 역사 재작성 필요성과 별도 승인 계획의 소유자를 확정한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Conclusion**: 역사 재작성과 force push는 수행하지 않았고 저장소 관리자와 영향 branch 소유자의 별도 승인 게이트로 확정했다.
- **Status**: done

### Phase 3 — 검증 SHA 별도 worktree

#### Task 3.1 — worktree 충돌 사전 검사

- **Task-ID**: 3.1
- **Dependency**: Task 2.2
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 고정 worktree 경로와 branch 이름의 미사용 상태를 검증한다.
- **Verify**: `powershell -NoProfile -Command "if ((Test-Path -LiteralPath 'C:\Develop\greenhub-verified-39fdb2c') -or (git branch --list 'codex/task-6-8-a-plus-cleanup')) { exit 1 }"`
- **Conclusion**: 고정 경로와 branch가 모두 미사용임을 확인했으며 충돌 검사가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 3.2 — 검증 SHA worktree 생성

- **Task-ID**: 3.2
- **Dependency**: Task 3.1
- **Target**: `C:\Develop\greenhub-verified-39fdb2c\.git`
- **Goal**: 검증 SHA에서 격리 branch의 별도 worktree를 생성한다.
- **Verify**: `git -C C:\Develop\greenhub-verified-39fdb2c rev-parse HEAD`
- **Conclusion**: 고정 명령으로 최종 검증 SHA에서 전용 branch와 worktree를 생성했고 HEAD 일치를 확인했다.
- **Status**: done

실행 명령은 `git worktree add -b codex/task-6-8-a-plus-cleanup C:\Develop\greenhub-verified-39fdb2c 39fdb2c28c45b5c7658519181e41845bb24be2fd`로 고정한다.

#### Task 3.3 — 새 worktree 기준선 확인

- **Task-ID**: 3.3
- **Dependency**: Task 3.2
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 새 worktree의 HEAD·branch·청결 상태를 비민감 증거로 기록한다.
- **Verify**: `powershell -NoProfile -Command "$s = git -C 'C:\Develop\greenhub-verified-39fdb2c' status --porcelain; if ($s) { exit 1 }"`
- **Conclusion**: 새 worktree는 지정 branch에서 변경 항목 0개로 clean이며 기존 작업 트리 HEAD는 바뀌지 않았다.
- **Status**: done

### Phase 4 — 기존 작업 트리의 승인 기반 정리

#### Task 4.1 — cleanup 허용 목록 확정

- **Task-ID**: 4.1
- **Dependency**: Task 3.3
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: ignore 생성물의 삭제 허용 목록을 절대 경로와 소유 근거로 확정한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Conclusion**: Task 6.7 중간 실행 디렉터리 22개를 절대 경로 허용 목록으로 확정하고 추적 파일 0개·reparse point 0개를 확인했다.
- **Status**: done

#### Task 4.2 — 승인된 ignore 생성물 제거

- **Task-ID**: 4.2
- **Dependency**: Task 4.1과 사용자 승인
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 허용 목록과 정확히 일치하는 ignore 생성물만 제거한다.
- **Verify**: `git status --short`
- **Conclusion**: 허용 목록과 일치하는 중간 실행 파일 345개, 총 4,360,378바이트와 빈 디렉터리만 제거했다.
- **Status**: done

#### Task 4.3 — 시스템 TEMP 증거 사본 제거

- **Task-ID**: 4.3
- **Dependency**: Task 4.2와 사용자 승인
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 검증된 시스템 TEMP 하위의 비민감 원격 증거 사본만 제거한다.
- **Verify**: `powershell -NoProfile -Command "if (Test-Path -LiteralPath (Join-Path $env:TEMP 'greenhub-task-6-8-closeout-run-30031472177')) { exit 1 }"`
- **Conclusion**: 시스템 TEMP 내부의 고정 경로에서 비민감 사본 10개, 총 2,901바이트를 제거했고 경로 부재를 확인했다.
- **Status**: done

#### Task 4.4 — readiness·credential JSON 소유권 판정

- **Task-ID**: 4.4
- **Dependency**: Task 4.3
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: readiness·credential JSON의 보존·삭제·별도 보안 검토 소유권을 파일별로 판정한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Conclusion**: readiness 18개와 credential 점검 JSON 2개를 파일별 판정해 중간 readiness 17개는 삭제, 최종 readiness 1개와 점검 JSON 2개는 보존으로 확정했다.
- **Status**: done

#### Task 4.5 — 승인된 JSON 정리 결정 적용

- **Task-ID**: 4.5
- **Dependency**: Task 4.4와 사용자 승인
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 파일별 승인 결과와 정확히 일치하는 JSON 정리만 적용한다.
- **Verify**: `git status --short`
- **Conclusion**: 삭제 판정 17개는 제거됐고 보존 판정 3개와 역사적 `closeout-summary.json`은 그대로 남아 있다.
- **Status**: done

### Phase 5 — 최종 교차검증과 인계

#### Task 5.1 — 두 worktree 최종 상태 기록

- **Task-ID**: 5.1
- **Dependency**: Task 4.5
- **Target**: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 기존 작업 트리와 새 worktree의 최종 상태를 소유권 구분과 함께 기록한다.
- **Verify**: `git diff --check`
- **Conclusion**: 기존 worktree의 사용자 파일은 정리 전 바이트 동일성을 확인했고 새 worktree는 검증 SHA에서 clean 상태다.
- **Status**: done

#### Task 5.2 — 프로젝트 memory 갱신

- **Task-ID**: 5.2
- **Dependency**: Task 5.1
- **Target**: `docs/memory.md`
- **Goal**: 비밀값 대응 상태와 안전한 후속 진입점을 최신 memory에 반영한다.
- **Verify**: `git diff --check -- docs/memory.md`
- **Conclusion**: `docs/memory.md`를 200줄 제한 안에서 비밀값 대응 상태·분리 worktree·후속 승인 게이트로 갱신했다.
- **Status**: done

#### Task 5.3 — A+ 계획 Closeout

- **Task-ID**: 5.3
- **Dependency**: Task 5.2
- **Target**: `docs/plans/PLAN_task_6_8_a_plus_secure_cleanup.md`
- **Goal**: 전체 Task 판정과 남은 역사 재작성 위험을 Closeout으로 확정한다.
- **Verify**: `git diff --check`
- **Conclusion**: 전체 Task와 검증을 완료했고 역사 재작성만 별도 승인 게이트로 남겼다.
- **Status**: done

## Completion Criteria

- 이전 PortOne 비밀값이 `401` 또는 `403`으로 거부된다.
- 새 PortOne 비밀값이 같은 인증 경계에서 `401`·`403` 이외 응답을 반환한다.
- 환경별 비밀값 반영 결과에는 값 자체가 포함되지 않는다.
- `C:\Develop\greenhub-verified-39fdb2c`의 HEAD가 최종 검증 SHA와 정확히 일치한다.
- 새 worktree는 `codex/task-6-8-a-plus-cleanup` branch에서 깨끗하다.
- 기존 작업 트리의 tracked 사용자 변경은 보존된다.
- 삭제 항목은 승인된 cleanup 허용 목록과 일치한다.
- 역사적 `closeout-summary.json`과 최종 Closeout 보고서가 보존된다.
- readiness·credential JSON마다 보존·삭제·별도 검토 판정이 기록된다.
- 시스템 TEMP 비민감 사본이 제거된다.
- `git diff --check`가 통과한다.
- Git 역사 재작성 여부와 소유자가 후속 게이트로 기록된다.

## Closeout Roll-up

- **Status**: `done`
- **완료 Task**: 0.1~5.3 전체
- **비밀값 상태**: 과거 노출 후보 거부 확인, 대상 환경 현재 값 인증 통과
- **검증 worktree 상태**: 고정 경로·branch 생성 완료, 최종 검증 SHA 일치, clean
- **기존 작업 트리 cleanup 상태**: 허용 목록 22개와 TEMP 사본 제거, 사용자 변경과 보존 증거 유지
- **역사 재작성 상태**: 미실행, 저장소 관리자와 영향 branch 소유자의 별도 승인 대기

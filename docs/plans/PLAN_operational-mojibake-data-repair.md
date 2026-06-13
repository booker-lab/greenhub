<!-- Language: ko -->

# Project Blueprint: 운영 mojibake 데이터 보정

## 문서 메타
- **Linear-Issue**: N/A
- **Priority**: 1
- **Labels**: ops, data-repair
- **Architectural Goal**: 운영 Firestore 원본에 저장된 깨진 표시명 3건을 코드 변경 없이 최소 필드 쓰기로 보정한다.

## 업무 요약
### 개요
육안검증에서 코드 렌더링 문제가 아니라 운영 Firestore 원본 `name` 값 자체가 깨진 2건이 확인됐고, 같은 테스트 스토어에 연결된 seller 사용자명 1건도 추가로 확인됐다. 자동 복원은 하지 않고, 테스트/e2e 용도를 드러내는 값으로 allowlist된 문서의 `name` 필드만 수정한다.

### 생산자 확인 기준
- `stores/9b2cb652-ff77-46b9-a773-e1efa78fb763.name`
- `users/69dcfab6-4dca-43c0-952d-908001257168.name`
- `users/424b9334-cc05-41b0-a451-840e88733446.name`
- 정상값은 테스트/e2e 계정임을 드러내는 명칭으로 한정한다.

## Diagnosis & Findings
- **현상**: `/admin/stores`, `/admin/users`에서 특정 행만 깨진 문자열로 표시된다.
- **근본 원인**: 화면 인코딩이나 Firestore 저장 방식 문제가 아니라 해당 문서의 `name` 원본 값 자체가 이미 깨진 상태다.

## Architectural Deepening
- **Seam**: 운영 데이터 보정은 앱 코드와 분리된 `scripts/ops` 단발성 스크립트에서 수행한다.
- **Leverage**: 기본 `dry-run`, hardcoded allowlist, `--apply` 필수 조건으로 운영 쓰기 범위를 제한한다.

## Agent Completion Contract
Task 완료 시 Verify -> 결과 기록 -> 관련 문서 갱신 순서로 종료한다.

> **에이전트 스코프**: 스크립트 준비, dry-run 조회, 정상값 확정 후 allowlist 3건 적용과 재조회 검증까지 수행한다.

## Execution Plan

#### Task 1.1: 보정 스크립트 추가 [Unit: Atomic]
- **Task-ID**: 1.1
- **Pre-read**: `docs/specs/frontend/visual-verify-fix-backlog.md`, `scripts/peek-store.mjs`
- **Target**: `scripts/ops/repair-mojibake-data.mjs`
- **Goal**: allowlist된 운영 문서 3건의 현재 값을 조회하고, 정상값이 주어진 경우에만 `name` 필드를 보정한다.
- **Verify**: `node scripts/ops/repair-mojibake-data.mjs --dry-run`
- **Conclusion**: [완료] 스크립트를 추가했고 dry-run에서 대상 3문서 존재와 `name` 깨짐 의심을 확인했다. 정상값 확정 후 `--apply`로 3건을 보정하고 재조회에서 깨짐 의심 `아니오`를 확인했다.
- **Status**: done

#### Task 1.2: 보수 백로그와 메모리 최신화 [Unit: Atomic]
- **Task-ID**: 1.2
- **Pre-read**: `docs/specs/frontend/visual-verify-fix-backlog.md`, `docs/memory.md`
- **Target**: `docs/memory.md`
- **Goal**: 실제 쓰기 전 단계와 남은 승인 조건을 세션 메모에 남긴다.
- **Verify**: `(Get-Content docs/memory.md | Measure-Object -Line).Lines`
- **Conclusion**: [완료] 실제 적용 결과와 `VF-008`, `VF-011` 종결 내용을 문서에 남겼고 200라인 이하를 유지했다.
- **Status**: done

## Completion Checklist
- [x] 수정 파일 500라인 이하 확인
- [x] `docs/memory.md` 200라인 이하 확인
- [x] dry-run 조회 완료
- [x] 실제 운영 쓰기 전 정상값 3개 확인
- [x] 운영 보정 적용 후 재조회 완료

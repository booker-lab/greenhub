# Greenhub 작업 규칙

## 0. Git-native 실행 Kernel

Greenhub 개발의 기본 실행 모델은 별도 coordination control plane이 아니라 **현재 repository authority + bounded semantic task + Git-native publication**이다. 이 문서는 compact executor kernel만 소유하고, 상세 실행 규칙은 `docs/specs/ops/development-authority.md`가 소유한다.

Canonical invariants:

1. **Current truth first**  
   현재 repository/runtime의 직접 증거를 우선한다. 과거 branch, worktree, exact SHA, launcher, task state, report는 필요성을 다시 입증하지 않는 한 다음 실행의 권위가 아니다.

2. **Bounded semantic ownership**  
   하나의 mutating task는 하나의 independently closable semantic outcome을 소유한다. 다른 semantic boundary가 필요해져도 조용히 소유 범위를 넓히지 않고 dependency로 드러낸다.

3. **Git movement is not invalidation**  
   semantic freshness, proof freshness, publication freshness를 구분한다. Git revision movement만으로 완료된 구현이나 유효한 proof를 무효화하지 않는다. 영향을 받은 dimension만 다시 판정한다.

4. **Nearest faithful proof, then scoped fail-closed**  
   criterion을 실제로 falsify/confirm할 수 있는 가장 가까운 충실한 evidence부터 실행한다. 불확실하면 전체 task가 아니라 실제로 위험한 transition만 fail closed한다.

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

## 1. 우선순위와 범위

- 상위 지침, 사용자 요청, 현재 Task의 범위와 제외 범위를 우선한다.
- 요청받지 않은 리팩터링, 정리, 문서 갱신을 함께 수행하지 않는다.
- 하위 `AGENTS.md`는 해당 디렉터리에서 이 규칙을 보충한다.
- 관찰이나 부수적 finding은 자동으로 새 작업을 만들지 않는다. 현재 evidence가 실제 변경 필요성을 보여줄 때만 별도 bounded task로 다룬다.

## 2. 최소 Context 로딩

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

## 3. 승인 경계

- 외부 서비스, 운영 환경, 배포, 환경 변수, 비밀값, 운영 데이터, 마이그레이션, 알림 발송은 명시적 승인 없이 변경하지 않는다.
- `commit`, `push`, PR 생성·수정·병합, GitHub 설정 변경은 현재 사용자 요청의 bounded intent 안에서만 수행한다.
- 삭제, 대량 이동, 이력 변경 등 복구가 어려운 작업은 정확한 대상과 소유권을 확인한다.
- blocker나 proof 부족은 더 넓은 외부 mutation 권한을 자동으로 만들지 않는다.

## 4. 문서 정합성 감사

- 문서끼리 표현을 맞추는 것보다 현재 사실·의도된 계약·검증된 보장의 일치를 우선한다.
- 실제 동작은 코드·설정, 검증된 보장은 테스트, 의도된 계약은 current spec으로 구분한다.
- historical 문서의 과거 TODO·실행 지시를 현재 작업으로 자동 승계하지 않는다.
- current 상태는 사실 소유 문서에만 유지하고 다른 문서에는 역할상 필요한 최소 요약만 둔다.
- 세부 판정·분류는 `docs/DOCUMENT_CONSISTENCY.md`를 따른다.

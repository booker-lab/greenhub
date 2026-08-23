# Greenhub 문서 라우팅

> 현재 계약 문서와 완료된 계획·보고서·실험 기록을 함께 보존한다. 파일이 존재한다는 이유만으로 현재 작업 지시로 해석하지 않는다.

## 현재 판단에 사용하는 문서

1. `docs/memory.md` — 현재 Git/제품/외부 차단 상태
2. `docs/PROJECT_MAP.md` — 코드·문서 Context 라우터
3. `docs/BACKLOG.md` — 현재 미완료·향후 작업
4. `docs/memory.md`가 지정한 활성 HANDOFF·PLAN — 현재 실행 순서와 승인 게이트
5. 직접 관련 current spec — 동작 계약
6. `docs/CRITICAL_LOGIC.md` — 설계 결정 이력
7. `docs/TROUBLESHOOTING.md` — 장애 해결 이력

## Spec 하위 라우터

한 디렉터리에 current 문서와 과거 계획이 섞여 있으면 먼저 해당 README를 확인한다.

- API: `docs/specs/api/README.md`
- Frontend: `docs/specs/frontend/README.md`
- Ops: `docs/specs/ops/README.md`
- Legal: `docs/specs/legal/README.md`
- Security: `docs/security/README.md`
- Design history: `docs/design/README.md`
- Performance evidence: `docs/performance/README.md`
- Plans: `docs/plans/README.md`

회차 직배송의 통합 동작 계약은 `docs/specs/mvp-sales-round-direct-delivery.md`를 사용한다.

## 현재 출시에서 특별히 주의할 계약

현재 production `/privacy`, `/terms`는 비판매 상태를 전제로 한다. 회차 직배송 실제 판매 공개 전에는 `docs/specs/legal/README.md`의 판매 활성화 재정합화 게이트를 수행한다.

현재 외부 차단점과 정확한 실행 순서는 `docs/memory.md`와 활성 HANDOFF·PLAN이 정본이다.

## 역사 자료로 보는 문서

`docs/memory.md` 또는 `docs/BACKLOG.md`에서 다시 활성화하지 않는 한 다음은 기본적으로 역사 자료다.

- 완료된 `PLAN_*`, `REPORT_*`, `PROMPT_*`
- `docs/archive/**`
- `docs/discussions/**`
- 구현 전에 작성된 `*-plan.md`, `*-roadmap.md`, `*-sdd.md`
- 특정 과거 SHA·PR·workflow run·세션 기준 체크리스트와 검증 기록
- 과거 외부 심사·배포·장애 snapshot

역사 문서 안의 `TODO`, `다음 단계`, `대기`, `미구현`, `실행 필요`를 현재 작업으로 자동 승계하지 않는다.

## 충돌 판정

- 코드 동작 계약: 현재 `main` 코드·설정·테스트 → current spec → 역사 문서
- 진행 상태: 직접 재검증 → `docs/memory.md` → 활성 HANDOFF·PLAN → Backlog → 역사 문서
- 외부 환경: provider/배포 플랫폼 현재 상태를 다시 확인하고 과거 snapshot을 현재값으로 사용하지 않는다.

## 승인 경계

문서의 명령은 실행 승인이 아니다. 다음은 별도 승인 없이 실행하지 않는다.

- production 배포·롤백
- 운영 환경변수·secret·Firebase 데이터 변경
- 운영 회차·주문·판매 모드 변경
- 실제 결제·환불
- 실제 알림톡·SMS 발송 또는 provider 설정 변경
- 파괴적 seed/cleanup/migration

## 보안·개인정보 문서 원칙

- 계정 비밀번호·session·bypass secret·service account 원문을 문서에 기록하지 않는다.
- 운영 DB를 visual/E2E fixture 저장소로 사용하는 과거 절차를 현재 지시로 재사용하지 않는다.
- 고객명·전체 전화번호·전체 주소·배송 사진 원본을 검증 문서에 복사하지 않는다.
- 과거 Git history의 테스트 자격정보가 현재 유효하다고 가정하지 않는다.

## 유지관리 원칙

- 현재 상태는 `docs/memory.md`에 최소한으로 유지한다.
- 공개 사업자 정보·URL·환경값은 가능한 한 코드/전용 정본을 참조하고 여러 문서에 원문 복제하지 않는다.
- 완료 이력은 역사 문서로 보존하되 현재 지시와 분리한다.
- 큰 과거 계획을 억지로 현재화하기보다 짧은 current contract/router를 유지한다.

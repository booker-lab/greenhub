# Deployment Safety Guards — 2026-08-23

> 상태: `partially_resolved_admin_gate`
>
> 목적: `main` 통합과 production 배포를 분리하고, 문서 변경이 production/Preview/E2E를 불필요하게 움직이지 않도록 한다.

## 현재 판정

### 완료

- PR #30으로 consumer·seller·driver의 `main` Git 자동 Vercel deployment를 차단했다.
- PR #30 merge SHA `a83fa20516ed6209a4705020cc92154f39e383ca` 이후 세 Vercel 프로젝트에서 새 deployment가 0건임을 직접 확인했다.
- `.github/workflows/sync-preview.yml`은 `docs/**`와 `**/*.md`만 바뀐 `main` push를 제외한다.
- `AGENTS.md`는 문서-only 변경을 포함해 `main` 직접 commit/push를 금지하고 PR 통합을 요구한다.
- `.github/workflows/deployment-safety.yml`과 `scripts/verify-deployment-safety.mjs`가 배포 안전 invariant를 검증한다.
- PR #31로 세 앱에 docs-only `ignoreCommand`를 추가해 순수 문서/Markdown 변경의 Vercel Preview build를 skip하도록 구성했다.
- PR #30·#31의 deployment safety CI는 모두 성공했다.
- pure-docs branch `docs/deployment-safety-closeout`의 commit `ebf44c104b2e8758733fd14501fd0e820d575ae4` 이후 consumer·seller·driver 세 Vercel 프로젝트 신규 deployment가 0건임을 확인해 feature-branch docs-only skip을 실증했다.

### 남은 P0 관리자 게이트

- GitHub `main`은 2026-08-23 재조회 기준 여전히 `protected=false`다.
- 연결된 GitHub 도구에는 branch protection/ruleset mutation이 노출되지 않는다.
- 관리자 설정 작업은 Issue #32 `P0: main branch protection / ruleset 활성화`로 추적한다.

Issue #32 완료 조건:

1. `main`에 PR required.
2. `Deployment safety guard / verify`를 required status check로 지정.
3. force push 차단.
4. branch deletion 차단.
5. 현재 1인 저장소에서는 self-deadlock을 피하도록 required approval 0으로 시작하고, 협업자가 생기면 1 이상으로 상향.
6. 재조회에서 `protected=true` 또는 동등한 ruleset enforcement 확인.

## 현재 배포 계약

`main` merge 자체는 production 배포 승인이 아니다.

production은 다음 조건을 모두 충족한 뒤에만 실행한다.

1. 판매 활성화 법적 문서까지 포함한 release SHA 확정.
2. 해당 exact SHA의 회차 원격 E2E 52건 + fixture cleanup 성공.
3. 운영 Firebase·ALIGO 선행 게이트 통과.
4. Issue #32의 `main` 보호 완료.
5. 사용자의 별도 `Task 3.1 승인`.
6. 배포 직전/직후 deployment metadata의 Git SHA가 승인된 release SHA와 정확히 일치함을 확인.

현재 저장소에는 production 전용 자동 workflow가 없다. 따라서 향후 Task 3.1에서는 **이미 검증된 exact SHA/artifact를 명시적으로 production에 deploy 또는 promote하는 절차**를 먼저 확정하고, 단순히 `main`을 다시 push하거나 빈 commit으로 배포를 유도하지 않는다.

## docs-only 변경 계약

- feature branch의 변경 파일이 모두 `docs/**` 또는 `*.md`이면 세 Vercel 프로젝트의 `ignoreCommand`가 build를 skip한다.
- feature-branch pure-docs 검증은 완료됐다: `ebf44c1...` 이후 세 프로젝트 신규 deployment 0건.
- `main`에 docs-only PR이 merge돼도 Vercel production Git deploy는 `git.deploymentEnabled.main=false` 때문에 생성되면 안 된다.
- 같은 docs-only merge는 `sync-preview.yml`의 `paths-ignore` 때문에 `preview` branch 동기화와 일반 E2E dispatch를 만들면 안 된다.
- 이 closeout PR merge 뒤 세 Vercel 프로젝트 deployment 0건과 `preview` branch SHA 불변을 다시 확인해 main-side 검증을 마무리한다.

## 회귀 방지

다음 중 하나라도 깨지면 deployment safety regression으로 P0 처리한다.

- 세 앱 중 하나의 `git.deploymentEnabled.main !== false`
- docs-only `ignoreCommand` 제거/변경
- `sync-preview.yml`의 docs ignore 제거
- `AGENTS.md`의 no-direct-main 규칙 제거
- safety CI 제거 또는 실패를 무시하고 merge
- exact release SHA 검증 없이 production 배포

## 승인 기록

- 사용자 승인: `배포 안전장치 변경 승인`
- repo-side guard: PR #30, PR #31
- pure-docs branch skip 검증: `ebf44c104b2e8758733fd14501fd0e820d575ae4`
- 관리자 잔여 작업: Issue #32

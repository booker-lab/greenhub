# Greenhub 툴체인 현행 계약

> **상태**: Current
> **최종 정합화**: 2026-08-23 KST
> **정본**: 루트/각 package의 `package.json`, `biome.json`, `Justfile`

## 1. 현재 구성

| 영역 | 현재 도구 | 비고 |
|---|---|---|
| package manager | pnpm 10.x | workspace monorepo |
| Node | >=20 | CI/workflow는 필요 시 별도 버전 고정 |
| frontend/shared formatting·lint | Biome 2.x | 루트 `biome.json` |
| API formatting | Biome | `apps/api` format script |
| API lint | ESLint | 현재 `--fix` 포함 |
| API test | Jest | unit/service test |
| E2E | Playwright | `apps/e2e` |
| Rules test | Node test + Firebase rules testing | Firestore/Storage 별도 |
| load test | k6 | `tests/load`, `scripts/load` |
| task runner | Just | 루트 `Justfile` |
| secret scan | TruffleHog CLI recipe | `just secret-scan`; 로컬/CI 설치 여부는 실행 시 확인 |

## 2. Biome

루트 `biome.json`이 공통 formatter/linter 설정이다.

현재 주요 계약:

- 2-space indent
- line width 100
- single quote
- trailing comma `all`
- semicolon 사용
- `noExplicitAny` 비활성
- `noArrayIndexKey`, `noNonNullAssertion`, `noImgElement` 경고
- `node_modules`, `.next`, `dist`, tsbuildinfo, 생성된 PWA service worker 파일 제외

Biome 버전·schema는 문서에 별도 고정하지 않고 현재 `package.json`과 `biome.json`을 정본으로 본다.

## 3. API lint의 중요한 예외

`apps/api/package.json`의 현재 lint script는 다음 의미다.

```text
eslint "{src,apps,libs,test}/**/*.ts" --fix
```

즉 `pnpm --filter api lint`, 루트 `pnpm lint`, `just lint`는 **read-only 명령이 아니다**. lint fix가 파일을 변경할 수 있다.

따라서 코드 수정이 금지된 감사에서 lint 결과만 확인하려고 이 명령을 실행하지 않는다. 읽기 전용 lint가 필요하면 별도 `lint:check` 계약을 추가하는 Task를 먼저 설계하거나, 현재 ESLint 설정을 기준으로 `--fix` 없는 명령을 명시적으로 사용한다.

이 부채는 `docs/BACKLOG.md`의 API lint baseline 후속 항목으로 관리한다.

## 4. Justfile

현재 `Justfile`은 다음 대표 recipe를 제공한다.

- `dev-consumer`
- `dev-api`
- `build`, `build-api`
- `lint`
- `format`, `format-check`
- `typecheck`
- `test-ds`, `test-e2e`
- `secret-scan`
- `ci`

주의:

- `just lint`는 API lint를 포함하므로 수정형이다.
- `just format`은 명시적으로 파일을 수정한다.
- `just ci`가 저장소의 모든 출시 검증을 의미하지 않는다. 회차 직배송 원격 E2E, Firebase Rules, 배포 게이트 등은 현재 Task의 별도 계약을 따른다.
- recipe가 존재한다고 해서 필요한 외부 CLI(`just`, `trufflehog`, `k6`)가 모든 환경에 설치됐다고 가정하지 않는다.

## 5. 루트 package scripts

대표 스크립트:

```text
pnpm build
pnpm lint
pnpm typecheck
pnpm test:firestore-rules
pnpm test:storage-rules
pnpm test:e2e
pnpm load:smoke
pnpm load:readiness
```

실행 전에 대상 package script와 현재 Task의 변경 허용 범위를 다시 확인한다.

### `pnpm typecheck` 주의

루트 `pnpm -r typecheck`는 **typecheck script가 정의된 workspace package만** 실행한다. 모든 앱을 반드시 검사한다고 해석하지 않는다.

### build/test 산출물

build, test, formatter가 생성한 파일은 의도한 소스 변경과 분리해 확인한다. read-only 감사에서 작업 트리가 바뀌면 원인을 먼저 식별하고 임의로 commit하지 않는다.

## 6. E2E

일반 E2E와 회차 출시 E2E를 구분한다.

- 일반: `pnpm test:e2e`
- 회차 직배송 지정 SHA 원격 검증: `.github/workflows/e2e-round-direct.yml`

회차 출시 게이트는 `docs/specs/ops/mvp-sales-round-e2e-environment.md`를 따른다. 일반 E2E 성공을 회차 52건 성공으로 대체하지 않는다.

## 7. k6

k6는 API 성능/제한 검증용이며 실제 OAuth·결제·알림 provider에 반복 부하를 만들지 않는다.

현재 부하테스트 재개 조건은 `docs/BACKLOG.md`의 `LOAD-TEST-FORMAL`과 `docs/specs/ops/k6-load-test-plan.md`를 따른다. production 쓰기 부하는 기본 금지한다.

## 8. Secret scan

`Justfile`의 `secret-scan`은 TruffleHog git scan을 실행하도록 정의돼 있다.

- 결과에 secret 원문을 문서/채팅/이슈에 복사하지 않는다.
- verified 결과가 발견되면 먼저 노출 범위와 폐기/회전 필요성을 판단한다.
- secret 회전·provider 변경은 별도 운영 승인 대상이다.

## 9. 과거 도입 계획

이 문서의 2026-05 Git history에는 Biome/Just/TruffleHog를 도입하기 전 단계별 계획과 당시의 ESLint/Prettier 비교가 남아 있다. 현재 실행 절차가 필요하면 그 과거 TODO가 아니라 현재 설정 파일과 이 문서를 사용한다.

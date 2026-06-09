# 핸드오프 프롬프트 2번: 개발·릴리즈 트레인 가지

> 작성: 2026-06-06
>
> 목적: 핸드오프 번호가 1번의 다음 순서처럼 해석되는 문제를 막고, 2번을 **별도 개발·릴리즈 트레인 가지**로 고정한다.

## 분기 정체성

**프롬프트 2번은 육안검증 잔여를 닫는 흐름이 아니다.**

이 가지는 누적 변경을 SDD 경계에 맞춰 작은 릴리즈 웨이브로 분리하고, 각 웨이브마다 `commit -> push -> Vercel Preview -> 검증`을 반복하는 흐름이다.

## 읽어야 할 문서

1. `docs/specs/ops/staged-preview-release-pipeline.md`
2. `docs/specs/frontend/preview-visual-verify-policy.md`
3. `docs/memory.md`
4. 각 웨이브가 건드리는 도메인별 SDD 문서

## 현재 진행 상태

| 웨이브 | 상태 | 기준 |
|---|---|---|
| `shared-contracts` | 완료 | 커밋 `3b37f0d` |
| `api-backend` | 완료 | 커밋 `34a8451` |
| `consumer-web` | 완료 | 커밋 `c54c3cf` |
| `seller-admin` | 완료 | 커밋 `ccec39e` |
| `driver-web` | 완료 | 커밋 `f53d844` |
| `e2e-ops` | 완료 | 커밋 `d3ccc2b` |
| `consumer-web` 후속 보정 | 완료 | 커밋 `32d8aef` |

## 첫 진입점

**2026-06-06 기준 프롬프트 2번 개발·릴리즈 트레인은 완료됐다.**

1. `pnpm release:plan`으로 현재 미커밋 파일 분류를 확인한다.
2. `pnpm release:stage -- <wave>`로 한 번에 하나의 웨이브만 stage한다.
3. `git diff --cached --name-status`로 다른 가지 파일이 섞이지 않았는지 확인한다.
4. 해당 웨이브에 맞는 타입체크·테스트·Biome·Playwright 검증을 실행한다.
5. 커밋·push 후 Vercel Preview 상태와 접근 결과를 기록한다.

## 금지

- 2번에서 `pending-visual-verify.md` 잔여 번호를 닫는 일을 주목적으로 삼지 않는다.
- 1번의 보류 항목을 해소하려고 운영 쓰기 버튼을 누르지 않는다.
- `release:stage` 범위 밖 파일을 함께 stage하지 않는다.

## 다음 사람에게 줄 문장

**"2번은 개발·릴리즈 트레인 가지다. 2026-06-06 기준 기존 웨이브는 완료됐고, 새 변경은 `release:plan`으로 다시 분류한다."**

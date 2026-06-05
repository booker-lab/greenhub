# 단계별 Preview 릴리즈 파이프라인

> 작성일: 2026-06-05
>
> 목적: 로컬 dev 서버에 의존하지 않고, 누적된 미푸시 작업을 작은 웨이브로 나누어 `commit -> push -> Vercel Preview -> 육안검증` 순서로 반복한다.

## 원칙

1. 한 웨이브는 하나의 검증 가능한 책임만 가진다.
2. 각 웨이브는 별도 커밋으로 push하고, Vercel Preview가 `READY`가 된 뒤에 다음 웨이브로 넘어간다.
3. Preview에서 실패하면 다음 웨이브를 진행하지 않고, 같은 웨이브 안에서 수정 커밋을 추가한다.
4. `.codex/`, `.vercel/`, `node_modules/`, 인증 상태 파일, 로컬 env 파일은 항상 제외한다.
5. 운영 데이터 상태를 바꾸는 버튼은 사용자 승인 없이 Preview에서 클릭하지 않는다.

## 웨이브 순서

| 순서 | 웨이브 | 포함 범위 | 기본 검증 |
|---:|---|---|---|
| 1 | `docs-policy` | 릴리즈 정책, 결정 로그, memory, 백로그 | `git diff --check`, 라인 가드 |
| 2 | `shared-contracts` | `packages/shared`, 공용 타입, Firestore index | shared build, 영향 앱 typecheck |
| 3 | `api-backend` | `apps/api`, API spec, 데이터 seed/ops 스크립트 | API 단위 테스트, API build |
| 4 | `consumer-web` | `apps/consumer`, consumer E2E/spec | consumer typecheck/build, Preview 육안검증 |
| 5 | `seller-admin` | `apps/seller`, seller/admin E2E/spec | seller typecheck/build, Preview 육안검증 |
| 6 | `driver-web` | `apps/driver`, driver spec | driver typecheck/build, Preview 육안검증 |
| 7 | `e2e-ops` | 공통 E2E, Playwright fixture, 검증 문서 | GitHub Actions E2E, Preview 회귀 확인 |

## 반복 절차

1. `pnpm release:plan`으로 현재 변경 파일의 웨이브 분류를 확인한다.
2. `pnpm release:stage -- <wave>`로 해당 웨이브 파일만 stage한다.
3. `git diff --cached --name-status`로 의도한 파일만 들어갔는지 확인한다.
4. 웨이브별 기본 검증을 실행한다.
5. `git commit -m "<wave>: <요약>"`으로 커밋한다.
6. `git push origin <branch>`로 push한다.
7. Vercel Preview 배포가 `READY`인지 확인한다.
8. Browser 또는 Playwright로 Preview URL을 육안검증한다.
9. 검증 결과와 Preview URL, 커밋 SHA를 `docs/memory.md` 또는 해당 handoff 문서에 기록한다.
10. 통과한 뒤 다음 웨이브로 이동한다.

## Preview 확인 기준

- consumer: 주문 상세, 마이페이지, 상품/상점 화면을 우선 확인한다.
- seller: 관리자 주문, 정산, 상점, 초대, 배너 화면을 우선 확인한다.
- driver: 로그인, 보드, 지도, 프로필 화면을 우선 확인한다.
- API-only 웨이브도 consumer/seller Preview가 정상 로드되는지 최소 스모크 확인한다.

## 중단 조건

- Vercel build 실패
- GitHub Actions E2E 실패
- Preview에서 주요 화면 로드 실패
- 라인 가드 위반
- `docs/memory.md` 200라인 초과
- stage 범위에 사용자 미승인 파일이 포함됨

## 재개 규칙

실패 웨이브는 새 웨이브로 넘기지 않는다. 같은 웨이브에서 수정 커밋을 추가하고, Preview가 다시 `READY`가 된 뒤 동일 검증을 반복한다.

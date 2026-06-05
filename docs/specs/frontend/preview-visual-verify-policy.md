# Preview Visual Verify Policy

> 작성일: 2026-06-05
>
> 목적: 로컬 dev 서버의 포트, 인증, 컴파일 지연에 막히지 않도록 육안검증의 기본 축을 GitHub push 이후 Vercel Preview URL로 고정한다.

## 원칙

1. 육안검증은 기본적으로 로컬 `localhost`가 아니라 배포된 Vercel Preview URL에서 수행한다.
2. 작업 묶음이 커질수록 먼저 GitHub 브랜치에 커밋·푸시하고, Vercel이 생성한 최신 Preview 배포를 기준 URL로 삼는다.
3. 로컬 dev 서버는 빠른 개발 확인용 보조 수단으로만 사용한다. 인증, 포트, `next dev` 컴파일 문제가 발생하면 즉시 Preview 검증으로 전환한다.
4. 운영 데이터 상태를 바꾸는 버튼은 Preview에서도 사용자 승인 없이 실행하지 않는다. 읽기 전용 검증, fixture 검증, 상태 변경 없는 UI 확인을 우선한다.
5. 검증 결과는 원본 SSOT 항목에 `[x]`, `[ ]`, `[-]`로 남기고, 사용한 Preview URL과 커밋 SHA를 메모에 기록한다.

## 표준 절차

1. 변경 범위를 확인한다.
   - `git status -sb`
   - 작업트리가 섞여 있으면 커밋에 포함할 파일을 먼저 확정한다.
2. 검증 가능한 최소 체크를 수행한다.
   - 수정 앱의 `tsc --noEmit`
   - 변경 파일 Biome
   - 필요 시 관련 단위 테스트 또는 E2E fixture
   - `git diff --check`
3. 의도한 파일만 stage 후 커밋한다.
4. 현재 브랜치를 원격에 push한다.
5. Vercel Preview 배포가 `READY`가 될 때까지 기다린다.
6. Preview URL을 기준으로 Browser 또는 Playwright 검증을 수행한다.
7. 결과 문서와 `docs/memory.md`를 갱신한다.

## 앱별 Preview 기준

| 앱 | Vercel 프로젝트 | 검증 기준 |
|---|---|---|
| consumer | `greenhubconsumer` | 소비자 홈, 마이페이지, 주문 상세, 상품·상점 화면 |
| seller | `greenhub-seller` | 판매자·관리자 콘솔, 주문·정산·초대·배너 화면 |
| driver | `greenhub-driver` | 드라이버 로그인, 보드, 지도, 프로필 화면 |

## 보류 처리

- Preview 배포가 실패하면 Vercel build log를 먼저 확인한다.
- Preview는 `READY`지만 인증 세션이 없으면 Vercel 보호 우회 URL 또는 기존 E2E 인증 state를 사용한다.
- Preview에서도 데이터 조건이 없으면 항목을 `[ ]`로 유지하고 필요한 데이터 조건을 메모한다.
- 로컬에서만 실패하고 Preview에서 통과하면 Preview 결과를 우선한다.

## 이번 전환의 배경

2026-06-05 consumer 주문 상세 `#147` 재검증 중 로컬 dev 서버가 `/e2e/order-cancel-status` 컴파일에서 멈췄다. 이후 동일 유형의 육안검증은 로컬 dev 서버를 기본 축으로 삼지 않고, push된 Preview 배포에서 확인한다.

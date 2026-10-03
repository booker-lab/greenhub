# 화면 확인 하네스 (visual)

배포·Vercel 미리보기·카카오 로그인 없이, 작업 직후 화면을 가짜 데이터로 띄워 PC나 휴대폰에서 보는 도구다.
실제 API·Firebase emulator를 쓰는 통합 실행은 `scripts/dev/local`(`pnpm dev:local`)이 맡고, 여기서는 화면만 본다.

## 실행

```bash
node scripts/visual/start.mjs                    # 셀러(어드민 포함) → http://127.0.0.1:3202/login
node scripts/visual/start.mjs consumer           # 소비자 → http://127.0.0.1:3201/
node scripts/visual/start.mjs consumer --phone   # Tailscale 주소에 바인딩 → 휴대폰에서 http://<Tailscale IP>:3201/
```

포트는 `apps.mjs`가 정한다. `dev:local`(3000~3003)과 로컬 E2E(127.0.0.x:3101~3103)를 피해 3200번대를 쓰고,
가짜 API도 앱마다 따로 둬서(4201·4202) 두 앱을 동시에 띄울 수 있다.

- 셀러: 로그인 화면에서 아무 이메일·비밀번호나 넣으면 겸직(어드민+셀러) 가짜 계정으로 들어간다.
- 소비자: 소비자 앱은 E2E 헤더 게이트(`x-e2e-test-token`)가 있어 브라우저에서는 공개 화면만 볼 수 있다.
  - 자동 캡처(`shots.mjs`)는 실행기가 만든 1회용 값(`runtime.json`)으로 로그인한다.
  - 하네스는 `E2E_TEST=true`로 띄우므로 로그인 화면에 운영에 없는 이메일 입력칸이 함께 보인다.
- 종료는 Ctrl+C.
- 기록은 `%TEMP%\greenhub-visual\<app>\`에 남는다.
  - `mock-api.log`: 요청 기록. `kind: "missing"`이면 fixture에 없는 경로다.
  - `next-dev.log`: next dev 출력.
  - `node-guard.log`: 차단된 외부 요청.

## 자동 캡처와 확인판

서버를 띄운 채로 다른 터미널에서 실행한다.

```bash
node scripts/visual/shots.mjs seller --label after                  # fixtures의 screens를 폰(390)·PC(1280)로 촬영
node scripts/visual/report.mjs seller --after after --out <폴더>     # 폰에서 볼 확인판 HTML 생성
node scripts/visual/report.mjs seller --after after --before before --out <폴더>  # 작업 전·후 비교
node scripts/visual/report.mjs consumer@after,seller@baseline --after after --before baseline --out <폴더>  # 앱마다 다른 캡처
```

- 캡처는 `%TEMP%\greenhub-visual\<app>\shots\<label>\`에 PNG와 `manifest.json`으로 남는다.
  - `manifest.json`에는 화면별 최종 주소, 콘솔 오류, fixture가 없는 API 경로가 함께 기록된다.
- 작업 전 화면은 main worktree에서 같은 명령을 `--label before`로 찍는다.
- Claude가 `<폴더>`를 claude.ai 아티팩트로 게시한다(`db` 기능 사용).
  - 사람이 화면마다 괜찮음/고칠 것과 메모를 남긴다.
  - 판정은 `verdicts` 컬렉션(문서 id `<label>__<screen id>`)에 저장되고, Claude가 읽어 다음 수정을 정한다.

## 구성

| 파일 | 역할 |
|---|---|
| `start.mjs` | 가짜 API와 next dev를 함께 띄우는 실행기 |
| `mock-api.mjs` | 가짜 API 서버. 쓰기 요청은 기록만 하고 `200 {}`을 돌려준다 |
| `fixtures/<app>.mjs` | 앱별 가짜 사용자, 조회 경로 표, 캡처 화면 목록 |
| `node-guard.cjs` | next dev 프로세스의 외부 연결 차단 |
| `apps.mjs` | 앱별 포트 등 공통 설정 |
| `shots.mjs` | 화면 자동 캡처(Playwright, `apps/e2e`의 설치본 사용) |
| `report.mjs` · `report-template.html` | 캡처 결과로 확인판 HTML 생성 |

## 안전장치

- 앱 `.env*` 파일의 키를 전부 빈 값으로 덮는다. 운영 API·Firebase·비밀값이 next dev에 들어가지 않는다.
- next dev의 외부 연결을 막는다. 허용하는 곳은 루프백, 바인딩 주소, Google Fonts뿐이다.
- `--phone`은 Tailscale 주소에만 바인딩한다. 같은 tailnet 기기만 접속할 수 있다.

## 한계

- Firebase 로그인은 시작하지 않는다(`/auth/firebase-token` → 503). 그래서 개발 표시에 `Issue 1`이 뜨지만 화면에는 영향이 없다. 자동 캡처에서는 개발 표시를 숨긴다.
- 셀러 상품·준비 화면은 Firestore를 직접 읽으므로 빈 상태로 보인다.
- 소비자 장바구니·결제는 브라우저 저장소 값이 필요하다. 화면 목록에 `storage: true`를 주면 fixture의 `browserStorage`를 넣고 연다.
  - 결제하기 버튼(카카오페이)과 우편번호 검색은 외부 스크립트라 동작하지 않는다.
- fixture에 없는 조회 경로는 404를 돌려준다. 새 화면을 볼 때는 `fixtures/<app>.mjs`에 경로를 더한다.
- 실제 카카오 로그인과 운영 데이터 확인은 대신하지 못한다.

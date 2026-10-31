# 화면 확인 하네스 (visual)

배포·Vercel 미리보기·카카오 로그인 없이, 작업 직후 화면을 가짜 데이터로 띄워 PC나 휴대폰에서 보는 도구다.
실제 API·Firebase emulator를 쓰는 통합 실행은 `scripts/dev/local`(`pnpm dev:local`)이 맡고, 여기서는 화면만 본다.

## 실행

```bash
node scripts/visual/start.mjs                    # 셀러(어드민 포함) → http://127.0.0.1:3202/login
node scripts/visual/start.mjs consumer           # 소비자 → http://127.0.0.1:3201/
node scripts/visual/start.mjs driver             # 기사 → http://127.0.0.1:3203/login
node scripts/visual/start.mjs consumer --phone   # Tailscale 주소에 바인딩 → 휴대폰에서 http://<Tailscale IP>:3201/
node scripts/visual/start.mjs seller --now 2026-10-30T00:00:00+09:00  # 기준 시각을 정해 띄운다(아래 "기준 시각")
node scripts/visual/start.mjs driver --prod      # 운영 빌드(next build && next start)로 띄운다(아래 "운영 빌드로 찍기")
```

포트는 `apps.mjs`가 정한다. `dev:local`(3000~3003)과 로컬 E2E(127.0.0.x:3101~3103)를 피해 3200번대를 쓰고,
가짜 API도 앱마다 따로 둬서(4201·4202·4203) 여러 앱을 동시에 띄울 수 있다.

- 셀러: 로그인 화면에서 아무 이메일·비밀번호나 넣으면 겸직(어드민+셀러) 가짜 계정으로 들어간다.
- 기사: 셀러와 같은 로컬 로그인이다. 승인된 가짜 기사 계정으로 들어가고, 배송판(준비·배송 중 탭)·주문 상세(준비 중·배송 중·배송 보류)·배송 보류 모달·배송 완료 사진 촬영(카메라 권한 없음 포함)·알림(toast)·지도·내 정보를 본다.
  - 헤드리스 브라우저에는 카메라가 없어 `카메라 촬영`을 누르면 권한 안내 화면이 된다. 실제 카메라 미리보기는 찍지 못한다.
  - 알림은 가짜 API가 상태 변경에 `200 {}`을 돌려줘 앱이 "확인 못 함" 수렴 알림을 띄우는 상태다.
  - 응답 모양은 API `DriverService.projectOrder`를 따르고, 전화번호는 실제 노출 규칙대로 단계별로만 넣었다.
  - 지도 화면의 카카오맵은 외부 스크립트라 그려지지 않는다.
- 소비자: 기능 플래그가 꺼져 404인 화면(`/guarantee`·`/partner`·`/store/[id]`·`/mypage/wishlist`·`/mypage/purchase-history`)은 `screens`에 넣지 않는다(켠 모양은 `--set benchmark`).
  - 소비자 앱은 E2E 헤더 게이트(`x-e2e-test-token`)가 있어 브라우저에서는 공개 화면만 볼 수 있다.
  - 자동 캡처(`shots.mjs`)는 실행기가 만든 1회용 값(`runtime.json`)으로 로그인한다.
  - 하네스는 `E2E_TEST=true`로 띄우므로 로그인 화면에 운영에 없는 이메일 입력칸이 함께 보인다.
- 종료는 Ctrl+C.
- 기록은 `%TEMP%\greenhub-visual\<app>\`에 남는다.
  - `mock-api.log`: 요청 기록. `kind: "missing"`이면 fixture에 없는 경로다.
  - `next-dev.log`: next dev 출력.
  - `node-guard.log`: 차단된 외부 요청.

## 셀러 상품·준비 화면(Firestore 에뮬레이터)

셀러 상품·준비 화면은 브라우저가 Firestore `products`를 직접 구독한다. 셀러 fixture에 `firestoreSeed`가 있으므로 `start.mjs seller`는 다음을 함께 한다.

1. Firebase Auth·Firestore 에뮬레이터를 띄운다(`firebase emulators:start --only auth,firestore --project greenhub-local`, 저장소 `firestore.rules` 적용).
2. `firestoreSeed`(users·stores·products)를 넣는다.
3. 앱을 로컬 Firebase 계약(project `greenhub-local`, 127.0.0.1:8080·9099)으로 띄운다.
4. 가짜 API `/auth/firebase-token`이 Auth 에뮬레이터용 커스텀 토큰(서명 없음, 클레임은 fixture `firebaseClaims`)을 돌려준다. 그러면 앱이 실제처럼 Firebase에 로그인해 구독한다.

- 필요: Firebase CLI, Java 11 이상(`dev:local`과 같다).
- 에뮬레이터 포트(8080·9099)가 `dev:local`과 같아서 둘을 동시에 띄울 수 없다. 포트가 쓰이고 있으면 시작하지 않는다.
- 에뮬레이터 주소가 127.0.0.1로 고정이라 `--phone`에서는 에뮬레이터를 쓰지 않는다(상품·준비는 빈 화면).
- 기록: `%TEMP%\greenhub-visual\seller\firebase-emulator.log`

## 운영 빌드로 찍기(`--prod`)

`next dev`로 찍은 화면은 운영 빌드와 다를 수 있다(개발 표시, 하네스 전용 로그인 입력칸 등). `--prod`는 앱 `build`와 같은 `next build --webpack` 뒤 `next start`로 띄운다. 앱 코드는 바꾸지 않는다.

- **로그인**: 운영 빌드에서는 로컬 로그인이 꺼진다(`NODE_ENV=production`, 기사·셀러 `isLocalCredentialRuntime`). 그래서 `start.mjs`가 실행마다 만든 `AUTH_SECRET`을 `runtime.json`에 남기고, `shots.mjs`가 그 값으로 Auth.js 세션 쿠키(`authjs.session-token`, 앱 `next-auth/jwt`의 `encode`)를 직접 만들어 넣는다. 토큰 모양은 세 앱 jwt 콜백이 로그인 직후 만드는 값과 같고, 앱은 이후 요청마다 가짜 API `/auth/session`으로 다시 검증한다. 로그인 화면은 운영과 같은 모양(카카오 버튼만)으로 찍힌다.
- **가짜 API 주소**: 운영 빌드는 API 주소로 HTTPS이면서 `localhost`·`127.0.0.1`이 아닌 주소만 받는다(`packages/shared/src/api-base-url.ts`). 그래서 가짜 API를 `https://127.0.0.2:<apiPort>`에도 연다(하네스 내부 조회는 그대로 `http://127.0.0.1`).
  - 인증서는 실행마다 새로 만드는 자체 서명 인증서다(`tls-cert.mjs`, node:crypto만 사용). next 서버는 `NODE_EXTRA_CA_CERTS`로, 브라우저는 그 공개키 지문만 믿는다(`--ignore-certificate-errors-spki-list`).
  - Playwright `ignoreHTTPSErrors`는 쓰지 않는다. 서비스워커(PWA)가 대신 보내는 요청에는 걸리지 않아, 서비스워커가 붙은 화면에서 주문 조회가 TLS 오류로 실패한 채 찍혔다.
  - `127.0.0.2`는 Linux·Windows에서는 바로 쓰인다. macOS는 `sudo ifconfig lo0 alias 127.0.0.2`가 필요하다.
- **서비스워커**: 운영과 같게 막지 않는다(막으면 앱의 등록 스크립트가 `navigator.serviceWorker`가 없어 오류를 낸다).
- **셀러 Firestore 화면**: 셀러 앱은 `NODE_ENV=production`에서 로컬 Firebase 런타임(에뮬레이터)을 거절한다(`apps/seller/src/lib/firebase.ts`). 그래서 `--prod`에서는 에뮬레이터를 띄우지 않고, `firestore: true` 화면(홈·준비·회차 상세·새 회차·상품 목록·회차 취소 모달)은 정상 판정에서 빠진다(문제: "Firestore 에뮬레이터 없음"). 이 화면들은 dev 촬영으로 비교한다.
- 빌드 기록은 `next-build.log`, 서버 기록은 `next-start.log`. 빌드 산출물(`.next`)과 빌드가 고치는 파일(`next-env.d.ts`·앱 `AGENTS.md`, 셀러는 저장소에 들어 있는 `public/sw.js`도 다시 만든다)은 커밋하지 않는다. 끝나면 `git checkout apps/seller/public/sw.js`로 되돌린다.
- 실측(2026-10-30, 같은 커밋 두 번): 기사 36장·소비자 66장·셀러 108장(Firestore 21장 제외) 정상 판정 통과. 비교 결과는 `docs/specs/frontend/ui-stack-migration-plan.md` P0.5에 적었다.

## 기준 시각

같은 시각으로 찍어야 작업 전·후 캡처를 픽셀로 비교할 수 있다(`clock.mjs`).

- `start.mjs`가 기준 시각을 정한다. 기본값은 실행한 날의 한국 시간 0시이고, `--now <ISO>`로 바꾼다.
  - 서버(next dev)는 실제 시각으로 그리므로 날짜가 같아야 서버가 그린 날짜 글자와 어긋나지 않는다. 그래서 기본값이 "오늘 0시"다.
- fixture의 다가오는 회차 일정은 이 시각 기준 상대값이다(`hoursFromNow`). 날짜가 지나도 "예정" 화면이 그대로 찍힌다.
- `shots.mjs`는 브라우저 시계를 이 시각에 고정하고(`page.clock.setFixedTime`, 타이머는 돈다), CSS 애니메이션을 멈춘 채 찍는다.
- 다른 날 찍은 캡처와 비교하려면 두 번 모두 같은 `--now`로 서버를 띄운다. 기준 시각이 다르면 `diff.mjs`가 비교하지 않는다.

## 자동 캡처와 확인판

서버를 띄운 채로 다른 터미널에서 실행한다.

```bash
node scripts/visual/shots.mjs seller --label after                  # fixtures의 screens를 폰(390)·태블릿(768)·PC(1280)로 촬영
node scripts/visual/shots.mjs seller --label after --viewports mobile,desktop  # 폭 고르기
node scripts/visual/report.mjs seller --after after --out <폴더>     # 폰에서 볼 확인판 HTML 생성
node scripts/visual/report.mjs seller --after after --before before --out <폴더>  # 작업 전·후 비교
node scripts/visual/report.mjs consumer@after,seller@baseline --after after --before baseline --out <폴더>  # 앱마다 다른 캡처
```

- 주소로 열 수 없는 화면 안 상태(탭 등)는 fixture 화면 목록에 `click: '<누를 글자>'`를 주면 찍기 전에 그 글자를 누른다(예: 셀러 정산 `기간별 조회`).
- 모달처럼 지금 보이는 화면이 중요한 상태는 `steps: [{ click: '<글자>' }]`와 `viewport: true`로 찍는다(예: 셀러 `modal-order-hold`).
- 불러오는 중 버튼처럼 누른 뒤 응답을 기다리는 상태는 `steps`에 `{ scenario: '<이름>' }`을 넣어 화면을 연 뒤에 가짜 API 상황을 바꾸고(예: 셀러 `slow-writes` = 쓰기 요청 60초 지연) 버튼을 누른다. 찍고 나면 페이지를 닫으므로 기다리던 요청은 취소된다(`ERR_ABORTED`, 정상 판정 제외).
- 글자가 없는 대상(값이 든 입력칸 등)은 `steps: [{ clickSelector: '<CSS 선택자>' }]`로 실제 마우스 클릭을 한다(예: 대조 화면 `ui-compare-select`).
- **정상 촬영 판정**(`soundness.mjs`): fixture 없는 API 경로 0, 콘솔 오류 0, 가짜 API에 닿지 못한 요청 0(취소된 요청 제외), 하네스가 지원하지 않는 화면 0(`--prod`의 셀러 Firestore 화면), 누를 글자·입력칸 없음 0, 도착 주소 = 의도한 주소(`path`의 pathname, 의도한 이동은 fixture `expectPath`)일 때만 정상이다. 정상이 아닌 캡처가 하나라도 있으면 `shots.mjs`는 종료 코드 1이고, `diff.mjs`는 그 화면을 비교하지 않고 실패로 본다. 작업 전·후가 같은 오류 화면이면 차이 0이어도 아무것도 증명하지 못하기 때문이다.
- **렌더 결정성**: 브라우저는 `--disable-partial-raster`로 띄운다. Chromium이 바뀐 영역만 다시 래스터하면 그리는 이력에 따라 글자·둥근 모서리의 안티앨리어싱이 채널 2~40만큼 달라져, 같은 커밋 두 번 촬영이 브라우저 컨텍스트마다 약 5~15% 어긋났다(2026-10-30 기사 화면 실측). 끄면 20번 중 20번 같았다.
- `next dev`는 힙 사용량이 상한(시스템 메모리의 50%)의 80%를 넘으면 스스로 재시작한다("Server is approaching the used memory threshold, restarting..."). 한 서버로 여러 번 연달아 찍다가 재시작하면, 그 사이 찍힌 화면은 연결 오류나 덜 그려진 상태(로딩)가 된다. `start.mjs`가 재시작 횟수를 `dev-restarts.txt`에 적고 `shots.mjs`가 재시작이 걸친 화면과 그 바로 다음 화면을 정상 판정에서 뺀다("next dev 메모리 재시작 중·직후 촬영"). 그 화면만 `--only`로 다시 찍는다. 세 앱 서버와 에뮬레이터를 한 컨테이너에서 같이 띄우면 더 자주 일어난다.
- 캡처는 `%TEMP%\greenhub-visual\<app>\shots\<label>\`에 PNG와 `manifest.json`으로 남는다.
  - `manifest.json`에는 화면별 최종 주소, 콘솔 오류, fixture가 없는 API 경로가 함께 기록된다.
- 작업 전 화면은 main worktree에서 같은 명령을 `--label before`로 찍는다.
- Claude가 `<폴더>`를 claude.ai 아티팩트로 게시한다(`db` 기능 사용).
  - 사람이 화면마다 괜찮음/고칠 것과 메모를 남긴다.
  - 판정은 `verdicts` 컬렉션(문서 id `<label>__<screen id>`)에 저장되고, Claude가 읽어 다음 수정을 정한다.

## UI 교체 대조 화면(판매자)

Mantine을 걷어내는 동안(`docs/specs/frontend/ui-stack-migration-plan.md` P1·P2a) `@greenhub/ui` 컴포넌트가 같은 크기의 Mantine과 같은 모양인지 본다.

```bash
node scripts/visual/shots.mjs seller --label compare --set compare   # 대조 화면과 Modal·Dialog·Drawer·Sheet 열린 상태(fixture compareScreens)
node scripts/visual/compare-cells.mjs --viewport 390                 # 짝마다 위치·크기·계산된 스타일·픽셀 비교(390·768·1280)
```

- 화면은 판매자 앱 `/dev/ui-compare`다. 행마다 왼쪽 Mantine, 오른쪽 `@greenhub/ui`를 그린다. 짝은 판매자 앱이 실제로 쓰는 props(`theme.ts` 기본값 포함)로 고른다.
- 열린 상태는 `?open=modal|dialog|drawer|sheet|select|uiselect`. Select 목록 둘은 입력칸을 실제로 눌러 연다. Modal은 `ConfirmModal`, Drawer는 소비자 `OptionSheet`와 같은 설정이다. 두 캡처는 같은 화면 위에 열리므로 캡처끼리 그대로 비교한다.
- 이 주소는 `GREENHUB_LOCAL_RUNTIME=true`이고 운영 빌드가 아닐 때(하네스·`dev:local`)만 열린다. 그 밖에는 404다(`apps/seller/src/lib/local-preview.ts`, 테스트 `local-preview.test.ts`).
- `compare-cells.mjs`는 같은 순서의 부품(칸의 첫 요소·button·input·svg·글자)을 짝지어 칸 안 위치·크기와 면·테두리·모서리·글꼴·색을 비교한다. 줄 높이·여백은 글자 위치로 드러나므로 따로 보지 않는다.
  - 픽셀은 같은 자리에서 비교한다. 오른쪽 칸을 찍고, 그 칸을 왼쪽(Mantine) 내용의 복제로 바꿔 다시 찍는다. 같은 Mantine 버튼도 가로 위치가 다른 칸에 놓으면 모서리 안티앨리어싱이 15픽셀 달라지기 때문이다(2026-10-31 실측).
  - textarea·select는 입력칸처럼 상자·글꼴을 비교하고, 안의 글자(option 포함)는 픽셀로만 본다(글자 노드 범위 좌표가 화면 위치가 아니다).
  - 채널 허용치는 1(`diff.mjs --tolerance 1`과 같다). 차이 있는 행이 있으면 종료 코드 1이다. `--out <폴더>`로 칸 이미지를 남긴다.

## 작업 전·후 픽셀 비교

```bash
node scripts/visual/diff.mjs seller --before before --after after                     # 차이 난 화면 목록
node scripts/visual/diff.mjs seller --before before --after after --allow allow.json  # 의도한 차이를 영역으로 허용
```

- 통과 조건: 모든 화면이 같거나(same), 차이가 허용 목록의 영역 안에만 있다(allowed). 정상 촬영 판정 실패·한쪽에만 있는 화면·기준 시각이나 폭 목록이 다른 묶음은 실패다. 실패하면 종료 코드 1이다.
- 허용 목록(JSON 배열): `{ "screen": "orders", "viewport": "mobile", "box": { "x": 0, "y": 120, "width": 390, "height": 48 }, "reason": "..." }`. `viewport`를 빼면 모든 폭, 크기가 달라진 화면은 `"box": "full"`로만 허용한다. 사유가 없는 항목은 받지 않는다. 쓰이지 않은 항목은 경고로 알려 준다.
- 결과: `%TEMP%\greenhub-visual\<app>\diff\<before>..<after>\`에 `report.json`과 차이 표시 이미지(`<id>-<viewport>.diff.png`, 빨강 = 설명 안 된 차이, 노랑 = 허용한 차이).
- 픽셀은 하나라도 다르면 차이다. `--tolerance <0~255>`는 채널 차이 허용치이고 결과에 기록된다. 기본 0이다.
  - 실측(2026-10-30, 판매자 129장을 같은 커밋에서 두 번): 128장은 완전히 같았고, 1장(상품 수정 태블릿)에서 입력칸 둥근 모서리 4px의 안티앨리어싱이 채널 값 1만큼 흔들렸다. 그래서 UI 교체 PR 판정은 `--tolerance 1`로 한다. 이때도 채널 값 2를 바꾼 1px은 차이로 잡힌다.
  - 그 밖의 값으로 바꾸려면 같은 커밋 두 번 비교로 근거를 만들고 PR에 적는다.
- 기준 시각이 같아도 서버는 실제 시각으로 그린다. 작업 전·후를 한국 날짜가 같은 날 찍는다(자정을 넘기면 서버가 그린 날짜 글자가 달라질 수 있다).
- UI 교체 PR의 판정 규칙(허용하지 않는 차이 등)은 `docs/specs/frontend/ui-stack-migration-plan.md` §7을 따른다.

## 구성

| 파일 | 역할 |
|---|---|
| `start.mjs` | 가짜 API와 next dev(`--prod`면 운영 빌드)를 함께 띄우는 실행기 |
| `mock-api.mjs` | 가짜 API 서버. 쓰기 요청은 기록만 하고 `200 {}`을 돌려준다 |
| `fixtures/<app>.mjs` | 앱별 가짜 사용자, 조회 경로 표, 캡처 화면 목록 |
| `node-guard.cjs` | next dev 프로세스의 외부 연결 차단 |
| `tls-cert.mjs` | `--prod` 가짜 API용 1회용 자체 서명 인증서(의존성 없음) |
| `firebase-emulator.mjs` | Auth·Firestore 에뮬레이터 기동·시드·커스텀 토큰(fixture에 `firestoreSeed`가 있을 때) |
| `apps.mjs` | 앱별 포트 등 공통 설정 |
| `clock.mjs` | 기준 시각(캡처 시계·fixture 일정) |
| `shots.mjs` | 화면 자동 캡처(Playwright, `apps/e2e`의 설치본 사용) |
| `soundness.mjs` | 정상 촬영 판정 |
| `diff.mjs` · `compare.mjs` · `png.mjs` | 작업 전·후 픽셀 비교(의존성 없음, `compare.spec.mjs`) |
| `report.mjs` · `report-template.html` | 캡처 결과로 확인판 HTML 생성 |
| `compare-cells.mjs` | UI 교체 대조 화면의 짝 비교(위치·스타일·픽셀) |

## 안전장치

- 앱 `.env*` 파일의 키를 전부 빈 값으로 덮는다. 운영 API·Firebase·비밀값이 next dev에 들어가지 않는다.
- next dev의 외부 연결을 막는다. 허용하는 곳은 루프백, 바인딩 주소, Google Fonts뿐이다.
- `--phone`은 Tailscale 주소에만 바인딩한다. 같은 tailnet 기기만 접속할 수 있다.

## 한계

- 에뮬레이터를 쓰지 않는 앱(소비자·기사, `--phone` 셀러)은 Firebase 로그인을 시작하지 않는다(`/auth/firebase-token` → 503). 그래서 개발 표시에 `Issue 1`이 뜨지만 화면에는 영향이 없다. 자동 캡처에서는 개발 표시를 숨긴다.
- 소비자 장바구니·결제는 브라우저 저장소 값이 필요하다. 화면 목록에 `storage: true`를 주면 fixture의 `browserStorage`를 넣고 연다.
  - 결제하기 버튼(카카오페이)과 우편번호 검색은 외부 스크립트라 동작하지 않는다.
- fixture에 없는 조회 경로는 404를 돌려준다. 새 화면을 볼 때는 `fixtures/<app>.mjs`에 경로를 더한다.
- 실제 카카오 로그인과 운영 데이터 확인은 대신하지 못한다.

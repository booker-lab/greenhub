# E2E (Playwright)

## 회차 E2E 로컬 대상 모드

원격 회차 E2E(`.github/workflows/e2e-round-direct.yml`, 회차 64건 + 세션 수명주기 12건)를 Vercel 배포 없이 로컬에서 같은 순서·인자로 돌린다. 대상 SHA를 깨끗한 임시 worktree에서 `next build && next start`로 띄운 세 앱을 검증하고, 데이터 대상은 원격과 같은 스테이징 API(`https://api-staging-94af.up.railway.app`)와 E2E Firebase 프로젝트(`greenhub-round-direct-e2e`)다.

| 앱 | 주소 |
| --- | --- |
| consumer | `http://127.0.0.1:3101` |
| seller | `http://127.0.0.2:3102` |
| driver | `http://127.0.0.3:3103` |

세 앱을 서로 다른 루프백 호스트로 띄워 한 브라우저 컨텍스트의 Auth.js 세션 쿠키가 겹치지 않게 한다. 이 http 주소는 `ROUND_DIRECT_E2E_TARGET_MODE=local` 표식이 있을 때만, 위의 앱별 매핑 그대로일 때만 허용된다.

### 준비물

`apps/e2e/.env.local-target`(gitignore 대상)에 아래 이름을 채운다. 다른 이름이 있으면 실행기가 거부한다.

| 이름 | 필수 | 내용 |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_FILE` 또는 `FIREBASE_SERVICE_ACCOUNT_JSON` | 둘 중 하나 | `greenhub-round-direct-e2e` 서비스 계정 키(파일 경로는 env 파일 위치 기준 상대 경로도 됨). 운영 키(`apps/api/firebase-adminsdk.json`)는 거부된다 |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | 필수 | E2E 프로젝트 웹 앱 설정 |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | 필수 | `greenhub-round-direct-e2e.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | 필수 | `greenhub-round-direct-e2e` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | 필수 | `greenhub-round-direct-e2e.firebasestorage.app` 또는 `.appspot.com` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | 필수 | E2E 프로젝트 웹 앱 설정 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | 필수 | E2E 프로젝트 웹 앱 설정 |
| `ROUND_DIRECT_E2E_RUN_ID` | 선택 | 실행 ID 고정(기본 `local-<sha 8자리>-<시각>`) |
| `NEXT_PUBLIC_PORTONE_STORE_ID`, `NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY`, `NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY`, `NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY` | 선택 | 결제 SDK는 테스트가 stub으로 바꾸므로 비우면 자리값을 쓴다 |

실행기가 직접 정하는 값(env 파일로 바꿀 수 없음):

- 스테이징 API origin, E2E Firebase 프로젝트·허용 bucket, 세 앱 루프백 주소
- 실행마다 새로 만드는 E2E 계정 12개(역할 3 × chromium·mobile)와 `AUTH_SECRET`·`E2E_TEST_SECRET`·`ROUND_DIRECT_E2E_SHARED_SECRET`. fixture seed가 이 계정으로 사용자 문서를 만들고 cleanup이 지운다.
- `VERCEL_ENV=preview`: driver의 Credentials 로그인은 `VERCEL_ENV==='preview'`와 `ROUND_DIRECT_E2E_ENABLED==='true'`일 때만 열린다(`apps/driver/src/auth.ts`). 앱 코드를 바꾸지 않고 Preview와 같은 게이트를 통과시키려고 흉내 낸다. `next start`는 `NODE_ENV=production`이라 로컬 파일럿용 Credentials 우회는 계속 꺼져 있다.
- `ROUND_DIRECT_E2E_ENV=preview`: 원격과 같은 "비운영 E2E 데이터 대상" 표식이다. 로컬 대상 모드도 같은 스테이징 API·E2E Firebase를 쓰므로 그대로 둔다.

빌드·서버·테스트 프로세스에는 OS 기본 env(PATH, TEMP, 프록시 등)와 위 값만 넘긴다. 셸에 있는 `NEXT_PUBLIC_*`·`FIREBASE_*`·`VERCEL_*` 값과 각 앱의 `.env.local`은 쓰이지 않는다.

### 실행

```bash
pnpm test:e2e:local --dry-run           # env 검증과 실행 계획만(빌드·외부 호출 없음)
pnpm test:e2e:local                     # origin/main을 fetch한 뒤 그 SHA로 실행
pnpm test:e2e:local --sha=<40자리 SHA>  # 지정 SHA로 실행
pnpm test:e2e:local --target-env=<경로>  # 다른 env 파일 사용
```

Windows(Git Bash·PowerShell)에서도 같다. 포트 3101~3103이 이미 쓰이고 있으면 남의 프로세스를 끄지 않고 중단한다. readiness·fixture·Playwright는 대상 SHA의 코드로 실행되므로, 이 모드가 들어오기 전 SHA는 빌드 전에 이유를 밝히고 멈춘다.

### 순서와 결과

1. env 검증 → 대상 SHA의 깨끗한 임시 git worktree(OS 임시 디렉터리) → `pnpm install --frozen-lockfile --prefer-offline`
2. `@greenhub/shared` 빌드 → 앱별 `pnpm --filter <앱> build`
3. 빌드 산출물(`.next/static`·`.next/server`)에서 `green-e4fe3`·`api-production-13e7`가 나오면 중단(seller·driver의 운영 차단 가드 리터럴만 예외), 스테이징 API가 인라인되지 않았어도 중단
4. 앱별 `next start -H <호스트> -p <포트>` → `/login` 200 대기
5. readiness(로컬 대상 모드) → chromium·mobile fixture seed/verify
6. 64건 → 무건너뜀 판정 → 세션 수명주기 12건 → 무건너뜀 판정(워크플로와 같은 Playwright 인자)
7. 성공·실패·중단 모두: fixture cleanup → 띄운 서버 종료 → 임시 worktree 제거. 정리 실패는 종료 코드 1과 함께 그대로 출력한다.

결과(`result.json`, 비민감 요약 `evidence/`, 앱 로그 `logs/`, 실패 스크린샷 `test-results/`)는 마지막 줄에 출력되는 OS 임시 디렉터리의 `output/`에 남는다. 확인 후 직접 지운다.

### 원격과 다른 점

| 원격 전용 검사 | 로컬 대상 모드 |
| --- | --- |
| Vercel deployment SHA·URL 확인(`wait-preview-deploy.mjs`) | 임시 worktree의 `HEAD`가 대상 SHA인지 확인하고, 앱별 고정 루프백 주소를 대상 URL로 쓴다 |
| readiness의 HTTPS 대상 URL 요구 | `local` 표식이 있을 때만 앱별 고정 루프백 http 주소 허용 |
| readiness의 사전 인증 증거(`ROUND_DIRECT_E2E_AUTH_EVIDENCE_JSON`) | globalSetup이 세 역할을 실제 로그인하고 역할·accessToken·세션 쿠키를 검증(실패 시 0건으로 중단) |
| Vercel 보호 우회 secret | 대상이 `.vercel.app`이 아니라 필요 없음 |

운영 Firebase·운영 서비스 계정·운영 bucket·운영 API·운영 store 거부, 실행 ID 범위의 fixture·manifest 경계, provider stub 모드 요구는 원격과 같은 코드로 그대로 적용된다.

## 어드민 로컬 E2E

어드민 화면(셀러앱 `/admin/*`)을 `pnpm dev:local` 스택(실제 API `localhost:3000` + Firestore·Auth 에뮬레이터 + 셀러/어드민 `localhost:3002`)에서 검증한다. 운영·스테이징·원격 Preview에는 붙지 않는다(주소는 `tests/_helpers/admin-local.ts`에 고정, env로 바꿀 수 없음).

```bash
pnpm dev:local                          # 다른 터미널에서 먼저 띄운다(Firebase CLI·Java 21 필요, scripts/dev/local/README.md)
ADMIN_LOCAL_E2E=1 SELLER_BASE=http://localhost:3002 CONSUMER_BASE=http://localhost:3001 DRIVER_BASE=http://localhost:3003   pnpm --filter e2e exec playwright test admin-local-
```

- 묶음 판정 실행기: `node scripts/admin-local-e2e.mjs`(dev:local을 먼저 띄운다). 대상 주소를 루프백으로 고정하고 재시도를 끈 채 돌려, 실행 건수가 기대값(spec 5개 × chromium·mobile = 20)과 같고 실패·재시도 통과·건너뜀이 모두 0일 때만 통과한다. UI 교체 PR의 판매자·어드민 로컬 증거다(`docs/specs/frontend/ui-stack-migration-plan.md` P0.5). spec을 더하거나 빼면 실행기의 `EXPECTED_TESTS`를 같은 PR에서 고친다.
- `ADMIN_LOCAL_E2E=1`이 없으면 `admin-local-*.spec.ts`는 모두 건너뛴다(일반·회차 원격 E2E에서도 건너뜀).
- 각 spec이 전용 관리자(에뮬레이터에 직접 생성, 로그인은 API 실경로)와 시드 문서를 만들고, afterAll에서 그 문서와 그 관리자가 남긴 기록(`adminAuditLogs` 등)을 지운다. 다른 문서는 건드리지 않는다.
- chromium(데스크톱 표)과 mobile(카드)을 함께 돈다. 실행마다 id·이름·전화번호가 달라 동시에 돌아도 섞이지 않는다.

| spec | 확인하는 것 |
| --- | --- |
| `admin-local-settlements` | 상태 필터, 지급 대기·지급 완료·수수료 합계 카드, 100건 뒤 더 보기, 지급 확인창(가게·주문번호·금액·계좌) → 지급 뒤 합계 이동 |
| `admin-local-orders` | 가게 이름 Select, 50건 뒤 더 보기, 목록 칸(주문일시·주문번호·고객·상품·가게·금액), 강제환불 확인창(주문번호·금액·되돌릴 수 없음) → 취소 시 환불 요청 없음 |
| `admin-local-invite` | 발급 직후·발급 내역 복사 값이 `/invite/<토큰>` 링크, 내역의 발급 일시(KST) |
| `admin-local-store-archive` | 기록 없는 가게 치우기 → 손님 공개 API(가게 소개·회차·상품) 404, 복구 → 200 |
| `admin-local-contacts` | 기사 탭 전화(전화 걸기 링크)·가입일, 판매자 탭 대표자·연락처 |

카카오 로그인으로 초대를 받아 가입하는 흐름은 실제 카카오가 필요해 로컬 E2E로 열 수 없다. API HTTP 통합 테스트(`apps/api/src/admin/admin-invite-revoke.spec.ts`의 "카카오 초대 가입")와 셀러앱 단위 테스트(`src/proxy.test.ts`·`src/lib/seller-invite.test.ts`)가 덮는다.

## 기사 디자인 시스템 spec 로컬 실행

`tests/driver-design-system.spec.ts`는 `DRIVER_BASE`가 루프백이면 인증 화면 묶음을 로컬 파일럿 로그인(아무 이메일·비밀번호)으로 연다. 쿠키가 필요 없고 건너뛰지 않는다. 로그인이 안 되면 실패한다.

```bash
node scripts/visual/start.mjs driver        # 다른 터미널(가짜 API + next dev, http://127.0.0.1:3203)
cd apps/e2e && DRIVER_BASE=http://127.0.0.1:3203 pnpm exec playwright test tests/driver-design-system.spec.ts --retries=0
```

원격 대상은 지금처럼 `DRIVER_SESSION_COOKIE`(세션 쿠키 JSON)를 주면 그 쿠키를 `DRIVER_BASE`의 도메인에 넣는다. 둘 다 없으면 인증 묶음을 건너뛴다.

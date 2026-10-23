<!-- Language: ko -->

# Railway 장애 때 API를 Cloud Run 예비 서버로 대피하기 — 비상 순서

> 작성: 2026-10-23 · 상태: **계획(아직 실행 불가)** · 결정: 사용자 확정(2026-10-23 채팅, 아래 "함께 정한 것")
> **쓸 수 있는 때**: 세 앱이 Railway 주소(`api-production-13e7.up.railway.app`)를 쓰는 동안. 그리고 Cloud Run 운영 예비 서버가 만들어진 뒤(`api-hosting-cloud-run-plan.md` C5)부터.
> **함께 볼 문서**
> - 계획된 이전(C1~C8)·비용·목표 구성의 정본: `api-hosting-cloud-run-plan.md`
> - Cloud Run 명령 절차: `api-cloud-run-runbook.md`(다른 세션이 작성 중)
>
> 이 문서는 그 계획에 없는 **갑작스러운 장애 때의 순서**만 맡는다.
> 이 문서에 순서가 적혀 있어도 운영 변경 승인은 아니다. 대피는 그때 사용자가 채팅으로 승인한다.

---

## 업무 요약

### 왜 필요한가

- 2026-10-21 07:24 UTC부터 Railway가 전체 장애를 냈다("Builds are temporarily paused", 이어서 Major Outage).
  - 운영 API는 계속 돌았다.
  - 하지만 새 배포·변수 변경·재시작이 하루 넘게 막혔다.
- 2026-05-19에는 Railway 전체가 약 8시간 멈췄다(`api-hosting-cloud-run-plan.md`).
- 지금은 Railway가 멈추면 쇼핑몰 서버를 돌릴 다른 곳이 없다.

### 함께 정한 것 (2026-10-23)

1. **언제 옮기나**: 손님이 주문·결제를 못 하는 상태가 **30분 넘게** 이어질 때만 옮긴다.
   - 10/21처럼 쇼핑몰은 돌고 배포만 막힌 경우에는 옮기지 않고 기다린다.
   - 옮기는 작업 자체가 새 사고를 낼 수 있어서다.
2. **어디로**: 구글 Cloud Run 서울. Firebase와 같은 구글 계정·같은 결제라 새로 가입할 회사가 없다. 이전 계획의 목적지와도 같다.
3. **평소 준비**: 운영 배포 때마다 예비 서버에도 **같은 버전을 꺼진 채로** 올려 둔다.
   - 장애 때 옛날 버전이 켜지는 일을 막는다.
   - 배포 도구 변경은 이전 계획 C4 범위다. 아래 "평소에 해 둘 일" P2.
4. **주소 바꾸기**: 장애 때 세 앱(손님·판매자·기사)의 API 주소를 예비 서버 주소(`…run.app`)로 바꿔 다시 올린다.
   - 결제 알림(PortOne 웹훅) 주소도 바꾼다.
   - 평소 드는 돈은 없다.
   - 서울 Cloud Run에는 간단한 도메인 연결이 없다. 우회하면 인증서 발급에 15분~24시간이 걸려 30분을 지킬 수 없다.
5. **자동 일(정기 작업)**: 대피할 때는 **끈 채로** 손님 주문부터 살린다. Railway 서버가 확실히 멈춘 것을 확인한 뒤에 켠다.

### 하지 않는 것

- 데이터 옮기기. 데이터는 Firestore에 그대로 있다. 서버만 바꾼다.
- 전환(C7) 뒤의 장애 대비. 전환 뒤에는 Cloud Run이 운영이고 주소가 `api.greenlove.co.kr`(구글 외부 부하분산기)로 바뀐다(`platform-modernization-plan.md`). 그때 이 문서를 다시 쓴다(아래 "전환 뒤").
- Railway Pro 전환. Railway 전체가 멈추는 장애는 막지 못한다.

---

## 지금 Railway에 기대는 것 (2026-10-23 `main` `5bff5576` 기준)

### 서버

| 무엇 | 지금 |
|---|---|
| 운영 API | Railway production, 1대, `us-west2`, `Dockerfile` 빌드 |
| 운영 API 주소 | `https://api-production-13e7.up.railway.app` (Railway 기본 주소) |
| 시험(staging) API | Railway staging. `main`에서 자동 배포. 회차 E2E·Preview가 사용 |
| 헬스 확인 | `GET /health`. Firestore 문서 1건을 읽어 실패하면 503. 배포 커밋은 `GREENHUB_COMMIT_SHA`, 없으면 `RAILWAY_GIT_COMMIT_SHA` |
| 가동 확인 | `.github/workflows/uptime.yml`이 15분마다 운영 `/health`를 확인 |
| 운영 배포 | `production-deploy.yml` → `scripts/release/production-deploy.mjs railway` |

### 알림톡·문자 고정 IP

- ALIGO는 등록된 IP의 호출만 받는다.
- Railway 송신 IP는 재배포마다 바뀐다. 그래서 운영은 Fixie 고정 IP 프록시(`ALIGO_OUTBOUND_PROXY_URL`)를 거친다.
- **Fixie는 어디서 호출하든 같은 IP로 나간다.** 대피 때 Cloud Run에 같은 값을 넣으면 ALIGO를 따로 고치지 않아도 된다.
- 이전 계획은 C5에서 Cloud NAT 고정 IP를 ALIGO에 추가하고, Fixie는 C8까지 둔다.

### 정기 작업 (모두 API 프로세스 안에서 돈다. `GREENHUB_SCHEDULES_ENABLED=false`면 꺼짐)

| 시각(KST) | 일 | 두 서버가 함께 돌 때 |
|---|---|---|
| 매분 | 결제 안 된 주문 15분 뒤 풀기(`PaymentsService.cleanupPendingOrders`) | **실행 lease 없음.** 같은 프로세스 안 중복만 막는다. 두 서버 동시 실행 안전성은 확인 안 됨 |
| 매분 | 공동구매 마감 확정·취소 | 처리 직전 트랜잭션 lease |
| 10분마다 | 공동구매 마감 2시간 전 알림 | lease 없음(두 번 갈 수 있음) |
| 03:00 | 보관 기한 지난 개인정보 파기 | `jobLeases` 하루 1회 |
| 03:20 | 입점 문의 파기 | `jobLeases` 하루 1회 |
| 04:00 | 정산 확정(pending → confirmed) | lease 없음. 건별로 아직 pending인지 보고 바꾼다 |
| 08:30 | 운영 아침 요약(텔레그램) | `jobLeases` 하루 1회 |

### 환경 변수 (이름만. 값은 Railway production에만 있다)

- **필수·운영 동작**: `NODE_ENV`, `PORT`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_STORAGE_BUCKET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `CORS_ORIGIN`, `CORS_ALLOW_VERCEL_PREVIEWS`, `TRUST_PROXY_HOPS`, `GREENHUB_SCHEDULES_ENABLED`, `GREENHUB_FEATURES`, `PLATFORM_FEE_RATE`, `SETTLEMENT_CONFIRM_DELAY_DAYS`
- **결제**: `PORTONE_V2_SECRET`, `PORTONE_WEBHOOK_SECRET`, `PORTONE_STORE_ID`(코드는 안 읽고 운영 설정 점검이 확인)
- **알림**: `ALIGO_API_KEY`, `ALIGO_USER_ID`, `ALIGO_SENDER_KEY`, `ALIGO_SENDER_PHONE`, `ALIGO_TEMPLATE_CODES_JSON`, `ALIGO_OUTBOUND_PROXY_URL`, `OPS_TELEGRAM_BOT_TOKEN`, `OPS_TELEGRAM_CHAT_ID`
- **기타 외부**: `KAKAO_ADMIN_KEY`, `KAKAO_APP_ID`, `GEMINI_API_KEY`
- **배포 환경 표식**: Railway가 넣는 `RAILWAY_ENVIRONMENT_NAME`·`RAILWAY_GIT_COMMIT_SHA`
  - Cloud Run에는 대신 `GREENHUB_ENVIRONMENT_NAME=production`, `GREENHUB_COMMIT_SHA=<SHA>`를 넣는다(#605 C1).
  - Railway 밖에서는 `TRUST_PROXY_HOPS`가 없으면 기동하지 않는다.
- 운영에 있으면 안 되는 것: `GOOGLE_GEMINI_BASE_URL`, `ROUND_DIRECT_E2E_*`, `GREENHUB_LOCAL_*`, 에뮬레이터 주소

### 세 앱(Vercel)이 API를 찾는 법

- 세 앱 모두 `NEXT_PUBLIC_API_URL` 하나로 API 주소를 정한다.
  - 이 값은 **빌드할 때 화면 코드와 보안 정책(CSP `connect-src`)에 박힌다.**
  - 그래서 값만 바꾸면 안 되고, 다시 빌드해야 반영된다.
- **함정**: 같은 커밋으로 다시 배포하면 빌드 생략 규칙(`scripts/vercel/ignore-build.mjs`)이 "바뀐 것 없음"으로 보고 빌드를 취소한다.
  - `production-deploy.mjs vercel`은 이 취소를 `skipped`로 기록하고 성공으로 끝난다.
  - 즉 **새 주소가 반영되지 않았는데 성공처럼 보인다.**
  - 대피 때는 Vercel 화면의 Redeploy에서 "프로젝트의 Ignored Build Step 사용"을 끄고 다시 배포한다. 실제 동작은 P5에서 미리 확인한다.
- API의 CORS는 세 앱 주소(`greenlove.co.kr`, `seller.`, `driver.`)를 허용한다. API 주소가 바뀌어도 CORS 값은 그대로다.

### 그 밖에 API 주소가 들어 있는 곳

- PortOne 콘솔의 결제 웹훅 주소(`…/payments/webhook/portone`)
- 운영 API 호스트 차단 목록(E2E·점검 도구가 운영을 건드리지 않게 막는 목록). Cloud Run 운영 주소 추가는 C4 범위다.
- `docs/URLS.md`, `uptime.yml`, `post-deploy-smoke`

---

## 피난처 비교 (2026-10-23 조사, 금액은 대략이라 결정 전에 다시 확인)

| 후보 | 좋은 점 | 걸리는 점 |
|---|---|---|
| **Cloud Run 서울 (선택)** | 같은 구글 계정·결제, 서울, 이전 계획과 목적지가 같아 준비가 겹친다. 꺼 두면 거의 0원 | 정기 작업을 돌리려면 1대 상시(CPU 항상 할당) 비용. 구글이 멈추면 Firestore와 같이 멈춘다(어차피 서비스도 멈춤) |
| Fly.io | 구글과 완전히 별개. 고정 송신 IP 월 약 $3.6 | 새 회사 가입·카드·청구서가 하나 는다 |
| Render | Railway와 화면이 비슷하다 | 고정 IP 묶음 월 $100. 서울 지역이 없다 |
| Railway Pro | 고정 IP 무료(공유 IP), 월 $20 | 같은 회사라 전체 장애를 막지 못한다 |

ALIGO 고정 IP는 Fixie로 어디서든 해결되므로 선택을 가르지 않았다. Cloud Run 정확한 월 비용은 이전 계획 C2에서 GCP 가격 계산기로 적는다.

---

## 언제 옮기나 — 판단 기준

**옮긴다**: 아래 둘이 모두 맞을 때. 그리고 사용자가 채팅으로 "대피해"라고 승인할 때.

1. 손님이 주문·결제를 못 한다. 다음 중 하나로 확인한다.
   - 운영 `/health`가 응답 없음·5xx
   - 손님 앱 로그인·장바구니·결제 화면 오류
2. 그 상태가 **30분 넘게** 이어지고, Railway 상태 페이지(status.railway.com)에 복구 시각이 없다.

**옮기지 않는다**

- 쇼핑몰은 정상이고 배포·변수 변경·재시작만 막힌 경우(10/21 사례). Railway 회복을 기다린다.
- 급한 수정이 있어도 마찬가지다.
- Firestore·Firebase Auth·Vercel 쪽 장애. 서버를 옮겨도 낫지 않는다. `/health` 503 본문에 `firestore: error`가 있으면 Firestore 쪽이다.

---

## 30분 대피 순서

시작 조건: 예비 서버가 있고(P1), 마지막 운영 배포와 같은 SHA다(P2). 걸리는 시간은 대략이다.

| 시점 | 할 일 | 누가 | 확인 |
|---|---|---|---|
| 0분 | 판단 기준 확인, 사용자 승인 | 사용자 | 채팅에 승인 문구 |
| ~5분 | 예비 서버를 **정기 작업 끈 채로**(`GREENHUB_SCHEDULES_ENABLED=false`) 최소 1대로 켠다 | Claude(명령)·사용자(GCP 승인) | 예비 서버 `/health` 200, `commit`이 마지막 운영 SHA |
| ~8분 | 예비 서버 CORS preflight를 세 앱 주소로 확인 | Claude | 세 주소 모두 허용 헤더 |
| ~10분 | 세 앱 Vercel production `NEXT_PUBLIC_API_URL`을 예비 서버 주소로 바꾼다 | 사용자(또는 승인 뒤 Claude) | Vercel 화면에서 값 확인 |
| ~20분 | 세 앱을 같은 SHA로 **빌드 생략 없이** 다시 배포한다(위 "함정"). 배포 도구로 할 때는 `production-deploy.mjs vercel --require-build=true`를 쓴다(C4에서 추가, CANCELED를 실패로 본다) | 사용자(또는 승인 뒤 Claude) | 세 배포 모두 READY. CANCELED·skipped면 실패로 본다 |
| ~22분 | PortOne 콘솔 결제 웹훅 주소를 예비 서버 주소로 바꾼다 | 사용자 | 콘솔 저장 화면 |
| ~25분 | 운영 확인: `post-deploy-smoke`를 예비 서버 대상으로, 세 앱 로그인·상품·장바구니 화면, 비인증 API 401 | Claude | 전부 통과 |
| ~30분 | 텔레그램·채팅으로 "대피 완료, 정기 작업은 꺼짐" 기록 | Claude | `docs/memory.md` 기록은 장애 종료 뒤 |

주의

- Railway 변수·배포는 건드리지 않는다. 장애 중에는 바꿀 수 없다. 회복된 뒤 자동 재배포가 검증 안 된 `main`을 내보낼 수 있다(2026-10-08 교훈).
- 대피 중에는 새 코드 배포를 하지 않는다. 고칠 것이 있으면 예비 서버 배포 방식(C4)으로 따로 승인받는다.

### 정기 작업 켜기 — Railway가 멈춘 것을 확인한 뒤

켜는 조건은 둘 중 하나다.

- Railway 화면·상태 페이지에서 운영 서비스가 멈췄거나 지워진 것을 확인
- Railway 운영 로그에 정기 작업 기록(`[PaymentsScheduler]` 등)이 30분 넘게 없음

조건이 맞으면 예비 서버를 `GREENHUB_SCHEDULES_ENABLED=true`로 다시 배포한다. 확인할 것:

- 다음 매분 정리 로그
- 다음 날 08:30 아침 요약
- `jobLeases` 문서의 보유자가 예비 서버

켜기 전까지 생기는 일:

- 결제 안 된 주문의 수량이 늦게 풀린다(15분 → 켤 때까지).
- 04:00 정산 확정이 하루 밀릴 수 있다.
- 결제가 끝난 주문은 웹훅으로 그대로 확정된다(웹훅 주소를 바꾼 경우).

### 되돌리기 — Railway가 회복된 뒤

1. Railway 운영이 장애 전 SHA로 정상인지 `/health`로 확인한다.
   - 회복 중 자동 재배포로 다른 SHA가 나갔으면 검증 SHA로 다시 배포한다.
2. **예비 서버 정기 작업을 먼저 끈다.**
   - 이때 Railway 정기 작업은 켜져 있다.
   - 몇 분간 두 서버가 함께 돌 수 있으니, 예비 서버를 끄고 나서 세 앱 주소를 되돌린다.
3. 세 앱 `NEXT_PUBLIC_API_URL`을 Railway 주소로 되돌리고, 빌드 생략 없이 다시 배포한다.
4. PortOne 웹훅 주소를 Railway 주소로 되돌린다.
5. 예비 서버를 꺼진 대기 상태(최소 0대)로 돌린다. `post-deploy-smoke`를 Railway 대상으로 다시 실행한다.
6. `docs/memory.md`에 장애·대피·복귀 시각과 배포 ID를 남긴다.

데이터는 계속 같은 Firestore라 되돌릴 데이터는 없다. 다만 대피 중 예비 서버에서 처리된 주문·알림은 그대로 남는다.

---

## 평소에 해 둘 일

| # | 할 일 | 맡는 곳 | 상태 |
|---|---|---|---|
| P1 | 운영 예비 서버(Cloud Run 서울, 정기 작업 꺼짐)와 운영 비밀값(Secret Manager) | 이전 계획 C2·C5(사용자 승인) | 미착수 |
| P2 | 운영 배포 때마다 예비 서버에도 같은 SHA를 꺼진 채로 배포(트래픽 없음, 최소 0대). 운영 Railway 배포 성공 뒤에 한다 | 이전 계획 C4(`production-deploy.mjs`·`.yml`) | C4 PR에서 구현 중(Railway 배포 뒤 같은 SHA로 예비 서버 배포, 실패해도 운영 배포는 계속) |
| P3 | **Railway 운영 변수를 바꿀 때 예비 서버 비밀값도 같이 바꾼다**(텔레그램·ALIGO·PortOne 등). 어긋나면 대피 때 알림·결제가 깨진다 | 사용자(운영 변수 변경 절차) | 규칙 |
| P4 | ALIGO 호출: 예비 서버에도 Fixie 값(`ALIGO_OUTBOUND_PROXY_URL`)을 넣어 둔다. Cloud NAT IP를 ALIGO에 추가하면 그 경로도 쓸 수 있다 | 이전 계획 C5 | 미착수 |
| P5 | **리허설 1회**(시험 환경): 시험용 Cloud Run 대상으로 Preview 세 앱 주소를 바꿔 다시 배포하고 로그인·주문 화면 확인. Vercel "Ignored Build Step 끄고 Redeploy"가 실제로 빌드하는지 함께 확인 | 이전 계획 C3에 묶어서 | 미착수 |
| P6 | 장애 때 쓸 열쇠가 Railway 밖에 있는지 확인: Vercel 운영 토큰, PortOne 콘솔 로그인, GCP 배포 권한(WIF) | 사용자 | 확인 필요 |
| P7 | 결제 안 된 주문 정리(매분)를 두 서버가 함께 돌려도 안전한지 확인. 안전하면 "정기 작업 켜기" 조건을 풀 수 있다 | 별도 작업(이전 계획 "여러 대 자동 확장"과 같은 확인) | 미착수 |

DNS(가비아)는 이 순서에서 바꾸지 않는다. CORS도 바꿀 것이 없다.

---

## 전환(C7) 뒤

- 전환 뒤에는 운영이 Cloud Run이다. 세 앱 주소는 `api.greenlove.co.kr`(구글 외부 부하분산기)이다.
- 그때부터 이 문서의 순서는 맞지 않는다.
- 첫 회차(11/10)까지 Railway로 되돌리는 법은 이전 계획 C7 "되돌리기"를 따른다.
- 그 뒤의 장애 대비(부하분산기 뒤 예비 대상, 다른 리전 등)는 전환 때 이 문서를 다시 써서 정한다.

## 열린 질문

- P7 결과에 따라 정기 작업 켜기 조건을 바꿀지
- Vercel Redeploy에서 빌드 생략을 끄는 방법의 실제 동작(P5)
- 예비 서버 대기 비용 실측(이전 계획 C2)

## 근거

- 서울 Cloud Run 도메인 연결 미지원, 인증서 15분~24시간: Google Cloud "Mapping custom domains" 문서(2026-10-23 조회)
- Vercel Redeploy에서 Ignored Build Step 끄기: Vercel "Git settings" 문서(2026-10-23 조회)
- Fly.io·Render·Railway 고정 IP 가격: 각 사 문서·변경 기록과 제3자 정리(2026-10-23 조회, 확인 필요)

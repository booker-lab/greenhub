<!-- Language: ko -->

# 운영 API를 Railway에서 Cloud Run(서울)으로 옮기기 — 계획서

> 작성: 2026-10-23 · 상태: **C1 완료(#605), C2 완료(절차서 R1~R5의 GCP 쪽, 2026-10-23), 다음은 R6·R7** · 결정: 사용자 확정(2026-10-23 채팅, "Cloud Run을 지금부터 구축, 단계별 진행")
> 실행 명령은 [`api-cloud-run-runbook.md`](api-cloud-run-runbook.md)(R0~R11)가 소유한다.
> 이 문서는 계획(`*-plan.md`)이다. 전환이 끝나면 현행 사실은 `docs/memory.md`·`docs/URLS.md`·배포 문서로 옮기고, 이 문서는 결정 배경으로만 남긴다.
> 운영 전환·외부 서비스 설정·처리방침 변경은 단계마다 따로 승인받는다. 이 문서의 단계 완료 표시는 운영 승인이 아니다.

---

## 업무 요약

### 무엇이 문제인가

운영 API는 Railway 미국 캘리포니아 리전(`us-west2`)에서 1대로만 돈다.

- **Railway가 멈추면 다른 곳으로 돌릴 길이 없다.** API 주소가 Railway 기본 주소(`api-production-13e7.up.railway.app`) 그대로이고, 세 앱 환경 변수·PortOne 웹훅·가동 확인·운영 스크립트에 박혀 있다. 대신 띄울 서버도 없다.
- **실제로 겪은 일**
  - 2026-05-19 Railway 전체 장애(약 8시간, Google Cloud가 Railway 계정을 정지). E2E가 4번 연속 실패했다.
  - 2026-10-08 운영 변수 하나를 바꾸자 Railway가 검증 안 된 `main`을 자동 배포했다.
  - 재배포마다 송신 IP가 바뀌어 ALIGO 호출은 Fixie 고정 IP 프록시를 거친다. 알림 경로에 외부 업체가 하나 더 낀다.
  - Railway 앞단 프록시 구조가 요청 한도의 접속자 IP 판정에 영향을 준다(#565, 홉 수 1→2).
- **데이터는 서울, API는 미국이다.** Firestore는 서울(`asia-northeast3`)인데 API는 캘리포니아라 Firestore를 읽을 때마다 태평양을 오간다. 개인정보처리방침에도 "API는 미국 캘리포니아에서 처리"로 적혀 있다.

### 함께 정한 것 (2026-10-23)

1. 운영 API를 **Google Cloud Run 서울(`asia-northeast3`)**로 옮긴다. Firestore와 같은 회사·같은 지역이다. Firestore가 멈추면 어차피 서비스가 멈추므로 장애 날 수 있는 업체가 하나 줄고, 지연도 줄어든다. 지금 `Dockerfile`을 그대로 쓴다.
2. **지금부터 만든다.** 실제 주문이 없는 파일럿 전이 옮기기 가장 쉬운 때다.
3. **만들기와 전환을 나눈다.** 운영 트래픽을 건드리지 않는 단계(C1~C5)를 먼저 끝내고, **2026-10-28(수)**에 전환 여부를 판단한다(C6).
4. 10/28까지 판단 조건이 다 맞지 않으면 **파일럿은 Railway로 시작**한다. Cloud Run은 언제든 넘어갈 수 있는 예비 서버로 두고, 전환은 첫 회차(11/10 배송) 뒤로 미룬다.
5. 전환 뒤에도 **Railway는 첫 회차가 끝날 때까지 되돌리기용으로 둔다**(정기 작업은 끈 채로).
6. 데스크탑을 서버로 쓰는 안은 택하지 않는다(정전·업데이트 재부팅·회선·보안·개인정보 안전조치 부담).
7. **API 고정 주소 `api.greenlove.co.kr`를 전환(C7) 때 바로 적용한다**(2026-10-23 사용자 확정, 다른 세션). 서울 Cloud Run은 도메인 직접 연결이 없어 구글 외부 애플리케이션 부하분산기를 쓴다(월 약 18달러 추가). 전환 때 세 앱·PortOne 주소를 어차피 바꾸므로 한 번에 고정 주소로 바꾸고, 다음 이전은 DNS만 바꾸면 되게 한다. **첫 회차(11/10) 전에 전부 끝낸다.**

### 하지 않는 것

- **데이터 이전**: 데이터는 그대로 Firestore에 있다. API 서버만 옮긴다. 그래서 되돌릴 때도 서버 주소만 되돌리면 된다.
- 프런트엔드(Vercel)·Firebase 변경.
- **여러 대 자동 확장**: 처음에는 최대 1대로 둔다. 매분 도는 결제 대기 정리(`PaymentsService.cleanupPendingOrders`)에는 실행 lease가 없다. 2대 이상은 이 작업의 중복 실행 안전성을 확인한 뒤에 늘린다.

## 지금 Railway에 기대는 곳 (2026-10-23 `main` `e4d781d` 기준)

| 곳 | 무엇 | 처리 단계 |
|---|---|---|
| `apps/api/src/config/runtime-config.ts` | `RAILWAY_ENVIRONMENT_NAME`으로 운영 판정, 프록시 홉 기본값 2 | C1 |
| `apps/api/src/app.controller.ts` | `/health`의 `commit`을 `RAILWAY_GIT_COMMIT_SHA`에서 읽음 | C1 |
| `apps/api/src/common/e2e-provider-mode.ts` | 운영에서 E2E 대역을 막을 때 `RAILWAY_ENVIRONMENT_NAME` 사용 | C1 |
| `apps/api/src/ops-alerts/ops-alert.service.ts` | 알림 제목의 환경 이름 | C1 |
| `scripts/release/production-deploy.mjs`, `.github/workflows/production-deploy.yml` | Railway GraphQL로 지정 SHA 배포 | C4 |
| `scripts/release/prod-config-check.mjs`, `.github/workflows/prod-config-check.yml` | Railway 변수를 읽어 불변식 점검 | C4 |
| `scripts/check-round-direct-e2e-readiness.mjs`, `scripts/probe-auth-runtime.mjs`, `scripts/probe-authjs-role-callback.mjs`, `scripts/deploy/verify-railway-staging-binding.mjs`, `.github/workflows/probe-auth-runtime.yml` | 운영 API 호스트 목록(`PRODUCTION_API_HOSTS` 등) | C4 |
| `.github/workflows/uptime.yml` | 운영 API `/health` 주소 | C7 |
| 세 앱 Vercel 운영 env `NEXT_PUBLIC_API_URL` | 운영 API 주소 | C7 |
| PortOne 콘솔 웹훅 주소 | 운영 API 주소 | C7(사용자) |
| ALIGO 허용 IP, `ALIGO_OUTBOUND_PROXY_URL`(Fixie) | 고정 송신 IP | C5·C8 |
| `apps/consumer/src/app/privacy/page.tsx` §4·§5, `docs/specs/legal/consumer-legal-documents.md` | 처리위탁·국외 처리(Railway, 미국 캘리포니아) | C7 |

## 목표 구성

- **서비스**: Cloud Run `asia-northeast3`. 이미지는 지금 `Dockerfile` 그대로이고, 같은 리전 Artifact Registry에 둔다.
- **대수**: 최소 1대·최대 1대, **CPU 항상 할당**. 요청이 없을 때도 매분 정기 작업이 돌아야 한다.
- **환경 변수**: Railway 운영 변수와 같은 값에 다음을 더한다.
  - `GREENHUB_ENVIRONMENT_NAME=production`
  - 배포마다 `GREENHUB_COMMIT_SHA=<배포 SHA>`
  - C3에서 실측한 `TRUST_PROXY_HOPS`
  - 비밀값은 Secret Manager에 둔다.
- **송신 IP**: Direct VPC egress(모든 트래픽) + Cloud NAT 고정 IP. ALIGO에 이 IP를 등록하면 Fixie가 필요 없다.
- **헬스 확인**: `/health`(Firestore 문서 한 건 읽기). Cloud Run 시작 검사로도 써서, 통과한 리비전에만 트래픽을 옮긴다.
- **주소**: 전환 뒤 `api.greenlove.co.kr`(부하분산기) 하나만 연다. run.app 직접 접속은 막는다(`ingress=internal-and-cloud-load-balancing`, `X-Forwarded-For` 위조로 요청 한도를 피하지 못하게).
- **배포**: GitHub Actions가 Workload Identity Federation으로 인증해(키 파일 없이) 지정 SHA 이미지만 배포한다.
- **정기 작업**: 전환 전까지 Cloud Run은 `GREENHUB_SCHEDULES_ENABLED=false`다. 두 서버가 함께 매분 작업을 돌리지 않게 한다.

비용은 Cloud Run 상시 1대(CPU 항상 할당), Cloud NAT·고정 IP, Secret Manager·Artifact Registry에서 든다. 정확한 월 금액은 C2에서 GCP 가격 계산기로 확인해 이 문서에 적는다.

## 단계

각 단계는 따로 닫을 수 있다. "확인"이 통과해야 다음 단계로 간다.

### C1. API 코드에서 Railway 전용 변수 의존 풀기

- **무엇**
  - 배포 환경 이름을 `GREENHUB_ENVIRONMENT_NAME`(없으면 `RAILWAY_ENVIRONMENT_NAME`)으로 판정한다. 둘 다 있는데 다르면 기동을 막는다.
  - `/health`의 `commit`을 `GREENHUB_COMMIT_SHA`(없으면 `RAILWAY_GIT_COMMIT_SHA`)로 읽는다. 둘 다 있는데 다르면 `null`이다(배포 확인이 잘못된 SHA로 통과하지 않게).
  - Railway 밖 배포 환경(`GREENHUB_ENVIRONMENT_NAME`만 있음)은 `TRUST_PROXY_HOPS`를 명시해야 기동한다. 0이면 모든 접속자가 프록시 IP 한 버킷으로 묶이기 때문이다.
- **Railway에서는 동작이 바뀌지 않는다.** 새 변수를 넣지 않으면 기존 값만 본다.
- **담당**: Claude
- **확인**: API 단위·통합 테스트, 타입 검사, ESLint

### C2. GCP 기본 구성 — 사용자 콘솔 작업, Claude가 명령 안내

- **프로젝트**: 기본안은 운영 `green-e4fe3`, 시험용은 회차 E2E가 쓰는 `greenhub-round-direct-e2e`이다. 각자 Firestore와 같은 프로젝트라 권한·결제가 단순하다. 다른 프로젝트를 원하면 여기서 정한다.
- 결제 계정 연결을 확인하고, Cloud Run·Artifact Registry·Secret Manager·Compute Engine(Cloud NAT) API를 켠다.
- Artifact Registry 저장소(`asia-northeast3`)를 만든다.
- 서비스 계정 두 개를 만든다.
  - 런타임용: Firestore·Storage·Firebase 인증과 Secret Manager 읽기(명령은 절차서 R3)
  - 배포용: GitHub OIDC로 이 저장소의 지정 workflow만 쓸 수 있게(절차서 R4·R5)
- `asia-northeast3`에서 Direct VPC egress·Cloud NAT를 쓸 수 있는지 확인한다.
- **확인**: 읽기 명령으로 구성을 확인하고, 예상 월 비용을 이 문서에 적는다.

### C3. 시험용 Cloud Run으로 검증

- `greenhub-round-direct-e2e`에 시험 서비스를 띄운다. Railway 스테이징과 같은 변수에 `GREENHUB_ENVIRONMENT_NAME=staging`, 고정 IP를 쓴다.
- **프록시 홉 수 실측**: 2026-10-18 Railway 실측과 같은 기준이다. 접속자마다 다른 요청 한도 버킷이어야 하고, 클라이언트가 보낸 `X-Forwarded-For`는 무시돼야 한다. 그 값을 `TRUST_PROXY_HOPS`로 고정한다.
- **회차 E2E 1회**(회차 64 + 세션 12)를 시험용 Cloud Run 대상으로 실행한다.
  - 이를 위해 `ROUND_DIRECT_E2E_API_ORIGIN`과 세 앱 브랜치 미지정 Preview env의 API 주소를 시험용 Cloud Run으로 바꾼다. 실행 뒤 되돌릴지는 여기서 정한다.
  - 원격 E2E 예산 규칙(`development-authority.md` §4.1)을 따른다.
- **확인**: E2E 통과·fixture 잔여 0, `/health` 200·commit 일치, 홉 수 실측 기록

### C4. 배포·점검 도구

- `production-deploy.mjs`에 Cloud Run 배포 명령을 더한다. 지정 SHA 이미지 빌드·푸시 → 트래픽 없이 배포(시작 검사 통과 필요) → 트래픽 이동 → `/health` commit 확인, 실패하면 이전 리비전으로 되돌린다. workflow는 `api_platform`(기본 railway)으로 고른다. Railway 명령은 C8까지 둔다.
- `prod-config-check.mjs`가 Cloud Run 운영 서비스도 값 노출 없이 점검하게 한다(`GREENHUB_ENVIRONMENT_NAME`, `TRUST_PROXY_HOPS`, 정기 작업 설정 등).
- 운영 API 호스트 목록에 Cloud Run 운영 호스트를 더한다.
  - 이 목록은 E2E·점검 도구가 운영 API를 잘못 건드리지 않게 막는 차단 목록이다.
  - 그래서 운영 서비스를 띄우기(C5) 전에 넣는다. 정본은 `scripts/release/api-hosts.mjs`(Railway·Cloud Run 결정적·해시·태그 주소·`api.greenlove.co.kr`).
- **확인**: 각 스크립트 spec, CI

### C5. 운영 Cloud Run 준비(트래픽 없음) — 승인 필요

- 운영 비밀값을 Secret Manager에 넣는다(사용자). `GREENHUB_SCHEDULES_ENABLED=false`로 배포한다.
- Cloud NAT 고정 IP를 ALIGO 허용 IP에 추가한다(사용자). Fixie IP는 그대로 둔다.
- **확인**
  - `/health` 200·commit 일치
  - CORS preflight
  - 고정 IP에서 ALIGO 읽기 전용 조회가 `code=0`(발송 없이). 방법은 여기서 정한다.

### C6. 전환 판단 — 2026-10-28(수), 사용자 결정

다음을 모두 만족하면 C7로 간다.

- C1~C5 확인 통과
- PortOne LIVE 채널 처리(BACKLOG `PORTONE-CHANNEL-CHECK`)가 끝났거나 전환 작업과 겹치지 않음
- 전환을 같은 날 끝낼 시간이 있음

하나라도 아니면 파일럿은 Railway로 시작하고 전환은 첫 회차 뒤로 미룬다.

### C7. 전환 — 승인 필요, 아래 순서대로

1. 처리방침 수정 PR을 준비한다. §4 처리위탁과 §5 국외 처리에서 API 처리 위치를 서울로 고친다. 공지·시행일 방식은 사용자가 정한다.
2. **Railway 정기 작업을 끈다**(`GREENHUB_SCHEDULES_ENABLED=false`). 변수 변경이 Railway 재배포를 일으키므로 **바로 검증된 SHA로 다시 배포한다**(2026-10-08 교훈).
3. Cloud Run 정기 작업을 켜고 다시 배포한다. 2와 3 사이 몇 분은 정기 작업이 쉬지만, 실주문이 없는 전환 시점에는 영향이 없다.
4. 세 앱 운영 `NEXT_PUBLIC_API_URL`을 `https://api.greenlove.co.kr`로 바꾸고 같은 SHA로 다시 배포한다.
5. PortOne 웹훅 주소를 `https://api.greenlove.co.kr` 기준으로 바꾼다(사용자 콘솔).
6. 처리방침을 반영해 배포하고 `uptime.yml` 주소를 바꾼다.
7. **확인**
   - Cloud Run 대상 `post-deploy-smoke`
   - 세 앱 로그인·주문 화면
   - 다음 날 08:30 아침 요약 도착
   - 첫 정기 작업의 `jobLeases` 정상

**되돌리기**: 4·5를 원래 주소로 되돌린다. Cloud Run 정기 작업을 끄고, Railway 정기 작업을 켠다(검증 SHA로 다시 배포). 데이터는 그대로라 되돌릴 데이터가 없다.

### C8. 정리 — 첫 회차(11/10) 뒤

- Fixie를 없앤다. `ALIGO_OUTBOUND_PROXY_URL`을 지우고, ALIGO에서 Fixie IP를 지우고, Fixie를 해지한다.
- 스테이징 API도 Cloud Run으로 옮길지 정한다. 지금 Railway 스테이징은 `main`에서 자동 배포된다.
- Railway 해지 여부를 정하고, Railway 전용 스크립트·workflow와 `RAILWAY_*` 호환 코드를 정리한다.
- `docs/memory.md`·`docs/URLS.md`·`docs/devops/toolchain.md`에 현행 사실을 옮긴다.

## 열린 질문

- C2: 운영 GCP 프로젝트 선택(기본안 `green-e4fe3`)
- C3: 시험용 E2E 뒤 Preview env API 주소를 Railway 스테이징으로 되돌릴지
- C7: 처리방침 변경 공지·시행일 방식

<!-- Language: ko -->

# 운영 API Cloud Run 구축·전환 절차서

> 작성: 2026-10-23. 계획·결정의 정본은 [`api-hosting-cloud-run-plan.md`](api-hosting-cloud-run-plan.md)이고, 이 문서는 그 계획의 **실행 명령**만 소유한다.
> 각 단계(R1~R11)는 **사용자 승인을 받은 뒤에만** 실행한다. 승인은 단계 단위이고 다음 단계로 이어지지 않는다(AGENTS.md §3).
> 비밀값(JWT·PortOne·SMS 등)은 사용자가 자기 터미널에서 직접 넣는다. Claude는 값을 보거나 채팅에 옮기지 않는다.

## 고정값

| 항목 | 값 |
|---|---|
| 운영 프로젝트 | `green-e4fe3` (번호 `988412563635`) |
| 시험 프로젝트 | `greenhub-round-direct-e2e` |
| 리전 | `asia-northeast3`(서울, Firestore와 같음) |
| 운영 서비스 | `greenhub-api` |
| 시험 서비스 | `greenhub-api-staging` (`greenhub-api-<해시>` 형태와 겹치지 않게 반드시 이 이름) |
| 이미지 저장소 | `asia-northeast3-docker.pkg.dev/green-e4fe3/greenhub/api` |
| 런타임 서비스 계정 | `greenhub-api-runtime@green-e4fe3.iam.gserviceaccount.com` |
| 배포 서비스 계정 | `greenhub-api-deployer@green-e4fe3.iam.gserviceaccount.com` |
| Cloud Run 기본 주소 | `https://greenhub-api-988412563635.asia-northeast3.run.app` |
| 고정 주소 | `https://api.greenlove.co.kr` (구글 외부 애플리케이션 부하분산기, 2026-10-23 사용자 확정: 전환 때 바로, 11/10 첫 회차 전 완료) |

이 값은 `scripts/release/api-hosts.mjs`·`.github/workflows/production-deploy.yml`과 같아야 한다.

## 예상 월 비용(2026-10-23 추정, R1 직후 가격 계산기로 확인해 고친다)

| 항목 | 추정 |
|---|---|
| Cloud Run 1대 상시(1 vCPU·1 GiB, CPU 항상 할당, 서울은 2등급 요금) | 약 55달러 |
| 외부 부하분산기(전달 규칙 1개) | 약 18달러 + 트래픽 |
| Cloud NAT + 고정 IP 2개(송신·부하분산기) | 약 5~8달러 |
| Artifact Registry·Secret Manager | 1달러 안팎 |
| **합계** | **약 80달러(약 11만 원)** |

## 진행 기록

| 단계 | 상태 | 날짜 | 비고 |
|---|---|---|---|
| R0 | 완료 | 2026-10-23 | 아래 R0 |
| R1 | 완료 | 2026-10-24 | API 7개 켬. 기본 VPC `default`·서울 서브넷 `10.178.0.0/20` 있음. Compute API를 켜며 생긴 기본 Compute 서비스 계정에 `roles/editor`가 붙어 있다(R9 Cloud Build 전에 빌드 계정 지정 또는 권한 축소를 정한다) |
| R2 | 완료 | 2026-10-24 | 저장소 `greenhub`(정리 정책 최근 20개 유지·30일 지난 것 삭제). 저장소는 2026-10-23 17:07 UTC 같은 계정으로 먼저 만들어져 있었다(비어 있었음, 만든 세션 미확인) |
| R3 | 완료 | 2026-10-24 | `greenhub-api-runtime`(위와 같이 먼저 만들어져 있었고 권한은 없었음). 운영 버킷은 `green-e4fe3.firebasestorage.app`(`appspot.com` 버킷 없음) |
| R4 | 완료 | 2026-10-24 | `greenhub-api-deployer` |
| R5 | 완료 | 2026-10-24 | 풀 `github`·공급자 `greenhub-deploy`, GitHub `Production` 환경 변수 2개. 환경 이름이 `Production`이라 조건은 `production`·`Production`을 모두 받는다. 실제 토큰 교환은 첫 workflow 실행 때 확인한다. 이 변수가 생겨 이후 Railway 운영 배포마다 Cloud Run 예비 배포 3단계가 돈다(R9 전에는 마지막 단계 실패 표시, 운영 배포는 계속) |
| R6 | 준비 | 2026-10-24 | `scripts/deploy/cloud-run-env.mjs` |

## R0. 읽기 전용 점검 — 승인 불필요, 2026-10-23 실행

- 결제 연결: `billingEnabled=True`
- 켜져 있지 않은 API: `run`, `artifactregistry`, `secretmanager`, `compute`, `iamcredentials`, `sts`, `cloudbuild` (R1에서 켠다)
- `compute` API가 꺼져 있어 기본 VPC(`default`) 존재 여부는 R1 뒤에 다시 본다.

## R1. API 켜기 — 승인 필요

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com compute.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudbuild.googleapis.com --project=green-e4fe3
```

- 확인: `gcloud services list --enabled --project=green-e4fe3`에 7개가 보인다. `gcloud compute networks list --project=green-e4fe3`로 `default` VPC와 `asia-northeast3` 서브넷을 확인한다(없으면 R7 전에 만든다).
- 비용: 켜는 것만으로는 들지 않는다.
- 되돌리기: `gcloud services disable <API> --project=green-e4fe3`

## R2. 이미지 저장소 — 승인 필요

```bash
gcloud artifacts repositories create greenhub --repository-format=docker --location=asia-northeast3 --project=green-e4fe3 --description="greenhub API 이미지"
```

오래된 이미지는 최근 20개만 남긴다(정리 정책 파일은 이 단계에서 같이 만든다).

## R3. 런타임 서비스 계정 — 승인 필요

API가 쓰는 권한만 준다: Firestore 읽기·쓰기, Storage 객체(상품·배송 사진), Firebase 사용자 지정 토큰 서명(`createCustomToken`)·토큰 폐기(`revokeRefreshTokens`).

```bash
gcloud iam service-accounts create greenhub-api-runtime --project=green-e4fe3 --display-name="greenhub API 런타임"
SA=greenhub-api-runtime@green-e4fe3.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding green-e4fe3 --member="serviceAccount:$SA" --role=roles/datastore.user
gcloud projects add-iam-policy-binding green-e4fe3 --member="serviceAccount:$SA" --role=roles/firebaseauth.admin
gcloud storage buckets add-iam-policy-binding gs://<운영 FIREBASE_STORAGE_BUCKET> --member="serviceAccount:$SA" --role=roles/storage.objectAdmin
# createCustomToken은 키 파일 없이 자기 자신에게 signBlob을 요청한다.
gcloud iam service-accounts add-iam-policy-binding $SA --project=green-e4fe3 --member="serviceAccount:$SA" --role=roles/iam.serviceAccountTokenCreator
```

- 지금 Railway는 `FIREBASE_SERVICE_ACCOUNT_JSON`(키 파일)을 쓴다. Cloud Run은 이 키를 옮기지 않고 런타임 서비스 계정(ADC)으로 접속한다. 코드는 키가 없으면 ADC를 쓰므로 바꿀 것이 없다.
- 버킷 이름은 Railway 운영 변수 `FIREBASE_STORAGE_BUCKET` 값이다(비밀값 아님).

## R4. 배포 서비스 계정 — 승인 필요

```bash
gcloud iam service-accounts create greenhub-api-deployer --project=green-e4fe3 --display-name="greenhub API 배포(GitHub Actions)"
D=greenhub-api-deployer@green-e4fe3.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding green-e4fe3 --member="serviceAccount:$D" --role=roles/run.developer
gcloud artifacts repositories add-iam-policy-binding greenhub --location=asia-northeast3 --project=green-e4fe3 --member="serviceAccount:$D" --role=roles/artifactregistry.writer
gcloud iam service-accounts add-iam-policy-binding greenhub-api-runtime@green-e4fe3.iam.gserviceaccount.com --project=green-e4fe3 --member="serviceAccount:$D" --role=roles/iam.serviceAccountUser
```

## R5. GitHub Actions 키 없는 인증(Workload Identity Federation) — 승인 필요

`main`에서 `production-deploy.yml`을 `production` Environment로 실행한 job만 배포 계정을 쓸 수 있게 한다.

```bash
gcloud iam workload-identity-pools create github --project=green-e4fe3 --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc greenhub-deploy --project=green-e4fe3 --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.repository=='booker-lab/greenhub' && assertion.ref=='refs/heads/main' && assertion.environment in ['production','Production'] && assertion.workflow_ref.startsWith('booker-lab/greenhub/.github/workflows/production-deploy.yml@refs/heads/main')"
gcloud iam service-accounts add-iam-policy-binding greenhub-api-deployer@green-e4fe3.iam.gserviceaccount.com --project=green-e4fe3 \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/988412563635/locations/global/workloadIdentityPools/github/attribute.repository/booker-lab/greenhub"
```

GitHub `production` Environment 변수(비밀값 아님)를 넣는다. GitHub 설정 변경이라 따로 승인받는다.

```bash
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env production --body "projects/988412563635/locations/global/workloadIdentityPools/github/providers/greenhub-deploy"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --env production --body "greenhub-api-deployer@green-e4fe3.iam.gserviceaccount.com"
```

## R6. 비밀값·일반 값 옮기기 — 사용자가 직접, 승인 필요

옮길 이름과 옮기지 않는 이름(이유 포함)은 도구가 정본이다. API 코드가 새 환경 변수를 읽기 시작하면 도구의 분류 테스트가 실패해 분류를 추가하게 한다.

```bash
node scripts/deploy/cloud-run-env.mjs list
```

- **비밀값 10개 → Secret Manager**: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PORTONE_V2_SECRET`, `PORTONE_WEBHOOK_SECRET`, `KAKAO_ADMIN_KEY`, `ALIGO_API_KEY`, `ALIGO_SENDER_KEY`, `ALIGO_OUTBOUND_PROXY_URL`(Fixie, C8에서 정리), `GEMINI_API_KEY`, `OPS_TELEGRAM_BOT_TOKEN`
- **일반 값 → Cloud Run 환경 변수(R9의 `--env-vars-file`)**: 고정값 `NODE_ENV=production`, `GREENHUB_ENVIRONMENT_NAME`(프로젝트에 따라 production·staging), `GREENHUB_SCHEDULES_ENABLED=false`(전환 전까지)와 Railway에서 옮기는 `CORS_ORIGIN`, `FIREBASE_*`, `KAKAO_APP_ID`, `ALIGO_USER_ID`·`ALIGO_SENDER_PHONE`·`ALIGO_TEMPLATE_CODES_JSON`, `OPS_TELEGRAM_CHAT_ID`, `PORTONE_STORE_ID`, `TRUST_PROXY_HOPS`(R8 실측) 등
- **옮기지 않음**: `RAILWAY_*`, `PORT`, `FIREBASE_SERVICE_ACCOUNT_JSON`·`GOOGLE_APPLICATION_CREDENTIALS`(ADC로 대체), 로컬·단위 테스트·비운영 E2E 전용 값

**권장: Railway에서 바로 옮기기** — Railway 값을 먼저 최신으로 바꾼 뒤 실행한다. Railway project token(운영 환경용)을 가려서 입력받아 토큰의 환경이 `production`인지 확인하고, API 서비스 변수(공유 변수 포함)를 읽어 비밀값은 Secret Manager 새 버전으로, 일반 값은 아래 YAML로 쓴다. 붙여 넣기가 없어 Railway와 같은 값이 들어가고, Railway가 직접 만든 값(화면에 나오지 않는 무작위 값)도 옮길 수 있다. `TRUST_PROXY_HOPS`는 앞단 구성이 달라 옮기지 않는다. 이름 목록을 보여 준 뒤 프로젝트 이름을 입력해야 쓴다.

```bash
node scripts/deploy/cloud-run-env.mjs from-railway
```

새 버전을 넣으면 그 전의 켜진 버전은 끈다(삭제 아님, `gcloud secrets versions enable`로 되돌릴 수 있음). 아래 `secrets`·`env`는 Railway에 없는 값을 따로 넣거나 하나만 고칠 때 쓴다.

**비밀값** — 사용자가 자기 터미널(PowerShell)에서 실행한다. 이름마다 값을 화면에 보이지 않게 입력받아 gcloud 표준 입력으로만 Secret Manager에 넣고, 런타임 서비스 계정에 그 비밀값 읽기 권한을 준다. 이미 값이 있으면 묻고(기본은 건너뜀), 비우고 Enter면 건너뛴다. 값은 파일·명령 인자·로그에 남지 않는다.

```bash
node scripts/deploy/cloud-run-env.mjs secrets
```

일부만 넣을 때는 `--only=JWT_SECRET,JWT_REFRESH_SECRET`, 시험 프로젝트는 `--project=greenhub-round-direct-e2e`.

**일반 값** — 같은 방식으로 입력받아 저장소 밖 `%USERPROFILE%\.greenhub\cloud-run-green-e4fe3.env.yaml`에 쓴다(비밀값은 넣지 않는다).

```bash
node scripts/deploy/cloud-run-env.mjs env
```

- 확인(Claude, 값 없이 이름만): `gcloud secrets list --project=green-e4fe3 --format="value(name)"`, 각 비밀값의 런타임 계정 읽기 권한

## R7. 고정 송신 IP(Cloud NAT) — 승인 필요

ALIGO는 허용 IP에서 온 호출만 받는다. Cloud Run의 모든 송신을 VPC로 보내 NAT 고정 IP로 나가게 한다.

```bash
gcloud compute addresses create greenhub-api-egress --region=asia-northeast3 --project=green-e4fe3
gcloud compute routers create greenhub-api-router --network=default --region=asia-northeast3 --project=green-e4fe3
gcloud compute routers nats create greenhub-api-nat --router=greenhub-api-router --region=asia-northeast3 --project=green-e4fe3 \
  --nat-custom-subnet-ip-ranges=default --nat-external-ip-pool=greenhub-api-egress
gcloud compute addresses describe greenhub-api-egress --region=asia-northeast3 --project=green-e4fe3 --format="value(address)"
```

- 사용자: ALIGO 콘솔 허용 IP에 위 주소를 **추가**한다(Fixie IP는 그대로 둔다).

## R8. 시험 서비스(계획서 C3) — 승인 필요

`greenhub-round-direct-e2e` 프로젝트에 R1~R7과 같은 구성을 만들고(프로젝트·서비스 이름만 바꿈) `greenhub-api-staging`을 띄운다. 이 단계에서 정한다.

- **프록시 홉 수 실측**: 2026-10-18 Railway 실측과 같은 기준(접속자마다 다른 요청 한도 버킷, 클라이언트가 보낸 `X-Forwarded-For` 무시). **부하분산기 경유와 run.app 직접은 홉 수가 다를 수 있다.** 운영은 부하분산기 경유 값을 쓴다.
- 회차 E2E 1회(회차 64 + 세션 12), 원격 E2E 예산 규칙(`development-authority.md` §4.1)을 따른다.

## R9. 운영 서비스 만들기(트래픽 없음, 계획서 C5) — 승인 필요

첫 이미지는 Cloud Build로 만든다(로컬 Docker 불필요). 깨끗한 checkout에서 실행한다.

```bash
SHA=<배포할 40자리 SHA>
git -C <깨끗한 checkout> checkout $SHA
gcloud builds submit <깨끗한 checkout> --project=green-e4fe3 --region=asia-northeast3 --tag=asia-northeast3-docker.pkg.dev/green-e4fe3/greenhub/api:$SHA
```

```bash
gcloud run deploy greenhub-api --project=green-e4fe3 --region=asia-northeast3 \
  --image=asia-northeast3-docker.pkg.dev/green-e4fe3/greenhub/api:$SHA \
  --service-account=greenhub-api-runtime@green-e4fe3.iam.gserviceaccount.com \
  --allow-unauthenticated --ingress=all \
  --min-instances=1 --max-instances=1 --no-cpu-throttling --cpu=1 --memory=1Gi --concurrency=80 --timeout=60 \
  --network=default --subnet=default --vpc-egress=all-traffic \
  --startup-probe=httpGet.path=/health,periodSeconds=5,timeoutSeconds=5,failureThreshold=12 \
  --env-vars-file=<R6 env로 만든 YAML> \
  --set-secrets=JWT_SECRET=JWT_SECRET:latest,<R6에서 넣은 비밀값 이름=이름:latest ...>
```

```bash
# --env-vars-file과 --update-env-vars는 한 명령에 함께 쓸 수 없어, 커밋 SHA는 만든 뒤 따로 넣는다.
gcloud run services update greenhub-api --project=green-e4fe3 --region=asia-northeast3 --update-env-vars=GREENHUB_COMMIT_SHA=$SHA
```

- **정기 작업은 끈 채로**(`GREENHUB_SCHEDULES_ENABLED=false`) 둔다. 두 서버가 함께 매분 작업을 돌리지 않게 한다.
- 시작 검사(`/health`, Firestore 한 건 읽기)를 통과해야 리비전이 Ready가 된다. 이후 배포 도구(`production-deploy.mjs cloudrun`)도 이 검사를 통과한 리비전에만 트래픽을 옮긴다.
- 확인: `curl https://greenhub-api-988412563635.asia-northeast3.run.app/health` 200·commit 일치, CORS preflight, 고정 IP에서 ALIGO 읽기 전용 조회 `code=0`(발송 없음).
- 이후 배포는 GitHub Actions `Production deploy`를 `api_platform=cloudrun`, `scope=api`로 실행한다.
- 전환 전에는 Railway 운영 배포(`api_platform=railway`)가 끝날 때마다 같은 workflow가 이 서비스에도 같은 SHA를 예비로 배포한다(R5의 GitHub 변수가 있을 때만, 실패해도 운영 배포는 계속. 2026-10-23 사용자 결정, [`railway-outage-failover.md`](railway-outage-failover.md)).

## R10. 고정 주소 `api.greenlove.co.kr`(부하분산기) — 승인 필요

```bash
P="--project=green-e4fe3"
gcloud compute network-endpoint-groups create greenhub-api-neg --region=asia-northeast3 --network-endpoint-type=serverless --cloud-run-service=greenhub-api $P
gcloud compute backend-services create greenhub-api-backend --global --load-balancing-scheme=EXTERNAL_MANAGED $P
gcloud compute backend-services add-backend greenhub-api-backend --global --network-endpoint-group=greenhub-api-neg --network-endpoint-group-region=asia-northeast3 $P
gcloud compute url-maps create greenhub-api-urlmap --default-service=greenhub-api-backend --global $P
gcloud compute ssl-certificates create greenhub-api-cert --domains=api.greenlove.co.kr --global $P
gcloud compute target-https-proxies create greenhub-api-https --url-map=greenhub-api-urlmap --ssl-certificates=greenhub-api-cert --global $P
gcloud compute addresses create greenhub-api-ip --global $P
gcloud compute forwarding-rules create greenhub-api-https-rule --global --load-balancing-scheme=EXTERNAL_MANAGED --target-https-proxy=greenhub-api-https --address=greenhub-api-ip --ports=443 $P
gcloud compute addresses describe greenhub-api-ip --global $P --format="value(address)"
```

- 사용자: 가비아 DNS에 `A api → <위 주소>`를 추가한다. 관리형 인증서는 DNS가 퍼진 뒤 ACTIVE가 된다(보통 15~60분, `gcloud compute ssl-certificates describe greenhub-api-cert --global $P`).
- 확인: `curl https://api.greenlove.co.kr/health` 200·commit 일치.
- **홉 수 재확인**: 부하분산기 경유로 R8과 같은 실측을 하고 `TRUST_PROXY_HOPS`를 맞춘다.
- 전환 전에는 `api.greenlove.co.kr`이 정기 작업이 꺼진 Cloud Run을 가리키며, 아무 앱도 아직 이 주소를 쓰지 않는다.

## R11. 전환(계획서 C7) — 승인 필요, 계획서 C7 순서를 따른다

계획서 C7의 주소를 `api.greenlove.co.kr`로 읽는다. 추가로 다음을 같은 날 한다.

1. 세 앱 운영 `NEXT_PUBLIC_API_URL`, PortOne 웹훅 주소, `uptime.yml`, `scripts/release/post-deploy-smoke.mjs`의 `PRODUCTION_TARGETS.api`를 `https://api.greenlove.co.kr`로 바꾼다.
   - **주의(전환 전에 해결)**: 같은 SHA로 Vercel 운영을 다시 배포하면 빌드 생략 규칙(`scripts/vercel/ignore-build.mjs`)이 "바뀐 것 없음"으로 보고 CANCELED한다. 그러면 바꾼 `NEXT_PUBLIC_API_URL`이 반영되지 않는다. 재배포는 `production-deploy.mjs vercel --require-build=true`로 해서 생략되면 실패로 드러나게 하고, 빌드를 실제로 일으키는 방법(예: Vercel 대시보드 Redeploy가 생략 규칙을 거치는지, 생략 규칙에 운영 강제 빌드 경로를 둘지)은 R8·R10 사이에 Preview로 확인해 이 항목에 적는다.
2. `production-deploy.yml`의 `api_platform` 기본값을 `cloudrun`으로, `CLOUD_RUN_API_BASE`를 `https://api.greenlove.co.kr`로 바꾼다.
3. **run.app 직접 접속을 막는다**: `gcloud run services update greenhub-api --ingress=internal-and-cloud-load-balancing --project=green-e4fe3 --region=asia-northeast3`. 열어 두면 run.app으로 들어온 요청이 `X-Forwarded-For`를 꾸며 요청 한도를 피할 수 있다(홉 수를 부하분산기 기준으로 맞췄기 때문).

**되돌리기**: 계획서 C7의 되돌리기와 같다. ingress를 `all`로 되돌리면 run.app 주소도 다시 쓸 수 있다.

## 배포 중 겹침

- Cloud Run 배포는 새 리비전이 시작 검사를 통과한 뒤 트래픽을 옮긴다. 그사이 잠깐 이전·새 리비전이 함께 떠 있을 수 있고, 정기 작업이 켜진 뒤라면 두 리비전에서 같은 작업이 겹칠 수 있다(Railway 배포 겹침과 같은 성격). 하루 1회 작업은 job lease가 막고, lease 없는 매분 작업(결제 대기 정리 등)은 계획서 "여러 대 자동 확장" 항목의 확인 대상이다.

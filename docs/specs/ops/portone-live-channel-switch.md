<!-- Language: ko -->

# PortOne 결제 채널을 LIVE로 바꾸기 — consumer 강제 빌드와 번들 확인

> 작성: 2026-10-30 · 상태: **도구 준비됨(운영에서 아직 실행 안 함)** · 기한: 첫 회차 주문 개방 2026-11-22(일) 10:00 KST 전
> **함께 볼 문서**: `docs/BACKLOG.md` `PORTONE-CHANNEL-CHECK`(순서·결정의 정본), `.github/workflows/production-deploy.yml`, `railway-outage-failover.md` "함정"(빌드 생략 규칙 실측)
>
> 이 문서에 순서가 적혀 있어도 운영 변경 승인은 아니다. Vercel 환경 변수 변경과 운영 배포는 그때 사용자가 승인한다.

## 왜 따로 순서가 필요한가

- consumer는 PortOne 채널 키를 `NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY`·`NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY`·`NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY`에서 읽고(`apps/consumer/src/lib/portone-config.ts`), Next는 이 값을 **빌드 때 JS 번들에 글자로 굳힌다.** Vercel에서 값만 바꾸면 새로 빌드해야 반영된다.
- 값만 바꾸고 같은 SHA로 다시 배포하면 앱 빌드 생략 규칙(`scripts/vercel/ignore-build.mjs`)이 바뀐 파일 0개로 보고 빌드를 생략한다(CANCELED). 운영 배포 도구는 이것을 `status: "skipped"`로 남기고 배포는 성공으로 끝난다. 그러면 consumer는 계속 TEST 키로 결제창을 열고, LIVE 채널을 요구하는 API(#426, `requireLiveChannel: true`)는 그 결제를 확정하지 않고 환불·취소한다.
- 그래서 LIVE 전환은 **환경 변수 변경 → 강제 빌드 → 번들 확인** 세 단계를 한 묶음으로 한다.

## 도구

| 무엇 | 어디 | 동작 |
| --- | --- | --- |
| 강제 빌드 | 운영 배포 workflow 입력 `require_build`(기본 `none`) | 고른 앱(`consumer`·`seller`·`driver`·`all`)만 `production-deploy.mjs vercel --require-build=true`로 배포한다. 생성 요청에 `skipIgnoreBuildStep=1`을 붙여 생략 규칙을 건너뛰고, 그래도 CANCELED면 실패로 멈춘다. 고르지 않은 앱은 평소처럼 생략 규칙을 따른다. 프런트를 배포하지 않는 scope(`api`·`indexes`·`rules`)에서 고르면 gate에서 멈춘다. |
| 번들 확인 | 운영 배포 workflow 입력 `expect_portone_channels`(기본 빈 값) → `post-deploy-smoke.mjs --expect-portone-channels=<앞부분>[,<앞부분>]` | consumer 운영 `/sw.js`의 precache 목록에서 JS 청크를 모두 읽어 `channel-key-…`를 모은다(결제 화면은 로그인해야 열려 페이지 HTML로는 청크를 못 찾는다). **번들의 모든 키가 기대 앞부분 중 하나로 시작하고, 기대 앞부분마다 번들에 키가 하나 이상 있어야** 통과한다. 목록·키를 못 찾아도 실패다. 키 값은 출력하지 않고 sha256 앞 10자리(지문)만 남긴다. |

기대값은 키 **앞부분**이다. `channel-key-` 뒤에 8자 이상을 붙인다(예: `channel-key-1a2b3c4d`). 형식이 다르면 점검이 시작 전에 멈춘다. 채널 키는 원래 브라우저 번들에 공개되는 값이라 앞부분이 run 입력에 보여도 새로 드러나는 것은 없지만, 키 전체를 문서·채팅에 붙이지 않는다.

내 키의 지문은 이렇게 계산해 점검 출력과 비교한다(키는 셸 기록에 남지 않게 붙여 넣는다).

```bash
read -rs KEY && printf %s "$KEY" | sha256sum | cut -c1-10; unset KEY
```

## 현재 기준(2026-10-30 운영 번들 직접 확인)

- 운영 consumer 번들의 채널 키 2개: 카드 지문 `9f5573fd78`, 카카오페이 지문 `242205c4a0`. 네이버페이 키는 비어 있어 선택지에 없다(`payment-method-options.ts`).
- 둘 다 지금은 TEST 채널로 본다(`PORTONE-CHANNEL-CHECK` 2026-10-13: 운영 상점에 TEST 채널만 있음). LIVE 전환 뒤에는 이 두 지문이 번들에서 사라져야 한다.

## 순서

### 0. 준비(사용자)

1. PortOne 콘솔 실연동 탭에 LIVE 채널이 생겼는지 본다(`PORTONE-CHANNEL-CHECK` 1단계).
2. **카드도 정한다.** consumer는 키가 있는 결제수단을 모두 선택지로 보인다. 카카오페이만 LIVE로 바꾸고 카드 키를 TEST로 두면 카드 결제가 모두 환불·취소된다. 카드 LIVE 키로 바꾸거나, 카드 LIVE가 없으면 Production의 `NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY`를 지워 카드 선택지를 숨긴다.
3. 다시 배포할 SHA를 정한다. 환경 변수만 바꾸는 경우 **지금 운영 consumer가 쓰는 SHA**(최근 `prod-*` GitHub Release의 SHA)와 그 SHA로 통과한 원격 회차 E2E run ID를 그대로 쓴다. 새 SHA를 함께 내보낸다면 평소 배포 순서(E2E 먼저)를 따른다.

### 1. 환경 변수 바꾸기(사용자, Vercel)

- `greenhubconsumer` 프로젝트 → Settings → Environment Variables에서 **Production 값만** LIVE 키로 바꾼다(`NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY`, 0-2에 따라 카드도). Preview·Development는 TEST로 둔다(원격 E2E가 TEST 채널을 쓴다).
- `NEXT_PUBLIC_PORTONE_STORE_ID`는 바꾸지 않는다(같은 상점의 LIVE 채널). API `PORTONE_STORE_ID`와 같아야 한다(`prod-config-check`).
- 이 단계만으로는 운영 사이트가 바뀌지 않는다. Vercel 화면의 "Redeploy" 안내는 따르지 않고 2단계 workflow로 배포한다(화면 Redeploy는 생략 규칙 체크를 끄지 않으면 CANCELED된다).

### 2. 강제 빌드(사용자 승인 뒤 workflow)

Actions → **Production deploy** → Run workflow(main):

| 입력 | 값 |
| --- | --- |
| `sha` | 0-3에서 정한 SHA |
| `e2e_run_id` | 그 SHA로 통과한 회차 E2E run ID |
| `scope` | `frontends`(새 SHA를 함께 내보내면 `all`) |
| `api_platform` | 지금 운영 API 대상(전환 전 `railway`) |
| `require_build` | `consumer` |
| `expect_portone_channels` | LIVE 카카오페이 키 앞부분(카드도 LIVE면 쉼표 뒤에 카드 키 앞부분) |
| `approval` | `PRODUCTION_DEPLOY_APPROVED` |

seller·driver는 같은 SHA라 평소처럼 `skipped`로 끝나는 것이 정상이다.

### 3. 확인

- run 요약의 `consumer(Vercel)` 결과가 `"status":"deployed"`다(`skipped`면 workflow가 이미 실패로 멈춘다).
- `post-deploy-smoke`에 `✅ consumer 번들 PortOne 채널 키가 기대값`이 있다.
- 실패 메시지가 `기대값 밖의 키 N개(sha256 …)`이면 번들에 다른 키가 남아 있다. 지문이 위 현재 기준(`9f5573fd78`·`242205c4a0`)이면 TEST 키다. Vercel Production 값을 다시 확인하고 2단계를 다시 실행한다. `번들에 없는 기대값 k번째`이면 그 LIVE 키가 빌드에 들어가지 않았다.
- workflow 없이 지금 운영 번들만 다시 보려면(읽기 전용):

```bash
node scripts/release/post-deploy-smoke.mjs --expect-portone-channels=channel-key-XXXXXXXX
```

### 4. 이어지는 일

- 실제 결제·환불 1건 시험(`docs/BACKLOG.md` NEXT 항목). 주문 개방(11/22 10:00 KST) 전에 끝낸다.
- API #426(`requireLiveChannel`) 배포는 consumer가 LIVE로 바뀐 뒤에 한다. 순서가 바뀌면 그 사이의 결제가 TEST 채널이라 환불·취소된다(`PORTONE-CHANNEL-CHECK` 4단계).
- 3단계 확인이 주문 개방 전에 끝나지 않으면 `ops-reschedule-round.yml`로 회차를 다시 미룬다(2026-10-28 사용자 결정과 같은 방식).

## 되돌리기

consumer를 TEST 키로 되돌리는 것은 1·2단계를 TEST 값으로 반복하면 되지만, LIVE를 요구하는 API가 나간 뒤라면 TEST로 되돌린 consumer의 결제는 모두 환불·취소된다. 그때는 키를 되돌리기보다 회차를 미룬다.

## 아직 증명하지 않은 것

- `require_build`·`expect_portone_channels`는 로컬 단위 테스트(`scripts/release/production-deploy.spec.mjs`, `post-deploy-smoke.spec.mjs`)와 2026-10-30 운영 번들 읽기(틀린 기대값으로 실패하고 지문 2개만 출력)로만 확인했다. 운영 workflow로는 아직 실행하지 않았다.
- `skipIgnoreBuildStep=1` 자체는 2026-10-29 Preview 리허설에서 확인했다(`railway-outage-failover.md`). 첫 운영 실행 때 Vercel 빌드 로그에 "Ignore Build Step was explicitly skipped for this deployment."가 찍혔는지 함께 본다.

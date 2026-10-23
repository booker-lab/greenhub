# 아침 운영 점검 보고 (어드민 운영 자동화 1단계)

> **상태**: 설계 확정(2026-10-21 사용자 결정) · S1~S3 구현(`scripts/ops/morning-check*.mjs`, 운영 접근 없음) · S0(열쇠 발급)은 사람 대기
> **범위**: 1단계 = 읽기 전용 아침 점검만. 2단계(결정 대기함)와 3단계(규칙 기반 자동 실행)는 파일럿(11/1) 이후로 미룬다.
> **관련**: 서버 아침 요약 `ops-alerts.md`(08:30 텔레그램), 어드민 행동 기록 `adminAuditLogs`(커밋 `88c1235d`), 관제판 `/board`

## 0. 사용자 확정 사항 (2026-10-21)

| # | 결정 | 확정 내용 |
|---|---|---|
| D1 | 누가 데이터를 보나 | 에이전트 전용 **읽기만 되는 열쇠**(새 서비스 계정)로 에이전트가 직접 본다. 서버 요약을 늘리는 방식은 고르지 않았다 |
| D2 | 어디서 돌리나 | **이 PC의 예약 작업.** 열쇠는 저장소 밖 폴더에 이 PC에만 둔다. PC가 꺼진 날은 점검이 없다 |
| D3 | 무엇을 보나 | 4묶음 전부: 돈 · 주문 흐름 · 사람 대기 · 서버 이상 |
| D4 | 주문 지연 기준 | **지난 것 + 오늘 예고**: 배송 마감이 지났는데 미완료인 주문, 그리고 오늘 배송인데 준비 전이거나 기사가 없는 주문 |
| D5 | 이상 기준 | §2 기준표 그대로 시작하고, 1주 운영 후 조정한다 |
| D6 | 전달 | **07:30 Claude 앱 휴대폰 알림 + 관제판.** 서버 08:30 텔레그램 요약은 대비책으로 유지한다 |
| D7 | 손님 정보 | 보고에는 **주문번호·가게 이름·금액만** 담는다. 점검 프로그램이 손님 이름·전화·주소를 아예 읽지 않는다 |

## 1. 목적과 범위

사용자는 일을 에이전트에게 맡기고 판단과 결과 보고만 받는다. 1단계에서 에이전트는 매일 아침 운영 데이터를 **읽고**, 이상한 것을 골라 **사람이 내릴 결정**과 함께 보고한다. 실행(환불, 지급, 정지, 알림 발송, 데이터 수정)은 언제나 사람이 어드민 버튼으로 하고, 그 행동은 `adminAuditLogs`에 남는다.

**하지 않는 것**
- 데이터를 고치거나, 손님·판매자·기사에게 알림을 보내거나, 돈을 움직이지 않는다.
- 결정 대기함, 버튼 하나로 승인하는 흐름(2단계)과 자동 실행(3단계)은 다루지 않는다.
- 서버 오류 로그 수집(Sentry 등)을 새로 들이지 않는다. 지금 오류는 Railway 콘솔 로그에만 있다(§2-4 참고).

## 2. 점검 항목표

수준: 🔴 1건만 있어도 알림 첫 줄에 올린다 · 🟡 목록에만 보인다 · 🟢 이상 없음.
"사람이 내릴 결정"은 보고에 그대로 적어 보낸다. 에이전트는 추천을 덧붙일 수 있지만 실행하지 않는다.

### 2-1. 돈

| ID | 왜 보는지 | 이상 기준 | 사람이 내릴 결정 |
|---|---|---|---|
| M1 지급 후 환불 | 판매자에게 이미 지급한 정산의 주문이 환불되어도 시스템은 경고 로그만 남기고 정산은 `paid`로 둔다. 회수할 돈이 아무 데도 기록되지 않는다 | 🔴 정산 `status=='paid'`인데 주문 `status=='CANCELLED'`이거나 결제 `refundedAt`이 있음. 1건부터 | 판매자에게 돌려받기 / 다음 정산에서 빼기 / 그냥 두기. 정책 자체가 미정이다(재감사 결정 대기 "지급된 정산의 주문 환불: 차단 vs 회수 표시") |
| M2 수수료율 차이 | 어드민에서 가게 수수료율을 바꿔도 정산은 전역 5%(`PLATFORM_FEE_RATE`)로만 계산한다. 화면 값과 실제 돈이 다르다 | 🟡 `stores.commissionRate`가 있고, 그 가게 최근 정산의 `platformFeeRate`와 다름. 평소에는 "N곳 · 정책 결정 대기" 한 줄만 보이고, 새로 생기거나 바뀐 날에만 가게별로 자세히 보인다 | 가게별 율을 정산에 반영할지(코드 변경 필요), 화면 값을 기본값으로 되돌릴지 |

### 2-2. 주문 흐름

| ID | 왜 보는지 | 이상 기준 | 사람이 내릴 결정 |
|---|---|---|---|
| O1 배송 마감 지남 | 손님이 이미 기다리고 있다 | 🔴 회차의 `schedule.deliveryEndAt`이 지났는데 주문이 미완료(`DELIVERED`·`PICKED_UP`·`REVIEWED`·`CANCELLED`가 아님). 회차가 없는 일반 주문은 `requestedDeliveryDate`가 지난 것으로 본다. 날짜가 없는 주문은 `updatedAt`이 48시간 넘게 그대로면 🟡로 올리고 "짐작"이라고 표시한다 | 판매자·기사에게 연락할지, 손님에게 안내할지, 필요하면 어드민에서 강제 환불할지 |
| O2 오늘 배송인데 준비 전 | 아침에 알면 오늘 안에 막을 수 있다 | 🟡 오늘(KST)이 `schedule.deliveryStartAt`인 회차의 주문이 아직 `ACCEPTED`·`CONFIRMED`(준비 시작 전) | 판매자에게 확인 연락을 할지 |
| O3 기사 미배정 | 준비가 끝났는데 가져갈 사람이 없다 | 🟡 O2와 같은 회차에서 `PREPARING`이면서 `driverId`가 없음(직배송 `deliveryMethod=='direct'`만 해당) | 기사에게 배정을 요청하거나 직접 연락할지 |
| O4 배송 보류 장기화 | 보류는 사람이 풀어야 끝난다 | 🟡 `DELIVERY_HELD`이면서 `deliveryHold.resolvedAt`이 없고 `deliveryHold.heldAt`이 24시간을 넘음 | 재배송 일정을 잡을지, 취소할지 |

주문에는 상태별 시각 필드가 없다(`updatedAt` 하나뿐). 그래서 O1·O2는 회차 일정을 기준으로 판정한다. 일정이 없는 경우만 짐작치를 쓴다.

구현 판단(S1, 2026-10-21):
- O1의 "미완료"에서 `PENDING`(결제 전 주문)은 뺀다. 손님이 결제를 끝내지 않은 주문이라 배송 지연이 아니다.
- O1 짐작(날짜 없음 + `updatedAt` 48시간)에서 `DELIVERY_HELD`는 뺀다. 보류 시각이 있는 O4가 같은 주문을 더 정확히 본다.
- 시간 경계: "지났다"는 마감 < 지금, "넘었다"는 경과 > 기준(같으면 아직 아님), "최근 24시간"은 지금-24시간 < 시각 ≤ 지금이다.

### 2-3. 사람 대기

| ID | 왜 보는지 | 이상 기준 | 사람이 내릴 결정 |
|---|---|---|---|
| P1 기사 승인 대기 | 가입한 기사는 승인 전에는 일을 받을 수 없다 | 🟡 `users`에서 `role=='driver'`이고 `driverApproved==false`이며 `suspended`가 아님. 1명부터 | 어드민 기사 탭에서 승인할지, 정지할지 |
| P2 초대 만료 임박 | 72시간이 지나면 초대 링크가 사라진다 | 🟡 `invites`에서 `usedAt`과 `revokedAt`이 없고 `expiresAt`이 24시간 안 | 다시 보낼지, 그냥 둘지 |

판매자 쪽에는 "승인 대기" 상태가 없다. API는 가게를 항상 `active`로 만들고, `invited`를 기록하는 코드도 없다. 그래서 "승인 대기 판매자"는 P2(안 쓴 초대)로만 본다.

### 2-4. 서버 이상

| ID | 왜 보는지 | 이상 기준 | 사람이 내릴 결정 |
|---|---|---|---|
| S1 보안 사건 | 돈이나 계정이 공격받고 있다는 신호다 | 🔴 지난 24시간 `auditLogs`에 `payment.amount_tampered`·`payment.webhook.invalid_sig`·`auth.token.stolen`이 1건이라도 있음 | 해당 결제·계정을 확인할지. 토큰 도난은 서버가 이미 그 계정의 세션을 모두 끊었다 |
| S2 로그인 실패 급증 | 비밀번호를 마구 넣어 보는 시도일 수 있다 | 🟡 지난 24시간 `auth.login.failed`가 10건 이상이면서 직전 7일 하루 평균의 3배 이상 | 지켜볼지, 계정 잠금 도구를 쓸지 |
| S3 운영 확인 기록 | 결제 조회 실패, 환불 실패처럼 서버가 사람에게 넘긴 일이다 | 🔴 `operationIssues`에 `status=='OPEN'`이면서 `severity=='critical'`인 기록 · 🟡 `warning`인 기록 | 판매자 앱 "운영 확인"에서 처리할지 |
| S0 점검 실패 | 점검이 조용히 멈추면 이상이 없다고 착각하게 된다 | 🔴 열쇠 만료, 권한 오류, 읽기 실패, 예상하지 않은 열쇠 사용(§4-2) | 열쇠·PC 상태를 확인할지 |

서버 자체의 오류 기록(예외·500 응답)은 Sentry 같은 수집기가 없어 볼 수 없다. 서비스가 응답하는지는 GitHub `uptime.yml`이 15분마다 따로 본다.

## 3. 데이터 경로

### 3-1. 선택: 읽기 전용 서비스 계정 (D1·D2)

- 운영 Firebase 프로젝트에 **점검 전용 서비스 계정**을 새로 만들고, IAM 역할은 **Cloud Datastore 뷰어(`roles/datastore.viewer`)** 하나만 준다. 쓰기는 Google 서버가 막는다.
- 열쇠 파일은 이 PC의 `C:\Users\tazan\.claude\greenhub-ops\` 아래에만 둔다. 저장소, GitHub 비밀값, 클라우드 어디에도 올리지 않는다.
- 점검 프로그램 `scripts/ops/morning-check.mjs`(공개 저장소, 비밀값 없음)가 이 열쇠로 Firebase Admin SDK에 읽기 요청만 보낸다.

### 3-2. 검토하고 고르지 않은 경로

| 경로 | 고르지 않은 이유 |
|---|---|
| 서버 `OpsDigestService.collect()` 확장 | 새 열쇠가 필요 없어 가장 안전했다. 다만 항목을 바꿀 때마다 운영 배포가 필요하고, 에이전트가 원인을 따져 볼 수 없다. 사용자가 D1에서 고르지 않았다 |
| 어드민 계정으로 로그인해 API 호출 | 받은 토큰으로 쓰기도 할 수 있다. 새로 받은 refresh 토큰을 매번 저장해야 하고, 실수로 옛 토큰을 쓰면 그 계정의 모든 세션이 끊긴다. 응답에 손님 정보 원문도 섞여 온다 |
| Firestore 클라이언트 SDK(관리자 custom token) | 보안 규칙상 관리자도 주문·정산·운영 기록을 읽을 수 없다 |
| 운영 Admin 키(`FIREBASE_SERVICE_ACCOUNT_JSON`, `apps/api/firebase-adminsdk.json`) | 모든 쓰기 권한이 있다. 10/20 교체한 키를 다시 퍼뜨리지 않는다 |
| 클라우드 예약 에이전트·GitHub 예약 | 열쇠를 PC 밖에 둬야 한다(D2에서 고르지 않음) |

### 3-3. 읽는 컬렉션과 필드 (허용 목록)

모든 조회는 `select()`(또는 `getAll`의 `fieldMask`)로 **아래 필드만** 가져온다. 목록에 없는 필드는 Firestore가 아예 보내지 않으므로 에이전트 손에 들어오지 않는다(D7).

| 컬렉션 | 조건 | 가져오는 필드 |
|---|---|---|
| `settlements` | `status=='paid'` | `status`, `storeId`, `orderNumber`, `netAmount`, `platformFeeRate`, `paidAt` |
| `settlements` | 최근 30일 `settledAt` | `storeId`, `platformFeeRate`, `settledAt` |
| `orders` | M1 대상 문서 id로 `getAll` | `status`, `storeId`, `orderNumber` |
| `payments` | M1 대상 문서 id로 `getAll` | `status`, `refundedAt`, `refundAmount` |
| `stores` | 전체(파일럿 규모) | `name`, `status`, `commissionRate` |
| `saleRounds` | 배송 마감이 최근 7일 안이거나 배송 시작이 오늘인 회차 | `storeId`, `name`, `status`, `schedule.deliveryStartAt`, `schedule.deliveryEndAt` |
| `orders` | 위 회차 id별 `roundId==` | `status`, `storeId`, `orderNumber`, `roundId`, `deliveryMethod`, `driverId`, `totalAmount`, `updatedAt` |
| `orders` | 회차 없는 미완료 주문(`status in` 진행 중 상태) | `status`, `storeId`, `orderNumber`, `requestedDeliveryDate`, `updatedAt`, `roundId` |
| `orders` | `status=='DELIVERY_HELD'` | `status`, `storeId`, `orderNumber`, `deliveryHold.heldAt`, `deliveryHold.resolvedAt`, `deliveryHold.reasonCode` |
| `users` | `role=='driver'` | `role`, `driverApproved`, `suspended`, `createdAt` |
| `invites` | `expiresAt` 가 지금~24시간 뒤 | `expiresAt`, `usedAt`, `revokedAt`, `createdAt` |
| `auditLogs` | `createdAt` 최근 8일 | `action`, `createdAt` |
| `operationIssues` | `status=='OPEN'` | `type`, `severity`, `storeId`, `createdAt` |

**읽지 않는 필드(금지 목록, 테스트로 고정)**: `deliveryAddress`, `deliveryPhone`, `requestNote`, `gift`, `buyerName`, `buyerPhone`, `address`, `userId`, `deliveryHold.reasonMessage`, `recipientEmail`, `ip`, `detail`, `passwordHash`, `savedAddresses`, `activeSessionIds`, 이름·전화·이메일 필드 전부. 이 목록은 문서마다 필드가 늘어날 수 있으므로, 허용 목록 방식이 기준이고 금지 목록은 검사용이다.

**회차 조회**: 회차 일정(`schedule.*`)은 ISO 문자열이고 시차 표기(`Z`·`+09:00`)가 섞일 수 있어 문자열 범위 조회를 쓰지 않는다. `saleRounds`는 위 필드만 전체를 읽어 메모리에서 고르고, 고른 회차의 주문만 조회한다(파일럿 규모).

**인덱스**: 조건은 모두 필드 하나짜리 등호·범위라 Firestore 기본 인덱스로 충분하다. 두 필드를 섞어야 하는 판정(예: `action`과 `createdAt`)은 메모리에서 거른다. 파일럿 데이터 규모에서는 문제가 없다. 새 복합 인덱스는 만들지 않는다.

**테스트 가게 제외**: 운영 DB에는 E2E가 쓰는 고정 주문(`scripts/seed-e2e-orders.mjs`의 `20260101-00000x` 등)이 사는 테스트 가게가 있다. 이 주문을 지우거나 취소하면 원격 E2E가 깨지므로, 점검에서 뺀다. 뺄 가게 id는 공개 저장소가 아니라 로컬 `config.json`의 `excludeStoreIds`(선택, 가게 id 문자열 목록)에만 둔다. 그 가게의 주문·정산·회차·운영 확인 기록은 판정 전에 덜어내고, 보고에는 뺀 가게 수(`excludedStores`)만 남긴다. 모양이 틀리면 S0으로 멈춘다(2026-10-24 첫 운영 실행에서 이 주문들이 매일 🔴로 뜨는 것을 확인하고 사용자 결정으로 추가).

**읽기 비용**: 파일럿 규모(주문 수백 건 이하)에서 하루 수천 건 이하의 읽기다. 무료 할당(하루 5만 건) 안이다.

## 4. 권한 경계

### 4-1. 누가 무엇을 하나

| 하는 일 | 에이전트 | 사람 |
|---|---|---|
| 운영 데이터 읽기(§3-3 허용 필드만) | ✅ | ✅ |
| 이상 판정, 원인 추정, 추천 작성 | ✅ | ✅ |
| 관제판 갱신, 휴대폰 알림(사용자 본인에게만) | ✅ | — |
| 환불, 정산 지급, 수수료율 변경, 정지·승인, 초대 발급 | ❌ | ✅ 어드민 버튼(행동 기록 남음) |
| 손님·판매자·기사에게 알림톡·문자·연락 | ❌ | ✅ |
| 운영 데이터 수정·삭제, 운영 환경 변수·배포 | ❌ | ✅ |
| 점검 열쇠 만들기·교체·폐기 | ❌ | ✅ (§6 S0) |

### 4-2. 겹겹의 차단 장치

1. **Google 서버**: 서비스 계정 역할이 뷰어뿐이라 쓰기 요청은 권한 오류로 거부된다.
2. **점검 프로그램**
   - 열쇠 경로를 환경 변수 `GREENHUB_OPS_READONLY_KEY`에서만 받는다. 다른 스크립트처럼 `apps/api/firebase-adminsdk.json`으로 넘어가지 **않는다**.
   - 열쇠의 `client_email`이 로컬 설정에 적힌 점검 계정 이메일과 다르면 S0으로 멈춘다. 운영 Admin 키를 실수로 물려도 돌지 않는다.
   - 소스에 쓰기 메서드(`set`·`update`·`delete`·`add`·`create`·`batch`·`runTransaction`·`bulkWriter`)가 없음을 테스트로 고정한다.
3. **에이전트 권한 규칙**: Claude 설정에 열쇠 폴더 `Read` 금지 규칙을 넣어, 에이전트가 열쇠 파일 내용을 읽거나 출력하지 못하게 한다. 허용은 점검 프로그램 실행 한 가지뿐이다.
4. **보고 내용**: 주문번호·가게 이름·금액·건수만 담는다. 비밀값, 토큰, 계정 이메일, 사용자 id는 넣지 않는다.

### 4-3. 열쇠가 새면

- 쓰기는 못 하지만 운영 데이터 전체(손님 정보 포함)를 **읽을 수 있다.** Firestore IAM은 컬렉션별로 권한을 나눌 수 없다.
- 대응: Google Cloud 콘솔에서 해당 열쇠를 삭제하면 즉시 무효가 된다. 90일마다 새 열쇠로 바꾸고 옛 열쇠를 삭제한다. 점검 프로그램은 열쇠를 만든 날을 로컬 설정에서 읽어 80일이 지나면 🟡로 알린다.

## 5. 실행과 전달

### 5-1. 흐름 (매일 07:30 KST, 이 PC)

1. Claude 데스크톱 **예약 작업**이 07:30에 점검 세션을 연다.
2. 세션이 `node scripts/ops/morning-check.mjs`를 실행한다. 결과는 JSON 한 덩어리로 나온다(건수, 수준, 주문번호·가게 이름 목록).
3. 결과를 `C:\Users\tazan\.claude\greenhub-ops\reports\YYYY-MM-DD.json`에 저장하고 전날 결과와 비교한다. 이 비교로 "새로 생김 / 어제부터 계속"을 표시하고, M2의 "바뀐 날만 자세히"를 판정한다. 보고 파일은 30일만 보관한다.
4. 관제판(`/board` 아티팩트)의 "아침 점검" 칸을 갱신한다(ArtifactData `board/morning`).
5. 휴대폰 알림을 한 번 보낸다(Claude 앱 푸시).
6. 프로그램이 실패하거나 결과가 깨져 있으면, 그 자체를 🔴 S0으로 보고한다. 추측으로 채우지 않는다.

### 5-2. 휴대폰 알림 모양

이상이 없을 때 (한 줄):
```
🟢 아침 점검 이상 없음 · 10/22
```

이상이 있을 때 (첫 줄 결론, 이어서 🔴부터):
```
🔴 확인 2건 · 🟡 3건 · 10/22
🔴 지급 후 환불 1건 — 디어 오키드 20261021-000012 · 32,000원
🔴 배송 마감 지남 1건 — 20261021-000015 (어제부터 계속)
🟡 오늘 배송 준비 전 2건 · 기사 승인 대기 1명
👉 관제판에서 결정할 일 보기
```

관제판에는 항목마다 "왜 이상인지 / 사람이 내릴 결정 / 에이전트 추천 한 줄"이 붙는다.

### 5-3. 서버 08:30 텔레그램 요약과의 관계 (D6)

- 서버 요약은 그대로 둔다. PC가 꺼진 날의 대비책이다.
- 다만 운영 Railway와 GitHub에 `OPS_TELEGRAM_*` 값이 들어갔는지는 확인된 적이 없다(`docs/memory.md` 6번 항목, BACKLOG `OPS-ALERTING`). 들어가 있지 않다면 지금은 대비책이 없는 상태다. 이 값을 넣는 일은 사용자가 한다(`ops-alerts.md` §2).

## 6. 아토믹 구현 단계

| 단계 | 내용 | 누가 | 완료 확인 | 운영 접근 |
|---|---|---|---|---|
| S0 | 운영 Firebase 프로젝트에 점검 전용 서비스 계정 생성 → 역할 "Cloud Datastore 뷰어"만 부여 → JSON 열쇠 발급 → `C:\Users\tazan\.claude\greenhub-ops\readonly-key.json`에 저장 → 같은 폴더 `config.json`에 계정 이메일과 열쇠 만든 날 기록 | **사람** (보안 설정·자격증명이라 에이전트가 하지 않음) | 콘솔에서 역할이 뷰어 하나뿐인지 확인 | 사람 |
| S1 | 판정 규칙 순수 함수 `scripts/ops/morning-check-rules.mjs` + `morning-check-rules.spec.mjs`(`node --test`). 고정 입력으로 §2 기준마다 🔴·🟡·🟢 경계값을 검사 | 에이전트 | 테스트 통과 | 없음 |
| S2 | 수집기 `scripts/ops/morning-check.mjs`: §3-3 허용 목록 조회, §4-2 차단 장치(열쇠 경로 고정, 계정 이메일 대조, 대체 열쇠 없음), JSON 출력. spec: 가짜 Firestore 객체로 조회 필드가 허용 목록뿐인지, 소스에 쓰기 메서드·금지 필드가 없는지, 이메일이 다르면 멈추는지 검사 | 에이전트 | 테스트 통과, 로컬 에뮬레이터 실행 결과 확인 | 없음 |
| S3 | 전날 비교와 보고 파일 저장(30일 보관), 열쇠 80일 경고 | 에이전트 | 테스트 통과 | 없음 |
| — | S1~S3을 PR 하나로 올림. 병합은 사용자 | 에이전트 / 사람 | CI 통과 | 없음 |
| S4 | 첫 수동 실행: 사람이 지켜보는 가운데 운영 데이터로 한 번 실행하고 결과를 함께 확인. 쓰기 시도가 없는지, 손님 정보가 없는지 출력으로 확인 | 에이전트 실행 · **사람 승인** | 결과 JSON에 금지 필드가 없고 건수가 어드민 화면과 맞음 | 읽기만 |
| S5 | 관제판에 "아침 점검" 칸 추가(`board.html` 재게시 + `board/morning` 문서) | 에이전트 | 휴대폰에서 칸이 보임 | 없음 |
| S6 | Claude 설정에 허용·금지 규칙 추가(점검 실행 허용, 열쇠 폴더 읽기 금지) → 07:30 예약 작업 등록 | 에이전트 제안 · **사람 승인** | 다음 날 07:30 알림 수신 | 읽기만 |
| S7 | 1주 운영 후 기준 재조정(헛알림, 놓친 것) — 이 문서 §2 갱신 | 에이전트 + 사람 | 사용자 확인 | 없음 |

S1~S3은 운영에 접근하지 않으므로 S0과 나란히 진행할 수 있다. S4부터는 S0이 끝나야 한다.

## 7. 위험과 열린 질문

| ID | 내용 | 대응 |
|---|---|---|
| R1 | 프로젝트 정책상 서비스 계정 열쇠 발급이 막혀 있을 수 있음(조직 정책 `iam.disableServiceAccountKeyCreation`) | S0에서 막히면 이 문서로 돌아와 경로를 다시 정한다(서버 요약 확장안이 차선) |
| R2 | PC가 꺼지거나 Claude 앱이 닫혀 있으면 점검이 없음 | 서버 08:30 텔레그램 요약이 대비책. 단 §5-3의 텔레그램 설정 확인이 먼저 필요 |
| R3 | 주문 상태별 시각이 없어 일정 없는 주문의 지연은 짐작치 | O1에서 "짐작"으로 표시. 정확히 하려면 주문에 상태 변경 시각을 남기는 별도 작업이 필요(이번 범위 아님) |
| R4 | M1·M2는 정책이 정해질 때까지 매일 같은 내용이 뜰 수 있음 | M2는 평소 한 줄만 보임. M1은 돈 문제라 🔴 유지 |
| Q1 | 새 입점 문의(`partnerInquiries`)를 "사람 대기"에 넣을지 | 이번 확정 범위 밖. S7 재조정 때 판단 |
| Q2 | 2단계(결정 대기함)로 넘어갈 시점 | 파일럿 이후, 1단계 보고가 2주 이상 안정적으로 온 뒤 |

## 8. 근거 (2026-10-21, 브랜치 `feat/admin-audit-log` `88c1235d`)

- 서버 아침 요약: `apps/api/src/ops-alerts/ops-digest.service.ts:43-71`(수집 4항목), `:92`(08:30 cron)
- 기계 계정 통로 없음: `apps/api/src/admin/admin.controller.ts:19-21`(JWT + admin 역할만), API 키·내부 토큰 가드 없음
- 클라이언트 규칙: `firestore.rules:52-54`(orders 차단), `:147-149`(그 밖 기본 차단)
- 지급 후 환불: `apps/api/src/settlements/settlements.service.ts:240-245`(paid면 경고만)
- 수수료율 미반영: `apps/api/src/settlements/settlements.service.ts:43,59`(전역 율), `apps/api/src/admin/admin.service.ts:97-100`(저장만)
- 결제 시각: `apps/api/src/payments/payment-finalization.service.ts:668-684`(`payments` 문서)
- 기사 미배정: `apps/api/src/orders/driver-order-scope.service.ts:308`
- 주문 상태 전이: `apps/api/src/orders/orders.helpers.ts:9-29`
- 보안 사건 종류: `apps/api/src/common/audit/audit.service.ts:7-14`
- 기사 승인 대기 판정: `apps/api/src/admin/admin.service.ts:579-585`
- 초대 상태 판정: `apps/api/src/auth/auth.service.ts:91-112`
- 기존 스크립트의 Admin 키 대체 경로(점검 프로그램은 따르지 않음): `scripts/list-stores.mjs:12-20`, `scripts/release/pre-deploy-check.mjs:138-147`

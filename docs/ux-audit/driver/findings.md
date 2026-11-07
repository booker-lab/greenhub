<!-- Language: ko -->

# 그린허브 기사 앱 UX 여정 감사 (분석 전용)

- 실행일: 2026-11-08 KST(2026-11-07 UTC)
- 코드 기준: `booker-lab/greenhub` 브랜치 `claude/happy-johnson-andzgt` = `origin/main` `2cbc1b9`(작업 시작 시점, 코드 수정 없음)
- 뷰포트: 모바일 390×844(터치), 1배율 캡처
- 스크린샷: `docs/ux-audit/driver/screenshots/` (경로는 이 파일 기준 상대 경로)
  - `J<단계>-*`: 여정 단계, `X-*`: 추가 상황. 이름 끝 `-full`은 전체 페이지 캡처(고정 하단 탭·고정 버튼이 페이지 중간에 겹쳐 찍히는 것은 캡처 방식 때문이다)

## 0. 실행 환경과 한계 (먼저 읽기)

운영 환경·운영 데이터·외부 서비스는 쓰지 않았다. 저장소의 로컬 하네스에서 감사했다.

| 항목 | 이번 감사 | 운영과의 차이 |
|---|---|---|
| 앱 | driver `next dev`(저장소 코드 그대로), 로컬 하네스 `pnpm dev:local`(`scripts/dev/local/launcher.mjs`) | 운영 빌드가 아니다. 개발 표시("N")는 캡처에서 숨겼다 |
| API·DB | 로컬 API + Firebase 에뮬레이터(auth·firestore·storage, project `greenhub-local`). 외부 알림·결제 발송은 하네스가 `DENY_ALL_EXTERNAL_PROVIDER_DISPATCH`로 막는다 | 운영 데이터가 아니다 |
| 데이터 | 회차 E2E fixture 생성기(`scripts/round-direct-e2e-fixtures.mjs`의 `buildFixtureManifest`)로 `round_direct` 가게·열린 회차·기사 주문(수거 대기 4, 배송 중 5, 보류 3)을 넣고, 기사 주문 8건에 실제와 같은 주소(동·호수)·받는 분·요청사항을 덧씌웠다. 미배정 수거 대기 주문 1건을 추가했다 | 상품명이 "E2E 호접란" 같은 테스트 이름 |
| 로그인 | 로컬 런타임에서만 보이는 이메일 로그인으로 들어갔다(API `/auth/login` 실경로 + 기사 역할·승인 검사) | 운영은 카카오 로그인만 있다. 카카오 인증 화면은 확인하지 못했다(`kauth.kakao.com` 요청 발생까지만 확인) |
| 승인 대기 | 승인 전 기사 계정을 API로 만들어 확인했다. 카카오 첫 로그인 결과 화면은 코드 경로(API 403 → Auth.js `AccessDenied` → `/login?error=AccessDenied`)대로 같은 URL을 열어 확인했다 | 카카오 왕복 자체는 재현하지 못했다 |
| 카메라 | Chromium 가짜 카메라(`--use-fake-device-for-media-stream`)로 촬영·업로드했다. 사진은 Storage 에뮬레이터에 올라갔다 | 실기기 카메라·갤러리·HEIC 동작은 확인하지 못했다 |
| 외부 지도 | 카카오맵 링크는 열지 않았다(외부 호스트 차단) | |

**확인 방식 표기**
- `실행`: 위 로컬 스택에서 직접 실행하고 스크린샷으로 확인했다.
- `코드`: 화면을 실행하지 못해 코드로만 확인했다.

**로컬 환경 때문에 생긴 현상(결함으로 세지 않음)**
- 로컬 이메일 로그인 직후 목록이 "로그인이 필요합니다"로 뜬다(`screenshots/J02-board-after-login.png`). 로그인이 server action 안의 화면 이동이라 `SessionProvider`가 세션을 다시 읽지 않기 때문이다. 새로고침하면 정상이다. 운영 카카오 로그인은 외부 왕복 뒤 전체 페이지를 다시 읽으므로 해당하지 않는다.
- 로컬 이메일 로그인에서 승인 전 계정이나 틀린 비밀번호를 넣으면 Next 기본 오류 화면("This page couldn't load")이 뜬다(`screenshots/J01-login-unapproved-local.png`). `signIn('credentials')`가 던진 `CredentialsSignin`을 `app/login/page.tsx:8-15`의 server action이 받지 않는다. 운영에는 이 입력칸이 없다.
- fixture의 `preparedAt`은 `{seconds, nanoseconds}` 객체라 상세 머리에 "수거 Invalid Date"가 보였다(`screenshots/J04-detail-preparing-unassigned.png`). 판매자 준비 시작이 쓰는 실제 Firestore Timestamp로 바꾸면 API가 ISO 문자열로 내려 "수거 오전 04:15"로 정상 표시된다(`screenshots/J04-detail-preparedAt-timestamp.png`). fixture 모양 문제다.
- 날짜 입력칸의 `mm/dd/yyyy` 표시는 헤드리스 Chromium 표시이며 기기 언어에 따라 다르다.

## 1. 라우트 표

표기: "헤더" 열 값은 앱 머리(로고·오늘 배송·탭), 상단 바(뒤로·배송 방식·상태), 제목만, 없음. 근거: 각 여정 캡처.

| 라우트 | 레이아웃 | 하단 탭 | 헤더 | 뒤로가기(화면 안) | 새로고침·URL 직접 접근 | 비로그인 접근 결과 |
|---|---|---|---|---|---|---|
| `/` | – | – | – | – | `/board`로 이동 | `/board` → `/login` |
| `/login` | 단독 카드 | X(의도) | 없음(로고) | X | 정상. 로그인 상태에서도 그대로 보임(D-22) | 정상 표시(`J01-login-guest.png`) |
| `/board?tab=preparing\|delivering` 작업 보드 | 430px 열 | O | 앱 머리(로고·오늘 배송·진행 점·탭) | X(탭 화면) | 정상(탭은 URL 유지). `J03-board-preparing.png`, `J03-board-delivering.png` | `/login`(복귀 주소 없음, D-13) |
| `/board/[orderId]` 주문 상세 | 430px 열 + 하단 고정 주요 버튼 | O | 상단 바 | O. 기록 없는 새 탭에서는 앱 밖으로 나감(D-16) | 정상 | `/login`(복귀 주소 없음) |
| `/board/[orderId]`(보이지 않는 주문) | 가운데 글자 | O | 없음 | X | 정상 | – |
| `/board/[orderId]/photo/round-direct` 배송 완료 사진 | 전체 화면 검정(하단 탭 덮음) | X(의도) | 뒤로 + "배송 완료 사진" | O | 정상(카메라 다시 켜야 함) | `/login` |
| `/board/[orderId]/photo` 거점 하차 사진 | 위와 같음 | X | 뒤로 + "거점 하차 인증 사진" | O | 정상 | `/login`. 회차 판매 운영에서는 진입 경로 없음 |
| `/map` 지도 | 430px 열 + 하단 고정 "다음 배송지" 버튼 | O | 제목만("오늘 배송 경로") | X(탭) | 정상(`J03-map.png`) | `/login` |
| `/profile` 내 정보 | 430px 열 | O | 제목만 | X(탭) | 정상(`J03-profile.png`) | `/login` |
| 없는 경로 | Next 기본 404(영문) | O | 없음 | X | 404 | 404(D-17) |

## 2. 문제 표

심각도: P0 배송 처리 불가 / P1 되돌릴 수 없는 잘못된 처리나 작업 중단 유발 / P2 혼란 / P3 다듬기. 스크린샷 경로는 `screenshots/` 기준.

| ID | 여정 단계 | 라우트 | 문제 | 재현 경로 | 심각도 | 스크린샷 | 관련 파일:라인 | 수정 제안 | 확인 방식 |
|---|---|---|---|---|---|---|---|---|---|
| D-01 | 1 가입·승인 대기 | `/login` | 처음 카카오로 들어온 기사는 API가 그 자리에서 기사 계정(승인 전)을 만들고 곧바로 403으로 거절한다. 화면에는 노란 안내 "로그인할 수 없는 계정입니다 / 관리자 승인 대기 중이거나 기사 계정이 아닙니다"만 나온다. 가입이 접수됐는지, 누구에게 승인을 요청해야 하는지, 얼마나 걸리는지 알 수 없다. 같은 문구가 손님 카카오 계정으로 잘못 들어온 경우에도 나와 두 상황을 구분하지 못한다. 승인 전용 안내(`?pending=true` "승인 대기 중입니다")는 API가 승인 전 기사에게 200을 주지 않아 도달하지 않는 경로다. 관리자에게 새 가입 알림도 가지 않는다 | 새 카카오 계정으로 기사 앱 "카카오로 시작하기" | P1 | `J01-login-access-denied.png`, (도달 불가 안내) `J01-login-pending-param.png` | `apps/api/src/auth/auth.service.ts:535`(기사 계정 생성), `:577-579`(승인 전 403, code 없음), `apps/driver/src/auth.ts:397`·`:408-410`, `apps/driver/src/app/login/login-notice.ts:43-56` | API가 승인 전 기사 거절에 기계 판독 code(예: `DRIVER_APPROVAL_PENDING`)를 붙이고 앱이 이를 승인 대기 안내로 바꾼다. 안내에 "가입 신청이 접수됐어요. 승인되면 다시 로그인해 주세요"와 운영팀 연락처를 둔다. 다른 역할 계정은 "기사용 카카오 계정이 아니에요"로 분리한다 | 실행(안내 화면) + 코드(카카오 왕복) |
| D-02 | 4 픽업 / 5 배송 시작 | `/board/[orderId]` | 수거 대기 주문 상세의 하단 큰 버튼 "수거 완료 / 배송 시작"을 누르면 확인 없이 바로 배송 중으로 바뀐다(2.5초 안에 처리, 확인 창 없음). 이 전환은 손님에게 "배송이 시작되었습니다" 알림을 보내고, 미배정 주문이면 그 기사에게 배정된다. 기사 화면에는 되돌리기·배정 해제가 없다(기사 전이는 배송 중 → 완료·보류뿐). 목록에서 다른 주문을 잘못 눌러 들어온 경우에도 엄지 자리의 버튼 한 번으로 처리된다 | 수거 대기 탭 → 주문 → "수거 완료 / 배송 시작" | P1 | `J04-detail-preparing-assigned.png`(전), `J05-after-start-delivering.png`(후), `J04-detail-preparing-unassigned.png`(미배정) | `apps/driver/src/app/board/[orderId]/page.tsx:910-926`, `apps/api/src/orders/orders.helpers.ts:36-37`(손님 알림) | 확인 창("○○동 ○○호 상품 2개를 실었나요? 손님에게 배송 시작 알림이 가요")을 둔다. 미배정 주문은 "이 주문 맡기"와 "배송 시작"을 나누거나 확인 창에 배정 사실을 적는다. 실수 복구(배정 해제)는 3절 결정 | 실행 |
| D-03 | 7 보류 → 8 재개 | `/board/[orderId]`, `/board` | 기사가 고객 책임 + 재배송비로 보류하면 곧바로 "재배송비 결제 정보 확인 필요 · 결제 정보를 확인할 때까지 배송을 시작할 수 없습니다"(노란 점)와 회색 버튼이 뜬다. 실제로는 손님이 아직 결제하지 않은 정상 대기 상태(API `MISSING` + `canPay=true`)다. 기사는 무언가 잘못됐다고 읽는다. 결제 링크를 손님이 받았는지, 결제되면 어떻게 알 수 있는지도 없다 | 배송 중 주문 → 부재·문제 알리기 → 고객 연락 불가 + 고객 책임 + 3,000원 → 저장 | P2 | `J07-held-customer-fee-full.png`, `J08-held-missing-payment-full.png`, (결제 대기와 비교) `J08-held-pending-payment-full.png` | `apps/driver/src/app/board/_lib/redelivery-payment.ts:44-50`, `apps/api/src/orders/redelivery-resume-gate.ts:133-145` | `MISSING`이면서 `canPay=true`이면 "손님 결제 대기 · 손님이 재배송비를 결제하면 배송을 다시 시작할 수 있어요"로 보인다. `requiresRecovery=true`인 `MISSING`만 확인 필요로 둔다 | 실행 |
| D-04 | 6 배송 완료(사진) | `/board/[orderId]/photo/round-direct` → `/board` | 사진을 올리면 아무 안내 없이 배송 중 목록으로 돌아간다. 완료된 주문은 목록에서 사라지고, 앱 어디에도 오늘 완료한 배송·올린 사진을 다시 볼 곳이 없다. 기사가 제대로 끝났는지 확인할 방법이 목록에서 빠진 것뿐이다 | 배송 중 주문 → 도착 사진 찍고 완료 → 촬영 → 사진을 등록하고 배송 완료 | P2 | `J06-photo-captured.png`(전), `J06-after-complete.png`(후, 알림 없음) | `apps/driver/src/app/board/[orderId]/photo/photo-capture.tsx:470`, `apps/driver/src/app/board/_client.tsx:129-134`(진행 상태만 목록에 남김) | 완료 뒤 "○○동 ○○호 배송을 완료했어요" 알림을 보인다. 완료 내역(오늘 완료 n건, 사진 보기)은 3절 결정 | 실행 |
| D-05 | 6 배송 완료(사진) | `/board/[orderId]/photo/round-direct` | 촬영 화면에는 "배송 완료 사진" 제목만 있고 어느 주소(동·호수)의 주문인지 없다. 같은 단지에 여러 집을 연달아 배송할 때 다른 주문 화면에서 사진을 올려도 알아챌 수 없다 | 배송 중 주문 → 도착 사진 찍고 완료 | P2 | `J06-photo-start.png`, `J06-photo-camera-live.png` | `apps/driver/src/app/board/[orderId]/photo/photo-capture.tsx:543-552` | 제목 아래에 동·호수(상세 주소)와 받는 분을 한 줄로 보인다(상세 조회 응답을 이미 읽고 있다: `readOrderStoreId`) | 실행 |
| D-06 | 6 배송 완료(사진) | `/board/[orderId]/photo/round-direct` | 촬영 뒤 하단 두 버튼 중 확정 버튼 글자 "사진을 등록하고 배송 완료"가 390px 폭에서 "사진을 등록하고 \|"로 잘린다. 가장 중요한 버튼이 무엇을 하는지 끝까지 읽을 수 없다 | 촬영 → 미리보기 화면 | P2 | `J06-photo-captured.png` | `apps/driver/src/app/board/[orderId]/photo/photo-capture.tsx:675-708` | 미리보기 상태에서는 확정 버튼을 한 줄 전체 폭으로, 재촬영은 그 위 보조 버튼으로 쌓는다. 또는 "배송 완료"로 줄인다 | 실행 |
| D-07 | 7 배송 실패·보류 | `/board/[orderId]` 보류 창 | 보류 창의 기본 유형이 "기상 악화"다. 문 앞에서 흔한 연락 불가·출입 불가로 들어와 사유만 적고 저장하면 "기상 보류의 새 배송 예정 시각을 입력해주세요."로 막힌다. 기사가 새 배송 시각을 정할 권한·정보가 있는지도 분명하지 않다 | 부재·문제 알리기 → 사유 입력 → 배송 보류 저장 | P2 | `J07-hold-modal-open.png`, `J07-hold-modal-weather-needs-date.png` | `apps/driver/src/app/board/[orderId]/_components/DeliveryHoldModal.tsx:121`, `:187-190` | 기본 선택 없이 유형을 고르게 하거나 "고객 연락 불가"를 기본으로 둔다. 새 배송 예정의 입력 주체는 3절 결정 | 실행 |
| D-08 | 7 배송 실패·보류 | `/board/[orderId]` 보류 창 | "보류 사유"에 적은 글은 손님 주문 상세에 그대로 보이고, 저장하면 손님에게 보류 알림톡이 간다. 창에는 두 사실이 모두 없다. 기사는 내부 메모처럼 쓸 수 있다(예: "3번 전화했지만 받지 않음") | 보류 저장 → 손님 앱 주문 상세 | P2 | `J07-hold-modal-filled.png`, (손님 화면) `../consumer/screenshots/J09-order-detail-held.png` | `DeliveryHoldModal.tsx:346-351`, `apps/consumer/src/app/mypage/orders/[id]/_client.tsx:1077`, `apps/api/src/orders/orders.helpers.ts:44`(보류 알림) | 칸 이름을 "손님에게 보일 사유"로 바꾸고 도움말 "손님 주문 화면에 그대로 보여요. 저장하면 손님에게 보류 알림이 가요"를 둔다 | 실행 + 코드 |
| D-09 | 7 배송 실패·보류 | `/board/[orderId]` 보류 창 | 고객 책임 여부와 재배송비 금액(0원 초과 50,000원 이하 정수, 입력칸 증감 1,000원)을 기사가 문 앞에서 직접 정한다. 기준·기본 금액 안내가 없어 기사마다 달라질 수 있고, 손님 결제 금액이 그대로 이 값이 된다 | 보류 창 → 고객 책임 체크 → 재배송비 입력 | P2 | `J07-hold-modal-fee-required.png`, `J07-hold-modal-filled.png` | `DeliveryHoldModal.tsx:352-366`, `apps/driver/src/app/board/_lib/delivery-hold-form.ts:21` | 정책 결정 필요(3절). 예: 재배송비는 고정 금액 하나로 두고 기사는 "고객 책임"만 고른다 | 실행 |
| D-10 | 3 배송 목록 / 4 픽업 | `/board?tab=preparing` | 수거 대기 탭에 내게 배정된 주문과 아무도 맡지 않은 주문이 같은 모양으로 섞인다. 미배정 주문은 들어가서 버튼을 누르는 순간 내 주문이 된다(D-02). 다른 기사가 먼저 맡으면 "이미 상태가 변경되었을 수 있습니다" 뒤 "주문을 찾을 수 없습니다"만 나온다 | 수거 대기 탭 | P2 | `J03-board-preparing.png`(첫 줄 임도현 = 미배정), `J04-detail-preparing-unassigned.png` | `apps/driver/src/components/OrderCard.tsx:129-167`, `apps/api/src/orders/driver-order-read-model.ts:28`(배정 여부를 응답에 싣지 않음) | API 목록 응답에 `assignedToMe`를 싣고, 목록을 "내 수거"와 "맡을 수 있는 주문"으로 나눈다 | 실행 |
| D-11 | 4 픽업 | `/board`, `/board/[orderId]` | 수거 대기 주문 어디에도 어디서 수거하는지(판매자 상호·주소)가 없다. 상세의 주소·지도 버튼은 손님 배송지이고, 판매자는 전화번호만 있다. 지금은 가게가 하나라 버틸 수 있지만, 기사가 수거 장소를 외워야 한다 | 수거 대기 주문 상세 | P2 | `J04-detail-preparing-assigned.png` | `apps/api/src/orders/driver-order-read-model.ts:29-44`(가게 정보 없음), `apps/driver/src/app/board/[orderId]/page.tsx:605-613` | 수거 대기 상태에서 "수거 장소: 상호·주소 + 지도"를 배송지보다 위에 보인다(API 응답에 가게 이름·주소 추가) | 실행 + 코드 |
| D-12 | 3 배송 목록 | `/board` | 머리에 "오늘 배송 · 11월 8일 (일)"이라고 쓰지만, 목록은 날짜·회차 구분 없이 기사에게 보이는 모든 주문(지난 회차 보류 주문 포함)을 보여 준다. 행에도 배송일·회차가 없다 | 작업 보드 | P2 | `J03-board-delivering-scrolled-end.png`(지난 회차 보류 주문이 오늘 목록에 섞임) | `apps/driver/src/app/board/_client.tsx:177-182`, `:220`, `apps/api/src/driver/driver.service.ts:66-84`(날짜 조건 없음) | 제목을 "배송 목록"으로 바꾸거나, 회차 배송일로 묶어 "11월 10일(화) 회차"처럼 머리를 나눈다. 오늘이 아닌 주문은 날짜를 행에 쓴다 | 실행 + 코드 |
| D-13 | 9 세션 만료 | 전 화면 | 쿠키 만료, 다른 곳에서 세션 폐기, 승인 철회가 되면 이유 안내 없이 빈 로그인 화면으로 간다. 다시 로그인하면 보던 주문 상세가 아니라 작업 보드로 간다. 배송 도중 갑자기 쫓겨난 기사는 왜 그런지, 승인 철회인지 알 수 없다 | 주문 상세에서 쿠키 삭제 후 새로고침 / API 세션 폐기 후 탭 이동 / `driverApproved=false` 후 화면 복귀 | P2 | `J09-session-expired-login.png`, `J09-relogin-lands.png`, `J09-revoked-after-nav.png`, `J09-approval-revoked.png` | `apps/driver/src/proxy.ts:48`, `apps/driver/src/app/providers.tsx:17`·`:74`, `apps/driver/src/app/login/page.tsx:13`·`:101` | 로그인 이동에 `callbackUrl`(현재 경로)을 싣고 로그인 뒤 그곳으로 돌아간다. 로그인 화면에 "로그인이 끝났어요. 다시 로그인해 주세요"를 보인다. 승인 철회는 재로그인 때 D-01의 승인 안내로 이어진다 | 실행 |
| D-14 | 5·7 (네트워크 불안정) | `/board/[orderId]` | 신호가 약해 버튼 결과를 모를 때 화면 위에 빨간 면 두 개("주문 정보를 불러오지 못했습니다 (이전 정보 표시 중)", "명령 결과를 확인하지 못했습니다. … 같은 명령을 바로 다시 보내지 마세요.")와 알림 "명령이 처리되었는지 확실하지 않습니다"가 한꺼번에 뜬다. "명령"은 개발 용어이고, 주요 버튼은 이미 꺼져 있어 "다시 보내지 마세요"가 무엇을 하라는지 알기 어렵다 | 상세 → API 연결 끊김 → 수거 완료 / 배송 시작 | P2 | `X-api-down-start.png` | `apps/driver/src/app/board/[orderId]/page.tsx:81-94`, `DeliveryHoldModal.tsx:101-104` | 하나의 면으로 합쳐 "처리됐는지 아직 확인하지 못했어요. 연결이 돌아오면 '상태 확인'을 눌러 주세요"와 버튼 하나만 둔다. 같은 동작을 막는 이유는 버튼 비활성으로 충분하다 | 실행 |
| D-15 | 7 배송 실패·보류 | `/board/[orderId]` 보류 창 | 기상 악화에서 생긴 오류 "기상 보류의 새 배송 예정 시각을 입력해주세요."가 유형을 "고객 연락 불가"로 바꾼 뒤에도 그대로 남아, 지금 고른 유형과 맞지 않는 안내가 보인다 | 기상 악화로 저장 실패 → 고객 연락 불가 선택 | P3 | `J07-hold-modal-fee-required.png` | `DeliveryHoldModal.tsx:160-167`(유형 변경 때 오류를 지우지 않음), `:382` | 유형·입력값이 바뀌면 이전 제출 오류를 지운다 | 실행 |
| D-16 | 공통 | `/board/[orderId]` | 상세의 뒤로가기는 `router.back()`만 부른다. 알림·메신저 링크처럼 기록 없이 상세를 열면 뒤로가기가 앱 밖(빈 화면)으로 나가거나 아무 반응이 없다 | 새 탭에서 상세 URL 직접 열기 → 뒤로가기 | P3 | `J05-direct-open-back-noop.png`(빈 화면으로 나감) | `apps/driver/src/app/board/[orderId]/page.tsx:638` | 앱 안 이전 기록이 없으면 `/board`(해당 탭)로 보낸다(소비자 C-10과 같은 방식) | 실행 |
| D-17 | 공통 | `/board/[orderId]`(보이지 않는 주문), 없는 경로 | 다른 기사가 맡았거나 완료된 주문을 열면 가운데 "주문을 찾을 수 없습니다" 한 줄만 있고 목록으로 갈 버튼·이유가 없다. 없는 경로는 Next 기본 영문 404("This page could not be found.")다 | 없는 주문 ID로 상세 열기 / `/nope` | P3 | `X-detail-not-found.png`, `X-unknown-route-404.png` | `apps/driver/src/app/board/[orderId]/page.tsx:536-569`, `apps/driver/src/app/`(not-found 없음) | "다른 기사가 맡았거나 이미 끝난 주문이에요" + "배송 목록으로" 버튼, 앱 공통 `not-found.tsx` 추가 | 실행 |
| D-18 | 3·8 | `/board`, `/board/[orderId]` | 재배송비 상태 문구가 내부 기준으로 쓰여 있다: "서버에서 결제 완료 상태를 확인했습니다. 배송을 시작할 수 있습니다."(목록 한 행이 세 줄로 늘어남), "운영 확인 필요 · 재배송비 결제 상태를 운영팀에서 확인해야 합니다."(누구에게 어떻게 연락하는지 없음) | 보류 주문 목록·상세 | P3 | `J03-board-delivering-scrolled-end.png`, `J08-held-paid-full.png` | `apps/driver/src/app/board/_lib/redelivery-payment.ts:28-42`, `:60-64` | "재배송비 결제됨 · 배송 재개 가능"처럼 짧게. 확인 필요 상태에는 운영팀 연락 버튼 | 실행 |
| D-19 | 9 로그아웃 | `/profile` | 내 정보에 운영팀 연락처·문의·도움말이 없다(앱 전체에 없음). 로그아웃은 배송 중 주문이 남아 있어도 확인 없이 바로 된다 | 내 정보 → 로그아웃 | P3 | `J09-profile.png`, `J09-after-logout.png` | `apps/driver/src/app/profile/page.tsx:140-151` | 내 정보에 "운영팀에 연락" 줄을 둔다. 배송 중·보류 주문이 있으면 "배송 중인 주문 n건이 있어요. 로그아웃할까요?" 확인 | 실행 |
| D-20 | 3 배송 목록 | `/map` | 지도 탭은 행마다 1~8 번호를 붙여 경로 순서처럼 보이지만, 주문에 좌표가 없어 목록 응답 순서(수거 시각·수정 시각) 그대로다. 수거 대기와 배송 중이 섞이고 보류 주문은 빠진다. 행 주소는 기본 주소만 잘려 보이고 동·호수가 없다 | 지도 탭 | P3 | `J03-map-full.png`, `J03-map-scrolled-end.png` | `apps/driver/src/app/map/page.tsx:147`, `:189` | 번호 대신 상태로 묶고("배송 중 5 · 수거 대기 3"), 경로 순서는 3절 결정. 행에 동·호수를 보인다 | 실행 |
| D-21 | 6 배송 완료(사진) | `/board/[orderId]/photo/round-direct` | "카메라 앱으로 찍기·사진 선택"은 JPEG만 받는다. PNG(스크린샷 등)를 고르면 "JPEG 사진만 선택할 수 있습니다."가 뜨는데, 기사에게 JPEG가 무엇인지·어떻게 하라는지가 없다 | 사진 선택에서 PNG 선택 | P3 | `J06-photo-select-png.png` | `apps/driver/src/app/board/[orderId]/photo/photo-capture.tsx:286-289`, `:560` | 문구를 "카메라로 새로 찍어 주세요(이 사진 형식은 올릴 수 없어요)"로 바꾼다. 다른 형식을 받을지는 서버 한도와 함께 판단 | 실행(실기기 갤러리·HEIC는 미확인) |
| D-22 | 2 로그인 | `/login` | 로그인한 상태로 `/login`을 열면 로그인 화면이 그대로 보인다 | 로그인 후 `/login` 직접 열기 | P3 | `J02-login-while-logged-in.png` | `apps/driver/src/proxy.ts`(로그인 검사가 `/board`·`/map`·`/profile`뿐), `apps/driver/src/app/login/page.tsx` | 기사 세션이 있으면 `/board`로 보낸다 | 실행 |
| D-23 | 3 배송 목록 | `/board` | 목록 조회가 401·403이면 "로그인이 필요합니다. 세션을 다시 확인해 주세요."와 "다시 로그인"·"다시 시도"를 둔다. "다시 시도"는 같은 토큰으로 다시 조회만 해 늘 같은 화면으로 돌아온다 | 목록 인증 오류 상태 | P3 | `J02-board-after-login.png`(같은 화면, 로컬 원인) | `apps/driver/src/app/board/_client.tsx:259-268` | 인증 오류에는 "다시 로그인" 하나만 둔다. 문구는 "로그인이 끝났어요" | 실행 + 코드 |
| D-24 | 7 배송 실패·보류 | `/board/[orderId]` | 같은 동작의 이름이 세 가지다: 상세의 "부재·문제 알리기", 창 제목 "배송 보류 기록", 저장 "배송 보류 저장". 목록·상세 상태는 "배송 보류"다 | 배송 중 상세 → 부재·문제 알리기 | P3 | `J06-detail-delivering.png`, `J07-hold-modal-open.png` | `page.tsx:839`, `DeliveryHoldModal.tsx:326`, `:393` | "배송 보류" 하나로 맞추고 버튼은 "배송 못 함 · 보류하기"처럼 상황을 함께 쓴다 | 실행 |

### 잘 동작한 것 (참고)
- 주문 상세가 문 앞에서 필요한 정보를 크게 보여 준다: 동·호수 28px, 상품마다 한 줄 수량, 요청사항 회색 면, 단계마다 전화 하나(수거 대기는 판매자, 배송 중은 손님), 엄지 자리 56px 주요 버튼(`J04-detail-preparing-assigned.png`, `J06-detail-delivering.png`).
- 카메라를 쓸 수 없거나 권한이 없으면 "카메라 앱으로 찍기·사진 선택"으로 이어 갈 수 있다. 가짜 카메라 촬영 → 업로드 → 완료까지 1.1초에 끝났다(`J06-photo-start.png`, `J06-after-complete.png`).
- 응답을 모를 때 같은 요청을 자동으로 다시 보내지 않고, 상태를 다시 읽기 전까지 위험한 버튼을 끈다(문구는 D-14). 사진 업로드도 같은 사진·같은 키로만 재시도한다.
- 보류 창은 책임·재배송비가 어긋나면 바로 안내하고 저장을 막는다(`J07-hold-modal-fee-required.png`). 재배송비 결제 전에는 "배송 재개" 대신 결제 상태 버튼이 잠겨 있고, 결제가 끝나면 "배송 재개"가 열린다(`J08-held-pending-payment-full.png`, `J08-held-paid-full.png`, `J08-resumed-paid.png`). 재배송비 없는 보류는 바로 재개할 수 있다(`J07-held-no-fee.png`, `J08-resumed-no-fee.png`).
- 세션 폐기·승인 철회 뒤 다음 조작에서 곧바로 로그인 화면으로 보내고 이전 주문 정보를 남기지 않는다(안내 문구는 D-13).
- 목록 갱신 실패 때 마지막 목록을 지우지 않고 "(이전 목록 표시 중)"으로 보여 준다. 첫 조회 실패는 "다시 시도"가 있다(`X-api-down-board.png`).

## 3. 빠진 단계·기능 목록

화면이 있는데 결함인 것이 아니라 여정에 아예 없는 것이다.

| 빠진 것 | 왜 필요한가 |
|---|---|
| 기사 가입 신청·승인 대기 화면·승인 알림 | 첫 카카오 로그인이 곧 가입인데 이름·연락처·차량 같은 신청 정보가 없고, 승인되면 알려 주는 경로도 없다. 관리자도 새 가입을 알 수 없다(D-01). |
| 배정 해제(잘못 맡은 주문 반납) | 수거 대기에서 잘못 누르면 되돌릴 수 없다(D-02). 기사 전이는 배송 중 → 완료·보류뿐이다. |
| 한 번에 수거(여러 주문 배송 시작) | 같은 가게에서 여러 주문을 싣는데 주문마다 들어가 버튼을 눌러야 한다. 수거 체크리스트(실은 상품 확인)도 없다. |
| 수거 장소 정보 | 판매자 상호·주소·지도 링크가 없다(D-11). |
| 배송 순서 정하기·경로 | 주문에 좌표가 없어 지도 탭 번호가 경로가 아니다(D-20). 기사가 순서를 바꾸거나 고정할 수 없고 "다음 배송지"는 응답 순서로 정해진다. |
| 오늘 완료 내역·사진 다시 보기 | 완료하면 목록에서 사라지고 다시 볼 곳이 없다(D-04). 손님 문의 때 기사가 확인할 수 없다. |
| 배송 실패(반송·취소) 경로 | 문제가 생기면 보류만 있다. 상품 파손·수령 거부처럼 재배송이 의미 없는 경우를 기록할 방법이 없다. |
| 운영팀 연락·도움말 | 앱 전체에 운영팀 연락처가 없다(D-18, D-19). "운영 확인 필요" 상태에서 기사가 할 일이 없다. |
| 새 수거 대기 주문 알림 | 목록은 화면 복귀 때만 다시 읽는다. 새 주문이 생겨도 기사는 앱을 열어 봐야 안다. |
| 신호 약한 곳의 업로드 대기열 | 지하주차장·엘리베이터에서 업로드가 실패하면 그 자리에서 다시 눌러야 한다. 나중에 자동으로 올리는 대기열이 없다. |

## 4. 요약

- P0: **0건**. 로컬 재현 범위에서 수거·배송 시작·사진 완료·보류·재개가 모두 끝까지 처리됐다.
- P1: **2건**. D-01 첫 로그인(가입) 뒤 승인 대기 안내 없음, D-02 배송 시작이 확인 없이 처리되고 손님 알림·배정까지 되돌릴 수 없음.
- P2: 12건, P3: 10건.

가장 먼저 고칠 5개:
1. **D-02**: 배송 시작에 확인 창을 둔다. 손님에게 알림이 나가고 기사가 되돌릴 수 없는 유일한 단일 탭 동작이다.
2. **D-01**: 승인 대기 기사에게 "가입 접수됨 + 연락처"를 보인다. API 거절 code 하나와 안내 문구로 해결된다.
3. **D-03**: 보류 직후 정상 대기를 "확인 필요"로 보이는 문구를 "손님 결제 대기"로 바꾼다.
4. **D-05 + D-06 + D-04**: 사진 화면에 주소를 보이고, 확정 버튼 글자를 다 보이게 하고, 완료 뒤 확인 알림을 띄운다. 배송 완료 단계의 오처리를 줄인다.
5. **D-07 + D-08**: 보류 창의 기본 유형을 바꾸고 "손님에게 보이는 사유·알림 발송"을 알린다.

# 운영 알림(휴대폰)

> **상태**: Current (2026-10-09 사용자 결정)
> **코드**: `apps/api/src/ops-alerts/`, `.github/workflows/uptime.yml`

운영자 휴대폰으로 장애와 확인할 일을 바로 받는다. 고객 알림톡(알리고)과 다른 경로인 **텔레그램 봇**을 쓴다. 그래서 알리고 잔액·허용 IP 문제처럼 알림톡 자체가 막힌 상황도 알릴 수 있다.

## 1. 무엇이 오나

| 알림 | 출처 | 수준 |
|---|---|---|
| 운영 확인 기록이 새로 열림(결제 조회 실패, 환불 실패, 고객 안내 실패, 배송 사진 확인 등) | API `OperationIssueWriterService` | 기록의 severity(긴급·주의) |
| 알림톡 발송 막힘(잔액 부족, 허용 IP 아님, 인증 실패, 발신번호 미등록) | API `NotificationsService` | 긴급, 같은 사유는 1시간에 한 번 |
| 아침 운영 요약 08:30 KST(열린 운영 기록, 20분 넘은 결제 대기, 배송 보류, 지급 대기 정산) | API `OpsDigestService` | 이상 없으면 🟢 |
| 서비스 응답 이상(API `/health`, 소비자 홈, 판매자·기사 로그인) | GitHub `uptime.yml`, 15분마다 | 긴급 |

- 알림에는 고객 이름·전화·주소를 싣지 않는다. 처리는 판매자 앱 홈 "운영 확인"과 주문 화면에서 한다.
- 같은 운영 기록이 매분 합쳐질 때는 다시 보내지 않는다. 해결 뒤 다시 열리면 보낸다.
- 운영이 아닌 Railway 환경에서 오면 제목에 환경 이름이 붙는다.

## 2. 켜는 방법(한 번)

1. 텔레그램에서 `@BotFather`에게 `/newbot`을 보내 봇을 만들고 토큰을 받는다.
2. 만든 봇과 대화를 열어 아무 메시지나 보낸다.
3. 브라우저에서 `https://api.telegram.org/bot<토큰>/getUpdates`를 열어 `"chat":{"id": ...}` 숫자를 확인한다(이것이 채팅 ID).
4. Railway **production** API 서비스 변수에 `OPS_TELEGRAM_BOT_TOKEN`, `OPS_TELEGRAM_CHAT_ID`를 추가한다. 다음 배포부터 API 알림이 켜진다.
5. GitHub 저장소 Settings → Secrets and variables → Actions에 같은 이름의 비밀값 두 개를 추가한다. `uptime.yml` 알림이 켜진다.

변수가 없으면 API는 아무것도 보내지 않는다. 로컬 실행(외부 발송 차단 정책)과 회차 E2E 실행에서도 보내지 않는다.

## 3. 확인

- Actions → Uptime check → Run workflow로 수동 실행해 정상이면 초록, 이상이면 텔레그램이 온다.
- 다음 날 08:30에 아침 요약이 오지 않으면 Railway 변수나 정기 작업(`GREENHUB_SCHEDULES_ENABLED`)을 확인한다.

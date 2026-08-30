<!-- Language: ko -->

# Notifications API / Domain Spec

> **최종 정합화**: 2026-08-30
> **상태**: Current
> **코드 정본**: `packages/shared/src/notification.types.ts`, `apps/api/src/notifications/**`
> **운영 승인 상태**: 이 문서에 복제하지 않고 `docs/memory.md`와 활성 HANDOFF를 따른다.

## 1. 소유권과 범위

- 알림 발송과 알림 기록은 NestJS API가 소유한다.
- 현재 외부 메시지 provider는 **ALIGO**다.
- 현재 코드상 외부 발송 경로는 카카오 알림톡과 SMS다. 실제 production 발송 여부는 운영 승인·설정의 별도 상태다.
- `fcm`은 shared `NotificationChannel`에 호환 타입으로 남아 있지만 현재 API의 실제 발송 구현 경로가 아니다.
- 사용자 알림 목록과 알림톡/SMS 수신 설정 API는 consumer에 노출된다.
- 회차 직배송의 현재 provider 승인·심사 상태는 운영 상태이므로 이 spec이 아니라 `docs/memory.md`에서 관리한다.

## 2. 공통 타입

`packages/shared/src/notification.types.ts`가 공개 공통 타입을 소유한다.

```ts
type NotificationChannel = 'alimtalk' | 'sms' | 'fcm'
type NotificationStatus = 'pending' | 'sent' | 'failed'
```

공통 `NotificationTemplateCode`에는 legacy 일반 판매·공동구매와 회차 직배송·운영 알림 코드가 함께 존재한다.

현재 shared 코드:

- `ORDER_ACCEPTED`
- `ORDER_PREPARING`
- `ORDER_DELIVERING`
- `ORDER_DELIVERY_HELD`
- `ORDER_REDELIVERY_PAYMENT_REQUESTED`
- `ORDER_REDELIVERY_SCHEDULED`
- `ORDER_HUB_ARRIVED`
- `ORDER_DELIVERED`
- `ORDER_CANCELLED`
- `ROUND_ORDER_CONFIRMED`
- `OPERATION_ISSUE_CREATED`
- `CUSTOMER_NOTICE_FAILED`
- `GROUP_JOINED`
- `GROUP_DEADLINE_SOON`
- `GROUP_CONFIRMED`
- `GROUP_CANCELLED_LACK`
- `GROUP_CANCELLED_SELF`
- `GROUP_PREPARING`
- `GROUP_DELIVERING`
- `GROUP_DELIVERED`

API 내부 registry는 판매자용 legacy 코드도 추가로 지원한다.

- `SELLER_GROUP_CONFIRMED`
- `SELLER_GROUP_CANCELLED_LACK`
- `SELLER_ORDER_BATCH`

## 3. 알림 기록

`notifications/{notificationId}`의 현재 기록 계약은 다음 필드를 중심으로 한다.

```ts
{
  id: string
  userId: string
  orderId: string | null
  channel: 'alimtalk' | 'sms' | 'fcm'
  templateCode: string
  variables: Record<string, string>
  message: string
  phone: string | null
  fcmToken: string | null
  status: 'pending' | 'sent' | 'failed'
  attemptCount?: number
  sentAt: Timestamp | null
  errorMessage: string | null
  createdAt: Timestamp
}
```

외부 API 응답에서는 `TimestampInterceptor`에 의해 timestamp가 ISO 문자열로 변환될 수 있다. 클라이언트는 Firestore 내부 객체 형태를 공개 API 계약으로 가정하지 않는다.

## 4. 본문 registry와 변수 검증

본문 정본은 `apps/api/src/notifications/notification-templates.ts`의 `NOTIFICATION_TEMPLATES`다.

각 템플릿은 다음을 가진다.

```ts
{
  body: string
  requiredVariables: readonly string[]
}
```

`renderNotificationMessage()`는 `requiredVariables` 중 값이 없거나 문자열이 아니거나 trim 후 빈 값이면 외부 요청 전에 실패한다. 필수 변수를 빈 문자열로 조용히 대체하지 않는다.

현재 회차 직배송의 핵심 변수 계약:

- `ORDER_ACCEPTED.name`: 결제 확정 시 주문 snapshot의 표시명을 사용하고 유효한 표시명이 없으면 서버 규칙에 따라 비개인 fallback을 사용한다.
- `ORDER_DELIVERY_HELD.reason`: 자유 입력 원문이 아니라 서버가 허용한 reason code의 비개인 고정 문구를 사용한다.
- `ORDER_CANCELLED.reason`: 서버가 정규화한 취소 사유를 사용한다.

세부 생성 규칙은 실제 호출부와 회차 직배송 spec을 함께 확인한다.

## 5. 내부 논리 코드와 ALIGO `tpl_code`

내부 `NotificationTemplateCode`와 provider의 `tpl_code`는 같은 값으로 취급하지 않는다.

운영 환경 변수:

- `ALIGO_API_KEY`
- `ALIGO_USER_ID`
- `ALIGO_SENDER_KEY`
- `ALIGO_SENDER_PHONE`
- `ALIGO_TEMPLATE_CODES_JSON`

`ALIGO_TEMPLATE_CODES_JSON`은 논리 코드 → 실제 ALIGO `tpl_code` 문자열의 JSON 객체다.

`apps/api/src/notifications/aligo-template-codes.ts`의 계약:

- JSON 객체만 허용
- `NOTIFICATION_TEMPLATES`에 없는 논리 키 거부
- 문자열이 아닌 provider code 거부
- trim 후 빈 문자열 거부
- 요청한 논리 코드의 매핑 누락 시 외부 요청 전에 실패
- 실제 `tpl_code` 원문은 문서·로그·Git 증거에 기록하지 않음

## 6. 회차 직배송 출시 필수 템플릿

회차 직배송 출시 준비 검사는 아래 8종의 실제 provider 매핑을 모두 요구한다.

1. `ORDER_ACCEPTED`
2. `ORDER_PREPARING`
3. `ORDER_DELIVERING`
4. `ORDER_DELIVERY_HELD`
5. `ORDER_REDELIVERY_PAYMENT_REQUESTED`
6. `ORDER_REDELIVERY_SCHEDULED`
7. `ORDER_DELIVERED`
8. `ORDER_CANCELLED`

이 목록은 `ROUND_DIRECT_NOTIFICATION_TEMPLATE_CODES`가 코드 정본이다.

`ORDER_HUB_ARRIVED`, 공동구매, 판매자 배치 등의 legacy 템플릿은 registry에 존재하지만 위 8종 회차 직배송 출시 readiness 목록에는 포함되지 않는다.

## 7. ALIGO 전달 계약

`AligoClient.sendAlimtalk()`의 현재 최소 계약:

1. 먼저 본문을 render하고 필수 변수를 검증한다.
2. ALIGO 필수 자격 증명 4개가 없으면 외부 요청 없이 실패한다.
3. `ALIGO_TEMPLATE_CODES_JSON`에서 실제 provider `tpl_code`를 해석한다.
4. 알림톡을 최대 **3회** 시도한다.
5. 3회 모두 실패하면 SMS를 **1회** 시도한다.
6. 성공 채널과 시도 횟수를 결과로 반환한다.
7. 알림톡과 SMS가 모두 실패하면 최종 실패를 반환한다.

현재 코드에는 retry 간격/backoff, provider 오류 분류, rate-limit별 지연 정책이 없다. 해당 고도화는 `docs/BACKLOG.md`의 `NOTIFICATION-RETRY-POLICY` 후속 범위다.

### 설정 오류의 fail-closed

다음은 SMS fallback까지 실행하지 않고 요청 전 실패한다.

- 필수 본문 변수 누락
- ALIGO 필수 자격 증명 누락
- `ALIGO_TEMPLATE_CODES_JSON` 파싱 오류
- 허용되지 않은 논리 코드
- 현재 템플릿의 provider 매핑 누락

### 직접 검증 상태

2026-08-24 기준 `notifications-delivery.spec.ts`, template/mapping 관련 spec은 다음을 직접 검증한다.

- 알림톡 성공 시 추가 재시도·SMS 없음
- 실패 시 최대 3회 알림톡 재시도
- 3회 실패 뒤 동일 본문 SMS 1회 fallback
- 설정·mapping·필수 변수 오류의 외부 요청 0 fail-closed
- 성공 channel과 attempt count 기록
- 최종 실패 운영 예외
- 동일 delivery idempotency key의 단일 발송

따라서 위 **격리된 client/service 전달 계약은 직접 테스트 근거가 있다.** 다만 이 증거를 ALIGO provider 실제 승인 상태나 실제 외부 발송 성공으로 확장하지 않는다. 실제 provider 검증은 활성 출시 PLAN의 별도 승인 게이트다.

## 8. 수신자와 최종 실패 처리

`NotificationsService.sendToUser()`는 주문 snapshot과 사용자 정보를 기준으로 수신 전화번호를 해석한다.

- 유효한 전화번호가 없고 주문 연계 알림이면 고객 안내 실패 운영 이슈를 만든다.
- 외부 발송 결과는 `notifications`에 기록한다.
- 최종 실패이고 주문이 있으면 `CUSTOMER_NOTICE_FAILED` 계열 운영 이슈를 생성한다.
- idempotency key가 주어진 알림은 `notificationDeliveries`를 사용해 `PROCESSING`/`SENT` 중복 전달을 차단한다.
- 실패한 전달은 `FAILED`로 닫히며 후속 운영 처리 대상이 될 수 있다.

운영 이슈에서 명시적으로 SMS 재발송하는 경로는 기존 실패 알림 기록의 전화번호·template code·variables를 사용해 `AligoClient.sendSms()`를 호출한다.

## 9. 사용자 API와 선택 마케팅 동의

모든 endpoint는 `JwtAuthGuard`를 사용한다.

### `GET /notifications/me`

현재 사용자 알림을 조회한다.

현재 service는 사용자 문서를 조회해 생성일 내림차순으로 정렬한 뒤 최대 50건을 반환한다.

```ts
{
  items: Notification[]
  total: number
}
```

과거 cursor 기반 응답 형식은 현재 구현 계약이 아니다.

### `PATCH /notifications/me/preferences`

허용 body:

```ts
{
  alimtalk?: boolean
  sms?: boolean
}
```

규칙:

- 빈 object 거부
- `alimtalk`, `sms` 외 키 거부
- boolean 외 타입 거부
- 한 채널만 전달하면 기존 다른 채널 값을 보존
- 저장 위치: `users/{userId}.notificationPreferences`

### 마케팅과 정보성 연락의 경계

consumer UI는 이 값을 **선택 마케팅 수신 상태**로 표시하고, 주문·결제·배송 정보성 연락은 마케팅 동의와 별개라고 안내한다.

따라서 주문 상태 알림을 단순히 `notificationPreferences`가 false라는 이유로 막는 것은 현재 안전 계약이 아니다. 거래 수행에 필요한 정보성 연락과 선택 마케팅 sender를 구분한다.

### 현재 파일럿 정책 — `MARKETING_NOT_USED_IN_PILOT`

현재 통제된 공개 파일럿에서는 선택 마케팅을 사용하지 않는다.

1. round checkout에 선택 마케팅 checkbox를 노출하지 않는다.
2. 신규 round 주문 request에 `marketingConsent`를 보내지 않는다.
3. `RoundOrderCreateService`는 방어적으로 `marketingConsent` 요청을 거부하고 신규 마케팅 consent
   retention record를 생성하지 않는다.
4. MY 마케팅 설정 진입은 파일럿에서 비활성화한다.
5. 과거에 이미 저장된 `notificationPreferences` 또는 consent 기록은 이 정책 전환만을 이유로
   삭제하지 않는다.

이는 미래 marketing 기능 전체를 삭제했다는 뜻이 아니다. legacy preference API·코드는 향후 별도
정책과 lifecycle 정합화 뒤 재사용할 수 있으나, 현재 파일럿의 선택 마케팅 sender로 사용하지 않는다.

`ORDER_ACCEPTED`, `ORDER_PREPARING`, `ORDER_DELIVERING`, `ORDER_DELIVERY_HELD`,
`ORDER_REDELIVERY_PAYMENT_REQUESTED`, `ORDER_REDELIVERY_SCHEDULED`, `ORDER_DELIVERED`,
`ORDER_CANCELLED`는 주문·결제·배송 수행을 위한 거래성 알림이며 선택 마케팅과 별개다. 마케팅
선호 상태를 이유로 거래성 알림을 막지 않는다.

현재 외부 provider의 실제 승인·운영 발송 여부는 이 source contract만으로 확정하지 않으며,
ALIGO 실제 발송은 별도 승인된 운영 readiness 검증의 대상이다.

## 10. Legacy 공동구매 알림

현재 코드에는 다음 legacy 공동구매 흐름이 유지된다.

- 마감 임박 스케줄러
- 목표 달성 시 참여 주문 `CONFIRMED` 전환 및 참여자 알림
- 목표 미달 시 환불 후 `CANCELLED` 전환 및 참여자 알림 의도
- 판매자 그룹 확정/취소 알림

### 현재 legacy 구현 finding — 목표 미달 consumer 취소 알림

`cancelGroupBuyLack()`는 RECRUITING 주문을 환불한 뒤 먼저 `CANCELLED`로 batch update하고 이후 `sendToGroupParticipants(..., 'GROUP_CANCELLED_LACK')`를 호출한다.

그러나 `sendToGroupParticipants()`는 `PENDING`, `CANCELLED`, `REVIEWED`를 terminal status로 제외한다. 따라서 방금 `CANCELLED`된 참여자는 consumer 취소 알림 대상에서 빠질 수 있다.

이 경로는 회차 직배송 출시 8종과 별개의 legacy 경로이므로 `LEGACY-GROUP-CANCEL-NOTIFICATION` LATER `IMPLEMENTATION FINDING`으로 추적한다. 현재 코드를 정당화하기 위해 “목표 미달 consumer 알림은 보내지 않는다”로 계약을 바꾸지 않는다.

회귀 시에는 취소 대상 snapshot 또는 명시적 recipient 집합을 기준으로 consumer 취소 알림이 한 번만 전달되고, 다른 template의 terminal filtering 의미는 유지되는지 직접 확인한다.

## 11. FCM 상태

`fcm` 타입과 `fcmToken` 필드는 호환 구조로 남아 있으나 현재 notifications API 코드에는 `sendFcmPush()` 구현이 없다. 따라서 FCM을 현재 운영 발송 채널로 문서화하지 않는다.

FCM을 다시 도입할 경우 별도 Task에서 다음을 함께 정의한다.

- 토큰 등록·회전·삭제
- Service Worker
- 수신 동의
- 실패·만료 토큰 처리
- 알림톡/SMS와의 우선순위

## 12. 보안·증거 원칙

- 실제 API key, sender key, 전화번호, `tpl_code` 원문을 저장소 문서에 기록하지 않는다.
- 테스트에서 실제 고객에게 알림톡·SMS를 발송하지 않는다.
- provider 실제 발송은 승인된 격리 수신자와 명시적 승인 게이트에서만 수행한다.
- provider 등록·승인 상태는 빠르게 바뀌므로 이 spec에 복제하지 않는다.
- 마케팅 consent의 존재를 실제 마케팅 발송 활성화 증거로 사용하지 않는다.
- 거래 정보성 연락과 선택 마케팅 수신 거부를 혼동하지 않는다.

## 13. 검증 진입점

알림 변경 시 최소 확인 대상:

- `apps/api/src/notifications/notification-templates.ts`
- `apps/api/src/notifications/aligo-template-codes.ts`
- `apps/api/src/notifications/aligo.client.ts`
- `apps/api/src/notifications/notifications.service.ts`
- `apps/api/src/notifications/notifications.controller.ts`
- `apps/api/src/notifications/notifications-delivery.spec.ts`
- `apps/api/src/notifications/notifications-preferences.spec.ts`
- `apps/consumer/src/app/mypage/notifications/settings/**`
- `apps/consumer/src/app/checkout/**`
- `apps/api/src/orders/round-order-create.service.ts`
- `apps/api/src/retention/retention.service.ts`
- `packages/shared/src/notification.types.ts`
- 회차 알림이면 `docs/specs/mvp-sales-round-direct-delivery.md`와 활성 출시 HANDOFF/PLAN
- consent/ALIGO 공개 고지 변경이면 `docs/specs/legal/README.md`

외부 실제 발송은 단위·통합 테스트의 대체물이 아니며 별도 승인된 운영 readiness 검증이다.

향후 선택 마케팅을 재개하는 변경은 단일 화면의 checkbox 동작만 확인하지 않고 consent → authoritative
state → withdrawal → retention evidence → sender gating의 lifecycle을 직접 검증한다. 현재 파일럿은
그 lifecycle을 사용하지 않는다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-30 | 파일럿 선택 마케팅 미사용, 거래성 `ORDER_*` 8종 유지, 과거 preference·consent 보존 정책을 반영 |
| 2026-08-24 | checkout consent·user preference·철회·retention evidence 분리와 legacy 목표미달 consumer 취소 알림 누락 가능성을 기록 |
| 2026-08-24 | ALIGO 3회 retry+SMS fallback·fail-closed·delivery idempotency의 직접 테스트 근거와 실제 provider 검증을 분리 |
| 2026-08-23 | 현행 ALIGO/SMS 구현, 3회 retry+1회 fallback, FCM 미구현 상태, 회차 8종 매핑 계약에 맞춰 전면 정합화 |
| 2026-08-22 | 내부 논리 코드와 ALIGO `tpl_code` 매핑 분리, 필수 본문 변수와 회차 알림 변수 계약 반영 |
| 2026-03-26 | 초기 알림 도메인 초안 작성 |

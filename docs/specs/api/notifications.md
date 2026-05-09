# Notifications Domain Spec

> **작성일**: 2026-03-26
> **상태**: Draft (4단계 개발 선행 문서)
> **연관 문서**: `orders.md`, `auth.md`, `1단계 요구사항 정의.md`

---

## 1. 도메인 개요

알림은 **두 채널**로 운영된다.

| 채널 | 기술 | 용도 | 비고 |
|------|------|------|------|
| 카카오 알림톡 | 알리고 또는 솔라피 API | 주문 상태 변경 공식 알림 | 건당 약 8~9원 |
| FCM 브라우저 푸시 | FCM + Service Worker | PWA 실시간 푸시 | Should Have |

**알림톡이 주 채널** — 카카오톡 공식 채널로 발송되어 앱 미설치 사용자에게도 도달.
FCM 푸시는 PWA 설치 사용자 대상 보조 채널.

모든 알림 발송은 **NestJS API 서버가 전담** (클라이언트에서 직접 발송 불가).

---

## 2. Firestore 컬렉션 스키마

### `notifications/{notificationId}`

```ts
{
  id: string
  userId: string
  orderId: string | null
  channel: 'alimtalk' | 'fcm'

  // 알림 내용
  templateCode: NotificationTemplateCode  // 하단 참조
  variables: Record<string, string>       // 템플릿 변수값
  message: string                         // 최종 발송 문자열 (로깅용)

  // 수신자
  phone: string | null      // 알림톡 발송 전화번호
  fcmToken: string | null   // FCM 푸시 토큰

  // 발송 결과
  status: 'pending' | 'sent' | 'failed'
  sentAt: Timestamp | null
  errorMessage: string | null

  createdAt: Timestamp
}
```

---

## 3. 알림톡 템플릿 목록

> 실제 발송 전 카카오 비즈메시지 채널 등록 + 템플릿 심사 필요 (약 1~3 영업일).

### 일반 판매

| 코드 | 트리거 | 수신자 | 내용 요약 |
|------|--------|--------|----------|
| `ORDER_ACCEPTED` | `PENDING → ACCEPTED` | 본인 | 결제 완료, 주문번호 안내 |
| `ORDER_PREPARING` | `ACCEPTED → PREPARING` | 본인 | 판매자가 상품 준비 시작 |
| `ORDER_DELIVERING` | `PREPARING → DELIVERING` | 본인 | 배송 시작 |
| `ORDER_HUB_ARRIVED` | `DELIVERING → HUB_ARRIVED` | 본인 | 거점 도착, 픽업 코드 안내 |
| `ORDER_DELIVERED` | `DELIVERING → DELIVERED` | 본인 | 배송 완료 |
| `ORDER_CANCELLED` | `* → CANCELLED` (판매자 강제) | 본인 | 취소 사유 + 환불 일정 |

### 공동구매

| 코드 | 트리거 | 수신자 | 내용 요약 |
|------|--------|--------|----------|
| `GROUP_JOINED` | `PENDING → RECRUITING` | 참여자 본인 | 참여 완료, 현재 N/M명 |
| `GROUP_DEADLINE_SOON` | 마감 2시간 전 (스케줄러) | 전체 참여자 | "N명만 더! 주변에 공유해보세요" |
| `GROUP_CONFIRMED` | `RECRUITING → CONFIRMED` | **전체 참여자** | 목표 달성, 주문 확정 |
| `GROUP_CANCELLED_LACK` | `RECRUITING → CANCELLED` (미달) | **전체 참여자** | 미달 취소 + 환불 일정 |
| `GROUP_CANCELLED_SELF` | `RECRUITING → CANCELLED` (개인 취소) | 취소자 본인만 | 취소·환불 완료 |
| `GROUP_PREPARING` | `CONFIRMED → PREPARING` | **전체 참여자** | 판매자 준비 시작 |
| `GROUP_DELIVERING` | `PREPARING → DELIVERING` | **전체 참여자** | 배송 시작 |
| `GROUP_DELIVERED` | `DELIVERING → DELIVERED` | **전체 참여자** | 배송 완료 |

### 판매자 알림 (SELLER_*)

> **2026-03-28 결정**: 매 주문·참여마다 알림은 과잉. 공동구매 결과(목표달성/미달취소)만 즉시 발송.
> 일반 판매는 배치 집계 알림(`SELLER_ORDER_BATCH`)으로 대체.
> `SELLER_NEW_ORDER`, `SELLER_ORDER_CANCELLED` 제거 — seller 앱 스캐폴딩 시 코드에서도 제거 필요.

| 코드 | 트리거 | 수신자 | 내용 요약 |
|------|--------|--------|----------|
| `SELLER_GROUP_CONFIRMED` | `RECRUITING → CONFIRMED` | 판매자 | "OO 공동구매 목표 달성! 준비를 시작하세요." |
| `SELLER_GROUP_CANCELLED_LACK` | `RECRUITING → CANCELLED` (미달 자동) | 판매자 | "OO 공동구매 미달 자동 취소 및 환불이 완료되었습니다." |
| `SELLER_ORDER_BATCH` | NestJS @Cron 스케줄러 (시각 미결) | 판매자 | "오늘 N건 주문, 총 OOO원" (0건이면 미발송) |

**`SELLER_ORDER_BATCH` 발송 시각**: **1일 1회 확정** (오후 8시 유력, seller 앱 착수 시 최종 확정). 0건 시 미발송.

---

## 4. 알림톡 템플릿 본문 (초안)

```
[ORDER_ACCEPTED]
안녕하세요, #{name}님.
Green Hub에서 주문이 접수되었습니다.

■ 주문번호: #{orderId}
■ 상품명: #{productName}
■ 결제금액: #{totalAmount}원
■ 배송 예정일: #{deliveryDate}

주문 현황은 앱에서 실시간으로 확인하실 수 있습니다.
```

```
[GROUP_JOINED]
#{name}님, #{productName} 공동구매에 참여하셨습니다!

현재 #{currentParticipants}/#{minParticipants}명 참여 중
■ 모집 마감: #{recruitDeadline}
■ 배송 예정일: #{groupDeliveryDate}

목표 인원 미달 시 결제 금액이 자동 환불됩니다.
```

```
[GROUP_DEADLINE_SOON]
#{productName} 공동구매 마감이 2시간 후입니다!

현재 #{currentParticipants}/#{minParticipants}명
#{remaining}명만 더 모이면 확정됩니다.
주변에 공유해보세요!
```

```
[GROUP_CONFIRMED]
🎉 #{productName} 공동구매가 확정되었습니다!

목표 인원 #{minParticipants}명이 모였습니다.
■ 배송 예정일: #{groupDeliveryDate}

확정 이후에는 취소 및 환불이 불가합니다.
```

```
[GROUP_CANCELLED_LACK]
[목표 수량 미달성으로 취소] #{productName} 공동구매

모집 기한 내 목표 인원이 모이지 않아 주문이 취소되었습니다.
결제 금액은 아래 일정으로 환불됩니다.
■ 카카오페이·네이버페이: 1~3 영업일
■ 신용·체크카드: 3~5 영업일
```

```
[ORDER_HUB_ARRIVED]
#{productName}이(가) 거점에 도착했습니다.

■ 픽업 코드: #{pickupCode}
■ 수령 장소: #{hubAddress}

코드를 제시하고 상품을 수령하세요.
```

---

## 5. 알림 발송 API (NestJS 내부 서비스)

> 아래 메서드들은 NestJS `NotificationsService` 내부에서 호출되며 외부에 직접 노출하지 않는다.
> 주문 상태 전환 시 `OrdersService`가 `NotificationsService`를 의존성 주입으로 호출.

```ts
// 단건 발송
sendAlimtalk(userId: string, templateCode: NotificationTemplateCode, variables: Record<string, string>): Promise<void>

// 다건 일괄 발송 (공동구매 전체 참여자)
sendAlimtalkBulk(userIds: string[], templateCode: NotificationTemplateCode, variables: Record<string, string>): Promise<void>

// FCM 푸시 단건
sendFcmPush(userId: string, title: string, body: string, data?: Record<string, string>): Promise<void>
```

---

## 6. 외부 노출 API 엔드포인트

### 알림 목록 조회 (소비자 앱 — 마이페이지 알림 내역)

```
GET /notifications/me?limit=20&cursor=:notificationId
```

**Guard**: `JwtAuthGuard` (consumer)

```ts
// Response 200
{
  items: NotificationSummary[]
  nextCursor: string | null
}
```

**NotificationSummary**
```ts
{
  id: string
  templateCode: NotificationTemplateCode
  message: string
  orderId: string | null
  sentAt: string   // ISO8601
}
```

---

### FCM 토큰 등록

> `auth.md` 섹션 6 참조 — `PATCH /auth/me/fcm-token` 으로 통합.

---

### 알림 수신 동의 설정 (Should Have)

```
PATCH /notifications/me/preferences
```

```ts
{
  alimtalk: boolean   // 알림톡 수신 동의
  fcm: boolean        // FCM 푸시 수신 동의
}
```

---

## 7. 알리고 / 솔라피 연동

### 선택 기준

| 항목 | 알리고 | 솔라피 |
|------|--------|--------|
| 가격 | 건당 약 8원 | 건당 약 8.5~9원 |
| API 문서 | 단순 | 상세 |
| 카카오 알림톡 | 지원 | 지원 |
| SMS 폴백 | 지원 | 지원 |

**MVP에서는 알리고 채택 검토** (가격 우위). 이후 발송량 기준으로 재검토.

### 알리고 API 호출 구조

```ts
// NestJS NotificationsService 내부
POST https://kakaoapi.aligo.in/akv10/alimtalk/send/

{
  apikey: process.env.ALIGO_API_KEY,
  userid: process.env.ALIGO_USER_ID,
  senderkey: process.env.ALIGO_SENDER_KEY,
  tpl_code: templateCode,       // 카카오 심사 완료 템플릿 코드
  sender: '010-XXXX-XXXX',      // 발신 번호
  receiver_1: phone,
  recvname_1: userName,
  // 템플릿 변수
  subject_1: '주문 알림',
  message_1: renderedMessage,
  // SMS 폴백 (알림톡 수신 불가 시 문자 대체 발송)
  failover: 'Y',
  fsubject_1: '주문 알림',
  fmessage_1: renderedMessage,
}
```

---

## 8. FCM 브라우저 푸시 (Should Have)

```
구현 순서:
  1. Firebase 프로젝트 설정 + FCM VAPID 키 발급
  2. Service Worker (firebase-messaging-sw.js) 등록
  3. 소비자 앱: 브라우저 푸시 권한 요청 → FCM 토큰 발급 → PATCH /auth/me/fcm-token
  4. NestJS: firebase-admin SDK로 FCM 푸시 발송

오프라인 수신:
  Service Worker가 백그라운드 메시지를 수신해 시스템 알림으로 표시.
  알림 클릭 시 해당 주문 현황 페이지로 딥링크.
```

---

## 9. 마감 임박 알림 스케줄러

```
NestJS @Cron (매 10분)

처리:
  1. recruitDeadline이 현재 시각 기준 2시간 이내인 RECRUITING 상태 groupProductConfig 조회
  2. 이미 GROUP_DEADLINE_SOON 알림 발송된 건 제외 (notifications 컬렉션 조회)
  3. 대상 공동구매의 전체 참여자에게 GROUP_DEADLINE_SOON 알림톡 일괄 발송
  4. 발송 완료 기록 저장 (중복 발송 방지)
```

---

## 10. packages/shared 공통 타입

> **Timestamp 직렬화 규칙**: Firestore 스키마의 `Timestamp` 필드는 shared 타입에서 `string (ISO8601)`으로 표현합니다.

```ts
// packages/shared/src/notification.types.ts

export type NotificationChannel = 'alimtalk' | 'fcm'

export type NotificationStatus = 'pending' | 'sent' | 'failed'

export type NotificationTemplateCode =
  // 일반 판매 (소비자)
  | 'ORDER_ACCEPTED'
  | 'ORDER_PREPARING'
  | 'ORDER_DELIVERING'
  | 'ORDER_HUB_ARRIVED'
  | 'ORDER_DELIVERED'
  | 'ORDER_CANCELLED'
  // 공동구매 (소비자)
  | 'GROUP_JOINED'
  | 'GROUP_DEADLINE_SOON'
  | 'GROUP_CONFIRMED'
  | 'GROUP_CANCELLED_LACK'
  | 'GROUP_CANCELLED_SELF'
  | 'GROUP_PREPARING'
  | 'GROUP_DELIVERING'
  | 'GROUP_DELIVERED'
  // 판매자 알림 (2026-03-28 확정 — 매 건 알림 제거, 배치+공동구매 결과만)
  | 'SELLER_GROUP_CONFIRMED'
  | 'SELLER_GROUP_CANCELLED_LACK'
  | 'SELLER_ORDER_BATCH'         // 일반 판매 배치 집계 (발송 시각 미결)

export interface Notification {
  id: string
  userId: string
  orderId: string | null
  channel: NotificationChannel
  templateCode: NotificationTemplateCode
  variables: Record<string, string>
  message: string
  phone: string | null
  fcmToken: string | null
  status: NotificationStatus
  sentAt: string | null   // ISO8601
  errorMessage: string | null
  createdAt: string       // ISO8601
}

export interface NotificationSummary {
  id: string
  templateCode: NotificationTemplateCode
  message: string
  orderId: string | null
  sentAt: string   // ISO8601
}
```

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-03-26 | 초안 작성 — 1·2단계 설계 + orders.md 알림 시점 기반 통합 |

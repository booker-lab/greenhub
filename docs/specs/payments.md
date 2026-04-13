# Payments Domain Spec

> **작성일**: 2026-03-26
> **최종 수정**: 2026-03-27 (Portone V2 마이그레이션 반영)
> **상태**: 현행화 완료
> **연관 문서**: `orders.md`, `CRITICAL_LOGIC.md`, `1단계 요구사항 정의.md`

---

## 1. 도메인 개요

결제 검증·환불은 **NestJS API 서버가 단독 처리**한다.
클라이언트(소비자 앱)는 **Portone V2 SDK**로 결제창을 열고, 서버는 Portone webhook을 수신해 금액을 검증한 뒤 주문 상태를 전환한다.

**핵심 결정 사항**

| 항목 | 결정 | 이유 |
|------|------|------|
| Portone SDK 버전 | **V2** (`@portone/browser-sdk/v2`) | V1 deprecated |
| 결제 방식 | 즉시 결제 (pre-auth 미적용) | 카카오페이·네이버페이가 pre-auth 미지원 |
| 무통장 입금 | 미지원 | 즉시 결제만 지원 |
| 환불 처리 | Portone V2 환불 API | 자동 처리, 카드 3~5 영업일 / 간편결제 1~3일 |
| 결제 PG | Portone (이니시스 or NHN KCP) | 카드 결제 활성화를 위해 PG사 계약 필요 |

> ⚠️ **MVP 완료 후 액션 필요**
> 카드 결제 활성화를 위해 Portone 가입 + PG사 심사 신청 (KG이니시스 또는 NHN KCP).
> 심사 기간 약 2~5 영업일. 코드 변경 없이 채널키 추가만으로 활성화 가능.

---

## 2. 지원 결제 수단

| 수단 | easyPayProvider | 상태 |
|------|----------------|------|
| 카카오페이 | `KAKAOPAY` | ✅ 테스트 완료 |
| 네이버페이 | `NAVERPAY` | ⏸ 파트너 가입 필요 |
| 신용/체크카드 | — | ⏸ PG사 계약 완료 후 활성화 |

---

## 3. Firestore 컬렉션 스키마

### `payments/{paymentId}`

```ts
{
  id: string                    // orderId와 동일 (Portone V2 paymentId)
  orderId: string               // orders 참조
  userId: string
  storeId: string

  // 결제 정보
  amount: number                // 실제 결제 금액 (검증 기준)
  payMethod: 'kakaopay' | 'naverpay' | 'card' | null
  status: PaymentStatus
  portonePaymentId: string      // Portone V2 paymentId (구 imp_uid)
  portoneTransactionId: string  // Portone V2 transactionId (구 merchant_uid)

  // 환불 정보
  refundAmount: number | null
  refundedAt: Timestamp | null
  refundReason: string | null

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**PaymentStatus**
```
'PENDING'    — 결제창 열림, webhook 수신 전 (payments 문서 미생성)
'PAID'       — 결제 완료 (금액 검증 성공)
'FAILED'     — 결제 실패 또는 금액 위변조 감지 (환불 완료 포함)
'CANCELLED'  — 환불 완료
```

> 💡 PENDING 상태일 때는 payments 문서가 생성되지 않음.
> Portone webhook 수신 + 금액 검증 성공 시 PAID로 최초 생성됨.

---

## 4. 결제 플로우

### 4-1. 일반 결제 흐름 (Portone V2)

```
[소비자 앱]                     [NestJS]                    [Portone]

1. POST /stores/:id/orders
                               2. PENDING 주문 생성
                               3. { orderId, portonePaymentParams } 반환
4. Portone V2 SDK 결제창 오픈
   storeId, paymentId=orderId,
   channelKey (카카오페이)
                                                        5. 결제 처리
                                                        6. webhook POST → NestJS
                                                           { type: 'Transaction.Paid',
                                                             data: { paymentId, storeId } }
                               7. GET /payments/{paymentId} 로 Portone V2 API 조회
                               8. amount.total 검증
                               [성공] 주문 ACCEPTED / RECRUITING 전환
                                      payments 문서 생성 (status: PAID)
                                      알림톡 발송
                               [실패] 주문 CANCELLED + 즉시 환불 처리
9. Firestore REST API 폴링으로
   주문 상태 확인 → 완료 화면 표시
```

### 4-2. 금액 검증 규칙 (위변조 방지)

```
검증 조건:
  portone.getPayment(paymentId).amount.total === orders.totalAmount

실패 처리:
  1. Portone V2 환불 API 즉시 호출
  2. orders.status → 'CANCELLED', cancelReason: 'amount_mismatch'
  3. dailyCaps.usedSlots 복구
  (payments 문서 생성 없음 — 검증 실패 시 PAID 기록 불필요)
```

### 4-3. PENDING 타임아웃 처리

```
조건: 결제창 열린 후 15분 내 Portone webhook 미수신

NestJS PaymentsService 스케줄러 (@Cron EVERY_MINUTE):
  1. orders.status === 'PENDING' AND createdAt < (now - 15분) 조회
  2. orders.status → 'CANCELLED', cancelReason: 'timeout'
  3. dailyCaps.usedSlots 복구
  (payments 문서 없으므로 환불 불필요)
```

---

## 5. 환불 플로우

### 5-1. 개인 취소 (RECRUITING 구간)

```
소비자 앱: PATCH /stores/:storeId/orders/:orderId/cancel
NestJS:
  1. 상태 검증 — RECRUITING 이외 → 403 거부
  2. processRefundByOrderId() 호출
     - payments에서 PAID 기록 조회
     - Portone V2 환불 API: POST /payments/{paymentId}/cancel
     - payments.status → 'CANCELLED', refundedAt 기록
  3. orders.status → 'CANCELLED', cancelReason 기록
  4. groupProductConfig.currentParticipants -1 (Firestore 트랜잭션)
  5. 본인에게 알림톡 발송
```

### 5-2. 공동구매 마감 미달 자동 환불

```
트리거: NestJS 스케줄러 (recruitDeadline 경과 + currentParticipants < minParticipants)

처리:
  1. 해당 groupProductId의 모든 RECRUITING 주문 조회
  2. 각 주문에 processRefundByOrderId() 병렬 호출
  3. 전체 orders.status → 'CANCELLED'
     cancelReason: '목표 수량 미달성으로 취소'
  4. 전체 참여자에게 알림톡 일괄 발송
```

### 5-3. 판매자 강제 취소

```
판매자 앱: PATCH /stores/:storeId/orders/:orderId/status { status: 'CANCELLED', reason }

처리:
  1. 환불 가능 상태 (ACCEPTED, RECRUITING, CONFIRMED, PREPARING) 검증
  2. processRefundByOrderId() 호출 (내부 공통 환불 메서드)
  3. orders.status → 'CANCELLED', cancelReason 기록
  4. 소비자에게 알림톡 발송
```

### 환불 소요 시간 안내 문구 (소비자 노출)

| 결제 수단 | 환불 소요 |
|----------|----------|
| 카카오페이 | 1~3 영업일 |
| 네이버페이 | 1~3 영업일 |
| 신용/체크카드 | 3~5 영업일 |

---

## 6. API 엔드포인트

### 결제 파라미터 생성 (주문 생성과 통합)

> `POST /stores/:storeId/orders` 응답에 Portone V2 결제 파라미터를 포함해 반환.
> 별도 결제 엔드포인트 없음.

**Response** `201`
```ts
{
  orderId: string
  portonePaymentParams: {
    name: string      // 상품명
    amount: number    // 검증 기준 금액 (KRW)
    buyerName: string
  }
}
```

---

### Portone Webhook 수신

```
POST /payments/webhook/portone
```

Portone이 서버로 직접 호출. 클라이언트 미사용. 인증 불필요.

**Request Body** (Portone V2 전송)
```ts
{
  type: string   // 'Transaction.Paid' | 'Transaction.Failed' | 'Transaction.Cancelled' 등
  data: {
    paymentId: string  // orderId와 동일
    storeId: string    // Portone 스토어 ID
  }
}
```

**처리 흐름** — 섹션 4-1, 4-2 참조

---

### 결제 내역 조회

```
GET /payments/:paymentId          (JwtAuthGuard — 본인 또는 해당 판매자)
GET /stores/:storeId/orders/:orderId/payment  (JwtAuthGuard)
```

**Response** `200` — `payments` 전체 필드 (Timestamp → ISO8601 직렬화)

---

### 환불 처리 (내부 서비스 메서드)

> `PaymentsService.processRefundByOrderId(orderId, reason)` — NestJS 서비스 레이어 내부 호출.
> 외부 엔드포인트로 직접 노출하지 않음.
> OrdersService.cancelOrder(), NotificationsService.cancelGroupBuyLack()에서 호출.

---

## 7. 보안 체크리스트

| 항목 | 처리 방식 |
|------|----------|
| 금액 위변조 | 서버에서 Portone V2 API로 재조회 후 `orders.totalAmount`와 비교 |
| Webhook 위조 | Portone IP 화이트리스트 설정 권장 (MVP는 미적용, 금액 검증으로 대체) |
| 중복 webhook | `orders.status !== 'PENDING'` 멱등성 처리 (이미 처리된 경우 스킵) |
| 환불 권한 | 소비자: 본인 RECRUITING 주문만 / 판매자: 본인 storeId 주문만 |
| 결제 금액 | `totalAmount`는 서버에서 계산, 클라이언트 전달값 사용 안 함 |

---

## 8. packages/shared 공통 타입

> **Timestamp 직렬화 규칙**: Firestore `Timestamp` 필드는 shared 타입에서 `string (ISO8601)`으로 표현.

```ts
// packages/shared/src/payment.types.ts

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
export type PayMethod = 'kakaopay' | 'naverpay' | 'card'

export interface Payment {
  id: string                    // orderId와 동일 (Portone V2 paymentId)
  orderId: string
  userId: string
  storeId: string
  amount: number
  payMethod: PayMethod | null
  status: PaymentStatus
  portonePaymentId: string      // Portone V2 paymentId (구 imp_uid)
  portoneTransactionId: string  // Portone V2 transactionId (구 merchant_uid)
  refundAmount: number | null
  refundedAt: string | null     // ISO8601
  refundReason: string | null
  createdAt: string             // ISO8601
  updatedAt: string             // ISO8601
}

// POST /stores/:storeId/orders 응답 내 포함
export interface PortonePaymentParams {
  name: string      // 상품명
  amount: number    // 결제금액 (KRW)
  buyerName: string
}
```

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-03-26 | 초안 작성 |
| 2026-03-27 | Portone V1 → V2 전면 업데이트 (SDK, webhook 포맷, 필드명, 플로우 다이어그램) |

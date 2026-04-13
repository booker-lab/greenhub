# Orders Domain Spec

> **작성일**: 2026-03-26
> **상태**: Draft (4단계 개발 선행 문서)
> **연관 문서**: `CRITICAL_LOGIC.md`, `1단계 요구사항 정의.md`, `2단계 IA.md`

---

## 1. 도메인 개요

`orders` 도메인은 소비자·판매자·드라이버 세 앱이 공유하는 **핵심 도메인**이다.
모든 비즈니스 로직(상태 전환·결제 검증·공동구매 자동 환불·Daily Cap 동시성 처리)은
**NestJS API 서버 단독으로 처리**하며, 클라이언트는 Firestore 실시간 리스너로 결과를 수신한다.

---

## 2. 주문 상태 FSM

### 상태 코드 전체

| 상태 코드 | 소비자 노출 명칭 | 적용 판매 방식 | 알림톡 |
|-----------|----------------|--------------|--------|
| `PENDING` | (미노출) | 공통 (내부) | - |
| `RECRUITING` | 모집 중 | 공동구매 | ✅ |
| `CONFIRMED` | 주문 확정 | 공동구매 | ✅ |
| `ACCEPTED` | 결제 완료 | 일반 판매 | ✅ |
| `PREPARING` | 상품 준비 중 | 공통 | ✅ |
| `DELIVERING` | 배송 중 | 공통 | ✅ |
| `HUB_ARRIVED` | 거점 도착 | 거점 픽업 전용 | ✅ |
| `PICKED_UP` | 픽업 완료 | 거점 픽업 전용 | - |
| `DELIVERED` | 배송 완료 | 직배송·택배 | ✅ |
| `CANCELLED` | 주문 취소 | 공통 | ✅ (사유 포함) |
| `REVIEWED` | 구매 확정 | 공통 | - |

### 상태 전환 흐름

```
[일반 판매]
  PENDING → ACCEPTED → PREPARING → DELIVERING → DELIVERED → REVIEWED
                                             ↘ HUB_ARRIVED → PICKED_UP → REVIEWED

[공동구매]
  PENDING → RECRUITING → CONFIRMED → PREPARING → DELIVERING → DELIVERED → REVIEWED
                       ↘ CANCELLED (마감 기한 내 minParticipants 미달 → 자동 환불)

[공통 취소]
  RECRUITING → CANCELLED (소비자 개인 취소, RECRUITING 구간 한정)
  모든 상태 → CANCELLED (판매자 강제 취소, 사유 필수)
```

### PENDING 처리 규칙

- Portone 결제창이 열리는 순간 `PENDING` 상태 주문 생성 (소비자 미노출)
- Portone webhook 수신 성공 → `ACCEPTED` 또는 `RECRUITING` 으로 전환
- **15분 내 webhook 미수신** → NestJS 스케줄러가 주문 자동 삭제 + 슬롯 복구

---

## 3. Firestore 컬렉션 스키마

### `orders/{orderId}`

```ts
{
  id: string
  storeId: string              // MVP: 'dear-orchid' 고정
  userId: string
  productId: string
  quantity: number
  saleType: 'normal' | 'group'

  status: OrderStatus          // 위 FSM 참조

  // 배송 정보
  deliveryMethod: 'direct' | 'hub' | 'parcel'
  deliveryFee: number
  deliveryAddress: {
    address: string
    addressDetail: string
    zipCode: string
  }
  isMetropolitan: boolean      // 서울/경기 여부 (주소 판별)
  hubId: string | null         // hub 배송 선택 시 거점 ID (직배송·택배는 null)
  pickupCode: string | null    // hub 배송 시에만 생성 (6자리)

  // 금액
  totalAmount: number          // 상품가 + 배송비

  // 일반 판매 전용
  requestedDeliveryDate: Timestamp | null

  // 판매자 입력 (PREPARING 전환 시 선택 입력)
  preparedAt: Timestamp | null  // 드라이버 수거 예정 시간 (null이면 미설정)

  // 드라이버 앱 (DELIVERING 전환 시 자동 기록)
  driverId: string | null          // 드라이버 userId → Seller 앱 주문 상세에서 이름·연락처 조회
  deliveryPhotoUrl: string | null  // 거점 하차 인증 사진 (Firebase Storage URL)
                                   // HUB_ARRIVED 전환 시 저장. 직배송·택배는 null

  // 취소 정보
  cancelReason: string | null

  // 공동구매 전용 — 법적 동의 기록 (전자상거래법 제17조)
  groupBuyConsent: {
    agreed: true               // 미동의 시 결제 진입 불가이므로 항상 true
    agreedAt: Timestamp
    userId: string
  } | null                     // 일반 판매는 null

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `dailyCaps/{storeId_date}`

```ts
{
  id: string                   // '{storeId}_{YYYY-MM-DD}'
  storeId: string
  date: string                 // 'YYYY-MM-DD'
  totalCap: number             // 날짜별 최대 수용량 (직배송 + 거점 픽업 합산)
  usedSlots: number            // 실시간 갱신 (Firestore 트랜잭션)
}
```

> `groupProductConfig` 스키마는 `products.md` 에서 정의

---

## 4. API 엔드포인트

> **기본 경로**: `/stores/:storeId/orders`
> MVP에서는 `storeId = 'dear-orchid'` 고정. 다중 판매자 확장 시 변경 없음.

### 주문 생성

```
POST /stores/:storeId/orders
```

**Request Body**
```ts
{
  productId: string
  quantity: number
  saleType: 'normal' | 'group'
  deliveryMethod: 'direct' | 'hub' | 'parcel'
  deliveryAddress: { address, addressDetail, zipCode }
  requestedDeliveryDate?: string   // 일반 판매 전용 'YYYY-MM-DD'
  groupBuyConsent?: {              // 공동구매 전용
    agreed: true
    agreedAt: string               // ISO8601
  }
}
```

**처리 흐름**
1. Daily Cap 잔여 슬롯 검증 (Firestore 트랜잭션)
2. 공동구매: `groupBuyConsent` 필드 존재 여부 검증
3. `PENDING` 상태 주문 생성 + `usedSlots` +1
4. Portone 결제 요청 파라미터 반환

**Response** `201`
```ts
{ orderId: string, portonePaymentParams: object }
```

---

### Portone Webhook 수신

```
POST /payments/webhook/portone
```

**처리 흐름**
1. Portone 결제 금액 검증 (위변조 방지)
2. 검증 성공 → `PENDING` 제거 후 상태 전환
   - `saleType: 'normal'` → `ACCEPTED`
   - `saleType: 'group'` → `RECRUITING`
3. 카카오 알림톡 발송 (알리고/솔라피)
4. 검증 실패 → 주문 `CANCELLED` + 슬롯 복구 + 환불 처리

---

### 주문 상태 조회

```
GET /stores/:storeId/orders/:orderId
```

> 소비자 앱은 **Firestore 실시간 리스너**로 상태를 수신.
> 이 엔드포인트는 초기 로드 및 서버사이드 렌더링(SSR) 용도로만 사용.

**Response** `200` — 주문 전체 필드

---

### 주문 목록 조회

```
GET /stores/:storeId/orders?userId=:userId&status=:status&saleType=:saleType
```

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `userId` | consumer·seller·driver: ✅ / **admin: 선택** | 본인 주문만 조회. admin은 생략 시 storeId 전체 주문 조회 |
| `status` | - | 특정 상태 필터 |
| `saleType` | - | `normal` \| `group` |
| `driverId` | - | 드라이버 앱 전용 — 자신에게 배정된 주문 필터 (Phase 2, 현재 단일 드라이버이므로 미사용) |

> **admin 전용**: `userId` 생략 가능. NestJS Guard에서 `role === 'admin'` 시 userId 검증 우회.

---

### 주문 취소

```
PATCH /stores/:storeId/orders/:orderId/cancel
```

**Request Body**
```ts
{ reason?: string }
```

**처리 규칙**
- `RECRUITING` 상태: 취소 허용 → Portone 환불 API → `CANCELLED` + `currentParticipants` -1
- `CONFIRMED` 이후: **소비자 직접 취소 거부** `403` (계약 성립 시점, 판매자 생산 시작)
- 환불 소요: 카드 3~5 영업일, 간편결제 1~3일

---

### 상태 전환 (판매자·드라이버 전용)

```
PATCH /stores/:storeId/orders/:orderId/status
```

**Request Body**
```ts
{
  status: OrderStatus
  reason?: string
  photoUrl?: string   // 거점 하차 인증 사진 URL (HUB_ARRIVED 전환 시에만 사용)
}
```

**허용 전환 목록** (NestJS Guard에서 역할별 제한)

| 호출 주체 | 허용 전환 |
|-----------|----------|
| 판매자 | `ACCEPTED → PREPARING`, `CONFIRMED → PREPARING`, `ACCEPTED → CANCELLED`, `CONFIRMED → CANCELLED`, `PREPARING → CANCELLED` |
| 드라이버 | `PREPARING → DELIVERING`, `DELIVERING → HUB_ARRIVED`, `DELIVERING → DELIVERED` |
| 시스템 (스케줄러) | `RECRUITING → CONFIRMED`, `RECRUITING → CANCELLED` (마감 기한) |
| 소비자 | `DELIVERED → REVIEWED`, `PICKED_UP → REVIEWED` |

> **설계 결정 (2026-03-28)**: 판매자 강제 취소는 `DELIVERING` 이전(`ACCEPTED` · `CONFIRMED` · `PREPARING`)까지만 허용.
> 발송(`DELIVERING`) 이후에는 소비자가 반품 신청 → 판매자 수락 루트로만 처리.
> 발송 후 판매자 일방 취소는 표준 e-커머스에 없는 개념이며, 드라이버가 이미 상품을 픽업한 상태에서 취소 시 상품 회수 처리가 모호해지는 운영 문제가 있음. (`CRITICAL_LOGIC.md` §판매자 취소 권한 참조)

---

### 구매 확정 (REVIEWED 전환)

```
PATCH /stores/:storeId/orders/:orderId/review
```

- `DELIVERED` 또는 `PICKED_UP` 상태에서만 허용
- 리뷰 작성 또는 구매 확정 버튼 클릭 시 호출

---

### 거점 픽업 확인 (HUB_ARRIVED → PICKED_UP)

```
PATCH /stores/:storeId/orders/:orderId/pickup-confirm
Body: { pickupCode: string }
```

- `hub` 배송 방식 주문에서 소비자가 거점에서 수령 시 호출
- 주문 생성 시 서버가 6자리 `pickupCode` 발급 → 거점 담당자가 확인
- `pickupCode` 불일치 시 `400 Bad Request`
- `HUB_ARRIVED` 상태에서만 허용

---

## 5. 공동구매 자동 처리 로직

### CONFIRMED 자동 전환

```
트리거: NestJS 스케줄러 (1분 주기 폴링 or Firestore onWrite 트리거)

조건: groupProductConfig.currentParticipants >= groupProductConfig.minParticipants

처리:
  1. 해당 groupProductId의 모든 RECRUITING 주문 → CONFIRMED 일괄 전환
  2. 전체 참여자에게 알림톡 발송: "목표 인원이 모였습니다! 주문이 확정되었습니다."
```

### 마감 기한 미달 자동 취소

```
트리거: NestJS 스케줄러 (groupProductConfig.recruitDeadline 경과 시)

조건: currentParticipants < minParticipants

처리:
  1. 모든 RECRUITING 주문 → CANCELLED (cancelReason: '목표 수량 미달성으로 취소')
  2. Portone 환불 API 일괄 호출
  3. 전체 참여자에게 알림톡 발송: "[목표 수량 미달성으로 취소] 결제 금액은 3~5일 내 환불됩니다."
  4. usedSlots 복구
```

---

## 6. Daily Cap 동시성 처리

```
문제: 두 소비자가 동시에 마지막 슬롯을 결제하는 레이스 컨디션

해결: Firestore 트랜잭션 (낙관적 잠금)

흐름:
  1. 트랜잭션 시작
  2. dailyCaps 문서 읽기
  3. usedSlots < totalCap 확인
  4. usedSlots + quantity 원자적 업데이트
  5. 트랜잭션 커밋 실패(충돌) → 재시도 최대 3회 → 실패 시 409 응답
```

---

## 7. 알림톡 발송 시점

| 트리거 | 수신자 | 내용 요약 |
|--------|--------|----------|
| `PENDING → ACCEPTED` | 본인 | 일반 판매 결제 완료 |
| `PENDING → RECRUITING` | 본인 | 공동구매 참여 완료, 현재 N/M명 |
| `RECRUITING → CONFIRMED` | **전체 참여자** | 목표 달성, 주문 확정 |
| `RECRUITING → CANCELLED` (마감 미달) | **전체 참여자** | 미달 취소 + 환불 일정 안내 |
| `RECRUITING → CANCELLED` (개인 취소) | 취소자 본인만 | 취소 및 환불 완료 |
| 마감 2시간 전 | 전체 참여자 | 마감 임박 + 공유 유도 |
| `CONFIRMED → PREPARING` | 전체 참여자 | 판매자 준비 시작 |
| `ACCEPTED → PREPARING` | 본인 | 판매자 준비 시작 |
| `PREPARING → DELIVERING` (일반 판매) | 본인 | 배송 시작 |
| `PREPARING → DELIVERING` (공동구매) | **전체 참여자** | 배송 시작 |
| `DELIVERING → HUB_ARRIVED` | 본인 | 거점 도착, 픽업 코드 안내 |
| `DELIVERING → DELIVERED` (일반 판매) | 본인 | 배송 완료 |
| `DELIVERING → DELIVERED` (공동구매) | **전체 참여자** | 배송 완료 |
| `* → CANCELLED` (판매자 강제) | 본인 | 취소 사유 + 환불 안내 |

---

## 8. 취소 사유 워딩 표준

```
"[목표 수량 미달성으로 취소]"   — 공동구매 마감 미달
"[산지 재고 소진으로 취소]"     — 물량 확보 실패
"[배송 불가 지역으로 취소]"     — 배송 범위 외 주소
"[결제 오류로 취소]"            — 결제 처리 실패
```

> 취소 사유는 주문 현황 보드 UI와 알림톡 모두에 동일하게 노출.

---

## 9. packages/shared 공통 타입

> **Timestamp 직렬화 규칙**: Firestore 스키마의 `Timestamp` 필드는 shared 타입에서 `string (ISO8601)`으로 표현합니다. 클라이언트·서버 경계에서 JSON 직렬화가 필요하기 때문입니다.

```ts
// packages/shared/src/order.types.ts

export type OrderStatus =
  | 'PENDING'
  | 'RECRUITING'
  | 'CONFIRMED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'DELIVERING'
  | 'HUB_ARRIVED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REVIEWED'

export type DeliveryMethod = 'direct' | 'hub' | 'parcel'
export type SaleType = 'normal' | 'group'

export interface DeliveryAddress {
  address: string
  addressDetail: string
  zipCode: string
}

export interface GroupBuyConsent {
  agreed: true
  agreedAt: string   // ISO8601
  userId: string
}

export interface Order {
  id: string
  storeId: string
  userId: string
  productId: string
  quantity: number
  saleType: SaleType
  status: OrderStatus
  deliveryMethod: DeliveryMethod
  deliveryFee: number
  deliveryAddress: DeliveryAddress
  isMetropolitan: boolean
  hubId: string | null               // hub 배송 선택 시 거점 ID
  pickupCode: string | null
  totalAmount: number
  requestedDeliveryDate: string | null   // ISO8601
  preparedAt: string | null              // ISO8601 — 드라이버 수거 예정 시간 (판매자 설정)
  driverId: string | null                // DELIVERING 전환 시 자동 기록
  deliveryPhotoUrl: string | null        // 거점 하차 인증 사진 URL (HUB_ARRIVED 전환 시)
  cancelReason: string | null
  groupBuyConsent: GroupBuyConsent | null
  createdAt: string   // ISO8601
  updatedAt: string   // ISO8601
}

export interface DailyCap {
  id: string   // '{storeId}_{YYYY-MM-DD}'
  storeId: string
  date: string   // 'YYYY-MM-DD'
  totalCap: number
  usedSlots: number
}

export interface CreateOrderRequest {
  productId: string
  quantity: number
  saleType: SaleType
  deliveryMethod: DeliveryMethod
  hubId?: string                 // hub 배송 시 필수 (서비스 레이어 검증)
  deliveryAddress: DeliveryAddress
  requestedDeliveryDate?: string   // 일반 판매 전용 'YYYY-MM-DD'
  groupBuyConsent?: {
    agreed: true
    agreedAt: string   // ISO8601
  }
}
```

> 세 앱과 NestJS 모두 이 파일을 import. 타입 불일치 원천 차단.

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-03-26 | 초안 작성 — 1·2·3단계 설계 + CRITICAL_LOGIC.md 기반 통합 |
| 2026-03-28 | `CreateOrderRequest.hubId?: string` 추가 (C-3 작업 반영) |
| 2026-03-28 | `Order.hubId: string \| null` 추가 (hub 배송 선택 시 거점 ID) |
| 2026-03-29 | Section 3·9 `hubId` 필드 스펙 반영 (코드와 문서 정합성 수정) |
| 2026-04-02 | `driverId`, `deliveryPhotoUrl` 필드 추가 (드라이버 IA 2단계 확정 반영) |
| 2026-04-02 | `PATCH /status` body에 `photoUrl` 파라미터 추가 (거점 하차 인증) |
| 2026-04-02 | `GET /orders` 쿼리에 `driverId` 파라미터 추가 (Phase 2 예고) |

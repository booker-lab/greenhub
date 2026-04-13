# Settlements Domain Spec

> **작성일**: 2026-03-28
> **상태**: Draft
> **연관 문서**: `orders.md`, `CRITICAL_LOGIC.md`

---

## 1. 도메인 개요

`settlements` 도메인은 주문이 완료 상태(`REVIEWED` / `DELIVERED` / `PICKED_UP`)에 도달할 때
**자동 생성**되는 정산 레코드를 관리한다. 판매자는 기간별 정산 내역과 요약을 조회할 수 있다.

---

## 2. Firestore 스키마

### `settlements/{settlementId}` 문서

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | `string` | 문서 ID (= `orderId`) |
| `storeId` | `string` | 판매자 스토어 ID |
| `orderId` | `string` | 연결된 주문 ID |
| `totalAmount` | `number` | 주문 총액 (배송비 포함) |
| `platformFeeRate` | `number` | 수수료율 (예: 0.05 = 5%) |
| `platformFee` | `number` | 플랫폼 수수료 = totalAmount × platformFeeRate (원 단위 버림) |
| `netAmount` | `number` | 판매자 실수령액 = totalAmount - platformFee |
| `status` | `SettlementStatus` | 정산 상태 |
| `completedStatus` | `string` | 트리거된 주문 완료 상태 (REVIEWED/DELIVERED/PICKED_UP) |
| `settledAt` | `Timestamp` | 주문 완료 시각 |
| `paidAt` | `Timestamp \| null` | 판매자 지급 시각 |
| `createdAt` | `Timestamp` | 문서 생성 시각 |
| `updatedAt` | `Timestamp` | 문서 최종 수정 시각 |

### SettlementStatus

```
pending → confirmed → paid
              ↓
          cancelled
```

| 값 | 의미 |
|----|------|
| `pending` | 정산 대기 (주문 완료 직후 자동 생성) |
| `confirmed` | 정산 확정 (운영자 확인) |
| `paid` | 지급 완료 |
| `cancelled` | 정산 취소 (주문 환불 등) |

---

## 3. API 명세

### 3-1. 기간별 정산 목록 조회

```
GET /stores/:storeId/settlements?from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer <seller JWT>
```

**응답**

```json
{
  "settlements": [
    {
      "id": "...",
      "orderId": "...",
      "totalAmount": 30000,
      "platformFee": 1500,
      "netAmount": 28500,
      "status": "pending",
      "settledAt": "2026-03-28T10:00:00Z"
    }
  ],
  "total": 1
}
```

### 3-2. 날짜별 요약 조회

```
GET /stores/:storeId/settlements/summary?date=YYYY-MM-DD
Authorization: Bearer <seller JWT>
```

**응답**

```json
{
  "date": "2026-03-28",
  "count": 5,
  "totalAmount": 150000,
  "totalPlatformFee": 7500,
  "totalNetAmount": 142500,
  "byStatus": {
    "pending": 3,
    "confirmed": 2,
    "paid": 0,
    "cancelled": 0
  }
}
```

---

## 4. 자동 생성 트리거

`orders.service.ts`의 `updateStatus()` 및 `reviewOrder()` / `confirmPickup()` 내에서
주문 상태가 아래 값에 도달하면 `SettlementsService.createSettlement(order)` 호출.

| 트리거 상태 | 발생 경로 |
|------------|---------|
| `REVIEWED` | `reviewOrder()` |
| `DELIVERED` | `updateStatus()` — 드라이버 전환 |
| `PICKED_UP` | `confirmPickup()` |

**플랫폼 수수료율**: `PLATFORM_FEE_RATE` 환경변수 (기본값 `0.05`)

---

## 5. 인덱스 요구사항

```
settlements: storeId ASC + settledAt ASC (기간 조회)
settlements: storeId ASC + settledAt ASC + status ASC (상태 필터)
```

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
| `confirmedAt` | `Timestamp \| null` | confirm 마감 배치가 `confirmed` 전이한 시각 (§4-1) |
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

> **타입 SSOT(F-1/S4)**: `SettlementStatus`·`STATUS_LABEL`("정산 대기"/"확정"/"지급 완료"/"취소")·`STATUS_COLOR`(yellow/blue/green/red)는 `packages/shared/src/settlement.types.ts`가 단일 정의처. 백엔드는 타입만, 셀러·어드민 화면은 라벨/색 상수까지 import한다(이전 백엔드·셀러·어드민·useAdmin 4중 정의·값 불일치 해소).

---

## 3. API 명세

### 3-1. 기간별 정산 목록 조회

```
GET /stores/:storeId/settlements?from=YYYY-MM-DD&to=YYYY-MM-DD&status=pending
Authorization: Bearer <seller JWT>
```

**쿼리 파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `from` | `YYYY-MM-DD` | 선택 | `settledAt` 하한 (포함) |
| `to` | `YYYY-MM-DD` | 선택 | `settledAt` 상한 (해당일 23:59:59까지 포함) |
| `status` | `SettlementStatus` | 선택 | 정산 상태 필터 (`pending`/`confirmed`/`paid`/`cancelled`). `status` 단독 사용 시 `status + settledAt` 인덱스(§5) 필요 |

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

### 4-1. confirm 마감 배치 (`pending → confirmed` 자동 확정)

`SettlementsService.confirmDueSettlements()`가 `@Cron('0 4 * * *', { timeZone: 'Asia/Seoul' })`로
**매일 04:00 KST** 실행된다. `settledAt`이 마감 경계를 지난 `pending` 정산을 `confirmed`로 전이한다.

- **마감 경계(cutoff)** = `지금 - SETTLEMENT_CONFIRM_DELAY_DAYS일` (env, 기본 `1`).
- **쿼리**: `status == 'pending' AND settledAt < cutoff` → `status + settledAt` 복합 인덱스 필요(§5).
- **멱등·경합 차단**: 문서별 트랜잭션 내 `status === 'pending'` 재확인 후에만 `confirmed` + `confirmedAt` set.
  배치 도중 `cancelSettlement`가 `cancelled`로 바꿨다면 skip → **`cancelled` 미덮어씀**.
- **TZ**: 서버 TZ 미설정이라 `@Cron` `timeZone` 옵션으로 KST 보정.

> **배경**: 스펙(§2)은 `pending → confirmed → paid`를 명시하나 confirm 전이 코드가 부재해
> 전 정산이 `pending` 고착 → 어드민 "지급처리" 버튼(`confirmed`에서만 노출)이 영구 미표시였다.
> 이 배치가 누락 고리를 복구한다. (결정 로그 #CL-44)

---

## 5. 인덱스 요구사항

```
settlements: storeId ASC + settledAt ASC (기간 조회)
settlements: storeId ASC + status ASC + settledAt ASC (스토어별 상태 필터)
settlements: status ASC + settledAt ASC (confirm 마감 배치 §4-1 — storeId 없는 전역 쿼리)
```

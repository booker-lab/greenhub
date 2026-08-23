<!-- Language: ko -->

# Hubs API / Domain Spec

> **최종 정합화**: 2026-08-23
> **상태**: Current (legacy hub/pickup domain)
> **API 정본**: `apps/api/src/hubs/**`
> **주문 연계**: `docs/specs/api/orders.md`

## 1. 범위

`hubs`는 legacy `deliveryMethod: 'hub'` 주문의 픽업 거점을 관리한다.

회차 직배송 MVP의 기본 경로는 직접배송이며, 이 hub domain은 기존 거점픽업 기능 호환을 위해 유지한다. 회차 직배송 출시 로직에 hub를 자동 포함하지 않는다.

## 2. Hub 문서

`hubs/{hubId}`의 현재 핵심 필드:

```ts
{
  id: string
  storeId: string
  name: string
  address: string
  addressDetail: string | null
  lat: number | null
  lng: number | null
  operatingHours: string | null
  isActive: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

새 hub 생성 시 `isActive: true`로 시작한다.

## 3. 인증·소유권

모든 hub endpoint에는 `JwtAuthGuard`가 적용된다.

service의 실제 권한 기준은 role 문자열 자체가 아니라 다음 소유권 검사다.

```text
stores/{storeId}.ownerId === requesterId
```

현재 `HubsService.verifyOwnership()`에는 admin role 예외가 없다. 따라서 과거 다른 domain의 “admin은 모든 store ownership 우회” 규칙을 hub API에 자동 적용하지 않는다.

관리자 전역 거점 관리가 필요하면 별도 권한 설계와 테스트를 추가한다.

## 4. API

### 목록

```text
GET /stores/:storeId/hubs
```

응답:

```ts
{ hubs: Hub[] }
```

현재 service는 storeId로 조회하고 `createdAt ASC` 순으로 반환한다. `isActive`로 자동 필터링하지 않는다.

### 단건

```text
GET /stores/:storeId/hubs/:hubId
```

hub가 요청 store에 속하지 않으면 not found로 처리한다.

### Hub 주문

```text
GET /stores/:storeId/hubs/:hubId/orders?status=<OrderStatus>
```

- hub 소유권을 먼저 확인한다.
- Firestore에서는 `hubId`로 주문을 조회한다.
- `status`가 있으면 조회 후 service 메모리에서 필터한다.
- 따라서 현재 구현에는 `hubId + status` 복합 인덱스가 필요하지 않다.

### 생성

```text
POST /stores/:storeId/hubs
```

입력:

```ts
{
  name: string
  address: string
  addressDetail?: string
  lat?: number
  lng?: number
  operatingHours?: string
}
```

응답:

```ts
{ id: string }
```

### 수정

```text
PATCH /stores/:storeId/hubs/:hubId
```

허용 필드:

```text
name
address
addressDetail
lat
lng
operatingHours
isActive
```

응답:

```ts
{ id: string }
```

### 삭제

```text
DELETE /stores/:storeId/hubs/:hubId
```

`204 No Content`.

현재 구현은 물리 삭제다. 진행 중 주문 참조를 차단하는 별도 service guard가 없으므로 운영에서 단순 정리 목적으로 사용하지 않는다. 실제 거점 폐쇄는 가능하면 먼저 `isActive: false`로 신규 사용을 막고 연결 주문을 확인한 뒤 삭제 여부를 판단한다.

## 5. 소비자 노출과 `isActive`

이 service의 seller 목록은 `isActive`를 필터링하지 않는다. 소비자 주문 UI에서 활성 거점만 노출하는 계약은 해당 consumer 조회 경로/Firestore Rules/클라이언트 코드를 별도로 확인한다.

따라서 `GET /stores/:storeId/hubs` 자체가 “consumer용 활성 거점 목록”이라고 가정하지 않는다.

## 6. 주문 연계

hub 주문의 주요 주문 필드:

- `deliveryMethod: 'hub'`
- `hubId`
- `pickupCode`
- `hubName?`
- `hubAddress?`

관련 상태는 legacy 흐름에서 `HUB_ARRIVED`, `PICKED_UP`을 사용한다. 정확한 FSM은 `docs/specs/api/orders.md`와 현재 orders lifecycle을 따른다.

## 7. 인덱스

현재 service query 기준:

- hubs: `storeId == ...`, `orderBy(createdAt, asc)`
- orders: `hubId == ...`

실제 필요한 인덱스는 `firestore.indexes.json`과 배포 환경을 정본으로 사용한다. 과거 spec의 예상 인덱스 표만 보고 production 인덱스를 추가·삭제하지 않는다.

## 8. 검증 원칙

hub 변경 시 최소 확인:

- `apps/api/src/hubs/hubs.controller.ts`
- `apps/api/src/hubs/hubs.service.ts`
- `apps/api/src/hubs/dto/create-hub.dto.ts`
- `apps/api/src/orders/**`
- 관련 seller/consumer UI와 E2E
- `firestore.indexes.json`, `firestore.rules`

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-23 | 실제 ownerId 권한, hub 주문 조회, 물리 삭제, 현재 인덱스 사용과 legacy 경계에 맞춰 정합화 |
| 2026-03-28 | 초기 hubs 설계 초안 |

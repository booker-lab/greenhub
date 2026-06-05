# Hubs Domain Spec

> **작성일**: 2026-03-28
> **상태**: Draft
> **연관 문서**: `orders.md`, `CRITICAL_LOGIC.md`

---

## 1. 도메인 개요

`hubs` 도메인은 판매자가 운영하는 **거점(픽업 포인트)**을 관리한다.
소비자가 주문 시 `deliveryMethod: 'hub'`를 선택하면 이 거점 중 하나를 픽업 장소로 지정한다.

---

## 2. Firestore 스키마

### `hubs/{hubId}` 문서

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | `string` | 문서 ID (uuid) |
| `storeId` | `string` | 판매자 스토어 ID |
| `name` | `string` | 거점 이름 (예: "강남 거점") |
| `address` | `string` | 거점 주소 |
| `addressDetail` | `string \| null` | 상세 주소 (동/호수 등) |
| `lat` | `number \| null` | 위도 |
| `lng` | `number \| null` | 경도 |
| `operatingHours` | `string \| null` | 운영 시간 (예: "09:00~18:00") |
| `staffIds` | `string[]` | 배정된 `hub_staff` 사용자 ID 목록 |
| `isActive` | `boolean` | 활성화 여부 |
| `createdAt` | `Timestamp` | 생성 시각 |
| `updatedAt` | `Timestamp` | 최종 수정 시각 |

---

## 3. API 명세

### 3-1. 거점 목록 조회

```
GET /stores/:storeId/hubs
Authorization: Bearer <seller JWT>
```

**응답**

```json
{
  "hubs": [
    {
      "id": "...",
      "name": "강남 거점",
      "address": "서울시 강남구 ...",
      "isActive": true
    }
  ]
}
```

### 3-2. 거점 단건 조회

```
GET /stores/:storeId/hubs/:hubId
Authorization: Bearer <seller JWT>
```

### 3-3. 거점 생성

```
POST /stores/:storeId/hubs
Authorization: Bearer <seller JWT>
Content-Type: application/json
```

**Body**

```json
{
  "name": "강남 거점",
  "address": "서울시 강남구 테헤란로 1",
  "addressDetail": "1층 로비",
  "lat": 37.4979,
  "lng": 127.0276,
  "operatingHours": "09:00~18:00"
}
```

### 3-4. 거점 수정

```
PATCH /stores/:storeId/hubs/:hubId
Authorization: Bearer <seller JWT>
```

**Body**: 3-3과 동일 필드 (모두 Optional) + `isActive?: boolean`

### 3-5. 거점 삭제

```
DELETE /stores/:storeId/hubs/:hubId
Authorization: Bearer <seller JWT>
```

응답: `204 No Content`

### 3-6. 거점 스태프 초대 링크 발급

```
POST /stores/:storeId/hubs/:hubId/staff-invite
Authorization: Bearer <seller JWT>
Content-Type: application/json
```

**Body**

```json
{
  "expiresInDays": 7
}
```

**응답**

```json
{
  "token": "HUBSTAFFTOKEN01",
  "inviteUrl": "https://seller.greenlove.co.kr/staff-invite?token=HUBSTAFFTOKEN01",
  "expiresAt": "2026-06-12T00:00:00.000Z"
}
```

### 3-7. 거점 스태프 목록 조회

```
GET /stores/:storeId/hubs/:hubId/staff
Authorization: Bearer <seller JWT>
```

**응답**

```json
{
  "staff": [
    {
      "id": "user-id",
      "name": "스태프",
      "email": "staff@example.com",
      "suspended": false
    }
  ]
}
```

### 3-8. 거점 스태프 권한 회수

```
DELETE /stores/:storeId/hubs/:hubId/staff/:staffId
Authorization: Bearer <seller JWT>
```

응답: `204 No Content`

---

## 4. 비즈니스 규칙

- 거점은 **해당 스토어 소유자만** 생성·수정·삭제 가능 (JWT `sub === stores/{storeId}.ownerId`)
- 거점 스태프 초대 링크도 해당 스토어 소유자만 발급 가능
- 거점 스태프 목록 조회와 권한 회수도 해당 스토어 소유자만 가능
- `hub_staff`는 `staffIds`에 자신의 `userId`가 포함된 거점의 목록·상세·픽업 대기 주문만 조회 가능
- 기존 거점에 `staffIds`가 없으면 빈 배열로 취급
- 스태프 권한 회수는 `hubs.staffIds` 제거, 해당 `hub_staff` 사용자 정지, refresh token 삭제를 함께 수행한다
- 삭제는 **Soft Delete 없음** — 즉시 물리 삭제 (진행 중인 주문 연결 거점은 추후 제한 로직 추가 예정)
- `isActive: false`인 거점은 소비자 앱 주문 화면에 노출되지 않음

---

## 5. 인덱스 요구사항

```
hubs: storeId ASC + isActive ASC (활성 거점 필터)
hubs: storeId ASC + createdAt ASC (목록 정렬)
```

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-05 | `hubStaffInvites` 기반 거점 스태프 초대 링크 발급 API 추가 |
| 2026-06-05 | `hub_staff` 1차 읽기 권한과 `hubs.staffIds` 관계 필드 추가 |
| 2026-06-05 | 거점별 스태프 목록 조회와 권한 회수 API 추가 |

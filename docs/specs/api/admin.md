<!-- Language: ko -->

# Admin API / Domain Spec

> **최종 정합화**: 2026-08-23
> **상태**: Current
> **API 정본**: `apps/api/src/admin/**`
> **인증 계약**: `docs/specs/api/auth.md`
> **정산 계약**: `docs/specs/api/settlements.md`
> **canonical URL**: `docs/URLS.md`

## 1. 범위와 권한

`admin`은 Greenhub 운영자 전용 관리 API다.

`AdminController` 전체에 다음 보호가 적용된다.

```text
JwtAuthGuard
RolesGuard
@Roles('admin')
```

seller 앱의 admin UI도 세션 role을 추가로 확인하지만 API 권한의 정본은 서버 guard다.

admin role을 어떤 운영 절차로 부여하는지는 계정 보안 정책이다. 과거 문서의 “Firestore 콘솔에서 직접 role을 바꾸는 것이 유일한 정식 방법”을 현행 운영 지침으로 사용하지 않는다. 실제 관리자 권한 부여는 별도 승인된 관리 절차로 수행한다.

## 2. 접근 URL

UI 진입점:

```text
{seller_domain}/admin
```

Production canonical seller domain:

```text
https://seller.greenlove.co.kr
```

따라서 production admin 기준 URL은:

```text
https://seller.greenlove.co.kr/admin
```

과거 `greenhub-seller.vercel.app` 같은 deployment alias를 canonical production URL로 사용하지 않는다.

로컬 seller 포트는 실행 방식에 따라 달라질 수 있으므로 `docs/URLS.md`를 확인한다.

## 3. Store 관리

### 목록

```text
GET /admin/stores
```

- `createdAt DESC`
- `{ stores, total }`

### Store 수수료율

```text
PATCH /admin/stores/:storeId/commission
```

body의 정확한 검증 범위는 `SetCommissionDto`를 따른다. 이 값과 settlement service의 전역 `PLATFORM_FEE_RATE` 사용 범위를 동일한 것으로 가정하지 않는다. 실제 수수료 모델 변경은 두 경로를 함께 점검한다.

### Store archive / restore

```text
PATCH /admin/stores/:storeId/archive
PATCH /admin/stores/:storeId/restore
```

현재 archive는 물리 삭제가 아니다.

- 주문 또는 settlement가 하나라도 존재하면 archive 거부
- 허용되면 `status: archived`, `archivedAt` 기록
- restore는 `status: active`로 복구하고 `archivedAt` 제거

기록이 있는 판매자를 강제로 삭제하는 도구로 사용하지 않는다.

## 4. Consumer 사용자 관리

### 목록

```text
GET /admin/users
```

현재 `role == consumer`만 조회한다. 반환 전에 `passwordHash`를 제거한다.

### 정지/복구 flag

```text
PATCH /admin/users/:userId/status
```

```ts
{ suspended: boolean }
```

이 endpoint는 Firestore `suspended` 값을 갱신한다.

중요: `suspended` flag가 존재한다는 것과 모든 인증/refresh/API 경로가 정지 사용자를 동일하게 차단한다는 것은 별개다. 계정 정지 정책 변경 시 `AuthService`, JWT refresh, 각 guard의 실제 enforcement를 함께 검증한다.

## 5. 주문 관리

### 목록

```text
GET /admin/orders?storeId=<storeId>&status=<OrderStatus>
```

- 선택적 store/status filter
- `createdAt DESC`
- 최대 200건
- pagination 없음

### 관리자 환불

```text
POST /admin/orders/:orderId/refund
```

현재 흐름:

1. 주문 존재 확인
2. 이미 `CANCELLED`면 거부
3. `PaymentsService.processRefundByOrderId()` 호출
4. 주문을 `CANCELLED`로 갱신하고 사유 기록

환불의 provider 멱등성·claim·운영 이슈 계약은 `docs/specs/api/payments.md`를 따른다. 이 admin endpoint를 반복 호출해 provider 상태를 추측하지 않는다.

## 6. 정산 관리

### 목록

```text
GET /admin/settlements?storeId=<storeId>&from=<date>&to=<date>
```

- `settledAt DESC`
- 최대 500건
- `{ settlements, total }`

### 지급 처리

```text
PATCH /admin/settlements/:settlementId/pay
```

- `confirmed`만 `paid`로 전환
- 이미 `paid`면 거부
- transaction 안에서 status 재확인
- `paidAt`, `updatedAt` 기록

상세 정산 상태 계약은 `docs/specs/api/settlements.md`가 정본이다.

## 7. Driver 관리

### 목록

```text
GET /admin/drivers?status=pending|approved|suspended
```

현재 구현은 Firestore에서 `role == driver` 최대 100건을 읽은 뒤 status를 service 메모리에서 필터·정렬한다.

status 판정:

- `pending`: `!driverApproved && !suspended`
- `approved`: `driverApproved && !suspended`
- `suspended`: `suspended`

### 승인

```text
PATCH /admin/drivers/:userId/approve
```

- 사용자 존재 확인
- `role === driver` 확인
- `driverApproved: true`

### 정지/복구

```text
PATCH /admin/drivers/:userId/suspend
```

```ts
{ suspended: boolean }
```

Driver Kakao 로그인은 `driverApproved`를 별도 확인한다. Preview E2E credentials는 더 좁은 allowlist/secret gate를 사용하므로 admin 승인과 E2E gate를 혼동하지 않는다.

## 8. Seller 초대

### 생성

```text
POST /admin/invite
```

현재 구현:

- UUID에서 하이픈 제거 후 앞 16자를 대문자로 사용
- `invites/{token}` 저장
- 생성자 admin user ID 기록
- `usedAt`, `usedBy` 초기 null
- 만료: 생성 시점 + 7일

응답:

```ts
{
  token: string
  expiresAt: string
}
```

초대 token 원문은 권한 있는 온보딩 흐름에서만 취급하며 문서·이슈에 실제 token을 남기지 않는다.

### 목록

```text
GET /admin/invite
```

- `createdAt DESC`
- 최대 50건

## 9. Banner 관리

Admin:

```text
GET /admin/banner
PUT /admin/banner
```

Consumer public read:

```text
GET /banner
```

현재 고정 문서:

```text
banners/main_hero
```

주요 필드:

```ts
{
  imageUrl?: string
  tagText?: string
  headline?: string
  subText?: string
  cta1?: { label: string; href: string }
  cta2?: { label: string; href: string }
  isActive: boolean
  updatedAt: Timestamp
}
```

admin upsert는 client가 되돌려 보낸 `updatedAt/createdAt`을 제거하고 서버 `updatedAt`을 기록한다.

Storage write/read 권한은 현재 `storage.rules`를 정본으로 확인한다. 과거 문서의 “인증 사용자 누구나 banner 경로 write” 설명을 현재 보안 계약으로 자동 적용하지 않는다.

## 10. 현재 알려진 구조적 제한

- admin 주문 목록: 최대 200건, pagination 없음
- admin 정산 목록: 최대 500건, pagination 없음
- driver 목록: 최대 100건 read 후 메모리 필터
- store 수수료 설정과 settlement 생성의 `PLATFORM_FEE_RATE` 관계는 단일 정책으로 완전히 통합돼 있지 않을 수 있으므로 변경 전 코드 재검증 필요
- 사용자 `suspended` flag의 enforcement는 endpoint별 인증 경로를 실제 검증해야 함
- admin actions의 통합 감사 로그 범위는 operation/audit 구현을 확인해야 하며 단순 endpoint 존재만으로 완전한 감사 추적을 보장하지 않는다.

이 제한을 해소할 필요가 생기면 `docs/BACKLOG.md`에 현재 작업으로 승격한 뒤 별도 설계를 수행한다.

## 11. 검증 원칙

admin 변경 시 최소 확인:

- `apps/api/src/admin/admin.controller.ts`
- `apps/api/src/admin/admin.service.ts`
- `apps/api/src/admin/dto/admin.dto.ts`
- `apps/seller/src/app/admin/**`
- `apps/seller/src/hooks/useAdmin.ts`
- auth/orders/payments/settlements 관련 spec
- 관련 unit/E2E

실제 환불·계정 권한 변경·운영 데이터 변경은 문서 정합성 검토 범위에서 실행하지 않는다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-23 | canonical URL, archive/restore, 현재 정산·드라이버·초대 계약, 위험한 수동 권한 부여 지침을 현행화 |
| 2026-04-23 | banner 관리 추가 |
| 2026-04-03 | driver 관리 추가 |
| 2026-04-01 | 초기 admin 구현 문서화 |

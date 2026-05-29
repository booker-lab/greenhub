# Admin Domain Spec

> **작성일**: 2026-04-01 (소급 작성 — 구현 완료 후 정합성 검토 시 문서화)
> **상태**: Implemented & Verified
> **연관 문서**: `CRITICAL_LOGIC.md`, `auth.md`, `orders.md`, `settlements.md`

---

## 1. 도메인 개요

`admin` 도메인은 **Green Hub 운영자 전용** 관리 기능을 제공한다.
모든 엔드포인트는 `role === 'admin'` 인증이 이중으로 적용된다.

- **NestJS 레이어**: `@Roles('admin')` 데코레이터 → `RolesGuard` JWT 검증
- **Next.js 레이어**: `apps/seller/src/app/admin/layout.tsx` Server Component에서 세션 role 재검증

admin 계정은 별도 회원가입 경로가 없으며, **Firestore 콘솔에서 `users/{id}.role = 'admin'` 수동 설정**으로만 부여한다.
(초대 토큰 발행 시 역할은 'seller'로 고정 — admin은 시스템 운영자 한정)

---

## 2. 접근 경로

| 항목 | 값 |
|------|-----|
| UI 진입점 | `{seller_domain}/admin` (BottomNav 노출 없음 — URL 직접 입력) |
| 인증 방식 | NextAuth 세션 → NestJS JWT 순으로 이중 검증 |
| 개발 URL | `http://localhost:3002/admin` |
| 프로덕션 URL | `https://greenhub-seller.vercel.app/admin` |

---

## 3. Firestore 컬렉션 스키마

### `invites/{token}`

```ts
{
  token: string          // 16자리 대문자 영숫자 (UUID 파생)
  createdBy: string      // admin userId
  usedAt: Timestamp | null
  usedBy: string | null  // 초대 수락한 seller userId
  expiresAt: Timestamp   // 생성 시점 +7일
  createdAt: Timestamp
}
```

---

## 4. API 엔드포인트

> **기본 경로**: `/admin`
> 모든 엔드포인트: `Authorization: Bearer {adminJwt}` 필수 + `@Roles('admin')` 검증

---

### 4-1. 스토어 관리

#### 전체 스토어 목록

```
GET /admin/stores
```

**Response** `200`
```ts
{
  stores: Store[],   // 전체 스토어 (createdAt desc)
  total: number
}
```

---

#### 수수료 설정

```
PATCH /admin/stores/:storeId/commission
```

**Request Body**
```ts
{ rate: number }   // 0~100 (%)
```

**Response** `200`
```ts
{ storeId: string, commissionRate: number }
```

---

### 4-2. 사용자 관리

#### 소비자 목록 조회

```
GET /admin/users
```

> `role === 'consumer'` 사용자만 반환. `passwordHash` 필드 제외.
> `createdAt desc` 최신순으로 최대 5000건을 반환한다. 검색·상태 필터는 현재 admin 클라이언트에서 수행하므로, 서버는 무제한 전체 읽기를 하지 않는다.

**Response** `200`
```ts
{
  users: Omit<UserProfile, 'passwordHash'>[],
  total: number
}
```

---

#### 사용자 정지/복구

```
PATCH /admin/users/:userId/status
```

**Request Body**
```ts
{ suspended: boolean }
```

**Response** `200`
```ts
{ userId: string, suspended: boolean }
```

> Firestore `users/{userId}.suspended` 필드를 토글한다.
> 정지된 사용자는 이메일·카카오 로그인과 `/auth/refresh`에서 `401`을 반환한다.
> 이미 발급된 access token은 자연 만료까지 유효하므로 최대 1시간 지연은 허용한다.

---

### 4-3. 주문 관리

#### 주문 목록 조회 (전체)

```
GET /admin/orders?storeId=:storeId&status=:status
```

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `storeId` | - | 특정 스토어 필터 |
| `status` | - | 주문 상태 필터 (`OrderStatus`) |

> 최대 200건 반환 (createdAt desc). 페이지네이션 미지원 — MVP 운영 규모 한정.

**Response** `200`
```ts
{
  orders: Order[],
  total: number
}
```

---

#### 강제 환불

```
POST /admin/orders/:orderId/refund
```

**Request Body**
```ts
{ reason?: string }   // 생략 시 '관리자 강제 환불'
```

**처리 흐름**
1. 이미 `CANCELLED` 상태이면 `400`
2. Portone 환불 API 호출
3. 주문 상태 → `CANCELLED`, `cancelReason` 기록

**Response** `200`
```ts
{ ok: true, orderId: string }
```

---

### 4-4. 정산 관리

#### 정산 목록 조회

```
GET /admin/settlements?storeId=:storeId&from=YYYY-MM-DD&to=YYYY-MM-DD&status=:status
```

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `storeId` | - | 특정 스토어 필터 |
| `from` | - | 정산 시작일 (settledAt >=) |
| `to` | - | 정산 종료일 (settledAt <=, 23:59:59) |
| `status` | - | `pending` / `confirmed` / `paid` / `cancelled` 상태 필터 |

> 최대 500건 반환 (settledAt desc). `status` 값은 `@greenhub/shared`의 `SETTLEMENT_STATUSES`만 허용한다.

**Response** `200`
```ts
{
  settlements: Settlement[],
  total: number
}
```

---

#### 정산 지급 처리

```
PATCH /admin/settlements/:settlementId/pay
```

**처리 규칙**
- `confirmed` 상태만 `paid`로 전환 가능
- 이미 `paid`이면 `400`

**Response** `200`
```ts
{ settlementId: string, status: 'paid' }
```

---

#### 정산 일괄 지급 처리

```
POST /admin/settlements/bulk-pay
```

**Request Body**
```ts
{ ids: string[] }   // 1~500개, 서버에서 중복 제거
```

**처리 규칙**
- `confirmed` 상태만 `paid`로 전환 가능
- 단건 지급과 같은 조건부 트랜잭션을 ID별로 반복
- 한 건이 실패해도 나머지 건은 계속 처리
- 실패 사유는 운영자가 바로 볼 수 있는 문자열로 반환

**Response** `200`
```ts
{
  ok: string[]
  failed: Array<{ id: string; reason: string }>
}
```

---

### 4-5. 초대 관리

#### 초대 토큰 생성

```
POST /admin/invite
```

**처리 흐름**
1. 16자리 대문자 토큰 생성 (UUID 파생, 중복 가능성 무시 — MVP)
2. Firestore `invites/{token}` 문서 저장 (만료: +7일)
3. 토큰과 만료 시각 반환

**Response** `201`
```ts
{
  token: string,       // 16자리 대문자 영숫자
  expiresAt: string    // ISO8601
}
```

> 생성된 토큰을 seller 온보딩 URL에 포함: `{seller_domain}/onboarding?token={token}`

---

#### 초대 목록 조회

```
GET /admin/invite
```

**Response** `200`
```ts
Array<{
  token: string
  createdBy: string
  usedAt: string | null     // ISO8601
  usedBy: string | null
  expiresAt: string         // ISO8601
  createdAt: string         // ISO8601
}>
```

> 최대 50건 (createdAt desc).

---

### 4-6. 드라이버 관리

#### 드라이버 목록 조회

```
GET /admin/drivers?status=pending|approved|suspended
```

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `status` | - | `pending`(승인 대기) / `approved`(승인 완료) / `suspended`(정지) / 생략 시 전체 |

**Response** `200`
```ts
{ drivers: UserProfile[], total: number }
```

---

#### 드라이버 승인

```
PATCH /admin/drivers/:userId/approve
```

- `role !== 'driver'`이면 `400`
- `driverApproved: true` 업데이트

**Response** `200`
```ts
{ userId: string, driverApproved: true }
```

---

#### 드라이버 정지/복구

```
PATCH /admin/drivers/:userId/suspend
```

**Request Body**
```ts
{ suspended: boolean }
```

**Response** `200`
```ts
{ userId: string, suspended: boolean }
```

---

#### 드라이버 사전 승인 플로우

1. 카카오 최초 로그인 → `POST /auth/kakao-login` → 신규 사용자 생성 (`driverApproved: false`)
2. driver 앱 `auth.ts` signIn 콜백 → `driverApproved === false`이면 `/login?pending=true`로 리다이렉트
3. admin이 `/admin/drivers` 승인 대기 탭에서 승인 버튼 클릭 → `driverApproved: true`
4. 드라이버가 다시 카카오 로그인 → 정상 진입

---

## 5. 보안 설계

| 레이어 | 구현 |
|--------|------|
| JWT 검증 | `JwtAuthGuard` → `RolesGuard(@Roles('admin'))` |
| UI 접근 차단 | `admin/layout.tsx` (Server Component) — `session.user.role !== 'admin'` 시 `/` 리다이렉트 |
| admin 계정 발급 | Firestore 콘솔 수동 설정만 허용 — 프로그래매틱 부여 경로 없음 |
| 초대 경로 | seller 초대는 role='seller'로 고정 — admin 권한 위임 불가 |

---

## 6. 알려진 한계 및 미구현 사항

| 항목 | 상태 | 비고 |
|------|------|------|
| `suspended` 사용자 차단 | ✅ 구현 | 로그인 및 refresh 토큰 교환 시 401, 기존 access token은 자연 만료 |
| 주문 목록 페이지네이션 | 🔲 MVP 제외 | 현재 200건 하드 리밋 |
| admin 활동 로그 | 🔲 미구현 | 강제 환불·정지 등 감사 로그 |
| 다중 admin 지원 | ✅ 지원 | role='admin' 사용자 수 제한 없음 |

---

## 7. 배너 관리

### Firestore 스키마 — `banners/main_hero`

```ts
{
  imageUrl?: string        // Firebase Storage URL
  tagText?: string         // 배지 텍스트 (예: "🌿 신상품 출시")
  headline?: string        // 메인 헤드라인
  subText?: string         // 서브 텍스트
  cta1?: { label: string; href: string }
  cta2?: { label: string; href: string }
  isActive: boolean        // false면 consumer 앱에 미표시
  updatedAt: Timestamp     // 서버 자동 관리
}
```

**구조 결정**: 단일 고정 문서(`banners/main_hero`). 복수 배너 시 `banners/{bannerType}` 패턴으로 확장.

### API 엔드포인트

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| `GET` | `/admin/banner` | admin | 현재 배너 조회 |
| `PUT` | `/admin/banner` | admin | 배너 업서트 (merge) |
| `GET` | `/banner` | 없음 | consumer 앱용 공개 조회 |

**공개 엔드포인트 위치**: `app.controller.ts` (AdminModule 아님) — NestJS 최상위 컨트롤러에서 직접 Firestore 조회.

### 이미지 업로드

Firebase Storage 경로: `banners/main_hero/{uuid}`. Storage rules: 인증된 사용자 쓰기, 누구나 읽기.

### updatedAt 처리 규칙

클라이언트가 GET 후 form에 `updatedAt`을 포함해 PUT할 때 400을 방지하기 위한 **양방향 방어 패턴**:
1. `UpsertBannerDto`에 `updatedAt?: unknown` 허용 필드 포함
2. `upsertBanner()` 서비스에서 spread 전 반드시 제거: `const { updatedAt: _u, createdAt: _c, ...fields } = dto`
3. `useAdmin.ts` save() 에서도 제거 후 전송

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-01 | 초안 작성 — 구현 완료 후 소급 문서화 (정합성 검토 세션) |
| 2026-04-03 | §4-6 드라이버 관리 API 추가 + 사전 승인 플로우 문서화 — E2E 검증 완료 |
| 2026-04-23 | §7 배너 관리 API 추가 — 히어로 배너 admin 편집 기능 구현 |
| 2026-05-29 | 소비자 정지 효과 보강 — `/auth/refresh`에서 정지 사용자 401 차단 |
| 2026-05-29 | 소비자 목록 조회 최신순·최대 5000건 제한 추가 — 무제한 Firestore 읽기 방지 |
| 2026-05-29 | 정산 일괄 지급 API 추가 — `POST /admin/settlements/bulk-pay`, 부분 성공 응답 |
| 2026-05-29 | 어드민 정산 목록 `status` 쿼리 필터 추가 — shared 정산 상태 SSOT 사용 |

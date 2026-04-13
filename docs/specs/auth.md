# Auth Domain Spec

> **작성일**: 2026-03-26
> **상태**: Draft (4단계 개발 선행 문서)
> **연관 문서**: `orders.md`, `payments.md`, `1단계 요구사항 정의.md`

---

## 1. 도메인 개요

인증은 **NextAuth.js (Next.js 앱 레이어)** 와 **NestJS JWT Guard (API 레이어)** 두 계층으로 구성된다.

| 레이어 | 담당 | 기술 |
|--------|------|------|
| Next.js 앱 | 세션 관리, 로그인 UI, 소셜 OAuth 흐름 | NextAuth.js v5 |
| NestJS API | API 요청 인증·권한 검증 | JWT Bearer Guard |

**비회원 구매 미지원** — 모든 주문은 로그인 필수.

---

## 2. 로그인 Provider

| Provider | 타입 | 비고 |
|----------|------|------|
| 카카오 | OAuth 2.0 | Kakao Developers 앱 등록 필요 |
| 네이버 | OAuth 2.0 | Naver Developers 앱 등록 필요 |
| 이메일 | Credentials | 이메일 + 비밀번호, bcrypt 해시 저장 |

---

## 3. 역할(Role) 시스템

```ts
type UserRole = 'consumer' | 'seller' | 'driver' | 'admin'
```

| 역할 | 대상 | 추가 클레임 | 지원 Provider |
|------|------|------------|--------------|
| `consumer` | 소비자 앱 사용자 | - | 카카오, 네이버, 이메일 |
| `seller` | 판매자 (디어 오키드) | `storeId` | **카카오, 이메일** (MVP: 네이버 미지원 — 단일 판매자이므로 불필요) |
| `driver` | 배송기사 | - | 이메일 (운영자 수동 발급 예정) |
| `admin` | 플랫폼 운영자(개발자 본인) | - | 이메일 (Firestore 직접 수동 설정, 1회) |

JWT 페이로드 구조:
```ts
{
  sub: string      // userId
  role: UserRole
  storeId?: string // seller 전용
  iat: number
  exp: number
}
```

---

## 4. Firestore 컬렉션 스키마

### `users/{userId}`

```ts
{
  id: string
  email: string
  name: string
  phone: string | null
  role: UserRole

  // 판매자 전용
  storeId: string | null

  // 소셜 로그인 연결 정보
  providers: ('kakao' | 'naver' | 'email')[]

  // 소비자 전용
  savedAddresses: {
    id: string
    label: string          // '집', '회사' 등
    address: string
    addressDetail: string
    zipCode: string
    isDefault: boolean
  }[]

  // PWA
  fcmToken: string | null  // FCM 푸시 토큰 (브라우저 푸시)

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

---

## 5. 인증 플로우

### 5-1. 소셜 로그인 (카카오·네이버)

```
1. 소비자 앱 로그인 버튼 클릭
2. NextAuth.js → OAuth Provider 리다이렉트
3. Provider 인증 완료 → NextAuth.js callback
4. users/{userId} 조회
   - 없으면 신규 생성 (role: 'consumer' 기본값)
   - 있으면 providers 배열 업데이트
5. NextAuth.js 세션 생성 + JWT 발급
6. 원래 진입하려던 화면으로 복귀 (callbackUrl)
```

### 5-2. 판매자 초대 토큰 가입 (A안 — MVP)

```
1. 운영자(admin)가 /admin/invite 에서 초대 토큰 생성
   → invite_tokens/{tokenId} 문서 생성 (24시간 유효, 1회용)
   → 판매자에게 링크 전달: seller.greenhub.kr/register?token=xxx

2. 판매자가 링크 클릭
   → NestJS GET /auth/invite/:token 토큰 유효성 검증

3. 판매자가 이메일 + 비밀번호 입력 → POST /auth/register
   { email, password, name, role: 'seller', inviteToken: token }

4. NestJS:
   - inviteToken 재검증 (만료·사용 여부)
   - users 문서 생성 (role: 'seller')
   - stores 문서 생성 (status: 'invited' → 'active' 자동 전환)
   - invite_tokens 문서 usedAt 기록 (재사용 불가)

5. 판매자 → 온보딩 화면(/onboarding)으로 이동
```

> **B안 전환 시**: 공개 신청 폼 추가 + `stores.status = 'pending_approval'` 저장.
> admin 승인 화면은 이미 존재하므로 추가 개발 없음.

---

### `invite_tokens/{tokenId}` 스키마

```ts
{
  id: string              // uuid
  token: string           // 랜덤 32자 hex (URL에 노출되는 값)
  createdBy: string       // admin userId
  expiresAt: Timestamp    // 발급 후 24시간
  usedAt: Timestamp | null
  usedBy: string | null   // 가입한 판매자 userId
}
```

---

### 5-3. 이메일 로그인 (구 5-2)

```
1. 이메일 + 비밀번호 입력
2. NestJS POST /auth/login → bcrypt.compare 검증
3. 검증 성공 → JWT 반환
4. NextAuth.js Credentials Provider가 JWT를 세션에 저장
```

### 5-4. NestJS API 요청 인증 (구 5-3)

```
1. Next.js 앱: NextAuth.js 세션에서 accessToken 추출
2. NestJS API 요청 헤더: Authorization: Bearer <accessToken>
3. NestJS JwtAuthGuard: JWT 검증 + 페이로드 추출
4. RolesGuard: 요청 역할 검증
5. 통과 → 컨트롤러 실행 / 실패 → 401 or 403
```

### 5-5. 로그인 진입 시점 (소비자 앱) (구 5-4)

```
진입 시점 A: 미로그인 상태에서 '결제하기' 클릭
진입 시점 B: 미로그인 상태에서 '마이페이지' 탭 클릭

처리:
  → 로그인 화면 이동
  → 로그인 완료 후 원래 화면으로 복귀 (callbackUrl 유지)
```

---

## 6. API 엔드포인트

### 회원가입 (이메일)

```
POST /auth/register
```

```ts
// Request
{
  email: string
  password: string    // 8자 이상, 클라이언트 검증
  name: string
  role: 'consumer' | 'seller' | 'driver'  // 멀티앱 구조상 명시 필수
  phone?: string
}

// Response 201
{ userId: string }
```

> **role 설계 의도**: consumer / seller / driver 앱이 동일한 `/auth/register` 엔드포인트를 공유하므로 role을 명시적으로 전달. OAuth(Kakao/Naver) 가입은 consumer 기본값 적용 (앱 구분 불필요).


---

### 로그인 (이메일 — Credentials Provider 내부 호출)

```
POST /auth/login
```

```ts
// Request
{ email: string, password: string }

// Response 200
{ accessToken: string, user: UserProfile }

// Response 401
{ message: '이메일 또는 비밀번호가 올바르지 않습니다.' }
```

---

### 토큰 갱신

```
POST /auth/refresh
```

> NextAuth.js가 내부적으로 처리. 클라이언트에서 직접 호출 불필요.

---

### 내 프로필 조회

```
GET /auth/me
```

**Guard**: `JwtAuthGuard`

```ts
// Response 200
{
  id: string
  email: string
  name: string
  phone: string | null
  role: UserRole
  storeId: string | null
  providers: string[]
  savedAddresses: SavedAddress[]
}
```

---

### 프로필 수정

```
PATCH /auth/me
```

```ts
// Request (Partial)
{
  name?: string
  phone?: string
}
```

---

### 배송지 관리

```
POST   /auth/me/addresses           // 배송지 추가
PATCH  /auth/me/addresses/:id       // 수정
DELETE /auth/me/addresses/:id       // 삭제
PATCH  /auth/me/addresses/:id/default  // 기본 배송지 설정
```

---

### FCM 토큰 등록

```
PATCH /auth/me/fcm-token
```

```ts
{ fcmToken: string }
```

> PWA 푸시 알림 수신을 위해 브라우저 푸시 권한 획득 후 호출.

---

## 7. 역할별 API 접근 제어

| 엔드포인트 | consumer | seller | driver | admin | 비고 |
|------------|----------|--------|--------|-------|------|
| `GET /stores/:storeId/products` | ✅ | ✅ | ✅ | ✅ | 공개 |
| `POST /stores/:storeId/products` | ❌ | ✅ | ❌ | ✅ | 본인 storeId만 (admin은 전체) |
| `POST /stores/:storeId/orders` | ✅ | ❌ | ❌ | ❌ | - |
| `GET /stores/:storeId/orders/:orderId` | ✅ | ✅ | ✅ | ✅ | 본인 주문 or 본인 storeId (admin은 전체) |
| `PATCH /stores/:storeId/orders/:orderId/cancel` | ✅ | ❌ | ❌ | ✅ | 본인 주문만 (admin은 강제 처리 가능) |
| `PATCH /stores/:storeId/orders/:orderId/status` | 일부 | ✅ | ✅ | ✅ | 역할별 허용 전환 다름 (`orders.md` 섹션 4 참조) |
| `GET /stores/:storeId/daily-caps` | ❌ | ✅ | ❌ | ✅ | - |
| `PATCH /stores/:storeId/delivery-config` | ❌ | ✅ | ❌ | ✅ | - |
| `GET /admin/*` | ❌ | ❌ | ❌ | ✅ | admin 전용 경로 전체 |

> **admin 접근 원칙**: admin은 storeId 소유권 검증 없이 모든 storeId 데이터에 접근 가능. NestJS Guard에서 `role === 'admin'` 시 storeId 검증 우회.

---

## 8. 보안 체크리스트

| 항목 | 처리 방식 |
|------|----------|
| 비밀번호 저장 | bcrypt (saltRounds: 12) |
| JWT 만료 | accessToken 1시간 / refreshToken 30일 |
| storeId 위조 | JWT 클레임 `storeId`와 경로 `:storeId` 일치 검증 (Guard) |
| 타인 주문 접근 | `userId` 클레임과 `orders.userId` 일치 검증 |
| 소셜 계정 연결 | 동일 이메일로 이미 존재하는 계정에 provider 추가 병합 |

---

## 9. packages/shared 공통 타입

> **Timestamp 직렬화 규칙**: Firestore 스키마의 `Timestamp` 필드는 shared 타입에서 `string (ISO8601)`으로 표현합니다.

```ts
// packages/shared/src/auth.types.ts

export type UserRole = 'consumer' | 'seller' | 'driver' | 'admin'

export type AuthProvider = 'kakao' | 'naver' | 'email'

export interface JwtPayload {
  sub: string
  role: UserRole
  storeId?: string
  iat: number
  exp: number
}

export interface SavedAddress {
  id: string
  label: string
  address: string
  addressDetail: string
  zipCode: string
  isDefault: boolean
}

export interface UserProfile {
  id: string
  email: string
  name: string
  phone: string | null
  role: UserRole
  storeId: string | null
  providers: AuthProvider[]
  savedAddresses: SavedAddress[]
  fcmToken: string | null   // PWA 푸시 토큰
  createdAt: string   // ISO8601
  updatedAt: string   // ISO8601
}
```

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-03-26 | 초안 작성 — PWA 설계 문서 + 1단계 요구사항 기반 통합 |

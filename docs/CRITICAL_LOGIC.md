# Critical Logic — 설계 결정 이력

> 이 파일은 되돌리기 어려운 설계 결정과 그 이유를 기록합니다.
> 결정 변경 시 반드시 이유와 날짜를 함께 기록하세요.

---

## [2026-04-23] 히어로 배너 관리 — updatedAt 양방향 방어 패턴

### 결정: DTO에서 수락 + 서비스에서 스트립 (두 레이어 모두 처리)

**배경**
- `forbidNonWhitelisted: true` ValidationPipe 환경에서, 배너 조회 후 form state에 `updatedAt` (Timestamp 직렬화 문자열)이 포함됨
- 저장 시 그대로 PUT body에 포함 → `"property updatedAt should not exist"` 400 반환

**결정**
1. **클라이언트**: `useAdmin.ts` `save()` 함수에서 `updatedAt/createdAt` 제거 후 전송
2. **DTO**: `updatedAt?: unknown`, `createdAt?: unknown` 추가 → 클라이언트 버그 있어도 400 차단
3. **서비스**: `const { updatedAt: _u, createdAt: _c, ...fields } = dto` — Firestore write 전에 반드시 스트립

**이유**: 클라이언트 방어만으로는 레이스컨디션·실수 가능성 있음. 서비스 레이어에서 Timestamp 필드를 직접 주입하므로 클라이언트 값은 무시해야 안전.

**이 패턴 적용 조건**: 서버에서 Timestamp.now()로 덮어쓰는 필드가 DTO에 흘러들어올 가능성이 있는 모든 PUT/PATCH 엔드포인트.

---

## [2026-04-23] 히어로 배너 — Firestore 단일 문서 구조 채택

### 결정: `banners/main_hero` 고정 doc (컬렉션 아님)

**배경**: 배너가 1개 (메인 홈 히어로). 복수 배너 운영 계획 없음.

**결정**: `set({ merge: true })` 방식으로 upsert — 초기 문서 없어도 생성됨. 배너 비활성화는 `isActive: false`로 처리 (문서 삭제 X).

**공개 엔드포인트 위치**: `app.controller.ts`의 `GET /banner` — AdminModule이 아닌 최상위 컨트롤러. 인증 없이 consumer 앱이 직접 호출.

**이유**: 향후 배너 수가 늘어도 `banners/{bannerType}` 패턴(예: `banners/category_hero`)으로 확장 가능. 컬렉션 쿼리 추가 비용 없음.

---

## [2026-04-23] CareLevel 타입 위치 — product.types.ts로 이동

### 결정: `CareLevel = 'easy' | 'normal' | 'hard'`를 `variety.types.ts`에서 `product.types.ts`로 이동

**배경**
- `variety.types.ts`는 `product.types.ts`를 import함 (`Category`, `FragranceLevel` 등)
- `Selection` 인터페이스에 `careLevel` 추가 시 `product.types.ts`에서 `variety.types.ts`를 역참조하면 순환 의존 발생

**결정**
- `CareLevel` 정의를 `product.types.ts`로 이동
- `variety.types.ts`에서 `CareLevel`을 `product.types.ts`로부터 import
- `Selection.careLevel?: CareLevel` (optional — 기존 상품 하위 호환)

**이유**: 순환 의존 없이 `careLevel`을 셀러 설정 필드로 사용 가능. variety 도큐먼트 없이도 동작.

---

## [2026-04-23] 관리 난이도(careLevel) — variety 속성 → 셀러 직접 설정 필드 전환

### 결정: `careLevel`을 `Variety` 도큐먼트 속성이 아닌 `product.selection.careLevel`로 관리

**배경**
- 소비자앱 케어 아이콘 카드에서 `variety.careLevel`을 표시하려 했으나 대부분 상품의 variety 도큐먼트가 없거나 미로드
- `fragrance`는 이미 `product.selection.fragrance`로 상품별 설정 구조

**결정**
- `careLevel`을 `product.selection`에 추가 — 셀러가 상품 등록·수정 시 직접 선택
- `TouchSelector`에 관리 난이도 셀렉터 UI 추가 (개화상태↔판매단위 사이)
- 기존 상품 기본값: `'normal'` (edit/page.tsx fallback)

**이유**: variety 도큐먼트 의존 제거, 상품별 특성 반영 가능, 셀러 UX 일관성 유지.

---

## [2026-04-11] storeId 구조 — dear-orchid 하드코딩 제거 결정

### 결정: Firestore 데이터 + 프론트 코드 전체를 UUID 기반으로 통일

**배경**
- 2026-03-28 Phase A 구현 시 seed 데이터를 `storeId: 'dear-orchid'` slug로 심음
- API는 처음부터 UUID 방식으로 올바르게 설계됐으나, Firestore 실제 데이터와 프론트 코드가 slug로 굳어짐
- 결과: seller 세션 `storeId`(UUID)로 Firestore products 조회 시 0건

**결정**
1. Firestore 전체 마이그레이션: `'dear-orchid'` → `'eaa96b06-60f6-4a03-a1af-bea3ad6604c6'`
2. consumer/driver 앱: `STORE_ID` 하드코딩 제거 → 상품/주문 데이터의 `storeId` 사용
3. API: storeId 없는 public 엔드포인트 3개 추가 (`GET /products`, `GET /orders/:id`, `GET /orders`)

**이유**: 다중판매자 Phase 2 전환 시 추가 수정 최소화. 각 셀러가 UUID storeId로 완전히 격리됨.

**상세 계획**: `docs/specs/storeId-migration.md`

---

## [2026-04-11] orders.service.ts 모듈 분리

### 결정: 499줄 → create/query/lifecycle 3개 서비스 + facade 패턴

**배경**: 500줄 한계 도달. 기능 추가(storeId-free 엔드포인트 등) 시 즉시 초과 예정.

**구조**
- `orders-create.service.ts` (~145줄): createOrder + getDeliveryConfig
- `orders-query.service.ts` (~72줄): getOrder, getOrders
- `orders-lifecycle.service.ts` (~220줄): updateStatus, cancelOrder, reviewOrder, confirmPickup, hubConfirmPickup
- `orders.service.ts` (56줄): Facade — controller 인터페이스 유지, 위임만

**이유**: controller와 외부 exports 변경 없이 내부만 분리. 다음 STEP 4 엔드포인트 추가 시 orders-query.service.ts에만 추가하면 됨.

---

## [2026-04-10] Firestore onSnapshot race condition — firebaseReady 패턴 확립

### 결정: 모든 Firestore 실시간 리스너는 firebaseReady=true 이후에만 시작

**배경**
- NextAuth 카카오 로그인 완료 후 `useFirebaseAuth`가 백엔드에서 Custom Token을 받아 Firebase에 `signInWithCustomToken` 실행
- 이 과정이 비동기이므로 페이지 컴포넌트의 `onSnapshot`이 Firebase Auth 완료 전에 실행되면 `permission-denied` 발생

**해결 패턴**
```ts
// useFirebaseAuth.ts
const [firebaseReady, setFirebaseReady] = useState(false)
useEffect(() => {
  return onAuthStateChanged(firebaseAuth, (user) => setFirebaseReady(!!user))
}, [])
return { firebaseReady }

// 각 페이지/훅
useEffect(() => {
  if (!firebaseReady) return
  // onSnapshot 시작
}, [firebaseReady])
```

**적용 위치**
- `apps/driver`: `useFirebaseAuth`, `board/_client.tsx`, `map/page.tsx`, `board/[orderId]/page.tsx`
- `apps/seller`: `useFirebaseAuth`, `orders/[id]/page.tsx` (useOrders는 이미 적용되어 있었음)

---

## [2026-04-10] Seller 강제 취소 API 필드명 — cancelReason → reason

### 결정: 주문 상태 변경 PATCH body의 취소 사유 필드는 `reason`

**배경**
- `update-status.dto.ts`의 필드명이 `reason`이나 프론트엔드 `orders/page.tsx`가 `cancelReason`으로 전송
- API가 400 `property cancelReason should not exist` 반환

**수정**: `handleStatusChange` extra 타입 및 전달값 `cancelReason` → `reason`

---

## [2026-04-05] orders 생성 시 denormalize 필드 확장

### 결정: createOrder에서 연락처·거점 정보를 orders 문서에 즉시 저장

**배경**
- 드라이버 앱은 Firestore 실시간 리스너(`onSnapshot`)로 주문 정보를 표시
- 별도 API 호출 없이 단일 orders 문서만으로 화면을 구성해야 함
- 기존에는 `productName`, `buyerName`, `address` 3개 필드만 denormalize → 연락처·거점 정보 항상 비어 있던 버그 발견

**추가된 필드 (createOrder 시 저장)**
- `buyerPhone`: `users/${userId}.phone`
- `sellerPhone`: `stores/${storeId}.phone`
- `hubName`: `hubs/${hubId}.name` (hub 배송 시만, 아니면 null)
- `hubAddress`: `hubs/${hubId}.address + addressDetail` 합산 (hub 배송 시만, 아니면 null)

**구현**: `Promise.all`에 stores·hubs 병렬 fetch 추가 → 트랜잭션 전 추출 → `t.set()` 저장

**주의**: 기존 주문 소급 적용 없음. 신규 주문 생성 시부터 반영.

---

## [2026-04-04] Refresh Token 자동 갱신 — Method B 채택

### 결정: NextAuth jwt 콜백 내에서 `accessTokenExpires` 타이머 기반 자동 재발급

**배경**
- Railway JWT `accessToken`은 1시간 만료. NextAuth 세션 쿠키는 30일 유지.
- 1시간 후 API 호출 시 401 Unauthorized 발생 → 사용자 강제 로그아웃 또는 빈 화면.

**선택지**
- **Method A (기각)**: JWT TTL을 30일로 늘리기 — 보안 정책 위반, 토큰 탈취 시 30일 피해
- **Method B (채택)**: 55분 타이머 + `POST /auth/refresh` → 새 accessToken·refreshToken 발급

**구현 내용**
- `apps/api/src/auth/auth.service.ts`: `refresh()` 메서드 추가, `login()`·`kakaoLogin()` 모두 `refreshToken` 반환
- `apps/api/src/auth/auth.controller.ts`: `POST /auth/refresh` 엔드포인트 (public, @HttpCode 200)
- consumer·seller·driver 앱 `auth.ts`: `refreshAccessToken()` 헬퍼 + jwt 콜백 `if (Date.now() < token.accessTokenExpires) return token; return refreshAccessToken(token);`
- `JWT_REFRESH_SECRET` Railway 환경변수 별도 관리 (accessToken secret과 분리)

**주의**: 재로그인 1회 필요 — 기존 세션 쿠키에는 `refreshToken`·`accessTokenExpires`가 없음. 재로그인 후 정상 동작.

---

## [2026-04-04] Consumer 앱 상품 조회 — Firestore에서 API로 전환

### 결정: `useProducts`를 Firestore `getDocs` 방식에서 REST API 방식으로 변경

**배경**
- Firestore 보안 규칙: `allow get: if true; allow list: if false` 구조에서 `list` (컬렉션 쿼리)가 차단됨
- consumer 앱 `useProducts`가 `getDocs(query(collection(...)))` — list 권한 필요 → `Missing or insufficient permissions`

**결정 이유**
- 설계 의도 원칙: 소비자 앱의 상품 목록은 NestJS API를 통해 조회 (Firestore 직접 접근 X)
- API 방식이 검색·필터·페이지네이션·인증 없는 공개 접근 모두 지원

**변경 내용**
- `apps/consumer/src/hooks/useProducts.ts`: `fetch(${API_URL}/stores/${STORE_ID}/products?isActive=true&...)` 방식으로 전환
- 응답 형식: `{ items: Product[], total: number }` → `Array.isArray(data) ? data : (data.items ?? [])`로 언래핑

---

## [2026-04-03] seller 앱 "배송 시작" 버튼 제거

### 결정: `PREPARING → DELIVERING` 전환은 드라이버 앱 전담

**배경**
- 드라이버 앱 미완성 기간 동안 `SELLER_TRANSITIONS`에 `PREPARING: ['DELIVERING']`을 임시 추가했었음
- 드라이버 앱 배포·E2E 검증 완료(2026-04-03) 후 정합성 검토에서 제거 대상 확인

**제거 이유**
- `driverId` 오염: seller가 "배송 시작"을 누르면 `orders.driverId`에 seller userId가 기록됨 → 드라이버 정산 시스템(BACKLOG §9) 구축 시 데이터 오염
- 스펙(`orders.md`) 상 seller 허용 전환에 `PREPARING → DELIVERING` 없음

**변경 내용**
- `apps/api/src/orders/orders.helpers.ts` — `SELLER_TRANSITIONS`에서 `PREPARING: ['DELIVERING']` 제거
- `apps/seller/src/app/orders/[id]/page.tsx` — `handleDeliver` 함수 + "배송 시작" 버튼 + `canDeliver` 제거

**운영 영향**
- PREPARING 상태 주문의 "배송 시작"은 이제 드라이버 앱에서만 가능

---

## [2026-04-03] NextAuth v5 미들웨어 쿠키명 주의사항

### 결정: 미들웨어 쿠키 직접 확인 시 `authjs.*` 명칭 사용

**배경**
- NextAuth v4는 쿠키명 `next-auth.session-token` / `__Secure-next-auth.session-token`
- NextAuth **v5**는 `authjs.session-token` / `__Secure-authjs.session-token` 으로 변경됨
- `auth()` 래퍼 대신 쿠키 직접 확인 방식 미들웨어를 작성할 때 v4 명칭을 쓰면 세션이 있어도 항상 /login으로 튕김

**증상**: 카카오 로그인 완료 후 `/board` 진입 시 계속 `/login`으로 리다이렉트

**해결**: [middleware.ts](apps/driver/src/middleware.ts) 쿠키명을 `authjs.session-token`으로 수정

**적용 범위**: consumer·seller·driver 앱 모두 NextAuth v5 사용 → 동일 패턴 유지

---

## [2026-04-03] 드라이버 앱 승인 플로우 MVP 결정

### 결정: MVP에서는 카카오 계정 누구나 driver로 진입 허용, 실서비스 전 승인 플로우 추가

**현재 동작**
- 카카오 로그인 → `POST /auth/kakao-login` → kakaoId 미존재 시 `role: 'driver'`로 자동 생성 → 즉시 접근 허용

**왜 MVP에서 허용하는가**
- 현재 드라이버 = 판매자 본인(1인 운영 구조). 외부 드라이버 없음
- 실질적으로 카카오 계정 정보는 본인만 알고 있음 → 무단 접근 가능성 매우 낮음

**실서비스 전 반드시 구현 필요한 것**
- admin이 드라이버 phone/email 사전 등록 → 로그인 시 매칭 검증
- 또는 신규 가입 시 `role: 'pending'` → admin 승인 후 `role: 'driver'` 전환
- admin 화면 (`/admin/users` role 변경 UI)과 함께 구현

---

## [2026-04-03] 드라이버 앱 인증 구조 결정

### 결정: 카카오 OAuth 단일 경로 + `POST /auth/kakao-login` 별도 구현

**배경**
- seller 앱은 이메일+카카오 복합 Provider. driver 앱은 카카오만 사용
- NextAuth Kakao Provider는 OAuth 완료 후 `signIn` 콜백에서 자체 API 호출 필요
  (카카오 accessToken으로 사용자 정보 획득 → NestJS JWT 발급)

**결정 내용**
- `auth.ts`: `Kakao()` Provider → `signIn` 콜백에서 `POST /auth/kakao-login` 호출
- `POST /auth/kakao-login` body: `{ kakaoId, name, email }` → users 컬렉션 조회·생성 → accessToken 반환
- role 검증: `['seller', 'driver']` 포함 시만 로그인 허용 (consumer 차단)
- **구현 완료** (2026-04-03): `POST /auth/kakao-login` — Railway 자동 배포 완료

**왜 별도 엔드포인트인가**
- 기존 `POST /auth/login` 은 이메일·비밀번호 기반 → 카카오 OAuth 흐름과 다름
- 카카오 ID는 비밀번호 없이 unique identifier로만 사용 → 별도 처리

---

## [2026-04-03] 드라이버 앱 UI 스타일 시스템 확정

### 결정: Tailwind CSS 단일 사용 (Mantine 등 컴포넌트 라이브러리 미사용)

**채택 이유**
- consumer·seller 앱과 동일한 스타일 시스템 → 3앱 일관성 유지
- 드라이버 앱 화면 수 6~7개, 필요 컴포넌트가 단순(카드·탭·버튼·토스트·모달) — Tailwind로 충분
- Mantine 등 컴포넌트 라이브러리는 스타일 교체가 아닌 **마크업 전체 교체**이므로 나중 전환 비용이 높음
- 다크모드: Tailwind `dark:` 클래스로 처리 (`prefers-color-scheme` 감지)

**향후 UI 라이브러리 도입 조건**
- 복잡한 컴포넌트(DateRangePicker, DataGrid 등)가 필요해지는 시점에 재검토
- 도입 시 3개 앱 동시 적용 or `packages/shared/ui` 공통 컴포넌트 패키지로 추상화

---

## [2026-03-25] 백엔드 아키텍처 확정

### 결정: NestJS (Layered Architecture) + Firestore 혼합

**선택지 비교**

| 항목 | Option A: Next.js API Routes | Option B: NestJS (채택) |
|------|------------------------------|------------------------|
| 비즈니스 로직 위치 | 3개 앱에 분산 | NestJS 단일 집중 |
| 주문 도메인 일관성 | 앱마다 다르게 구현될 위험 | 단일 Service로 보장 |
| Daily Cap 동시성 | 각 앱 API Routes에서 개별 처리 | NestJS 트랜잭션으로 처리 |
| 다중 판매자 확장 | 앱 전체 수정 필요 | NestJS 모듈 추가만으로 대응 |
| 배포 비용 | Vercel 무료 | +Railway $5/월 |

**채택 이유**

소비자·판매자·드라이버 세 앱이 동일한 `orders` 도메인을 공유한다.
주문 상태 전환·결제 검증·공동구매 자동 환불·Daily Cap 동시성 처리 등
핵심 비즈니스 로직이 복잡하고, 이를 3개 앱의 API Routes에 분산하면
나중에 혼자 유지보수하기 어렵다. 처음부터 NestJS로 통합하는 것이
나중에 마이그레이션하는 비용보다 훨씬 낮다.

**DDD 미적용 이유**

NestJS Layered Architecture(Controller → Service → Repository)만으로 충분.
DDD 풀세트(Entity·ValueObject·Aggregate·DomainService·Mapper)는
혼자 개발하는 MVP에서 오버엔지니어링이며, 500라인 제한(CLAUDE.md)과도 충돌한다.

---

## [2026-03-25] 모노레포 구조 확정

### 결정: pnpm workspace 모노레포

```
greenhub/
├── packages/
│   └── shared/          ← OrderStatus, Product, Store 등 공통 타입·상수
├── apps/
│   ├── consumer/        ← Next.js 15 (소비자 PWA)
│   ├── seller/          ← Next.js 15 (판매자 앱)
│   ├── driver/          ← Next.js 15 (드라이버 앱)
│   └── api/             ← NestJS (비즈니스 로직 전담)
└── pnpm-workspace.yaml
```

**채택 이유**

`OrderStatus` 타입이 세 앱에서 다르게 정의되면 Firestore 실시간 리스너 오작동.
`packages/shared`에 단일 정의 후 세 앱이 import하는 구조로 타입 불일치를 원천 차단.

---

## [2026-03-25] 공동구매 결제·취소·환불 정책 확정

### 결제 시점
- **즉시 결제 (Option A)** 채택 — 참여 즉시 Portone으로 실제 청구
- Pre-auth(사전 승인) 미적용 — 카카오페이·네이버페이가 pre-auth 미지원

### 취소 가능 구간
| 구간 | 취소 | 환불 |
|------|------|------|
| RECRUITING | 가능 | 즉시 처리 (Portone 환불 API) |
| CONFIRMED 이후 | **불가** | 불가 |

### CONFIRMED 이후 취소 불가 이유
CONFIRMED는 계약 성립 시점 — 판매자가 생산/조달 시작. 단일 취소가 `currentParticipants < minParticipants`를 유발해 전체 참여자에 영향.

### 법적 동의 수령 (전자상거래법 제17조)
참여 전 "확정 이후 취소 불가" 동의 체크박스 + Firestore `groupBuyConsent` 기록:
```ts
groupBuyConsent: { agreed: true, agreedAt: Timestamp, userId: string }
```

### 동의 수령 위치 (와이어프레임 반영)
1. `GroupBuyOptionSheet` — "확정 이후 취소·환불 불가" 체크박스 (미체크 시 버튼 비활성)
2. `checkout/group` — 약관 동의 문구 구체화

### 알림톡 발송 시점
| 트리거 | 수신자 |
|--------|--------|
| RECRUITING → CONFIRMED | 전체 참여자 |
| RECRUITING → CANCELLED (기간 만료) | 전체 참여자 (+ 자동 환불 안내) |
| CONFIRMED → PREPARING | 전체 참여자 |
| PREPARING → DELIVERING | 전체 참여자 |
개인 취소(RECRUITING 중) → 본인 UI만, 타 참여자 알림 없음

---

## [2026-03-25] 실시간 데이터 전략 확정

### 결정: Firestore 직접 리스너 유지 (단, 결제 완료 화면 예외)

| 데이터 | 방식 |
|--------|------|
| 주문 상태 변경 (결제 완료 화면) | **Firestore REST API 폴링 3초** ← [2026-03-27] 변경 |
| 공동구매 참여 인원 (`currentParticipants`) | Firestore 실시간 리스너 |
| Daily Cap 잔여량 (`usedSlots`) | Firestore 실시간 리스너 |
| 결제 검증·환불·알림 | NestJS API |

WebSocket·Redis·SSE 별도 구성 없음. Firestore가 실시간 채널 역할 전담.
NestJS Repository 추상화 없이 Firestore SDK 직접 사용 (이중 추상화 불필요).

### [2026-03-27] useOrderStatus: onSnapshot → REST API 폴링 변경

**원인**: PWA Service Worker(`@ducanh2912/next-pwa`)가 Firebase SDK의 내부 HTTP/2 스트리밍 요청을 가로채 응답하지 않음. `onSnapshot`, `getDoc` 모두 동일하게 실패. Firestore REST API 직접 `fetch()`는 정상 동작 확인.

**결정**: `/order/success` 페이지의 `useOrderStatus`는 Firebase SDK 대신 `https://firestore.googleapis.com/v1/...` REST API를 직접 호출하는 3초 폴링으로 대체. 결제 완료 화면은 밀리초 단위 실시간이 불필요하므로 UX 영향 없음.

**향후**: PWA Service Worker에 Firebase URL 예외 처리 추가 시 `onSnapshot` 복구 가능.

---

## [2026-03-26] 4단계 정합성 검토 미해결 백로그

### 🔴 Critical — apps/api 보완 필요 (Step 4 완료 후 일괄 처리)

| # | 엔드포인트 | 파일 | 조치 |
|---|-----------|------|------|
| C-1 | `PATCH /stores/:storeId/products/:id/active` | `products.controller.ts` | ✅ 2026-03-26 완료 |
| C-2 | `PATCH /stores/:storeId/orders/:id/review` | `orders.controller.ts` | ✅ 2026-03-26 완료 |
| C-3 | `GET /stores/:storeId/daily-caps` | `products.controller.ts` | ✅ 2026-03-26 완료 |
| C-4 | `PATCH /stores/:storeId/daily-caps/:date` | `products.controller.ts` | ✅ 2026-03-26 완료 |

### 🟡 Warning — Step 5 전 보완

| # | 항목 | 파일 | 조치 |
|---|------|------|------|
| W-1 | `GET /notifications/me` | `notifications.controller.ts` | ✅ 2026-03-26 완료 |
| W-2 | `PATCH /notifications/me/preferences` | `notifications.controller.ts` | ✅ 2026-03-26 완료 |
| W-3 | `GET /payments/:paymentId` | `payments.controller.ts` | ✅ 2026-03-26 완료 |
| W-4 | `GET /stores/:storeId/orders/:id/payment` | `payments.controller.ts` | ✅ 2026-03-26 완료 |
| W-5 | Kakao/Naver OAuth Provider | `apps/consumer/src/auth.ts` | ⏸ 키 발급 후 주석 해제 (스켈레톤 추가됨) |
| W-6 | Firestore Timestamp → ISO8601 직렬화 | `src/common/interceptors/timestamp.interceptor.ts` | ✅ 2026-03-26 전역 인터셉터로 완료 |

---

## [2026-03-27] 2차 정합성 검토 — Vercel 배포 후

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | PWA 아이콘 누락 | `public/icons/*.png` | ✅ 192x192, 512x512 생성 완료 |
| M-1 | 🟡 Major | `portonePaymentParams.buyerName`에 userId 사용 | `orders.service.ts` | ✅ users Firestore 조회 후 name 사용으로 수정 |
| m-1 | 🟢 Minor | 상품 조회 API 미사용 (Firestore 직접 접근) | Consumer hooks | 설계 의도대로 — Firestore 직접 접근 유지 |
| m-2 | 🟢 Minor | `/auth/me` 미사용 | Consumer | 향후 프로필 갱신 기능 추가 시 활용 |
| m-3 | 🟢 Minor | `/notifications/*` 미사용 | Consumer | 알림 기능 구현 시 사용 예정 |

---

## [2026-03-28] 5차 정합성 검토 — seller 설계 문서 ↔ 전체 spec 교차 검증

### 수정 완료

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | `products.md` stores 스키마 — 판매자 프로필 7개 필드 누락 (businessNumber 등) | `docs/specs/products.md`, `docs/소비자 설계 - 1단계 요구사항 정의.md` | ✅ 두 문서 모두 확장 필드 반영 |
| C-2 | 🔴 Critical | `orders.md` + shared 타입 — `preparedAt` 필드 누락 | `docs/specs/orders.md` | ✅ 스키마 + Order 인터페이스에 `preparedAt: string | null` 추가 |
| M-1 | 🟡 Major | `notifications.md` — SELLER_* 5종 템플릿 spec 미반영 (코드는 4차 검토에서 구현됨) | `docs/specs/notifications.md` | ✅ 판매자 알림 섹션 + `NotificationTemplateCode` 타입 추가 |
| M-2 | 🟡 Major | `products.md` groupProductConfig — `isProcessed` 플래그 누락 (4차 검토 minor 수정 반영) | `docs/specs/products.md` | ✅ `isProcessed: boolean` 필드 추가 |
| m-1 | 🟢 Minor | `auth.md` — 역할별 로그인 Provider 정책 미명시 | `docs/specs/auth.md` | ✅ seller 네이버 미지원 + 이유 명시 |

### 설계 공백 — seller 앱 스캐폴딩 착수 시 spec 추가 필요

| 항목 | 현황 | 조치 |
|------|------|------|
| `settlements` 모듈 | 스키마: 판매자 설계 1단계 §7에 정의. API·트리거 로직 미정의 | seller 앱 착수 시 `docs/specs/settlements.md` 신규 작성 |
| `hubs` 모듈 | 스키마: 판매자 설계 1단계 §7에 정의. CRUD API 미정의 | seller 앱 착수 시 `docs/specs/hubs.md` 신규 작성 |
| `orders.preparedAt` API 반영 | spec 업데이트 완료. NestJS `PATCH /orders/:id/status` PREPARING 전환 시 `preparedAt` 수신 필요 | seller 앱 착수 시 `orders.service.ts` 수정 |

---

## [2026-03-28] 4차 정합성 검토 — seller 앱 설계 착수 전

### 수정 완료

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | Webhook 후 소비자 알림 미발송 (`ORDER_ACCEPTED`, `GROUP_JOINED`) | `payments.service.ts` | ✅ handleWebhook 성공 분기에 `notifications.sendToUser` 추가 |
| C-2 | 🔴 Critical | `PaymentsService` ↔ `NotificationsService` 순환 의존성 | `payments.module.ts`, `notifications.module.ts`, `notifications.service.ts`, `payments.service.ts` | ✅ NestJS `forwardRef()` 로 해소 |
| C-3 | 🔴 Critical | 판매자 알림 전무 (신규주문·공동구매달성·개인취소·자동환불) | `notifications.service.ts`, `orders.service.ts` | ✅ `SELLER_*` 템플릿 4종 추가, `sendToStoreOwner` 구현 |
| M-1 | 🟡 Major | `getOrder`/`getOrders` 판매자 storeId 소유권 검증 누락 | `orders.service.ts` | ✅ `user.storeId !== storeId` 시 403 추가 |
| M-2 | 🟡 Major | `portonePaymentParams.merchantUid` V1 필드명 잔존 | `orders.service.ts` | ✅ 제거 — spec(`payments.md`) 기준 `{ name, amount, buyerName }` 정렬 |
| m-1 | 🟢 Minor | 공동구매 스케줄러 매분 중복 쿼리 | `notifications.service.ts` | ✅ `groupProductConfig.isProcessed` 플래그 도입, 처리 후 `true` 설정 |

### 설계 의도 확정 (코드 변경 불필요)

| 항목 | 결정 |
|------|------|
| 드라이버 주문 접근 제어 | driver는 storeId 범위 내 전체 주문 조회 허용 — 배송 담당자는 해당 storeId 모든 주문을 알아야 함. 드라이버 앱 설계 시 재검토 |
| `SELLER_TRANSITIONS` 중복 항목 (`DELIVERING: ['CANCELLED']`) | `getAllowedTransitions`의 일반 취소 로직과 중복이나 명시적 선언으로 유지 — 제거 시 의도 불명확 |

---

## [2026-03-28] 6차 정합성 검토 — 판매자 설계 + 운영 구조 결정 반영

### 수정 완료

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | `UserRole`에 `'admin'` 미포함 | `auth.md`, `auth.types.ts` | ✅ `'admin'` 추가, 접근 제어 테이블 반영 |
| C-2 | 🔴 Critical | `stores` 스키마에 `status` 필드 누락 | `products.md` | ✅ 5개 값 추가 |
| C-3 | 🔴 Critical | `settlements.status`에 `'paid'` 누락 | `판매자 설계 1단계` | ✅ `'paid'` 추가, 의미 주석 포함 |
| M-1 | 🟡 Major | seller 초대 토큰 가입 플로우·스키마 미정의 | `auth.md` | ✅ §5-2 신규 추가 + `invite_tokens` 스키마 정의 |
| M-2 | 🟡 Major | admin API 접근 제어 미정의 | `auth.md` | ✅ §7 테이블에 admin 컬럼 추가 + 우회 원칙 명시 |
| M-3 | 🟡 Major | 주문 목록 조회 admin 케이스 미반영 | `orders.md` | ✅ `userId` admin 시 선택적으로 변경, 주석 추가 |
| M-4 | 🟡 Major | 판매자 알림 "미구현" 표기 오류 | `판매자 설계 1단계` | ✅ 4차 검토 구현 완료로 현행화 |

### 설계 공백 — seller 스캐폴딩 착수 시 처리

| 항목 | 현황 |
|------|------|
| `settlements.md` spec | 스캐폴딩 착수 시 작성 |
| `settlements.md` spec | 스캐폴딩 착수 시 작성 |
| `hubs.md` spec | 스캐폴딩 착수 시 작성 |

### [2026-03-28] 판매자 알림 정책 확정

**결정**: 매 건 알림 제거 → 공동구매 결과 즉시 알림 + 일반 판매 배치 집계 알림으로 정리.

| 유지 | 제거 |
|------|------|
| `SELLER_GROUP_CONFIRMED` — 공동구매 목표 달성 즉시 | `SELLER_NEW_ORDER` — 일반 판매 매 건 알림 (과잉) |
| `SELLER_GROUP_CANCELLED_LACK` — 미달 자동 취소 즉시 | `SELLER_ORDER_CANCELLED` — 소비자 개인 취소 알림 (과잉) |
| `SELLER_ORDER_BATCH` — 일반 판매 배치 집계 (신규) | |

**이유**: 일반 판매 다건 운영 시 매 주문마다 알림이 오면 노이즈. 공동구매는 판매자 행동(준비 시작)이 즉시 필요하므로 실시간 유지.

**코드 조치**: `SELLER_NEW_ORDER`, `SELLER_ORDER_CANCELLED` 호출부는 seller 앱 스캐폴딩 시 `orders.service.ts`에서 제거.

### [2026-03-28] 온보딩 Guard 완성 조건 확정

**필수 (미입력 시 `active` 전환 불가)**
```
name            상호명
ceoName         대표자명
phone           연락처
address         소재지
```

**선택 (없어도 `active` 전환 가능)**
```
businessNumber  사업자등록번호
logoUrl         로고 이미지
```

**전환 조건**: 필수 4개 모두 입력 완료 시 `stores.status: 'invited' → 'active'` 자동 전환.
로고·사업자번호는 설정 화면에서 언제든 추가 가능.

> 당근비즈 벤치마킹은 이후 Phase 2 다중 판매자 온보딩 UX 개선 시 참조 예정.

### [2026-03-28] SELLER_ORDER_BATCH 발송 주기 확정

**1일 1회** — 발송 시각은 seller 앱 착수 시 확정 (오후 8시 유력).
0건이면 미발송.

---

## [2026-03-29] 결제 E2E 테스트 완료 — 발견된 버그 및 수정 결정

### 버그 1: Portone V2 웹훅 DTO 400 에러

**현상**: Portone이 웹훅 전송 시 `timestamp`(최상위)와 `data.transactionId` 필드를 포함하나,
DTO에 해당 필드가 없어 `forbidNonWhitelisted` 검증에서 400 반환.

**수정**: `portone-webhook.dto.ts`에 두 필드를 `@IsOptional()`로 추가.

### 버그 2: Transaction.Ready 웹훅 오처리

**현상**: Portone V2는 결제창 오픈 시 `Transaction.Ready` 이벤트를 먼저 발송.
기존 코드가 `type !== 'Transaction.Paid'` 조건으로 즉시 주문 CANCELLED 처리.
결제 완료 후 `Transaction.Paid`가 도착해도 이미 CANCELLED라 무시됨.

**수정**: `payments.service.ts`에서 `Transaction.Ready` 타입을 명시적으로 무시(early return).

**Portone V2 웹훅 이벤트 순서**:
```
결제창 오픈 → Transaction.Ready (무시)
결제 완료   → Transaction.Paid  (처리: PENDING→ACCEPTED)
결제 실패   → Transaction.Failed (처리: PENDING→CANCELLED)
```

### 버그 3: Firestore Timestamp NaN 표시

**현상**: `onSnapshot`으로 받은 `createdAt`이 Firestore Timestamp 객체라
`new Date(createdAt)`이 NaN 반환 → "NaN일 전" 표시.

**수정**: `toDate()` 메서드 존재 여부로 분기 처리.

---

## [2026-03-29] 마이페이지 Phase B 구현 — 기술 결정 사항

### 결정 1: consumer 주문 목록 — Firestore runQuery → NestJS API

**원인**: Firestore 보안 규칙이 단일 문서 `get`은 허용하나 컬렉션 `list`(runQuery POST)는 차단.

**결정**: `GET /stores/:storeId/orders?userId={id}` NestJS 엔드포인트로 대체.
- 인증 토큰 사용으로 보안 향상
- Firestore 규칙 수정 없이 해결

**수정된 서비스 응답**: `getOrders`가 `{ orders: [...] }` → `Order[]` 평탄화 + `id` 포함.
seller 앱은 Firestore SDK 직접 사용이라 영향 없음.

### 결정 2: NextAuth v5 beta.30 — session.user.id 명시적 전달 필수

`token.sub → session.user.id` 자동 매핑이 beta.30에서 불안정.
`jwt` 콜백에 `token.id = user.id`, `session` 콜백에 `session.user.id = token.id` 명시 필수.
`next-auth.d.ts`에 `id: string` 타입 추가.

### 결정 3: ssr: false 동적 import 패턴

`useSession`을 사용하는 페이지는 Next.js 정적 프리렌더 시 SessionProvider 미존재로 오류.
`page.tsx`(`'use client'`) → `next/dynamic(() => import('./_client'), { ssr: false })`로 래핑.
`force-dynamic`만으로는 클라이언트 훅 프리렌더를 막을 수 없음.

### 결정 4: 네이버페이 가입 시점 — 도메인 확정 후

네이버페이 파트너센터는 실제 운영 URL 필수. 도메인·브랜드명 확정 전 가입 불가.
브랜드명 변경은 manifest.json + 화면 텍스트만 수정하면 되므로 코드 영향 없음.

---

## [2026-03-28] 플랫폼 운영 구조 확정 — 판매자 등록 · 수수료 · admin 역할

### 결정 1: 운영자(admin) = 플랫폼 개발자 본인 + admin 앱 구조 로드맵

운영자는 별도 인물이 아닌 플랫폼을 만든 개발자 본인.

**admin 앱 구조 로드맵 (B→A)**
```
B안 (지금):   apps/seller /admin/* 경로로 통합 운영
              판매자는 /orders·/products 등 접근
              운영자만 /admin/* 접근 (role: 'admin' Guard)

A안 (확장):   apps/admin 별도 앱으로 분리
              분리 비용: /admin/* 페이지 파일 이동 + Vercel 프로젝트 추가 (~30분)
              NestJS API 엔드포인트는 동일 사용 — 코드 변경 없음
```

**A안 전환 시점 판단 기준** (해당 시 분리)
- 운영팀 인원이 생겨 admin URL을 판매자에게 노출하고 싶지 않을 때
- admin 기능이 늘어 seller 앱 번들 크기에 영향을 줄 때
- `admin.greenhub.kr` 별도 도메인이 필요할 때

**구현 방식**: 본인 Firestore `users` 문서에 `role: 'admin'` 수동 1회 설정 → 이후 웹앱 내에서 모든 권한 보유.

**admin에서 관리하는 범위**
```
/admin/stores        판매자 목록 · 초대 토큰 발급 · 승인 · 수수료율 설정
/admin/users         소비자 계정 조회 · 정지/복구
/admin/orders        전체 주문 조회 · 환불 강제 처리
/admin/settlements   판매자별 정산 처리 (confirmed → paid 이체 완료 처리)
/admin/invite        초대 토큰 발급 (판매자 등록 A안)
```

---

### 결정 2: 판매자 등록 구조 — A안으로 시작, B안으로 확장

**로드맵**
```
지금 (단일 판매자)   → A안: admin이 초대 토큰 생성 → 판매자가 링크로 가입
판매자 증가 시       → B안: 판매자 자체 신청 → admin 승인
(A→B 전환 비용 없음 — status 필드 설계만 처음부터 확장 가능하게)
```

**stores.status 확정 (처음부터 5개 값 지원)**
```
'invited'            A안 전용 — 초대 발송됨, 가입 전
'pending_approval'   B안 전용 — 판매자 자체 신청, 승인 대기
'active'             공통 — 정상 운영 중
'rejected'           공통 — 거절됨
'suspended'          공통 — 운영 정지
```

B안 전환 시 추가 작업: 공개 신청 폼 1개 추가 + `pending_approval` 상태로 저장.
admin 승인 화면은 A안 때 이미 존재하므로 수정 불필요.

---

### 결정 3: 수수료 정산 구조 — C→B→A 단계적 확장

**Portone 계정은 운영자(본인) 명의** — 모든 소비자 결제가 운영자 계좌로 수취됨.
이로써 플랫폼이 중간에서 수수료를 떼고 판매자에게 정산하는 마켓플레이스 구조가 이미 성립.

**로드맵**
```
C안 (지금):    commissionRate = 0 → 운영자가 전액 판매자에게 이체 (수수료 없음)
B안 (확장):    commissionRate > 0 → settlements 기반 수동 주기 정산 (운영자가 직접 이체)
A안 (자동화):  Portone 마켓플레이스 서브머천트 계약 → 자동 분배 (판매자 10인+ 시점)
```

**settlements.status 확정 (기존 3개 → 4개)**
```
'pending'    주문 진행 중
'confirmed'  주문 완료 — 판매자 지급 대기
'paid'       운영자가 판매자 계좌로 이체 완료  ← 신규 추가
'cancelled'  주문 취소
```

**admin 정산 화면 역할**: `confirmed` 건 합산 → [이체 완료 처리] → `paid` + `paidAt` 기록 → 판매자 알림.
**판매자 앱 정산 화면 역할**: 조회 전용 (`confirmed` = 입금 예정, `paid` = 입금 완료).

**수수료 계산식 (변경 없음)**
```
commissionAmount  = totalAmount × commissionRate
settlementAmount  = totalAmount − commissionAmount
→ stores.commissionRate 값만 변경하면 코드 수정 불필요
```

---

## [2026-03-27] 3차 정합성 검토 — 결제 E2E 테스트 완료 후

### 수정 완료

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | `shared/payment.types.ts` Portone V1 필드명 (`portoneImpUid`, `portoneMerchantUid`) | `packages/shared/src/payment.types.ts` | ✅ V2 기준 `portonePaymentId`, `portoneTransactionId`로 변경 |
| C-2 | 🔴 Critical | `docs/specs/payments.md` 전체가 Portone V1 기준 (webhook 포맷, 필드명, 플로우) | `docs/specs/payments.md` | ✅ Portone V2 전면 업데이트 |
| M-1 | 🟡 Major | `pickup-confirm` 엔드포인트 스펙 미정의 | `docs/specs/orders.md` | ✅ 엔드포인트 및 동작 추가 |
| M-2 | 🟡 Major | `POST /auth/register` Request Body에 `role` 필드 누락 | `docs/specs/auth.md` | ✅ 멀티앱 구조 설계 의도 명시 |
| m-1 | 🟢 Minor | `PortonePaymentParams` 타입이 V1 파라미터 기준 | `packages/shared/src/payment.types.ts` | ✅ V2 SDK 파라미터로 교체 |

### 설계 의도 확정 (코드 변경 불필요)

| 항목 | 결정 |
|------|------|
| PENDING 타임아웃 스케줄러 위치 | `PaymentsService`에 위치 — 결제 도메인 책임 (PENDING은 payments 생명주기) |
| `PaymentStatus.FAILED` 저장 누락 | PENDING 타임아웃·금액 위변조 시 payments 문서 미생성이 의도적 — 결제 자체가 성립되지 않은 케이스 |
| `role: 'consumer'` 기본값 미적용 | 멀티앱 구조상 API가 role을 명시적으로 받는 것이 올바름 (OAuth만 consumer 기본값) |

---

## [2026-03-28] 판매자 강제 취소 권한 범위 확정

### 결정: 판매자 취소는 PREPARING 이전까지만

**허용 범위**
```
ACCEPTED   → CANCELLED  ✅
CONFIRMED  → CANCELLED  ✅
PREPARING  → CANCELLED  ✅  (드라이버 출발 전 단계)
DELIVERING 이후         ❌  불가
```

**이유**
- 발송(`DELIVERING`) 이후 판매자 일방 취소는 표준 e-커머스에 없는 개념
- 드라이버가 이미 상품을 픽업한 상태에서 취소 시 상품 회수 처리 주체가 모호
- 발송 후 분쟁은 소비자가 반품 신청 → 판매자 수락 루트로만 처리

**영향 범위**
- `docs/specs/orders.md` §4 상태 전환 허용 목록 수정 완료
- `apps/seller/src/app/orders/[id]/page.tsx` `canCancel` 조건 수정 완료
- NestJS Guard 구현 시 `DELIVERING` 이후 판매자 `CANCELLED` 전환 요청 → `403` 반환

---

## [2026-03-28] 상품 등록 폼 UX 구조 확정

### 결정: 단일 페이지 스크롤 + 조건부 필드 노출

**배경**
당근마켓 UX 스크린샷 참조 후 논의. 스텝 형식(Step 1→2)과 단일 페이지 스크롤 중 선택.

**결정 근거**
- seller 앱 사용자는 반복 업무 사용자 → 스텝 전환이 불필요한 마찰
- 단일 페이지에서 전체 필드를 한눈에 파악 가능
- 스텝 형식은 향후 신규 판매자 온보딩 가이드가 필요할 때 별도 구현

**폼 구조 확정**
```
[이미지 업로드]        ← 가로 스크롤 썸네일, 대표사진 뱃지, 선택 순서 번호
[상품명]
[카테고리]
[색상 멀티 선택]
[배송 사이즈]
[가격]
[상세 설명]

── 판매 방식 ──────────────────
  ● 일반 판매   ○ 공동구매
────────────────────────────
  ↓ 공동구매 선택 시 슬라이드 다운
[최소 인원]
[최대 인원]
[모집 마감일]
[배송 예정일]
[배송 수단 (직배송 / 택배)]

[등록하기]
```

**당근마켓에서 차용한 UX 패턴**
- 이미지 가로 스크롤 썸네일 + "대표사진" 뱃지
- 선택 순서 번호 표시 (①②③)
- 헤더 우측 "임시저장" 버튼
- 이미지 → 제목 → 설명 → 가격 폼 순서

**당근마켓과 다르게 가는 부분**
- "판매하기 / 나눔하기" → "일반 판매 / 공동구매" 탭
- AI 사진 분석 자동 글 작성 ❌ (MVP 범위 초과)
- 거래 희망 장소 ❌ → 배송 수단으로 대체
- 가격 제안 받기 ❌ (고정가 구조)

---

## [2026-03-28] 8차 정합성 검토 — 코드 수정 사항

### C-1. 판매자 강제 취소 권한 API 반영 완료

**수정 파일**: `apps/api/src/orders/orders.service.ts`

`SELLER_TRANSITIONS`에서 `DELIVERING: ['CANCELLED']`, `HUB_ARRIVED: ['CANCELLED']` 제거.
`getAllowedTransitions` 내 광범위한 CANCELLED 추가 로직을 **허용 상태 화이트리스트** 방식으로 교체:
```typescript
const sellerCancellable = ['ACCEPTED', 'CONFIRMED', 'PREPARING']
```
발송 이후 단계(DELIVERING·HUB_ARRIVED)에서 판매자 취소 차단. 소비자 반품 신청 루트로만 처리.

### C-1-b. seller UI 취소 사유 필드명 불일치 수정

`orders/[id]/page.tsx` `handleCancel` 에서 `cancelReason` → `reason` 으로 수정.
`UpdateStatusDto.reason` 필드와 일치. 취소 사유가 Firestore `cancelReason`에 정상 저장됨.

### 상품 등록 폼 구현 완료

**신규 파일**:
- `apps/seller/src/app/products/_components/ProductForm.tsx` (443줄)
- `apps/seller/src/app/products/_components/ImageUpload.tsx` (96줄)
- `apps/seller/src/app/products/new/page.tsx`
- `apps/seller/src/app/products/[id]/edit/page.tsx`

**deliveryFeeDiscount MVP 결정**: 공동구매 배송비 할인 필드는 등록 폼에서 숨기고 `0` 고정.
공동구매 배송비 할인 정책 확정 전까지 노출 보류.

---

## [2026-03-28] 거점 픽업 확인 방식 — MVP vs Phase 2 결정

### MVP: 패턴 C (seller 주도 코드 입력 방식)

**결정 내용**:
- 거점 스태프 전용 계정/역할 없이 **seller가 허브 방문 또는 전화로 코드 확인 후 입력**
- API: 기존 `confirmPickup`(소비자 전용) 건드리지 않고, **신규 `hub-confirm` 엔드포인트 추가**
  - `PATCH /stores/:storeId/orders/:orderId/hub-confirm { pickupCode }`
  - seller JWT 검증 + pickupCode 6자리 매칭 → `PICKED_UP` 전환
- UI 흐름: `/hubs/[id]` 주문 행 클릭 → orderId 자동 전달 → `/hubs/[id]/pickup?orderId=xxx` → 6자리 입력 → 확인

**이유**: 운영 거점 계약 미확정 단계에서 hub_staff 권한 구조 선제 구현은 오버엔지니어링. 소규모 협력 업체(꽃집·과일가게)에 앱 등록 강제는 진입 장벽.

### Phase 2: hub_staff 역할 도입 (거점 계약 확정 후)

**필요 작업**:
- `users.role: 'hub_staff'` 신규 추가
- `hubs.staffIds: string[]` — hub ↔ staff 관계 필드
- seller 앱 내 스태프 초대 링크 발급 UI
- API 미들웨어: `hub_staff` JWT 처리 + 자기 hubId 주문만 접근 스코핑
- seller 앱 `/admin` 영역 구축 시 함께 설계

**트리거**: 운영 거점 협력 업체 계약 확정 시점

---

## [2026-03-28] 9차 정합성 검토 — seller 앱 완성 후 교차 검증

### 수정 완료

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | `SELLER_TRANSITIONS` — `PREPARING → DELIVERING` 미포함 → 판매자 "배송 시작" 버튼 403 오류 | `orders.service.ts` | ✅ `PREPARING: ['DELIVERING']` 추가 (드라이버 앱 미완성 전까지 판매자 임시 수행, 주석 명시) |
| C-2 | 🔴 Critical | seller `orders/[id]/page.tsx` — `'groupProductConfigs'` (s 있음) 오타 → 공동구매 정보 항상 null | `apps/seller/src/app/orders/[id]/page.tsx:106` | ✅ `'groupProductConfig'` (s 없음)으로 수정 |
| M-1 | 🟡 Major | `orders.md` §9 `CreateOrderRequest` — `hubId?: string` 미반영 | `docs/specs/orders.md` | ✅ `hubId?: string` 추가 + 변경 이력 기록 |

### 미이행 설계 결정

없음 — 전항목 수정 완료.

---

## [2026-03-29] 10차 정합성 검토 — 버그 3건·스펙 불일치 2건

### 수정 완료

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| B-1/B-2 | 🔴 Critical | 공동구매 `PREPARING→DELIVERING`, `DELIVERING→DELIVERED` 알림이 `ORDER_*` 템플릿으로 인해 개인 발송 → `sendToGroupParticipants` 조건 미통과 | `orders.service.ts` | ✅ `sendTransitionNotification`에 `GROUP_TEMPLATE_OVERRIDES` 추가, group 주문 시 `GROUP_DELIVERING` / `GROUP_DELIVERED` 사용 |
| B-3 | 🔴 Critical | `sendToGroupParticipants` 쿼리가 `status in ['RECRUITING','CONFIRMED']` 고정 → PREPARING/DELIVERING 상태 참여자에게 알림 0건 발송 | `notifications.service.ts` | ✅ 전체 쿼리 후 `['PENDING','CANCELLED','REVIEWED']` 앱 레이어 제외 방식으로 변경 |
| S-1 | 🟡 Major | `orders.md` Section 3 Firestore 스키마, Section 9 `Order` 인터페이스 정의에 `hubId` 필드 누락 (코드에는 존재, 변경이력에만 기록) | `docs/specs/orders.md` | ✅ Section 3·9 모두 `hubId: string \| null` 추가 |

### 설계 결정 확정 (S-2)

**일반 판매 소비자 취소(`ACCEPTED` 상태) — 현재 불가, 향후 결정 보류**

| 항목 | 내용 |
|------|------|
| 현재 코드 | `cancelOrder`는 `RECRUITING` 상태만 허용 → `ACCEPTED` 상태에서 소비자 취소 시 `403` 반환 |
| 스펙 기술 | `orders.md` §4: "CONFIRMED 이후 소비자 직접 취소 거부"만 명시, ACCEPTED 취소 여부 미기술 |
| **결정** | **ACCEPTED 소비자 취소 불가로 유지** — MVP 단계에서 결제 완료 즉시 판매자에게 준비 지시가 가는 구조이므로 취소 허용 시 운영 부담 |
| 영향 범위 | 허용으로 변경 시: `cancelOrder` 조건 수정 + `GROUP_CANCELLED_SELF` → 일반 판매용 템플릿(`ORDER_CANCELLED_SELF`) 추가 필요 |
| 향후 검토 | 주문량 증가로 결제~준비 간격이 생기면 "n분 이내 무료 취소" 정책 도입 검토 |

---

## [2026-04-09] 보안 로깅 전략 — 이중 구조 채택

### 결정: 보안 감사 로그는 Firestore, 운영 이벤트 로그는 NestJS Logger

**배경**
- 보안 취약점 수정 과정에서 감사 로그 필요성 확인
- 결제 완료 등 일반 이벤트까지 Firestore에 쓰면 규모 증가 시 비용/성능 문제
- MVP 단계에서 외부 로깅 서비스(PostHog, Datadog 등) 도입은 과도

**채택한 구조**

| 이벤트 유형 | 저장 위치 | 확인 방법 |
|------------|----------|----------|
| 로그인 실패, 토큰 탈취, 금액 위변조, Webhook 서명 실패, 권한 차단 | Firestore `auditLogs` 컬렉션 | Firebase Console |
| 결제 완료, 환불, 주문 생성 등 일반 운영 이벤트 | NestJS Logger → Railway 콘솔 | Railway 대시보드 로그 탭 |

**구현체**
- `src/common/audit/audit.service.ts` — 보안 감사 전용
- NestJS 내장 `Logger` — 운영 이벤트 (INFO 레벨)

**향후 규모 확장 시 마이그레이션 가이드**
- **1만 MAU 이하**: 현재 구조 유지
- **1만~10만 MAU**: PostHog(무료 100만 이벤트/월) 또는 Google Cloud Logging 도입
  - `AuditService`의 Firestore 쓰기를 PostHog `capture()` 호출로 교체
  - Logger 출력을 Cloud Logging exporter로 연결
- **10만 MAU 이상**: Datadog / New Relic 등 전문 APM 도입 검토
  - 현재 `AuditAction` 타입이 이벤트 카탈로그 역할 → 그대로 마이그레이션 가능

**결정 이유**
- 보안 이벤트는 영구 보관 + 구조화된 쿼리 필요 → Firestore 적합
- 일반 운영 로그는 단기 확인용 → Railway 로그(30일 보관)로 충분
- 전환 비용 최소화: `AuditService` 인터페이스 유지 시 내부 구현만 교체하면 됨

---

## [2026-04-12] Driver E2E 검증 — 버그 수정 4건 + 수수료 정책 확정

### BUG-1: 수거 대기 탭 클릭 미작동

**원인**: `apps/driver/src/app/board/_client.tsx`에서 `useSearchParams()` 사용 → Next.js App Router에서 `<Suspense>` 경계 필요.
**수정**: `board/page.tsx`에 Suspense + dynamic import 적용.
**커밋**: `8c4aaf3`

### BUG-2: admin 계정으로 드라이버 앱 PREPARING → DELIVERING 403

**원인**: `getAllowedTransitions(role, status)`에서 admin을 seller와 동일하게 처리 → SELLER_TRANSITIONS에 `PREPARING → DELIVERING` 없음.
**수정**: admin은 seller + driver 전환 모두 허용 (`orders.helpers.ts`).
**커밋**: `65ea9cc`

**설계 원칙 (확정)**: admin role은 seller·driver 전환 모두 허용 + CANCELLED 강제 취소 가능. seller는 PREPARING까지만 취소 가능.

### BUG-3: 신규 카카오 계정 드라이버 앱 접근 불가

**원인**: `kakaoLogin`에서 신규 드라이버 생성 시 `driverApproved: false` 기본값.
**결정 (MVP Option A)**: `driverApproved: true` 자동 승인. 실서비스 전환 시 admin 승인 플로우 추가 예정.
**커밋**: `dc1179d`

### BUG-4: admin으로 정산 조회 시 403

**원인**: `settlements.service.ts`의 `verifyOwnership`에 admin bypass 없음.
**수정**: `role === 'admin'` 시 소유권 체크 건너뜀. 컨트롤러에서 `user.role` 전달.
**커밋**: `7d3924c`

**설계 원칙**: admin bypass는 `assertSellerOwnsStore`, `settlements.verifyOwnership` 두 곳 모두 적용. 신규 서비스 추가 시 동일 패턴 적용.

### 플랫폼 수수료 정책 — MVP C안 적용 확정

**결정 (2026-04-12 재확인)**: MVP는 수수료 0% (C안). Railway 환경변수 `PLATFORM_FEE_RATE=0` 설정.

**다중판매자 전환 시 로드맵**:
- `PLATFORM_FEE_RATE` 단일값 → store 문서의 `commissionRate` 필드로 전환 (판매자별 차등)
- 환경변수 방식 유지로 코드 배포 없이 수수료율 즉시 변경 가능 (B안 전환 시)

---

## [2026-04-12] 공동구매 UI/UX 완성 — 정책 확정 및 구현

### 정책 결정 (3가지)

| 정책 | 결정 |
|------|------|
| 소비자 중도 취소 | RECRUITING 구간 허용 → 즉시 환불. CONFIRMED 이후 불가 (2026-03-25 기결정, 재확인) |
| maxParticipants 초과 | 선착순 마감 → 도달 즉시 조기 확정 트리거 (대기열 없음) |
| Daily Cap 연계 | 비연계 — groupDeliveryDate 고정으로 판매자가 일정 인지, 슬롯 별도 관리 불필요 |

### 배송 예정일 소비자 노출

`groupDeliveryDate`가 이미 스키마에 존재. Seller 상품 등록 시 날짜 선택 → Consumer 상품 상세에 "배송 예정일: O월 O일 (요일)" 표시.

### 구현 내역 (커밋 `a27f55a`)

| 파일 | 변경 내용 |
|------|----------|
| `GroupConfigSection.tsx` | `recruitDeadline` → `datetime-local` (분 단위 정밀도) |
| `ProductForm.tsx` | 날짜 교차 검증: 최소 인원 ≥2, 마감일 미래, 배송일 > 마감일 |
| `products/[id]/page.tsx` | groupDeliveryDate 표시 + 모집 완료 상태(isFull) + 버튼 비활성화 |
| `ProductCard.tsx` | groupSummary 기반 "N/M명 모집 중" / "모집 완료" 표시 |
| `mypage/orders/[id]/_client.tsx` | RECRUITING 상태 시 안내 카드 (취소 가능/확정 후 불가 안내) |
| `seller/orders/page.tsx` | RECRUITING OrderCard 인포 블록 (판매자 액션 없음 안내) |
| `notifications.service.ts` | `processGroupBuyEarlyConfirm(productId)` 추가 |
| `orders-create.service.ts` | maxParticipants 도달 시 `setImmediate`로 조기 확정 트리거 |
| `packages/shared/product.types.ts` | `Product` 타입에 `groupSummary?` 추가 |

### 선착순 마감 조기 확정 흐름

```
주문 생성 트랜잭션
  └─ currentParticipants + 1 === maxParticipants
       └─ setImmediate → processGroupBuyEarlyConfirm(productId)
            └─ gcSnap.isProcessed 체크 (중복 방지)
            └─ confirmGroupBuy() → 모든 RECRUITING 주문 → CONFIRMED
            └─ isProcessed = true
```

`setImmediate` 사용 이유: 트랜잭션 커밋 완료 후 비동기 실행. 실패 시 크론잡(매 1분)이 재처리하므로 안전.

---

## [2026-04-13] Firebase Storage CORS 미설정 — 보류 결정

### 결정: E2E 중 발견, 다음 세션으로 보류

**배경**
- seller.greenlove.co.kr에서 사진 업로드 시 Firebase Storage CORS 차단
- `firebasestorage.googleapis.com` preflight → 403

**해결 방법 (미적용)**
- `cors.json` 파일 생성 완료 (`/c/Develop/greenhub/cors.json`)
- 적용 명령: `gcloud storage buckets update gs://green-e4fe3.firebasestorage.app --cors-file=cors.json`
- gsutil/gcloud SDK 미설치 상태 → winget install Google.CloudSDK 후 적용 필요

**영향**
- 사진 없이 상품 등록은 정상 동작 (validate에 이미지 체크 없음)
- E2E는 사진 없이 진행

---

## [2026-04-13] 공동구매 — 수량 기반 모델로 전환 (향후 구현)

### 현황 (인원 기반)
- `groupProductConfig`: minParticipants / maxParticipants / currentParticipants
- 1주문 = 참여자 +1, quantity는 진행률에 미반영

### 결정: 수량 기반 모델로 전환
**배경**: 1인이 대량 구매 시 인원 카운트가 실제 수요를 반영하지 못함. 도매 공동구매 특성상 수량 기반이 더 적합.

**신규 스키마**
- `targetQuantity` — 목표 수량 (조기 확정 기준)
- `minQuantity` — 최소 수량 (미달 시 자동 취소)
- `maxPerPerson` — 1인 최대 구매 수량
- `currentQuantity` — 현재 누적 수량 (주문 quantity 합산)

**변경 범위**
- API: orders-create / orders-lifecycle / notifications (currentParticipants → currentQuantity)
- Seller: 상품 등록 폼 필드 교체
- Consumer: 프로그레스바 N/M개 표시
- shared 타입 업데이트
- Firestore 기존 groupProductConfig 마이그레이션 필요

**우선순위**: MVP E2E 완료 후 Phase 2 구현

---

## [2026-05-08] E2E 인증 테스트 — E2E_TEST 환경 게이팅 패턴 확정

### 결정: Credentials provider를 E2E_TEST=true 환경에서만 조건부 활성화

**배경**
- consumer 앱은 카카오 OAuth 단독 → Playwright storageState 확보 불가
- seller 앱도 프로덕션에서는 카카오 로그인이 주 경로, 이메일 로그인은 e2e용
- "임시 추가 → 나중에 제거" 패턴은 프로덕션 노출 위험 + 실제 제거 안 되는 기술부채 유발

**결정**
```ts
// auth.ts (consumer·seller 공통 패턴)
providers: [
  KakaoProvider(...),
  ...(process.env.E2E_TEST === 'true' ? [CredentialsProvider(...)] : []),
]
```
- Vercel 프로덕션: `E2E_TEST` 환경변수 없음 → 이메일 로그인 비노출
- Playwright `.env`: `E2E_TEST=true` → Credentials provider 활성 → storageState 확보 가능

**커버리지 범위 확정**
| 스펙 | 방향 |
|------|------|
| consumer-cart | E2E_TEST 게이팅 후 인증 테스트 추가 |
| consumer-mypage | E2E_TEST 게이팅 후 인증 테스트 추가 |
| consumer-checkout | 실결제(카카오페이) 자동화 불가 → "결제 버튼 노출까지"만 커버 후 수동 QA |

**이유**: 제거할 코드가 아니므로 기술부채 없음. 프로덕션 노출 위험 없이 인증 후 CRUD 자동화 가능.

---

## [2026-05-08] CI/CD 전략 — 현 구조 유지 결정

### 결정: GitHub Actions 미도입, Vercel/Railway GitOps 그대로 유지

**배경**
- main 브랜치 push 시 Vercel·Railway 자동 빌드/배포 (Git 연동 자체 GitOps)
- `.github` 디렉토리 없음 — GitHub Actions CI 전혀 없는 상태

**결정 근거**
- 1인 개발 + 빠른 수정 사이클 → PR 기반 CI는 오버엔지니어링
- Playwright e2e는 실 브라우저 + Vercel 배포 URL 필요 → CI 구성 비용 대비 ROI 낮음
- 하반기 오픈 전까지 더 가치 있는 구현 과제 우선

**향후 재검토 기준** (해당 시 GitHub Actions 추가)
- 팀원 합류로 PR 리뷰 프로세스 도입 시
- 빌드 실패 배포 사고가 반복될 시

---

## [2026-05-08] BUG-SEC — 셀러 초대 토큰 검증 구현

### 결정: POST /auth/register의 seller role에 inviteToken 필수 검증 + 트랜잭션 처리

**배경**
- `RegisterDto`에 `inviteToken` 필드 자체가 없어 누구나 `role: 'seller'`로 자유 가입 가능한 상태였음
- 관리자 초대 토큰 생성(`POST /admin/invite`) 로직은 이미 구현되어 있었으나 가입 시 검증 누락

**구현 내용**
- `register.dto.ts`: `inviteToken?: string` 추가 (`@IsOptional`)
- `auth.service.ts` register(): seller role 시 3단계 검증
  1. `inviteToken` 없음 → **403** "판매자 계정은 초대 토큰이 필요합니다"
  2. Firestore `invites/{token}` 미존재 → **403** "유효하지 않은 초대 토큰입니다"
  3. `expiresAt < Date.now()` → **410** "만료된 초대 토큰입니다"
  4. `usedAt !== null` → **409** "이미 사용된 초대 토큰입니다"
- 사용자 생성 + `invites/{token}` usedAt·usedBy 업데이트를 **단일 Firestore 트랜잭션**으로 묶음
  - 트랜잭션 내 재검증으로 동시 요청 경쟁 조건(race condition) 방지
- consumer·driver는 영향 없음 (inviteToken optional, 검증 블록 미진입)

**정합성 확인**
- 클라이언트 앱에서 `/auth/register` 직접 호출 없음 → 프론트엔드 변경 불필요
- Firestore Rules `invites` 컬렉션: catch-all `if false` → Admin SDK 서버만 접근 → Rules 변경 불필요
- `GET /auth/firebase-token` + `signInWithCustomToken()` — seller/driver 앱 모두 이미 구현 완료 확인
- Firestore Rules `orders` — 이미 `request.auth != null + storeId/role` 검증 구현 완료 확인 (1순위 기작업)

**e2e 스펙**: `apps/e2e/tests/seller-auth-invite.spec.ts` 4케이스 (배포 후 검증)

---

## [2026-05-07] 셀러앱 홈 대시보드 + 주문 배송 플로우 UX 설계 확정 (세션12 그릴)

### D1~D4 — 홈 대시보드 지표 구조

| 결정 | 내용 |
|------|------|
| 매출 기준 | 주문 접수(결제 완료) 기준 — "오늘 얼마나 바쁜가" 파악용 |
| 홈 강조 지표 | **신규(미처리) 주문 건수** 별도 강조 — 전체보다 "지금 처리할 것" 행동 유발 |
| 요약 뷰 범위 | 전체 주문 + 취소 + 재고 부족 한 화면에서 파악 |
| 홈↔목록 관계 | 홈 카드 탭 → 해당 필터된 주문 목록 딥링크 (홈은 숫자 카드만) |

### D5~D9 — 주문 상태 전환 UX

| 결정 | 내용 |
|------|------|
| 상태 전환 진입점 | 상세 페이지 진입 → 내용 확인 → "준비 시작" 버튼 (목록 빠른 전환 없음) |
| 동일 상품 집계 뷰 | "호접란 백조 3건" 집계 표시 — MVP 이후 구현 |
| 공동구매 상세 | 전체 모집 현황(총 N건, 목표 달성 여부) 표시 필수 |
| 공동구매 알림 | CONFIRMED 시 셀러 알림 — 코드 확인 완료 (`sendToStoreOwner`) |
| 공동구매 뱃지 | 주문 카드에 이미 구현됨 — 추가 작업 없음 |

**공동구매 RECRUITING→CONFIRMED 자동 처리 확인 (코드 근거)**
- 선착순: `orders-create.service.ts:128` `setImmediate(() => processGroupBuyEarlyConfirm())`
- 기한 만료: `notifications.service.ts` `@Cron(EVERY_MINUTE)` → `confirmGroupBuy()` 또는 `cancelGroupBuyLack()`
- **셀러 수동 확정 없음 — 완전 자동**

### D10~D12 — PREPARING 전환 UX

| 결정 | 내용 |
|------|------|
| preparedAt UX | **빠른 선택지** (오늘 오후 2시 / 오늘 오후 4시 / 내일 오전) — 분단위 피커 폐기 |
| 택배 MVP | 상태 전환만, 운송장 번호 입력 UI 없음 |
| 택배 API 향후 | CJ대한통운 등 택배사 API 연동 — 향후 구현 과제 등록 (규모 확장 시) |

### D13~D17 — 셀러 가입 및 온보딩

| 결정 | 내용 |
|------|------|
| 셀러 가입 방식 | 관리자가 미팅 후 초대 토큰 발급 — 자유 가입 불가 (BUG-SEC 수정과 직결) |
| 온보딩 단계 | ①사업자 프로필 → ②거점 등록 → ③상품 등록 → ④첫 주문 대기 |
| 사업자 프로필 UI | 당근비즈 벤치마킹 — MVP 이후 별도 구현 |
| 거점 등록 | G1 구현 전까지 온보딩 체크리스트에서 제외 (현재 껍데기) |
| 신규/기존 판별 | 거점 + 상품 등록 여부 조합 (`ONBOARDING | ACTIVE`) |

### 이번 세션 구현 범위 (확정)

| # | 항목 | 연결 |
|---|------|------|
| 1 | 홈 대시보드 — 지표 카드 4개 + 딥링크 | G4 |
| 2 | 주문 상세 — raw Firebase ID → 상품명 교체 | G2 |
| 3 | 주문 상세 — 공동구매 모집 현황 표시 | 신규 |
| 4 | preparedAt 빠른 선택지 UI | 신규 |
| 5 | 사업자 프로필 빈 폼 수정 | B1 |

### 제외 (MVP 이후)

- 거점 수정 페이지 G1 — 별도 세션
- 사업자 프로필 당근비즈 UI — 벤치마킹 후 설계
- 택배 API 연동 — 규모 확장 시
- 동일 상품 집계 뷰 ("백조 3건") — MVP 이후

---

## [결정 #CL-19] (SUPERSEDED by #CL-20, 2026-05-10) MVP 출시 전 이메일 로그인 코드 전면 제거 (2026-05-08)

**상태**: 세션22(2026-05-10)에 #CL-20 옵션 B 헤더 게이팅으로 대체. `E2E_TEST`/`NEXT_PUBLIC_E2E_TEST` 게이트는 production 보안 결함을 유발했고(폼 노출), 옵션 B는 폼 자체를 노출하지 않으면서 e2e 인증을 헤더 토큰으로 게이팅한다. MVP 출시 정리는 #CL-20을 따른다.

---

## [결정 #CL-20] 옵션 B — 헤더 게이팅 기반 E2E 인증 (2026-05-10, 세션22)

**배경**: `E2E_TEST=true` env 게이트는 Vercel Production env에 잘못 설정 시 일반 사용자에게 이메일 폼이 노출되는 결함이 있었다(세션19~20 부수효과). 게이트를 env 노출에서 **요청 헤더**로 옮기면 폼 자체가 노출되지 않는다.

**핵심 규칙**:

1. `apps/{seller,consumer}/src/auth.ts`의 Credentials Provider는 **상시 등록**하되 `authorize(credentials, request)`에서 `request.headers.get('x-e2e-test-token')`이 `process.env.E2E_TEST_SECRET`과 정확히 일치할 때만 통과. 그 외(헤더 부재·SECRET 미설정 포함) **즉시 null 반환**.
2. `login/page.tsx`의 `showCredentials` 플래그는 항상 false로 고정(env 미존재). 폼은 어떤 환경에서도 DOM에 렌더링되지 않는다.
3. `apps/e2e/playwright.config.ts`에 `extraHTTPHeaders`는 **의도적으로 없음**. 전역 주입 시 Firebase Identity Toolkit 등 third-party 도메인 요청에도 헤더가 따라가 CORS preflight 차단이 발생했기 때문(세션22 확인). 헤더는 `loginViaCredentials` 헬퍼 내부에서 CSRF 취득 · credentials POST 두 호출에만 명시적으로 주입한다.
4. e2e spec의 인증은 `apps/e2e/tests/_helpers/auth.ts`의 `loginViaCredentials(page, base, email, password)` 헬퍼로 통일. NextAuth `/api/auth/csrf` + `/api/auth/callback/credentials` 직접 호출. **UI 폼을 거치지 않는다.**

**로컬 개발 환경 주의사항**: `E2E_TEST=true` 설정 시 `/login` 페이지에 이메일 폼이 렌더링되지만 브라우저에서 폼을 제출하면 **항상 실패**한다. `next-auth/react`의 `signIn('credentials')`는 `x-e2e-test-token` 헤더를 주입하지 않으므로 `authorize()`가 즉시 null을 반환한다. 로컬에서 credentials 인증이 필요하면 `loginViaCredentials` 헬퍼를 e2e 스크립트로 실행하거나 카카오 로그인을 사용해야 한다. 이 동작은 의도된 트레이드오프다(폼은 시각적 잔재).
5. `E2E_TEST_SECRET`은 seller·consumer × Production·Preview·Development(총 6개) Vercel env에 동일값 + `apps/{seller,consumer}/.env.local`·`apps/e2e/.env`에 동일값. 32자(openssl rand -base64 24).

**MVP 출시 직전 정리 항목** (#CL-19 대체):

| # | 파일 | 정리 |
|---|------|------|
| 1 | `apps/{seller,consumer}/src/auth.ts` | Credentials Provider 블록 전체 제거 (Kakao만 남김) |
| 2 | `apps/{seller,consumer}/src/app/login/_form.tsx` | `showCredentials` prop·이메일 폼 분기 제거 |
| 3 | `apps/{seller,consumer}/src/app/login/page.tsx` | `showCredentials` 변수·전달 제거 |
| 4 | Vercel × 6환경 | `E2E_TEST_SECRET` 삭제 |
| 5 | `apps/{seller,consumer}/.env.local`·`apps/e2e/.env` | `E2E_TEST_SECRET` 삭제 |
| 6 | `apps/e2e/tests/_helpers/auth.ts`·`apps/e2e/playwright.config.ts` | helper·extraHTTPHeaders 제거 |
| 7 | `apps/e2e/tests/consumer-auth.spec.ts` | `skipEmailForm` 가드 + 폼 의존 테스트 3건 제거 |

**검증 시나리오** (세션22 통과 기준):
- `curl /login | grep -c 'type="email"'` = 0 (seller·consumer)
- `POST /api/auth/callback/credentials` 헤더 없이 → `Location: /login?error=CredentialsSignin&code=credentials`
- 정상 SECRET 헤더로 → `Location: <callbackUrl>` (성공)

---

## [결정 #CL-21] 옵션 A — Preview env 분리 완료 (2026-05-15, 세션26)

**의도**: 옵션 B는 production·preview에 동일 SECRET을 두므로 SECRET 유출 시 production 인증이 위험. 옵션 A는 Production env에 `E2E_TEST_SECRET` 자체를 두지 않고 Preview env에만 두어 attack surface를 줄인다.

**완료 작업** (4단계 다중 PR):
1. `preview` 브랜치 신설 → Vercel이 3개 앱의 안정적 branch Preview 배포(`{project}-git-preview-…vercel.app`) 자동 생성.
2. 21개 spec `const BASE` 하드코딩 → `process.env.SELLER_BASE/CONSUMER_BASE/DRIVER_BASE ?? fallback` 환경변수화. `apps/e2e/.env`에 Preview URL 추가.
3. `.github/workflows/e2e.yml` 신설 — `preview` 브랜치 push 시 Preview 대상 chromium e2e 실행.
4. Vercel seller·consumer Production env에서 `E2E_TEST_SECRET` 삭제 + 빈 커밋 재배포. Preview·Development만 유지.

**SSO 우회 설계 결정 (Step 3.5)**: Vercel은 Preview 배포를 Vercel Authentication(SSO)로 기본 보호 → e2e가 401을 받는다. Protection Bypass for Automation 시크릿을 3개 프로젝트에 발급(`VERCEL_AUTOMATION_BYPASS_SECRET`)해 우회. **헤더(`x-vercel-protection-bypass`)를 `extraHTTPHeaders`로 전역 주입하지 않는다** — 옵션 B `x-e2e-test-token`과 동일하게 Firebase 등 third-party 호출에 따라가 CORS preflight를 깨기 때문. 대신 `global-setup.ts`가 bypass 쿼리 파라미터로 1회 navigate → Vercel이 발급한 도메인 바인딩 `_vercel_jwt` 쿠키를 `storageState`(`apps/e2e/.bypass-state.json`, gitignore)에 저장 → 모든 spec이 재사용.

**검증 (옵션 B 4종)**: Production seller·consumer는 유효 `x-e2e-test-token` 헤더로도 `error=CredentialsSignin` 거부(세션 쿠키 미발급) — `auth.ts`의 `if (!expected) return null` fail-closed 동작. Preview seller·consumer는 정상 세션 발급. Playwright smoke: seller-orders 11/12·consumer-mypage 9/10 통과(잔여 1건씩은 #CL-23 인증 race 기존 flake).

**후속 필요**: GitHub repo Secrets 등록(`SELLER_BASE`·`CONSUMER_BASE`·`DRIVER_BASE`·`*_BYPASS_SECRET`·`E2E_TEST_SECRET`·`TEST_*`) 후에야 CI 동작. `preview` 브랜치는 `main`과 주기적 동기화 필요.

---

## [결정 #CL-22] 셀러 페이지 분할 — fatal constraint 해소 (2026-05-15, 세션23)

**배경**: CLAUDE.md §1 fatal constraint(단일 파일 500라인 한계)를 두 페이지가 위반했다.
- `apps/seller/src/app/orders/[id]/page.tsx` — 629라인
- `apps/seller/src/app/settlements/page.tsx` — 531라인

향후 UI/UX 리팩토링 진입 전, **동작 변경 없는 순수 구조 분할**로 한계를 해소했다.

**Track A — orders/[id] 분할 (629 → 217)**:
- `_lib.ts` — 유틸·상수 (`toDate`, `formatDeadlineCountdown`, `makePreparedAtOptions`, `READONLY_STATUSES`, `CANCELLABLE_STATUSES`)
- `_hooks/useOrderDetail.ts` — Firestore `onSnapshot` + `productName`·`groupConfig` 보조 fetch
- `_hooks/useOrderDetailActions.ts` — `handlePrepare`·`handleCancel` (detail 페이지 전용 시그니처)
- `_components/OrderInfoSection.tsx` — 상태 헤더 + 상품/공동구매/배송/취소사유 4 Paper
- `_components/PrepareForm.tsx` — 준비 시작 빠른 선택지 UI
- `_components/CancelOrderModal.tsx` — 취소 모달

**Track B — settlements 분할 (531 → 116)**:
- `_lib.ts` — `toKRW`, `toDateStr`, `downloadCSV`
- `_constants.ts` — 타입·`STATUS_LABEL`·`STATUS_COLOR`·`TABS`
- `_hooks/useSettlements.ts` — summary + list fetch + 자동 useEffect
- `_components/DailySummaryTab.tsx` / `PeriodTab.tsx` / `OrdersTab.tsx` / `SettlementListItem.tsx`

**기존 `useOrderActions` 훅과 통합하지 않은 이유**: detail 페이지는 모달 reason 입력 + ISO `preparedAt` + `apiFetch` 사용. 기존 훅은 `prompt()` reason + `datetime-local` 입력 + raw `fetch` 사용. 시그니처와 인증 경로 불일치로 단순 통합 시 동작 변경 위험. 향후 UI 리팩토링 사이클에서 양쪽을 한 번에 정비할 예정.

**정합성 검증**:
- `npx tsc --noEmit` 통과
- `npx next build --webpack` — TypeScript 컴파일 + tsc 통과. Prerender 단계에서 `/admin/banner`가 `auth/invalid-api-key`로 실패하나 admin/banner는 본 작업 범위 외이며 Firebase 환경변수 누락이 원인(사전 결함)
- Biome lint 실행 불가 — `biome.json:35:5`에 trailing comma 파싱 에러(사전 결함, 별도 처리 필요)
- e2e 텍스트 셀렉터("주문 상세", "상품명", "준비 시작" 등) 모두 보존

---

## [결정 #CL-23] e2e 인증 헬퍼 진단 강화 (2026-05-15, 세션24)

**배경**: 세션23 분할 리팩토링 회귀 검증을 위해 셀러 spec 3종(`seller-orders`, `seller-order-detail`, `seller-settlements`)을 chromium+mobile 2 projects로 실행한 결과, mobile 편중의 flake가 관측되었다. 페이지 스냅샷이 모두 카카오 로그인 페이지였는데, `loginViaCredentials`가 success를 반환한 직후의 케이스였다.

**진단**: `apps/e2e/tests/_helpers/auth.ts`에 set-cookie 헤더 카운트 + BrowserContext cookie jar 검증을 추가한 결과, 실패 케이스에서 `set-cookie count=0, body.url=null`이 일관되게 관측됨. NextAuth credentials POST가 200 OK + 빈 body + set-cookie 없음을 반환하는 케이스다.

**root cause 가설**: Vercel function 또는 Railway `/auth/login` 호출의 일시적 실패. 다음 정황 근거:
- mobile 단독 26/26 통과, chromium 단독 25/26 통과 (각 단독은 95~100%)
- chromium+mobile 합치면 44/52로 악화 (약 85%)
- workers=1로 직렬 실행해도 41/52 — 동시성 race 아님
- 시간에 따른 누적 효과로 추정 (rate limiting 또는 Railway cold-start)

**결정**: helper에서 명시적 throw로 가시화 (단일 시도). playwright test-level `retries: 1`이 의미 있게 동작하도록 cookie 누락을 즉시 throw한다. retry 루프를 helper에 넣으면 인증 호출 빈도가 늘어나 부하가 증가하므로 채택하지 않음(실험 검증: retry 3회 + 600ms wait → 19 fail로 악화).

**해소 보류 사유**: 분할 리팩토링과 무관한 인증 인프라 이슈이며, 본 세션의 1차 목적(세션23 회귀 검증)은 0건으로 완료되었다. 본격 해소는 다음 후속 작업에서 진행:
- `storageState` 패턴 도입 검토 — global setup에서 1회 로그인 + 모든 spec 재사용, Railway 인증 호출 N→1
- Railway `/auth/login` latency·실패율 계측
- Vercel function cold-start mitigation 검토

**helper 변경 요지**:
- credentials POST 후 `page.context().cookies(base)`에서 `authjs.session-token` 존재 검증
- 미발견 시 `set-cookie count`·`body.url`·`cookie names` 포함 throw
- retry 루프 미도입 (단일 시도, playwright 레벨 retry에 위임)

---

## [결정 #CL-25] 사전 결함 정리 및 메모리 정정 (2026-05-15, 세션25)

**배경**: 세션23·24 결과 보고서에서 "별도 처리 필요" 항목으로 분리됐던 작업 중 **e2e 무영향**인 것만 묶어 처리. e2e 영향이 큰 옵션 A 보강(#CL-21)은 별도 다단계 세션으로 보류.

**처리 항목**:
1. **biome.json:35 trailing comma 제거** — 셀러 앱 lint 실행 사각지대 해소. `npx biome check apps/seller/src` 정상 실행 확인 (55 errors는 import 정렬 등 사전 결함, 본 작업 범위 외).
2. **`.gitignore` 보강** — `.env.vercel.tmp`·`apps/*/.env.vercel.tmp` 패턴 추가로 Vercel CLI 임시 환경변수 파일의 우발 커밋 차단. `apps/seller/tsconfig.tsbuildinfo`는 `.gitignore:25` 패턴 존재에도 추적되고 있어 `git rm --cached`로 추적 해제. `apps/seller/public/sw.js`는 next-pwa 빌드 산출물이지만 Vercel 정적 서빙 보장 목적으로 의도적 추적 유지(.gitignore 주석 명시).
3. **메모리 정정** — `project_status.md`의 "driver app 옵션 B 헤더 게이팅 적용" 항목 제거. 검증 결과 `apps/driver/src/auth.ts`에 Credentials provider 자체가 없으므로(Kakao OAuth 전용) 게이팅 대상 부재.

**옵션 A 보강(#CL-21) 별도 처리 사유**: 현재 21개 spec의 `BASE`가 Production 도메인 하드코딩 상태. Production env에서 `E2E_TEST_SECRET`을 단순 제거하면 e2e 인증 전체가 깨짐. ① Preview alias 확보 → ② spec BASE 환경변수화 → ③ CI를 alias 대상으로 → ④ Production env 제거 4단계 다중 PR이 필요하므로 단일 세션 부적합.

**검증**:
- `git check-ignore -v` — 3개 패턴 모두 매치 확인
- `git status` — `.env.vercel.tmp` 미추적 확인
- `Grep "Credentials" apps/driver/src/` — 0 매치 재확인


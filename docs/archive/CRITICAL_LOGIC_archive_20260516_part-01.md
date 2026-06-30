# Critical Logic archive 20260516 part 01

> 원본: $Path에서 2026-06-29 문서 정리 시 분리.

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

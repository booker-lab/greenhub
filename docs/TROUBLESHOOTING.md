# Green Hub — 트러블슈팅 이력

> 프로덕션에서 실제로 발생한 문제와 해결책을 기록합니다.
> 다음 작업 시 같은 문제가 반복되지 않도록 패턴과 체크포인트를 함께 기록합니다.

---

## [2026-04-04] Firestore `get` vs `list` 권한 구분

### 증상
소비자 앱 홈 화면에 상품이 표시되지 않음. 콘솔에 `Missing or insufficient permissions`.

### 원인
Firestore 보안 규칙에서 `allow get: if true` 만 허용된 경우, **단일 문서 조회(`getDoc`)는 통과**하지만
**컬렉션 쿼리(`getDocs(query(...))`)는 `list` 권한**이 필요하여 차단됨.

```
// 차단됨
getDocs(query(collection(db, 'products'), where('storeId', '==', ...)))

// 통과됨
getDoc(doc(db, 'products', productId))
```

### 해결
- **소비자 앱**: Firestore 직접 쿼리 → **`GET /stores/:storeId/products` API 호출**로 전환 (설계 의도 복원)
- **셀러 앱**: `onSnapshot` 실시간 리스너도 `list` 권한 필요 → `firestore.rules`에서 products를 `allow read: if true`로 수정 후 `firebase deploy --only firestore:rules` 재배포

### 다음 작업 시 체크포인트
- 새 컬렉션 추가 시 `get`/`list`를 의도적으로 구분하여 규칙 작성
- 소비자 앱에서 Firestore 직접 쿼리를 쓰면 안 됨 — **항상 NestJS API를 통해 조회**

---

## [2026-04-04] API 페이지네이션 응답 형식 — 배열이 아닌 객체 반환

### 증상
상품 API 호출 성공(200)이지만 화면에 상품 0개. 에러 없음.

### 원인
NestJS API가 `{ items: Product[], total: number }` 형식으로 반환하는데, 클라이언트에서 응답 전체를 배열로 가정하여 처리함.

```ts
// 잘못된 처리
const items = await res.json() // → { items: [...], total: 1 }
setProducts(items)             // → setProducts(object) → length 없음

// 올바른 처리
const data = await res.json()
const items = Array.isArray(data) ? data : (data.items ?? [])
```

### 다음 작업 시 체크포인트
- `GET /stores/:storeId/products`, `GET /stores/:storeId/orders`, `GET /stores/:storeId/hubs` 등
  **목록 API는 모두 `{ items, total }` 페이지네이션 형식**으로 반환됨
- 새로운 API 연동 시 응답 타입을 반드시 확인 후 언래핑 처리할 것

---

## [2026-04-04] Vercel 환경변수 `NEXTAUTH_URL` URL 오타

### 증상
셀러 앱 로그인 시 404 또는 리다이렉트 무한루프.

### 원인
Vercel 환경변수에 `NEXTAUTH_URL=https://greenhubseller.vercel.app`으로 입력되어 있었으나
실제 배포 도메인은 `https://greenhub-seller.vercel.app` (하이픈 포함).

### 해결
```bash
npx vercel env rm NEXTAUTH_URL production
npx vercel env add NEXTAUTH_URL   # https://greenhub-seller.vercel.app 입력
npx vercel --prod                 # 재배포
```

### 다음 작업 시 체크포인트
- URL 변경 시 반드시 `URLS.md` 먼저 업데이트 → Vercel 환경변수 → Railway CORS_ORIGIN → 카카오 리다이렉트 URI 순서로 동기화
- **`URLS.md`가 SSOT**: 문서와 실제 환경변수가 다를 경우 문서 기준으로 수정

---

## [2026-04-04] Railway `CORS_ORIGIN` 복수 도메인 설정

### 증상
특정 프론트엔드 앱에서만 API 호출 시 CORS 오류.

### 원인
Railway 환경변수 `CORS_ORIGIN`에 허용할 도메인을 하나만 입력하거나, 신규 앱 추가 후 갱신하지 않음.

### 해결
Railway 대시보드 → 해당 서비스 → Variables → `CORS_ORIGIN` 값을 **쉼표 구분 문자열**로 설정:
```
https://greenhubconsumer.vercel.app,https://greenhub-seller.vercel.app,https://greenhub-driver.vercel.app
```
변경 후 자동 재배포됨.

### 다음 작업 시 체크포인트
- 새 앱(Vercel 배포)을 추가할 때마다 Railway `CORS_ORIGIN`에 URL 추가 필수
- `URLS.md` 체크리스트 항목으로 관리 중

---

## [2026-04-04] `@Roles` 데코레이터 — admin이 seller 기능에 접근 불가

### 증상
`admin` 역할 계정으로 상품 등록 시 `403 Forbidden resource`.

### 원인
NestJS `ProductsController`의 모든 엔드포인트에 `@Roles('seller')`만 지정되어 있어
`role: 'admin'`인 계정은 접근 불가.

### 해결
```ts
// 변경 전
@Roles('seller')
// 변경 후
@Roles('seller', 'admin')
```
`ProductsController`, `DailyCapsController`, `DeliveryConfigController` 전체 7개 데코레이터 수정.

### 다음 작업 시 체크포인트
- **admin은 seller 기능을 포함한 모든 기능에 접근 가능**해야 함
- 새로운 seller 전용 엔드포인트를 추가할 때 `@Roles('seller', 'admin')`으로 작성

---

## [2026-04-04] Firestore 문서 `ownerId` 불일치 — seed 데이터와 실제 계정 sub 다름

### 증상
셀러 앱에서 상품 등록 시 `403 권한이 없습니다` (API에서 store.ownerId !== user.sub 체크).

### 원인
`stores/dear-orchid` 문서의 `ownerId`가 시드 데이터 값(`test-seller-001`)으로 고정되어 있어,
실제 로그인한 계정의 JWT sub와 불일치.

### 해결 (Firebase Admin SDK 로컬 스크립트)
```ts
import * as admin from 'firebase-admin'
const db = admin.firestore()
await db.doc('stores/dear-orchid').update({
  ownerId: 'eaa96b06-60f6-4a03-a1af-bea3ad6604c6' // seller2@test.com의 sub
})
```

### 다음 작업 시 체크포인트
- 시드 데이터와 실제 계정의 ID가 다를 수 있음 — API에서 403이 나오면 Firestore 문서의 ownerId를 먼저 확인
- 현재 `dear-orchid.ownerId = eaa96b06-60f6-4a03-a1af-bea3ad6604c6` (seller2@test.com)

---

## [2026-04-04] Refresh Token — 기존 세션 재로그인 필수

### 증상
Refresh token 구현 배포 후에도 1시간 뒤 API 401이 발생할 수 있음.

### 원인
기존 세션 쿠키(`authjs.session-token`)에는 `refreshToken`과 `accessTokenExpires` 필드가 없음.
NextAuth jwt 콜백에서 `token.accessTokenExpires`가 `undefined`이면 갱신 로직이 동작하지 않음.

### 해결
배포 후 **모든 앱에서 1회 로그아웃 → 재로그인** 필요.
재로그인 이후 새 세션 쿠키에 `refreshToken`·`accessTokenExpires`가 포함되어 자동 갱신 동작.

### 다음 작업 시 체크포인트
- NextAuth jwt 콜백 필드 구조를 변경하는 경우 (필드 추가·삭제) 기존 세션이 구 구조를 가지므로
  **배포 후 강제 재로그인을 안내하거나 세션 버전 필드(`sessionVersion`)로 무효화 처리**
- `JWT_REFRESH_SECRET` Railway 환경변수가 설정되어 있어야 refresh endpoint가 동작함

---

## [2026-04-04] NextAuth v5 — Kakao PKCE 콜백 도메인 불일치

### 증상
카카오 로그인 후 `PKCE 검증 실패` 또는 세션이 생성되지 않음.

### 원인
NextAuth v5의 Kakao Provider는 PKCE를 사용함. 로그인 시작 도메인과 콜백 도메인이 달라야 PKCE 코드가 유효.
Vercel **프리뷰 URL**(`*.vercel.app/...`) 에서 로그인을 시작하면 프로덕션 콜백 URL과 도메인이 달라서 실패.

### 해결
- 반드시 **프로덕션 도메인**(`greenhub-driver.vercel.app`)에서 로그인 시작
- 카카오 개발자 콘솔 → 플랫폼 → 사이트 도메인에 프로덕션 URL만 등록
- `NEXTAUTH_URL`이 프로덕션 도메인을 정확히 가리키는지 확인

### 다음 작업 시 체크포인트
- 카카오 OAuth가 있는 앱(consumer, driver)은 Vercel 프리뷰 배포로 로그인 테스트 불가
- 반드시 프로덕션 배포 후 `URLS.md` 기재 URL에서 테스트

---

## [2026-04-04] pnpm lockfile specifier 불일치

### 증상
`pnpm install` 실패: `ERR_PNPM_LOCKFILE_BREAKING_CHANGE` 또는 specifier 불일치 오류.

### 원인
`package.json`에 `"@mantine/core": "^9"` 로 작성했으나 lockfile에는 `"^9.0.0"` 으로 기록된 경우
(또는 반대). pnpm은 specifier 문자열이 완전히 일치해야 lockfile을 재사용함.

### 해결
```bash
pnpm install --no-frozen-lockfile
```
또는 `package.json`의 specifier를 lockfile과 정확히 일치시킨 후 `pnpm install`.

### 다음 작업 시 체크포인트
- Mantine 패키지 specifier는 `"^9.0.0"` 형식으로 통일 (`"^9"` 사용 금지)
- 새 패키지 추가 후 lockfile 충돌 시 `--no-frozen-lockfile` 로 재생성

---

## [2026-04-04] orders FSM 403 — admin role이 consumer로 fallback

### 증상
seller 앱에서 "준비 시작" 클릭 시 `403: ACCEPTED → PREPARING 전환은 허용되지 않습니다`.

### 원인
`getAllowedTransitions(role, status)` 함수가 `role === 'seller'` 또는 `'driver'`만 처리하고, `'admin'`은 `CONSUMER_TRANSITIONS`로 fallback됨. 동시에 `updateStatus` 서비스가 JWT의 role 대신 Firestore를 재조회해서 role을 가져오는 구조라 조회 실패 시 `'consumer'`가 기본값.

### 해결
1. `orders.helpers.ts` — `if (role === 'seller' || role === 'admin')` 로 변경
2. `orders.service.ts` — `updateStatus`에 `requesterRole?: string` 파라미터 추가, JWT role 우선 사용
3. `orders.controller.ts` — `user.role`을 `updateStatus`에 전달

### 다음 작업 시 체크포인트
- **새 엔드포인트 추가 시**: `@Roles('seller', 'admin')`과 `getAllowedTransitions` admin 분기를 짝으로 맞출 것
- FSM 역할 분기: seller/admin → SELLER_TRANSITIONS, driver → DRIVER_TRANSITIONS, 나머지 → CONSUMER_TRANSITIONS

---

## [2026-04-04] orders 생성 시 driver 앱 필요 필드 누락

### 증상
driver 앱 주문 상세에서 상품명·배송지·구매자명이 모두 "-" 표시.

### 원인
`createOrder`에서 Firestore orders 문서에 `productName`, `buyerName`, `address` 필드를 저장하지 않음. driver 앱은 Firestore 실시간 리스너로 이 필드를 직접 읽음.

### 해결
`orders.service.ts` `t.set(...)` 블록에 아래 필드 추가:
```ts
productName: productData['name'] as string,
buyerName,
address: dto.deliveryAddress.address,
```
driver `board/[orderId]/page.tsx` — `address` 없을 시 `deliveryAddress.address` fallback 추가.

### 다음 작업 시 체크포인트
- 기존 주문(수정 전 생성)은 소급 적용 안 됨 — 신규 주문부터 표시
- driver 앱에서 새 필드 추가 시 항상 orders 문서에 denormalize 저장 패턴 유지

---

## [2026-04-04] Consumer 프로필 이름 "???" 표시

### 증상
Consumer 마이페이지 프로필에 이름이 "???"로 표시됨.

### 원인
Firestore 테스트 유저 문서의 `name` 필드가 `'???'` placeholder로 저장되어 있고, auth.ts session 콜백이 이 값을 그대로 `session.user.name`에 저장.

### 해결
`consumer/src/auth.ts` session 콜백에 fallback 로직 추가:
```ts
const rawName = token.name as string | undefined;
session.user.name = rawName && rawName !== '???' ? rawName : (session.user.email?.split('@')[0] ?? '사용자');
```

### 다음 작업 시 체크포인트
- 신규 유저 등록 시 name 필드 필수화 또는 UI에서 email 앞부분 기본값 제공 검토
- seller·driver 앱도 동일 패턴 적용 필요 시 각 auth.ts session 콜백에 추가

# StoreId 마이그레이션 계획
## `dear-orchid` → UUID 전환 + 다중판매자 구조 완성

**작성일**: 2026-04-11  
**목적**: Firestore 데이터 및 프론트엔드 코드에서 `dear-orchid` 하드코딩을 제거하고,  
API가 설계한 UUID 기반 다중판매자 구조와 완전히 일치시킨다.

---

## 배경

### 왜 이 문제가 생겼나
- 2026-03-28 Phase A 구현 시 `scripts/seed-test-data.mjs`로 Firestore에 테스트 데이터를 직접 심을 때 `storeId: 'dear-orchid'` slug를 사용
- consumer 앱이 이 seed 데이터 기준으로 만들어져서 `STORE_ID = 'dear-orchid'` 하드코딩
- API `stores.service.ts`는 처음부터 UUID 방식으로 올바르게 설계됐지만, Firestore 실제 데이터와 프론트 코드는 slug로 굳어진 상태

### 현재 상태
| 위치 | 상태 |
|------|------|
| API 백엔드 | ✅ UUID 기반, 다중판매자 완전 지원 |
| Firestore 데이터 | ❌ `storeId: 'dear-orchid'` (products, orders, deliveryFeeConfig, dailyCaps) |
| consumer 앱 | ❌ `STORE_ID = 'dear-orchid'` 하드코딩 6곳 |
| driver 앱 | ❌ `STORE_ID = 'dear-orchid'` 하드코딩 1곳 |
| seller 앱 | ❌ admin 폴백 `'dear-orchid'` 1곳 |

### 핵심 정보
- **seller 계정 UUID**: `eaa96b06-60f6-4a03-a1af-bea3ad6604c6` (dear-orchid ownerId)
- **Firestore 컬렉션**: `products`, `orders`, `payments`, `settlements`, `deliveryFeeConfig`, `dailyCaps`

---

## 전체 작업 단계

---

## STEP 1 — Firestore 마이그레이션 스크립트 실행

### 목표
Firestore의 모든 `storeId: 'dear-orchid'` 데이터를 `storeId: 'eaa96b06-60f6-4a03-a1af-bea3ad6604c6'`로 변경.  
동시에 `stores/dear-orchid` 문서를 `stores/{UUID}` 문서로 이전.

### 실행 방법
`scripts/migrate-storeId.mjs` 스크립트를 작성 후 실행:

```bash
cd /c/Develop/greenhub
node scripts/migrate-storeId.mjs
```

### 스크립트 내용 (`scripts/migrate-storeId.mjs`)

```js
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'

const OLD_STORE_ID = 'dear-orchid'
const NEW_STORE_ID = 'eaa96b06-60f6-4a03-a1af-bea3ad6604c6'

const serviceAccount = JSON.parse(readFileSync('./firebase-adminsdk.json', 'utf8'))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// 컬렉션별 storeId 필드 일괄 변경
const COLLECTIONS_WITH_STOREID = ['products', 'orders', 'payments', 'settlements', 'deliveryFeeConfig', 'dailyCaps']

async function migrateCollection(colName) {
  const snap = await db.collection(colName).where('storeId', '==', OLD_STORE_ID).get()
  if (snap.empty) { console.log(`  ${colName}: 0건 (스킵)`); return }
  const batch = db.batch()
  snap.docs.forEach(d => batch.update(d.ref, { storeId: NEW_STORE_ID }))
  await batch.commit()
  console.log(`  ✅ ${colName}: ${snap.docs.length}건 변경`)
}

// dailyCaps는 문서 ID가 `dear-orchid_YYYY-MM-DD` 형식 → 문서 자체를 재생성
async function migrateDailyCaps() {
  const snap = await db.collection('dailyCaps').where('storeId', '==', OLD_STORE_ID).get()
  if (snap.empty) { console.log(`  dailyCaps: 0건 (스킵)`); return }
  const batch = db.batch()
  snap.docs.forEach(d => {
    const newId = d.id.replace(OLD_STORE_ID, NEW_STORE_ID)
    batch.set(db.doc(`dailyCaps/${newId}`), { ...d.data(), storeId: NEW_STORE_ID })
    batch.delete(d.ref)
  })
  await batch.commit()
  console.log(`  ✅ dailyCaps: ${snap.docs.length}건 재생성`)
}

// deliveryFeeConfig 문서 ID도 storeId가 KEY → 재생성
async function migrateDeliveryFeeConfig() {
  const snap = await db.doc(`deliveryFeeConfig/${OLD_STORE_ID}`).get()
  if (!snap.exists) { console.log(`  deliveryFeeConfig: 없음 (스킵)`); return }
  await db.doc(`deliveryFeeConfig/${NEW_STORE_ID}`).set({ ...snap.data(), storeId: NEW_STORE_ID })
  await db.doc(`deliveryFeeConfig/${OLD_STORE_ID}`).delete()
  console.log(`  ✅ deliveryFeeConfig: 이전 완료`)
}

// stores/dear-orchid 문서 → stores/{UUID}로 이전
async function migrateStoreDoc() {
  const snap = await db.doc(`stores/${OLD_STORE_ID}`).get()
  if (snap.exists) {
    await db.doc(`stores/${NEW_STORE_ID}`).set({ ...snap.data(), id: NEW_STORE_ID })
    await db.doc(`stores/${OLD_STORE_ID}`).delete()
    console.log(`  ✅ stores: dear-orchid → ${NEW_STORE_ID}`)
  } else {
    console.log(`  stores/${OLD_STORE_ID}: 없음 — stores/${NEW_STORE_ID} 확인 필요`)
  }
}

async function main() {
  console.log('🚀 storeId 마이그레이션 시작\n')
  for (const col of ['products', 'orders', 'payments', 'settlements']) {
    await migrateCollection(col)
  }
  await migrateDailyCaps()
  await migrateDeliveryFeeConfig()
  await migrateStoreDoc()
  console.log('\n✅ 마이그레이션 완료')
}
main().catch(console.error)
```

### 검증
```bash
# Firebase Console에서 확인하거나:
node -e "
  import('./scripts/migrate-storeId.mjs') // 재실행 시 0건이면 완료
"
```

---

## STEP 2 — consumer 앱: `STORE_ID` 하드코딩 제거

### 목표
`STORE_ID = 'dear-orchid'` 6곳 제거. storeId를 상품/주문 데이터에서 읽어서 사용.

### 2-1. `useProducts.ts`
```
변경 전: GET /stores/dear-orchid/products
변경 후: GET /products (전체 활성 상품 — storeId 파라미터 없음)
```
→ **API에 `GET /products` 전체 조회 엔드포인트 추가 필요** (STEP 4)  
→ 응답 상품 데이터에 `storeId` 포함됨

### 2-2. `useProducts.ts` — Firestore 직접 조회 방식
```typescript
// 변경 전
const q = query(collection(db, 'products'), where('storeId', '==', 'dear-orchid'), ...)

// 변경 후 (storeId 필터 제거)
const q = query(collection(db, 'products'), where('isActive', '==', true), ...)
```

### 2-3. `products/[id]/page.tsx`
```typescript
// 변경 전
const STORE_ID = 'dear-orchid'
storeId: STORE_ID  // checkout 데이터에 하드코딩

// 변경 후
// product 데이터에서 꺼냄
storeId: product.storeId
```

### 2-4. `checkout/page.tsx`
```typescript
// 변경 전
const STORE_ID = 'dear-orchid'
fetch(`/stores/${STORE_ID}/products/${productId}`)
fetch(`/stores/${STORE_ID}/orders`, ...)

// 변경 후
// product.storeId를 state로 유지하여 사용
const storeId = product?.storeId  // API 응답에서
fetch(`/stores/${storeId}/orders`, ...)
```

### 2-5. `useOrders.ts`
```typescript
// 변경 전: GET /stores/dear-orchid/orders?userId=...
// 변경 후: GET /orders?userId=... (storeId 없는 전체 조회)
```
→ **API에 `GET /orders` 유저별 전체 조회 엔드포인트 추가 필요** (STEP 4)

### 2-6. `useOrderStatus.ts`
```typescript
// 변경 전: GET /stores/dear-orchid/orders/{id}
// 변경 후: GET /orders/{id} (storeId 없는 단건 조회)
```
→ **API에 `GET /orders/:orderId` 엔드포인트 추가 필요** (STEP 4)

### 2-7. `mypage/orders/[id]/_client.tsx`
```typescript
// 변경 전: PATCH /stores/dear-orchid/orders/{id}/review
// 변경 후: order.storeId 사용
fetch(`/stores/${order.storeId}/orders/${orderId}/review`, ...)
```

---

## STEP 3 — driver 앱: `STORE_ID` 하드코딩 제거

### 파일: `apps/driver/src/app/board/[orderId]/photo/page.tsx`

```typescript
// 변경 전
const STORE_ID = "dear-orchid"
`/stores/${STORE_ID}/orders/${orderId}/status`

// 변경 후
// 주문 데이터를 먼저 조회하거나, URL 파라미터/state에서 storeId를 받아 사용
// board 페이지에서 orderId로 주문 상세 조회 시 storeId가 응답에 포함됨
const order = await fetchOrder(orderId)  // GET /orders/:orderId
`/stores/${order.storeId}/orders/${orderId}/status`
```

---

## STEP 4 — API: consumer/driver용 storeId-free 엔드포인트 추가

consumer와 driver는 storeId를 모르므로 아래 3개 엔드포인트 추가 필요.

### 4-1. `GET /products` — 전체 활성 상품 조회 (consumer 홈/카테고리)
```typescript
// products.controller.ts에 추가
@Get()
getPublicProducts(@Query() query: ProductQueryDto) {
  return this.productsService.getPublicProducts(query)
}
```
```typescript
// products.service.ts에 추가
async getPublicProducts(query: ProductQueryDto) {
  // storeId 필터 없이 isActive: true 상품 전체 조회
}
```

### 4-2. `GET /orders/:orderId` — 단건 조회 (consumer 주문 상태, driver 주문 확인)
```typescript
@Get(':orderId')
getOrderById(@Param('orderId') orderId: string, @CurrentUser() user: JwtPayload) {
  return this.ordersService.getOrderById(orderId, user.sub)
}
```

### 4-3. `GET /orders?userId=` — 유저별 전체 주문 조회 (consumer 마이페이지)
```typescript
@Get()
getMyOrders(@CurrentUser() user: JwtPayload, @Query('userId') userId?: string) {
  return this.ordersService.getMyOrders(user.sub)
}
```

---

## STEP 5 — seller 앱: admin 폴백 `dear-orchid` 제거

### 파일: `apps/seller/src/app/orders/page.tsx`
```typescript
// 변경 전
const storeId = session?.user.storeId ?? (session?.user.role === 'admin' ? 'dear-orchid' : null)

// 변경 후
// admin은 storeId 없이 admin API를 사용하므로 폴백 불필요
const storeId = session?.user.storeId ?? null
// (admin은 이미 /admin/orders 별도 경로 존재)
```

---

## STEP 6 — 배포 및 검증

### 순서
1. `node scripts/migrate-storeId.mjs` 실행 → Firestore 데이터 확인
2. API 변경 → Railway 배포
3. consumer 앱 변경 → Vercel 배포
4. driver 앱 변경 → Vercel 배포
5. seller 앱 변경 → Vercel 배포

### E2E 검증 체크리스트
- [ ] consumer: 상품 목록 정상 표시
- [ ] consumer: 상품 클릭 → 상세 → 결제 storeId 올바르게 전달
- [ ] consumer: 마이페이지 주문 내역 표시
- [ ] seller: 상품 관리 → 상품 목록 표시 (UUID storeId로 조회)
- [ ] seller: 주문 관리 → 주문 표시
- [ ] seller: 정산 페이지 표시
- [ ] driver: 주문 상태 변경 (HUB_ARRIVED 등)

---

## 주의사항

1. **마이그레이션 전 Firestore 백업** 권장 — Firebase Console → Firestore → 내보내기
2. **배포 순서**: API 먼저 → 프론트 순서로 (API 엔드포인트가 먼저 있어야 프론트가 동작)
3. **`dailyCaps` 문서 ID** — `{storeId}_{date}` 형식이므로 단순 필드 변경이 아닌 문서 재생성 필요
4. **`deliveryFeeConfig` 문서 ID** — `{storeId}` 자체가 문서 ID이므로 문서 재생성 필요
5. `orders.service.ts` 현재 499줄 → STEP 4 추가 시 분리 완료 상태이므로 `orders-query.service.ts`에 추가

---

## 완료 기준

- [ ] Firestore에 `dear-orchid` 문자열 0건
- [ ] 프론트 코드에 `dear-orchid` 문자열 0건
- [ ] seller 로그인 시 본인 스토어 상품/주문/정산만 표시
- [ ] consumer 상품 목록 → 결제 → seller 주문 확인 E2E 통과

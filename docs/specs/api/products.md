<!-- Language: ko -->

# Products API / Domain Spec

> **최종 정합화**: 2026-08-23
> **상태**: Current
> **공통 타입 정본**: `packages/shared/src/product.types.ts`
> **API 정본**: `apps/api/src/products/**`
> **회차 상품 계약**: `docs/specs/mvp-sales-round-direct-delivery.md`

## 1. 범위

`products` 도메인은 legacy 상품 카탈로그, legacy 공동구매 설정, 배송비 설정, 날짜별 legacy 배송 한도를 관리한다.

회차 직배송에서는 원본 `products`를 그대로 주문 계약으로 사용하지 않고 `saleRoundItems`의 회차 가격·수량·상품 snapshot을 추가로 사용한다. 회차 상품 의미는 회차 직배송 spec을 우선한다.

`storeId`는 실제 Firestore 문서 식별자다. 과거 설계 예시의 `'dear-orchid'` 같은 사람이 읽기 쉬운 문자열을 현재 운영 store ID로 가정하지 않는다.

## 2. 현재 Product 공통 타입

```ts
export type Category = 'cut_flower' | 'orchid' | 'foliage'
export type DeliverySize = 'small' | 'medium' | 'large'
export type SaleType = 'normal' | 'group'

export interface Product {
  id: string
  storeId: string
  name: string
  images: string[]
  price: number
  category: Category
  saleType: SaleType
  deliverySize: DeliverySize
  isActive: boolean
  testOnly?: boolean
  createdAt: string
  updatedAt: string

  varietyId?: string
  selection?: Selection
  sellerNote?: string
  content?: GeneratedContent
  sellerOverride?: boolean

  // migration compatibility
  description?: string
  colors?: ColorOption[]

  groupSummary?: {
    currentQuantity: number
    minQuantity: number
    targetQuantity: number
    recruitDeadline: string
  }
}
```

신규 상품은 `selection`/`content` 계열 필드를 지원하며, `description`/`colors`는 구 데이터 호환 필드다. 새 UI나 API를 설계할 때 과거 `description + colors`만 있는 schema를 정본으로 삼지 않는다.

## 3. 선택 정보와 색상

현재 `Selection`:

```ts
interface Selection {
  colors: ColorOption[]
  stemType: '외대' | '쌍대' | '가지' | '3대'
  fragrance: 'none' | 'light' | 'strong'
  bloomCondition: 'bud' | 'half' | 'full'
  bundleUnit: string
  careLevel?: 'easy' | 'normal' | 'hard'
}
```

색상 필터는 신규 `selection.colors`를 우선하고 구버전 `colors`를 fallback으로 읽는다.

현재 `ColorOption`은 초기 13색보다 확장돼 있으며 정확한 union은 `packages/shared/src/product.types.ts`를 사용한다.

## 4. Legacy 공동구매 설정

`groupProductConfig/{productId}`는 `saleType: 'group'` legacy 상품의 추가 설정이다.

공통 공개 계약:

```ts
interface GroupProductConfig {
  productId: string
  minQuantity: number
  targetQuantity: number
  maxPerPerson: number
  recruitDeadline: string
  currentQuantity: number
  groupDeliveryDate: string
  groupDeliveryMethod: 'direct' | 'parcel'
  deliveryFeeDiscount: number
}
```

서버 내부 문서에는 `isProcessed` 같은 scheduler용 필드가 추가로 존재할 수 있다. 공개 타입과 Firestore 내부 문서를 동일시하지 않는다.

상품 생성에서 `saleType === 'group'`이고 `groupConfig`가 제공되면 별도 `groupProductConfig/{productId}`가 생성된다.

## 5. 상품 생성 입력

현재 `CreateProductDto`의 핵심 필드:

```ts
{
  name: string
  images: string[]
  price: number
  category: 'cut_flower' | 'orchid' | 'foliage'
  saleType: 'normal' | 'group'
  deliverySize: 'small' | 'medium' | 'large'
  isActive?: boolean

  varietyId?: string
  selection?: Selection
  sellerNote?: string
  content?: {
    headline: string
    description: string
    isEditedByUser: boolean
  }
  sellerOverride?: boolean
  groupConfig?: GroupConfig
}
```

과거 spec의 필수 `description`·`colors` 입력은 현재 `CreateProductDto` 계약이 아니다.

## 6. 상품 API

### Store-scoped 조회

```text
GET /stores/:storeId/products
GET /stores/:storeId/products/:productId
```

현재 store-scoped GET에는 controller-level JWT guard가 없다. 기본 목록은 `isActive !== false`이면 활성 상품만 조회한다.

query:

```text
category?: cut_flower | orchid | foliage
colors?: string | string[]
saleType?: normal | group
sort?: latest | popular | price_asc | price_desc
isActive?: boolean
```

주의:

- `popular`은 DTO 허용값이지만 현재 service에는 별도 인기 정렬 구현이 없고 기본 최신순 분기로 수렴한다.
- 색상은 Firestore `array-contains-any`가 아니라 조회 결과에서 `selection.colors ?? colors`를 기준으로 서버 메모리 필터링한다.
- 목록 응답은 `{ items, total }`이다.
- 목록 이미지 배열은 현재 첫 이미지만 담아 경량화한다.

### Public storeId-free 조회

```text
GET /products
GET /products/:productId
```

public 목록/상세는 `isActive === true` 상품만 노출하며 `testOnly === true` 상품을 제외한다.

이 경로는 다중 store 상품을 함께 반환할 수 있으므로 public summary에 `storeId`가 포함될 수 있다.

### Seller/Admin 쓰기

```text
POST   /stores/:storeId/products
PATCH  /stores/:storeId/products/:productId
PATCH  /stores/:storeId/products/:productId/active
DELETE /stores/:storeId/products/:productId
```

- `JwtAuthGuard + RolesGuard`
- role: `seller | admin`
- seller는 `stores/{storeId}.ownerId === user.sub` 검사를 통과해야 한다.
- admin은 이 seller ownership 검사에서 예외다.

현재 `DELETE`는 product 문서를 물리 삭제한다. 연결된 주문·회차·공동구매 참조의 장기 보존 의미를 바꾸려면 별도 설계가 필요하며, 운영에서 단순 정리 용도로 임의 삭제하지 않는다.

## 7. Delivery fee config

경로:

```text
GET   /stores/:storeId/delivery-config
PATCH /stores/:storeId/delivery-config
```

현재 공개 타입:

```ts
interface DeliveryFeeConfig {
  storeId: string
  directFee: number
  hubFee: number
  parcelFee: number
  freeThresholdDirect: number
  freeThresholdHub: number
  freeThresholdParcel: number
  weatherRestrictionActive: boolean
  updatedAt: string
}
```

문서가 없으면 service가 현재 다음 fallback 값을 반환한다.

```text
directFee              3000
hubFee                 1000
parcelFee              4000
freeThresholdDirect   50000
freeThresholdHub      30000
freeThresholdParcel   50000
weatherRestrictionActive false
```

이 fallback은 코드 기본값이지 특정 운영 store의 현재 설정값이라는 뜻은 아니다.

PATCH는 seller/admin 보호 경로이며 seller ownership을 검증한다.

## 8. Legacy Daily Cap

경로:

```text
GET   /stores/:storeId/daily-caps?from=YYYY-MM-DD&to=YYYY-MM-DD
PATCH /stores/:storeId/daily-caps/:date
```

seller/admin만 사용하며 seller ownership을 검증한다.

현재 GET의 날짜 미지정 기본값은 서버 UTC 기준 오늘 날짜 문자열이다. 회차 직배송의 배송지/상품 한도는 `saleRounds`/`saleRoundItems`/`checkoutReservations` 계약을 사용하므로 legacy `dailyCaps`와 혼동하지 않는다.

## 9. 배송비 계산

legacy 주문의 기본 계산 helper는 현재 orders domain에 있다.

- size extra: `small 0`, `medium 1000`, `large 3000`
- method base fee와 무료 threshold는 `deliveryFeeConfig` 사용
- 주문 금액이 해당 method 무료 threshold 이상이면 배송비 0
- 아니면 base + size extra

공동구매/회차 주문은 각 해당 domain의 추가 규칙이 있으므로 위 helper만으로 모든 결제 배송비를 재계산하지 않는다.

## 10. 회차 직배송과의 경계

회차 직배송에서는 다음 원칙이 중요하다.

- 원본 product 가격 변경이 이미 생성된 회차 가격·주문 snapshot을 소급 변경하지 않는다.
- 공개 회차 상품은 `saleRoundItems`의 회차 가격과 상품 snapshot을 사용한다.
- `Store.salesMode === 'round_direct'`의 consumer 진입 규칙은 회차 직배송 spec이 소유한다.
- legacy `saleType: group`, `dailyCaps`, `deliveryFeeConfig`를 회차 한도/가격 계약으로 대체 사용하지 않는다.

## 11. 검증 원칙

상품 계약 변경 시 최소 확인:

- `packages/shared/src/product.types.ts`
- `apps/api/src/products/dto/create-product.dto.ts`
- `apps/api/src/products/dto/product-query.dto.ts`
- `apps/api/src/products/products.controller.ts`
- `apps/api/src/products/products.service.ts`
- 관련 unit/E2E
- 회차 노출이면 `docs/specs/mvp-sales-round-direct-delivery.md`

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-23 | AI selection/content 필드, public API, 실제 색상 필터·정렬, ownership, legacy/회차 경계에 맞춰 전면 정합화 |
| 2026-04-23 | legacy 공동구매 수량 기반 계약 반영 |
| 2026-03-26 | 초기 products 설계 초안 |

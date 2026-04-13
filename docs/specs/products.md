# Products Domain Spec

> **작성일**: 2026-03-26
> **상태**: Draft (4단계 개발 선행 문서)
> **연관 문서**: `orders.md`, `1단계 요구사항 정의.md`, `2단계 IA.md`, `배송 관련 추가 검토사항.md`

---

## 1. 도메인 개요

`products` 도메인은 상품 카탈로그·공동구매 설정·배송비 설정·판매자 정보를 포함한다.
**판매자 앱**에서 등록·수정하고, **소비자 앱**에서 탐색·필터링한다.

MVP는 단일 판매자(`storeId: 'dear-orchid'`) 고정.
**처음부터 `storeId` 구조를 설계해두어** 다중 판매자 전환 시 스키마 수정 불필요.

---

## 2. Firestore 컬렉션 스키마

### `stores/{storeId}`

```ts
{
  id: string               // MVP: 'dear-orchid'
  name: string             // '디어 오키드'
  ownerId: string          // 판매자 계정 ID (NextAuth userId)

  // 판매자 앱 온보딩 시 추가 입력 (판매자 설계 1단계 §3 참조)
  businessNumber: string | null  // 사업자 등록번호
  ceoName: string | null         // 대표자명
  phone: string | null           // 대표 연락처
  address: string | null         // 소재지
  logoUrl: string | null         // Firebase Storage URL

  // 판매자 계정 상태 (오늘 결정: 2026-03-28 CRITICAL_LOGIC.md 참조)
  status: 'invited'             // 초대 토큰 발급됨, 가입 전 (A안)
        | 'pending_approval'    // 판매자 자체 신청, 승인 대기 (B안 전환 시)
        | 'active'              // 정상 운영 중
        | 'rejected'            // 거절됨
        | 'suspended'           // 운영 정지

  // 정산 설정 (MVP: 0 — 수수료 없음, Phase2에서 판매자별 요율 설정)
  commissionRate: number         // 0.0 ~ 1.0

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

---

### `products/{productId}`

```ts
{
  id: string
  storeId: string          // stores 참조

  // 기본 정보
  name: string
  description: string
  images: string[]         // Cloud Storage URL 배열

  // 가격 (실시간 시세 반영 — 판매자가 수동 갱신)
  price: number

  // 분류
  category: 'cut_flower' | 'orchid' | 'foliage'
                           // 절화 | 난 | 관엽
  colors: ColorOption[]    // 멀티 선택, 하단 참조

  // 판매 방식
  saleType: 'normal' | 'group'

  // 배송비 계산용 사이즈
  deliverySize: 'small' | 'medium' | 'large'

  // 활성 여부
  isActive: boolean

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**ColorOption 허용값**
```
'레드' | '핑크' | '화이트' | '옐로우' | '오렌지' | '퍼플'
| '블루' | '그린' | '무늬' | '브라운' | '베이지' | '블랙' | '그레이'
```

---

### `groupProductConfig/{productId}` (공동구매 전용, `saleType: 'group'` 1:1)

```ts
{
  productId: string            // products 참조

  // 모집 설정
  minParticipants: number      // 최소 모집 인원
  maxParticipants: number      // 최대 모집 인원 (= 공동구매 슬롯 한도)
  recruitDeadline: Timestamp   // 모집 마감일 (판매자 설정)
  currentParticipants: number  // Firestore 실시간 집계
  isProcessed: boolean         // 마감 기한 자동 취소 처리 완료 여부 (중복 스케줄러 방지)

  // 배송 설정 (소비자 변경 불가)
  groupDeliveryDate: Timestamp // 배송 예정일 (판매자 지정)
  groupDeliveryMethod: 'direct' | 'parcel'
                               // 서울/경기: direct 또는 parcel / 기타: parcel 고정

  // 배송비
  deliveryFeeDiscount: number  // 할인 배송비 (0이면 무료 배송)
}
```

---

### `deliveryFeeConfig/{storeId}` (판매자 앱에서 전역 관리)

```ts
{
  storeId: string

  // 기본 배송비 (MVP 임시 단가)
  directFee: number            // 꽃차 직배송: 3,000원
  hubFee: number               // 거점 픽업: 1,000원
  parcelFee: number            // 택배: 4,000원

  // 무료 배송 임계치
  freeThresholdDirect: number  // 50,000원
  freeThresholdHub: number     // 30,000원
  freeThresholdParcel: number  // 50,000원

  // 기상 제한 (판매자 수동 제어)
  weatherRestrictionActive: boolean
                               // true 시 소비자 결제 화면 택배 옵션 자동 비활성

  updatedAt: Timestamp
}
```

---

### `dailyCaps/{storeId_date}` (orders 도메인과 공유)

> 정의는 `orders.md` 섹션 3 참조. 상품 등록 시 판매자 앱에서 날짜별 설정.

---

## 3. 배송비 계산 규칙

배송비는 **배송 수단 × 품목 사이즈** 조합으로 결제 화면에서 자동 계산된다.

### 배송 수단별 기본 배송비

| 수단 | 코드 | 기본 배송비 | 무료 기준 |
|------|------|------------|----------|
| 꽃차 직배송 | `direct` | 3,000원 | 50,000원↑ |
| 거점 픽업 | `hub` | 1,000원 | 30,000원↑ |
| 택배 | `parcel` | 4,000원 | 50,000원↑ |

### 품목 사이즈 추가 배송비

| 사이즈 | 코드 | 추가 배송비 | 예시 품목 |
|--------|------|-----------|---------|
| 소형 | `small` | +0원 | 꽃다발, 소형 화분 |
| 중형 | `medium` | +1,000원 | 꽃바구니, 중형 화분 |
| 대형 | `large` | +3,000원↑ | 화환, 대형 식물 |

**계산식**
```
최종 배송비 = max(0, 기본 배송비 + 사이즈 추가 배송비 - 무료 기준 적용)
공동구매 배송비 = deliveryFeeDiscount (판매자 설정값 그대로 사용)
```

---

## 4. 배송 수단 분기 규칙

```
isMetropolitan = true (서울/경기):
  일반 판매 → direct | hub | parcel 모두 선택 가능
  공동구매  → groupDeliveryMethod (판매자 지정, 소비자 선택 불가)

isMetropolitan = false (기타 지역):
  일반 판매 → parcel 만 표시
  공동구매  → parcel 고정

기상 제한 (weatherRestrictionActive = true):
  parcel 자동 비활성화
  안내 문구: "현재 기온 조건으로 인해 택배 배송이 일시 중단되었습니다"
  direct 는 항온 설비로 기상 무관 정상 운영
```

---

## 5. API 엔드포인트

> **기본 경로**: `/stores/:storeId/products`

### 상품 목록 조회

```
GET /stores/:storeId/products
```

| 쿼리 파라미터 | 타입 | 설명 |
|------------|------|------|
| `category` | `cut_flower \| orchid \| foliage` | 카테고리 필터 |
| `colors` | `string[]` | 색상 멀티 필터 (AND → 해당 색상 포함 상품) |
| `saleType` | `normal \| group` | 판매 방식 필터 |
| `sort` | `latest \| popular \| price_asc \| price_desc` | 정렬 (기본: `latest`) |
| `isActive` | `boolean` | 기본 `true` |

**Response** `200`
```ts
{
  items: ProductSummary[]  // 카드 표시용 (상세 필드 제외)
  total: number
}
```

**ProductSummary** (목록 카드용 경량 타입)
```ts
{
  id: string
  name: string
  price: number
  images: string[]         // 첫 번째 이미지만
  category: Category
  colors: ColorOption[]
  saleType: SaleType
  isActive: boolean
  // 공동구매 전용 (saleType: 'group')
  groupSummary?: {
    currentParticipants: number
    minParticipants: number
    maxParticipants: number
    recruitDeadline: string  // ISO8601
  }
}
```

---

### 상품 상세 조회

```
GET /stores/:storeId/products/:productId
```

**Response** `200` — `products` 전체 필드
공동구매 상품인 경우 `groupProductConfig` 병합하여 반환.

```ts
{
  ...Product,
  groupConfig?: GroupProductConfig  // saleType: 'group' 일 때만
}
```

---

### 상품 등록 (판매자 전용)

```
POST /stores/:storeId/products
```

**Request Body**
```ts
{
  name: string
  description: string
  images: string[]
  price: number
  category: Category
  colors: ColorOption[]
  saleType: SaleType
  deliverySize: DeliverySize

  // 공동구매 전용
  groupConfig?: {
    minParticipants: number
    maxParticipants: number
    recruitDeadline: string      // ISO8601
    groupDeliveryDate: string    // ISO8601
    groupDeliveryMethod: 'direct' | 'parcel'
    deliveryFeeDiscount: number
  }
}
```

**Response** `201` `{ productId: string }`

---

### 상품 수정 (판매자 전용)

```
PATCH /stores/:storeId/products/:productId
```

Request Body — 위 등록 필드 중 변경할 항목만 포함 (Partial).

---

### 상품 활성/비활성 (판매자 전용)

```
PATCH /stores/:storeId/products/:productId/active
```

```ts
{ isActive: boolean }
```

---

### 배송비 설정 조회·수정 (판매자 전용)

```
GET  /stores/:storeId/delivery-config
PATCH /stores/:storeId/delivery-config
```

PATCH Body — `deliveryFeeConfig` 전체 필드 중 변경할 항목만.

---

### Daily Cap 조회·설정 (판매자 전용)

```
GET   /stores/:storeId/daily-caps?from=YYYY-MM-DD&to=YYYY-MM-DD
PATCH /stores/:storeId/daily-caps/:date
```

PATCH Body
```ts
{ totalCap: number }
```

---

## 6. 카테고리·색상 필터 로직

소비자 앱 카테고리 화면에서 **탭 필터(단일) × 색상 필터(멀티) AND 조합**으로 동작.

```
예시: 카테고리 = '절화', 색상 = ['레드', '핑크']

쿼리 조건:
  category == 'cut_flower'
  AND colors array-contains-any ['레드', '핑크']

→ 레드 또는 핑크 색상을 하나라도 포함한 절화 상품 반환
```

> Firestore `array-contains-any`는 최대 10개 값 지원 — 13개 색상 중 한 번에 최대 10개 조합 가능.
> 10개 초과 선택이 필요한 경우 클라이언트에서 두 번 쿼리 후 합산. (MVP에서는 실질적으로 발생 안 함)

---

## 7. packages/shared 공통 타입

> **Timestamp 직렬화 규칙**: Firestore 스키마의 `Timestamp` 필드는 shared 타입에서 `string (ISO8601)`으로 표현합니다.

```ts
// packages/shared/src/product.types.ts

export type Category = 'cut_flower' | 'orchid' | 'foliage'

export type ColorOption =
  | '레드' | '핑크' | '화이트' | '옐로우' | '오렌지' | '퍼플'
  | '블루' | '그린' | '무늬' | '브라운' | '베이지' | '블랙' | '그레이'

export type DeliverySize = 'small' | 'medium' | 'large'

// SaleType, DeliveryMethod 는 order.types.ts 에서 단일 정의 → 여기서 re-export
export type { SaleType, DeliveryMethod } from './order.types.js'

export interface GroupProductConfig {
  productId: string
  minParticipants: number
  maxParticipants: number
  recruitDeadline: string   // ISO8601
  currentParticipants: number
  groupDeliveryDate: string   // ISO8601
  groupDeliveryMethod: 'direct' | 'parcel'
  deliveryFeeDiscount: number
}

export interface Product {
  id: string
  storeId: string
  name: string
  description: string
  images: string[]
  price: number
  category: Category
  colors: ColorOption[]
  saleType: SaleType
  deliverySize: DeliverySize
  isActive: boolean
  createdAt: string   // ISO8601
  updatedAt: string   // ISO8601
}

export interface ProductSummary {
  id: string
  name: string
  price: number
  images: string[]
  category: Category
  colors: ColorOption[]
  saleType: SaleType
  isActive: boolean
  groupSummary?: {
    currentParticipants: number
    minParticipants: number
    maxParticipants: number
    recruitDeadline: string   // ISO8601
  }
}

export interface DeliveryFeeConfig {
  storeId: string
  directFee: number
  hubFee: number
  parcelFee: number
  freeThresholdDirect: number
  freeThresholdHub: number
  freeThresholdParcel: number
  weatherRestrictionActive: boolean
  updatedAt: string   // ISO8601
}
```

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-03-26 | 초안 작성 — 1·2단계 설계 + 배송 검토사항 기반 통합 |

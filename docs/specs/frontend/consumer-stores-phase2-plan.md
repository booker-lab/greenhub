# 소비자 다중 판매자 상점 페이지 1차 계획

> 작업 ID: `CONSUMER-STORES-PHASE2`
> 기준일: 2026-06-04

## 목적

소비자 앱에서 단일 판매자 상품 목록만 보이던 구조에 공개 상점 탐색 진입점을 추가한다. 1차 범위는 운영 데이터 쓰기 없이 active 상점 목록과 상점별 판매 상품을 읽는 경험으로 제한한다.

## 결정

- 기존 `GET /stores/:storeId`는 판매자 온보딩이 사업자번호까지 조회하는 인증 API이므로 공개 전환하지 않는다.
- 소비자 공개 조회는 `/public/stores`와 `/public/stores/:storeId`로 분리한다.
- 공개 상점 응답은 `id`, `name`, `address`, `logoUrl`, `productCount`, `hubCount`와 상세의 `phone`까지만 포함한다.
- 공개 상세의 상품 목록은 active 상품의 카드 표시용 `ProductSummary`만 반환한다.
- 홈 하드코딩 `STORE_ID` 제거는 장바구니·결제 흐름 영향이 커서 후속 SDD로 분리한다.

## API 계약

### `GET /public/stores`

```ts
{
  items: PublicStoreSummary[]
  total: number
}
```

### `GET /public/stores/:storeId`

```ts
{
  store: PublicStoreDetail
  products: ProductSummary[]
}
```

## UI 범위

- `/stores`: 상점 목록 카드, 로고, 주소, 상품 수, 거점 수.
- `/stores/[storeId]`: 상점 프로필과 판매 상품 그리드.
- 기존 홈·카테고리·상품 상세·장바구니 플로우는 변경하지 않는다.

## Phase 2-S2 홈 탐색 연결

- 하단 내비게이션에 `/stores` 진입점을 추가한다.
- 홈에는 active 상점 최대 3개를 읽기 전용 미리보기로 노출하고, 전체 목록은 `/stores`로 연결한다.
- 홈 미리보기는 공개 `/public/stores` 응답만 사용하며, 상점·상품·주문 데이터를 쓰지 않는다.
- 상품 카드, 상품 상세, 장바구니, 결제의 `storeId` 계약은 변경하지 않는다.

## Phase 2-S3 상점 상세 상품 진입 맥락

- `/stores/[storeId]`의 상품 카드는 기존 `/products/[id]` 상세로 이동하되 `fromStore`와 `storeName` 쿼리만 추가한다.
- 상품 상세는 `fromStore`가 있을 때 상단 뒤로가기 대상만 `/stores/[storeId]`로 고정한다.
- 장바구니, 바로구매, 결제, 상품 API의 `storeId` 계약은 변경하지 않는다.
- 일반 홈·카테고리·검색 상품 카드는 기존 `/products/[id]` 링크를 유지한다.

## Phase 2-S4 홈 고정 상점 ID 제거 감사

- 소비자 코드에는 더 이상 `STORE_ID = 'dear-orchid'` 또는 `dear-orchid` 문자열이 남아 있지 않다.
- 홈 상품 목록은 공개 `/products?isActive=true` 응답의 각 상품 `storeId`를 그대로 사용한다.
- 상품 상세의 장바구니 담기는 `CartItem.storeId = product.storeId`를 저장하고, 장바구니 결제는 각 item의 `storeId`로 주문 API를 호출한다.
- 바로구매 결제는 URL 쿼리의 상점 ID를 신뢰하지 않고 `/products/:id` 응답의 `product.storeId`를 주문 API 경로로 사용한다.
- 상품 로딩 전 또는 `storeId`가 없는 비정상 상품에서는 결제 버튼을 비활성화해 `/stores//orders` 요청을 차단한다.

## Phase 2-S5 장바구니 주문 무결성

- 상품 상세 CTA의 `장바구니`와 `바로 결제`는 같은 구매 가능 조건을 따른다.
- `storeId`가 없거나, 일반 상품의 직접 배송/거점 픽업에 배송 날짜가 없으면 장바구니 담기와 결제를 모두 비활성화한다.
- 과거에 저장된 잘못된 장바구니 항목은 결제 화면에서 다시 검증해 주문 API 호출을 차단한다.
- 장바구니 결제가 모두 성공하면 임시 `checkout_cart`와 실제 `greenhub_cart`를 함께 비워 완료 후 같은 상품이 남지 않게 한다.

## 검증

- API stores 단위 테스트에 공개 목록·상세·비활성 상세 404를 추가한다.
- API·consumer 타입체크와 빌드를 통과한다.
- 변경 파일 Biome과 `git diff --check`를 통과한다.
## Phase 2-S6 상품 상세 상점 진입 보강

- 상품 상세 하단의 판매자 정보는 비공개 Firestore 직접 조회 대신 공개 `/public/stores/:storeId` 응답을 재사용한다.
- 판매자 정보 블록은 `storeId`가 있을 때 `/stores/:storeId`로 이동하는 링크가 되며, 상품 상세의 장바구니·바로구매 `storeId` 계약은 변경하지 않는다.
- 공개 응답에 없는 `ceoName`·사업자번호 등 판매자 내부 정보는 소비자 상품 상세에 새로 노출하지 않는다.
- 상점 정보 조회가 실패해도 구매 CTA는 기존 상품 응답의 `storeId`와 배송 조건만 따른다.
## Phase 2-S7 fixture 회귀

- `/stores`와 `/stores/:storeId`는 운영 데이터 없이 브라우저 네트워크 mock으로 공개 `/public/stores` 계약을 검증한다.
- 상점 상세 상품 카드는 `/products/:id?fromStore=&storeName=` 링크를 유지해야 한다.
- 상품 상세의 상점 복귀와 판매자 정보 링크는 `ENABLE_E2E_FIXTURES=true` 전용 fixture에서 검증한다.
- fixture 상품은 택배 배송 방식을 초기값으로 사용해 배송일 Firestore 구독을 피하고, 구매 가능 조건과 `storeId` 계약만 확인한다.

## Phase 2-S8 상점 탐색 체감 개선

- 상점 목록은 공개 `/public/stores` 응답만 사용해 상점명·주소 검색, 상품 수순, 거점 수순, 가나다순 정렬을 제공한다.
- 홈 상점 미리보기와 상점 목록은 같은 상점 카드 표현 컴포넌트를 사용해 로고, 주소, 상품 수, 거점 수 표시 규칙을 공유한다.
- 공개 상점 조회 훅은 상품 조회 훅에서 분리해 상점 탐색 책임을 `useStores` 계층으로 격리한다.
- 검색 결과가 없을 때는 전체 빈 상태와 구분되는 안내를 표시하고, 입력 초기화 동작을 제공한다.
- API 계약은 변경하지 않으며, 공개 응답 필드 안에서만 기능을 확장한다.

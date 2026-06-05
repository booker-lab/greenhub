# 관리자 주문 정식 상세 SDD

> 작업 ID: `ADMIN-ORDERS-F3-FULL`
> 작성일: 2026-06-03

## 1. 문제

`/admin/orders`의 기존 상세 모달은 목록 응답에 들어 있는 denormalized 필드만 펼친다. 운영 CS에는 결제 기록, 판매자·구매자 기본 정보, 상품 라인, 상태 타임라인을 한 화면에서 대조하는 읽기 전용 상세가 필요하다.

## 2. 결정

- `GET /admin/orders/:orderId` 읽기 전용 API를 추가한다.
- 응답은 `order`, `store`, `buyer`, `payment`, `items`, `timeline`으로 나눈다.
- `items`는 현재 주문 스키마가 단일 상품 주문이므로 `productId/productName/quantity/totalAmount` 기반 단일 라인으로 만든다.
- `timeline`은 별도 상태 이력 컬렉션을 추정하지 않고 현재 주문 문서에 있는 `createdAt`, `preparedAt`, `updatedAt`, `cancelReason`, `status`만으로 관측 가능한 이벤트를 구성한다.
- 기존 목록 상세 모달은 유지하고, 모달과 목록 액션에서 정식 상세 라우트 `/admin/orders/[id]`로 이동할 수 있게 한다.

## 3. 제외

- 송장번호 사후 수정
- 상태 변경 이력 컬렉션 신설
- 결제 환불 재처리 또는 상태 변경 쓰기
- 다중 상품 라인 스키마 변경
- 총 건수·임의 페이지 번호 같은 고급 페이지네이션

## 4. 구현

- API: `admin-orders.helpers.ts`에 기존 목록 조회와 신규 상세 조회를 둔다.
- API Controller: `GET /admin/orders/:orderId`를 `refund` 라우트보다 앞에 둔다.
- Seller: `useAdminOrderDetail(orderId)` 훅과 `/admin/orders/[id]` 읽기 전용 화면을 추가한다.
- UI: 기존 `OrderDetailModal`에 정식 상세 링크를 추가한다.

## 5. 검증

- API 단위 테스트로 상세 응답의 store/buyer/payment/items/timeline 조립과 404를 확인한다.
- seller 타입체크, api 타입체크, api/seller 빌드, 변경 파일 Biome을 실행한다.
- 수정 파일은 500라인 미만을 유지한다.

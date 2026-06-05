# 어드민 주문 송장번호 사후 정정 계획

> 백로그: `ADMIN-ORDERS-A2`
> 결정 로그: `#CL-96`
> 범위: 어드민 주문 정식 상세에서 이미 저장된 택배 송장을 운영자가 읽기 전용에서 정정 가능하게 만든다.

## 결정

- 어드민은 `/admin/orders/[id]` 정식 상세에서 택배 주문의 `courierCompany`와 `trackingNumber`를 수정할 수 있다.
- 이 동선은 새 발송 처리 기능이 아니라 **사후 정정**이다. `PREPARING` 상태처럼 아직 송장이 없는 주문은 기존 셀러 발송 플로우를 사용한다.
- 허용 조건은 `deliveryMethod === 'parcel'` 이고, 기존 송장 필드가 있거나 상태가 `DELIVERING`, `HUB_ARRIVED`, `PICKED_UP`, `DELIVERED`, `REVIEWED` 중 하나인 주문이다.
- 값 검증은 셀러 발송 플로우와 맞춘다. 택배사는 공백 제거 후 1자 이상, 운송장번호는 공백 제거 후 3자 이상이어야 한다.
- API는 `PATCH /admin/orders/:orderId/tracking` 으로 둔다. 변경 시 `trackingUpdatedAt`, `trackingUpdatedBy`, `updatedAt`을 함께 기록한다.

## 제외

- 송장을 새로 생성해 발송 상태로 전환하는 기능
- 분할 발송과 다중 송장
- 택배사별 자릿수 검증
- 배송조회 링크와 택배사 API 연동
- 별도 감사 로그 컬렉션 신설

## 검증

- API 단위 테스트: 정상 정정, 비택배 차단, 미발송 무송장 주문 차단, 운송장번호 길이 검증.
- UI 타입체크와 빌드.
- E2E fixture: 정식 상세에서 송장 정정 후 새 값이 표시되고 PATCH 본문이 전달되는지 확인.

# Seller Validation Data Cleanup

> 작성일: 2026-06-09
> 상태: Active
> 관련 영역: seller verification, Firestore operations

## 목적

셀러앱 대규모 검증 전에 특정 스토어에 남아 있는 테스트 상품, 주문, 결제, 정산 데이터를 제거해 수동 재등록 검증을 깨끗한 상태에서 시작한다.

## 범위

- 대상은 명시된 `storeId` 하나로 한정한다.
- 기본 정리 대상은 `products`, `orders`, `payments`, `settlements`이다.
- `groupProductConfig`는 삭제 대상 상품 ID와 동일한 문서가 있을 때 함께 삭제한다.
- `dailyCaps`는 기본 보존한다. 배송 가능일 검증까지 초기화해야 할 때만 별도 옵션으로 삭제한다.
- `stores`, `users`, `deliveryFeeConfig`, `refreshTokens`, `auditLogs`는 삭제하지 않는다.

## 운영 규칙

- 스크립트는 기본 dry-run으로 실행되어 삭제 예정 건수와 샘플만 출력한다.
- 실제 삭제는 `--apply`를 명시한 경우에만 수행한다.
- 실제 삭제 전에는 `scripts/backup-firestore.mjs`로 백업을 남긴다.
- 작업 후 `scripts/inspect-store-data.mjs` 또는 동등한 조회로 잔여 데이터를 확인한다.

## 현재 검증 후보

- `80189070-2c3d-45f2-bc11-68a870b13951` (`난플렉스`): 상품 1건, 주문 8건, 결제 21건, 정산 5건.
- `9b2cb652-ff77-46b9-a773-e1efa78fb763` (`테스트 상점`): 상품 2건, 주문 5건, 결제 0건, 정산 1건.
- `test-store-001` (`테스트 꽃 농장`): 상품 1건, 주문 0건, 결제 0건, 정산 0건.

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

## 소비자 W11 주소 문자열 정리 계약

소비자 홈 상점 미리보기와 `/stores` 목록에서 보이는 깨진 주소 문자열은 프론트 렌더링 결함이 아니라 운영 Firestore 원본 `stores/{storeId}.address` 데이터 정리 대상으로 다룬다.

- 대상은 육안검증 또는 dry-run 조회로 식별한 `stores/{storeId}.address` 필드만 허용한다.
- `StoreCard`, `/stores/[storeId]` 상세, 공개 상점 API 응답에서 임의 치환이나 mojibake 추정 복원 fallback을 추가하지 않는다.
- 실제 보정 전에는 현재 문서 값, 정상 주소 후보, 요청자 승인, 백업 파일 경로를 한 기록에 묶어 남긴다.
- `scripts/ops/repair-mojibake-data.mjs`의 기존 원칙처럼 기본 dry-run, hardcoded allowlist, `--apply` 명시, 최소 필드 업데이트만 허용한다. 주소 보정이 필요하면 별도 옵션 또는 별도 스크립트로 `address` 필드만 확장하고, 기존 `name` 보정 대상과 섞지 않는다.
- 관리자 화면에서 수동 수정하는 경우에도 수정 전 백업과 수정 후 공개 소비자 화면 재확인을 같은 완료 증거로 남긴다.
- 이번 W11 문서 작업에서는 운영 쓰기를 수행하지 않는다. 백업·dry-run·명시적 승인 없이는 `--apply`를 실행하지 않는다.

### 주소 정리 절차

1. 운영 소비자 `/`, `/stores`에서 깨진 주소가 보이는 카드의 상점명과 가능한 `storeId`를 기록한다.
2. Firestore 읽기 전용 조회 또는 공개 `/public/stores` 응답으로 원본 `address` 값이 깨져 있는지 확인한다.
3. 정상 주소 후보가 운영자가 확인한 값인지 검증한다. 화면 표시만 보고 추정한 주소는 사용하지 않는다.
4. `scripts/backup-firestore.mjs` 또는 동일 범위 백업으로 현재 `stores/{storeId}` 문서를 보존한다.
5. dry-run에서 대상 문서, 현재 주소, 정상 주소 후보, 깨짐 의심 여부를 출력한다.
6. 운영자 승인 후에만 `--apply`로 `address` 필드 하나를 보정한다.
7. 보정 후 `/`, `/stores`, `/stores/{storeId}`에서 주소 표시와 콘솔 오류 여부를 재확인한다.

## 현재 검증 후보

- `80189070-2c3d-45f2-bc11-68a870b13951` (`난플렉스`): 상품 1건, 주문 8건, 결제 21건, 정산 5건.
- `9b2cb652-ff77-46b9-a773-e1efa78fb763` (`테스트 상점`): 상품 2건, 주문 5건, 결제 0건, 정산 1건.
- `test-store-001` (`테스트 꽃 농장`): 상품 1건, 주문 0건, 결제 0건, 정산 0건.

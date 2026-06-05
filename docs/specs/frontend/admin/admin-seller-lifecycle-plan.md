# 어드민 판매자 lifecycle SDD

## 배경

`ADMIN-INVITE-SELLER-ROLLBACK` 1차는 스토어가 연결된 판매자를 `store_exists`로 차단했다. 그러나 스토어가 생성됐더라도 주문·정산 기록이 아직 없으면 계정 정지와 스토어 보존 아카이브만으로 잘못 가입한 판매자를 되돌릴 수 있다.

## 결정

- 초대 rollback 대상 판매자가 `storeId`를 갖더라도 해당 스토어의 주문·정산 기록이 모두 0건이면 rollback을 허용한다.
- 성공 시 `users/{usedBy}.suspended = true`, `refreshTokens/{usedBy}` 삭제, `invites/{token}.sellerRollbackAt/sellerRollbackBy` 기록을 유지한다.
- 연결된 `stores/{storeId}`는 삭제하지 않고 `status = 'archived'`, `archivedAt`, `archivedBy`, `archiveReason = 'invite_seller_rollback'`으로 보존 아카이브한다.
- 주문 또는 정산 기록이 하나라도 있으면 409 `store_has_records`로 차단한다.
- `storeId`는 있으나 스토어 문서가 없으면 409 `store_not_found`로 차단한다.

## 제외

- 주문·정산 기록이 있는 판매자의 강제 정리.
- 스토어 삭제, 주문·정산 이력 변경, 초대 토큰 재활성화.
- 별도 판매자 lifecycle 화면 신설.

## 검증

- API 단위 테스트: 스토어가 있고 기록이 없으면 판매자 정지, refresh token 삭제, 초대 rollback 감사 필드, 스토어 archive 필드를 기록한다.
- API 단위 테스트: 주문 기록이 있으면 `store_has_records`로 차단하고 쓰지 않는다.
- 어드민 초대 E2E fixture: `store_has_records` reason 안내 문구를 검증한다.

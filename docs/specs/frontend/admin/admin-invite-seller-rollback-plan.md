# 어드민 초대 가입 판매자 되돌리기 SDD

## 배경

`ADMIN-INVITE-SELLER-ROLLBACK`은 사용된 초대 토큰을 단순히 취소하는 문제가 아니다. 이미 생성된 판매자 계정, 스토어 온보딩, refresh token, 감사 이력이 함께 걸린다. 따라서 1차 범위는 운영자가 잘못 사용된 초대 토큰을 즉시 차단할 수 있는 최소 안전 경계로 제한한다.

## 결정

- 사용된 초대 토큰의 `usedBy`가 판매자 계정이고, 해당 사용자에 `storeId`가 아직 없을 때만 rollback을 허용한다.
- rollback은 삭제가 아니라 `users/{usedBy}.suspended = true` 전환, `refreshTokens/{usedBy}` 삭제, `invites/{token}.sellerRollbackAt/sellerRollbackBy` 기록으로 처리한다.
- 이미 스토어가 연결된 판매자는 스토어 정리·주문·정산·감사 로그 정책이 필요하므로 409 `store_exists`로 차단한다.
- 사용 전, 이미 rollback 완료, 판매자 아님, 연결 사용자 누락 상태는 409 reason으로 명시한다.

## 제외

- 판매자 계정 삭제, 스토어 삭제·아카이브, 주문·정산 이력 변경, 초대 토큰 재활성화.
- 스토어가 있는 판매자의 되돌리기 정책. 이는 `ADMIN-SELLER-LIFECYCLE` 후속 SDD로 분리한다.

## 검증

- API 단위 테스트: 성공 시 사용자 정지, refresh token 삭제, 초대 rollback 감사 필드 기록.
- API 단위 테스트: `not_used`, `already_rolled_back`, `not_seller`, `store_exists` reason 차단.
- 어드민 초대 E2E fixture: 사용됨 토큰에만 rollback 버튼 노출, 성공 후 `되돌림` 상태 표시, store 연결 reason 안내.

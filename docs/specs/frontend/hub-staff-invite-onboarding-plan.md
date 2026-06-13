# Hub Staff Invite and Onboarding SDD

## 9. 2026-06-05 기존 스태프 추가 거점 배정 SDD

### 결정

판매자 소유자는 새 초대 링크를 만들지 않고도 같은 스토어의 기존 `hub_staff` 계정을 현재 거점에 추가 배정할 수 있다. 후보 목록은 현재 거점에 이미 배정되지 않았고, 같은 `storeId`를 가지며, 정지되지 않은 `hub_staff`로 제한한다.

### 계약

- 후보 API: `GET /stores/:storeId/hubs/:hubId/staff-candidates`
- 배정 API: `POST /stores/:storeId/hubs/:hubId/staff`
- 배정 요청: `{ staffId: string }`
- 후보 응답: `{ staff: Array<{ id, name, email, hubIds }> }`
- 배정은 `hubs/{hubId}.staffIds`에 `staffId`를 추가하고, `users/{staffId}.hubIds`에 `hubId`를 병합한다.
- 기존 `hubId`는 하위 호환을 위해 첫 번째 배정 거점으로 유지한다.
- 정지 계정, 다른 스토어 계정, 이미 현재 거점에 배정된 계정은 후보에서 제외하거나 배정을 차단한다.

### 검증

- [x] 판매자 소유자만 후보 조회와 배정을 수행한다.
- [x] 후보 목록은 같은 스토어의 미배정 `hub_staff`만 반환한다.
- [x] 배정 후 현재 스태프 목록에 계정이 나타나고 후보 목록에서는 사라진다.

## 10. 2026-06-05 스태프 초대 링크 운영 관리 SDD

### 결정

판매자 소유자는 거점별로 발급된 `hubStaffInvites` 목록을 조회하고, 아직 사용되지 않았으며 취소되지 않은 초대만 취소할 수 있다. 초대 문서는 감사 추적을 위해 삭제하지 않고 `revokedAt`·`revokedBy`를 기록한다.

### 계약

- 목록 API: `GET /stores/:storeId/hubs/:hubId/staff-invites`
- 취소 API: `DELETE /stores/:storeId/hubs/:hubId/staff-invites/:token`
- 목록 응답: `{ invites: Array<{ token, inviteUrl, expiresAt, createdAt, usedAt, revokedAt }> }`
- 목록은 같은 `storeId`·`hubId`의 최근 초대를 `createdAt desc` 기준으로 반환한다.
- 이미 사용된 초대와 이미 취소된 초대는 취소할 수 없고 409를 반환한다.
- 만료된 초대도 감사 상태를 보존하기 위해 별도 취소 쓰기를 하지 않고 409를 반환한다.
- 취소는 문서 삭제가 아니라 `revokedAt`, `revokedBy`, `updatedAt` 병합 업데이트로 처리한다.

### 검증

- [x] 판매자 소유자만 초대 목록을 조회하고 취소할 수 있다.
- [x] 목록은 해당 거점 초대만 반환한다.
- [x] 사용됨·취소됨·만료 초대 취소는 409로 차단한다.
- [x] 정상 취소는 `revokedAt`·`revokedBy`를 기록한다.

## 11. 2026-06-05 hub_staff 현장 픽업 확인 동선 노출 SDD

### 결정

거점 상세의 `HUB_ARRIVED` 주문 목록에서 픽업 확인 화면으로 가는 동선을 카드 전체 클릭에만 의존하지 않고, 명시적인 `픽업 확인` CTA로 노출한다. 주문번호와 픽업 코드도 카드 안에 함께 표시해 현장 스태프가 고객이 제시한 코드와 대상 주문을 바로 대조할 수 있게 한다.

### 계약

- 대상 화면: seller `/hubs/[id]`
- 대상 주문: 기존 API가 반환하는 `HUB_ARRIVED` 주문 목록
- 이동 경로: `/hubs/[id]/pickup?orderId={orderId}`
- 상태 변경 API와 권한 검증은 기존 `PATCH /stores/:storeId/orders/:orderId/hub-confirm` 계약을 그대로 사용한다.
- 판매자 소유자와 `hub_staff` 모두 같은 거점 상세 화면에서 명시 CTA를 볼 수 있다.

### 검증

- [x] 주문 카드에 주문번호 또는 내부 ID가 표시된다.
- [x] 픽업 코드가 있을 때 카드에 표시된다.
- [x] `픽업 확인` 버튼이 기존 픽업 화면으로 이동한다.
- [x] API 권한·상태 전이 로직은 변경하지 않는다.

> 작성: 2026-06-05
> 범위: 거점 스태프 초대 링크 발급 UI와 전용 온보딩 계약 1차

## 1. 문제

`hub_staff` 역할과 `hubs.staffIds` 읽기 권한 토대는 마련됐지만, 판매자가 거점별 스태프를 안전하게 초대하고 가입 사용자를 해당 거점에 배정하는 흐름이 없다. 기존 `admin/invite`는 판매자 가입 전용이라 거점 스태프 초대와 섞으면 판매자 rollback·스토어 lifecycle 정책이 오염된다.

## 2. 결정

거점 스태프 초대는 `hubStaffInvites/{token}` 컬렉션으로 분리한다. 판매자 소유자는 거점 상세에서 만료 기간을 선택해 초대 링크를 발급하고, 가입 소비 시 `users.role='hub_staff'`, `users.storeId`, `users.hubId`를 저장하며 같은 트랜잭션에서 `hubs/{hubId}.staffIds`에 `userId`를 추가한다.

## 3. 계약

- 발급 API: `POST /stores/:storeId/hubs/:hubId/staff-invite`
- 요청: `{ expiresInDays?: 3 | 7 | 14 | 30 }`, 기본값 7일, 허용 범위 1~30일
- 응답: `{ token, inviteUrl, expiresAt }`
- 초대 문서: `token`, `storeId`, `hubId`, `createdBy`, `usedAt`, `usedBy`, `expiresAt`, `createdAt`
- 가입 API: 기존 `POST /auth/register`가 `role='hub_staff'`와 `inviteToken`을 받는다.
- 가입 성공 시 사용자는 `storeId`와 `hubId`를 가진 `hub_staff`가 되고, 세션 JWT에는 `storeId`가 포함된다.
- `hub_staff`는 `/onboarding`으로 강제 이동하지 않고 `/hubs`로 진입한다.

## 4. 제외

- 스태프 초대 목록·취소·재발급 관리
- 거점 스태프의 주문 상태 변경 권한 확대
- 운영 데이터 backfill

## 5. 검증

- 소유자가 아닌 사용자는 거점 스태프 초대를 발급할 수 없다.
- 만료·사용·존재하지 않는 스태프 초대 토큰은 가입을 차단한다.
- 정상 가입은 `users` 생성, `hubStaffInvites.usedAt/usedBy` 갱신, `hubs.staffIds` 배정을 하나의 트랜잭션으로 처리한다.
- seller 거점 상세에서 초대 링크 발급과 복사가 동작한다.
- 변경 파일 Biome, API 타입체크·빌드, seller 타입체크·빌드를 통과한다.

## 6. 체크리스트

- [x] SDD 계약 확정
- [x] API 스태프 초대 발급
- [x] Auth 스태프 초대 소비 계약
- [x] seller 거점 상세 초대 링크 UI
- [x] `hub_staff` 라우팅 분기
- [x] Kakao 기반 스태프 초대 수락 화면
- [x] 스태프 목록 조회와 권한 회수 UI


## 7. 2026-06-05 SDD ??

- [x] Kakao ?? ?? ??? ?? ?? ??? ????.
- `staff-invite?token=...`? ??? ?? ???? ????, seller ?? ??? ??? ????.
- ?? ??? `hub_staff_invite_token` ??? 10?? ??? ? Kakao OAuth? ????.
- seller NextAuth Kakao ??? ?? ??? ??? `POST /auth/kakao-login`? `targetRole:'hub_staff'`? `inviteToken`? ????.
- API? ?? Kakao ???? `hub_staff` ??? ??? ? `users` ??, `hubStaffInvites.usedAt/usedBy`, `hubs.staffIds` ??? ?? ?????? ????.
- ?? Kakao ??? ?? ?? ??? `hub_staff`? ? `hub_staff` ?? `admin`? seller ? ???? ????.

## 8. 2026-06-05 스태프 권한 회수 SDD

### 결정

거점 상세의 스태프 운영 패널에서 현재 배정된 `hub_staff` 목록을 조회하고, 판매자 소유자가 특정 스태프의 거점 권한을 회수할 수 있게 한다.

### 계약

- 목록 API: `GET /stores/:storeId/hubs/:hubId/staff`
- 회수 API: `DELETE /stores/:storeId/hubs/:hubId/staff/:staffId`
- 목록 응답: `{ staff: Array<{ id, name, email, suspended }> }`
- 회수는 `hubs.staffIds`에서 `staffId`를 제거하고, 해당 `users/{staffId}`가 같은 `storeId`·`hubId`를 가진 `hub_staff`일 때만 `suspended:true`, `hubStaffRevokedAt`, `hubStaffRevokedBy`, `updatedAt`을 기록한다.
- 회수 시 `refreshTokens/{staffId}`를 삭제해 다음 refresh부터 세션을 차단한다.
- 주문 상태 변경 권한, 다중 거점 배정, 회수 취소·재초대 자동화는 후속 SDD로 남긴다.

### 검증

- 판매자 소유자만 스태프 목록과 회수를 수행한다.
- 다른 거점·다른 스토어·다른 역할 사용자는 회수할 수 없다.
- 회수 후 목록에는 해당 스태프가 남지 않는다.
- seller 거점 상세에서 회수 확인창과 성공 알림이 동작한다.

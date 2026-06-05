# Hub Staff Access SDD

> 작성: 2026-06-05
> 범위: 거점 스태프 권한 구조 1차 토대

## 1. 문제

현재 거점 API는 판매자 소유자만 접근할 수 있다. 향후 협력 업체나 거점 근무자가 픽업 대기 주문을 확인하려면 `hub_staff` 역할과 거점 배정 관계가 필요하지만, 판매자 관리 권한 전체를 열면 스토어 설정과 거점 삭제까지 노출될 수 있다.

## 2. 결정

`hub_staff`는 `hubs/{hubId}.staffIds` 배열에 자신의 `userId`가 포함된 거점에 한해 읽기 접근을 허용한다. 1차 범위에서는 `GET /stores/:storeId/hubs`, `GET /stores/:storeId/hubs/:hubId`, `GET /stores/:storeId/hubs/:hubId/orders`만 허용하고, `POST/PATCH/DELETE /stores/:storeId/hubs`는 기존 판매자 소유자만 수행한다.

## 3. 계약

- `UserRole`에 `hub_staff`를 추가한다.
- `hubs/{hubId}.staffIds: string[]`를 선택 필드로 추가한다.
- 새 거점 생성 시 `staffIds: []`를 저장한다.
- 기존 거점에 `staffIds`가 없으면 빈 배열로 취급한다.
- `hub_staff`의 목록 조회는 해당 스토어의 거점 중 자신이 배정된 거점만 반환한다.
- `hub_staff`는 배정되지 않은 거점 상세와 주문 목록을 조회할 수 없다.
- 판매자 소유권 검증은 기존 `stores/{storeId}.ownerId === requesterId` 계약을 유지한다.

## 4. 제외

- 스태프 초대 링크 발급 UI
- `hub_staff` 전용 로그인·온보딩 화면
- 관리자 콘솔에서 스태프 계정 생성·회수
- 거점 스태프의 주문 상태 변경 권한 확대
- Firestore 인덱스 최적화와 대량 스태프 목록

## 5. 검증

- 허용 역할 타입이 API와 shared에서 일치하는지 확인한다.
- 판매자 소유자는 기존 거점 목록·생성 권한을 유지한다.
- 배정된 `hub_staff`는 배정 거점과 주문 목록을 조회할 수 있다.
- 배정되지 않은 `hub_staff`는 403을 받는다.
- 변경 파일 Biome, API 타입체크, API 빌드, 관련 단위 테스트를 통과한다.

## 6. 체크리스트

- [x] 역할 타입에 `hub_staff` 추가
- [x] 거점 스키마 문서에 `staffIds` 추가
- [x] 거점 서비스 권한 경계 분리
- [x] 단위 테스트 추가
- [x] BACKLOG와 memory 최신화
## 7. 2026-06-05 JWT hubId 스코핑 보강

### 결정

`hub_staff` JWT에는 `storeId`와 `hubId`를 함께 포함한다. 거점 API는 `hub_staff` 요청에서 경로의 `storeId`·`hubId`가 JWT 스코프와 일치하는지 먼저 확인하고, 이후 기존처럼 `hubs.staffIds` 배정 여부를 DB에서 재검증한다.

### 계약

- `JwtPayload.hubId?: string | null`을 API와 shared 타입에 추가한다.
- 이메일·Kakao 가입으로 생성된 `hub_staff`는 초대 소비 트랜잭션에서 저장된 `hubId`를 토큰에도 싣는다.
- refresh 시점에는 사용자 문서의 최신 `storeId`·`hubId`를 다시 읽어 토큰을 재발급한다.
- 거점 목록은 `hub_staff`의 JWT `storeId`와 일치하는 store 경로에서만 허용하고, JWT `hubId`가 있으면 해당 거점으로 한 번 더 축소한다.
- 거점 상세·주문 조회는 경로 `hubId`와 JWT `hubId`가 다르면 403을 반환한다.
- 주문 상태 변경 권한 확대, 다중 거점 배정, 회수 취소는 계속 후속 SDD로 남긴다.

### 검증

- 로그인·Kakao 로그인·refresh 토큰에 `hubId`가 포함되는지 단위 테스트로 확인한다.
- `hub_staff`가 다른 store 또는 다른 hub 경로를 호출하면 403을 받는지 단위 테스트로 확인한다.
- 변경 파일 Biome, API 타입체크, API 빌드를 통과한다.

### 체크리스트

- [x] API/shared JWT 타입에 `hubId` 추가
- [x] Auth 토큰 발급·refresh에 `hubId` 반영
- [x] 거점 API JWT 스코프 가드 반영
- [x] 단위 테스트 추가
- [x] BACKLOG·CRITICAL_LOGIC·memory 최신화
## 8. 2026-06-05 다중 거점 배정 1차 계약

### 결정

`hub_staff`는 기존 단일 `hubId`를 유지하되, 새 계약으로 `hubIds: string[]`를 병행 사용한다. JWT와 사용자 문서 모두 `hubIds`를 지원하며, 기존 문서와 기존 토큰은 `hubId` 하나를 `hubIds` 1건처럼 해석한다.

### 계약

- 사용자 문서에는 `hubId?: string | null`과 `hubIds?: string[]`를 함께 둘 수 있다.
- 신규 거점 스태프 초대 수락 시 `hubId`와 `hubIds: [hubId]`를 함께 저장한다.
- 토큰 발급과 refresh는 사용자 문서의 `hubIds`를 우선 사용하고, 없으면 `hubId`로 보정한다.
- 거점 목록은 JWT `storeId`가 일치하는 store 안에서 `staffIds`에 본인이 포함된 거점을 반환한다. `hubIds`가 있으면 해당 배열 안의 거점으로 추가 축소한다.
- 거점 상세와 주문 조회는 경로 `hubId`가 JWT `hubIds` 또는 단일 `hubId` 안에 있어야 하며, 이후 `hubs.staffIds` 배정도 다시 검증한다.
- 단일 거점 회수는 해당 hub의 `staffIds`에서 제거하고 사용자 `hubIds`에서 해당 hubId를 제거한다. 남은 배정이 없을 때만 `hub_staff` 계정을 정지하고 refresh token을 삭제한다.
- 여러 거점에 기존 스태프를 추가 배정하는 별도 UI/API는 다음 SDD에서 다룬다.

### 검증

- 기존 단일 `hubId` 토큰과 새 `hubIds` 토큰이 모두 거점 접근을 통과하는지 단위 테스트로 확인한다.
- 다중 배정 스태프가 허용된 거점 목록과 상세만 볼 수 있는지 확인한다.
- 일부 거점 회수 시 계정 정지는 하지 않고, 마지막 거점 회수 시에만 정지·refresh token 삭제가 일어나는지 확인한다.

### 체크리스트

- [x] API/shared/JWT/NextAuth 타입에 `hubIds` 병행 추가
- [x] 로그인·카카오·refresh·초대 수락 토큰 발급 경로 보정
- [x] 거점 목록·상세·주문 조회 스코프 검증 보정
- [x] 일부 거점 회수와 마지막 거점 회수 정책 분리
- [x] 단위 테스트·타입체크·빌드 검증 완료

## 9. 2026-06-05 거점 스태프 픽업 확인 권한

### 결정

`hub_staff`는 배정된 거점의 `HUB_ARRIVED` 주문에 한해 거점 픽업 확인을 수행할 수 있다. 판매자 소유자가 사용하는 기존 `hub-confirm` 경로는 유지하되, `hub_staff` 요청은 JWT `storeId`와 `hubId`/`hubIds`, 그리고 `hubs/{hubId}.staffIds` 배정 관계를 모두 통과해야 한다.

### 계약

- 대상 API: `PATCH /stores/:storeId/orders/:orderId/hub-confirm`
- 허용 상태: `HUB_ARRIVED -> PICKED_UP`
- `hub_staff` 요청은 주문의 `hubId`가 JWT `hubIds` 또는 단일 `hubId` 안에 있어야 한다.
- `hub_staff` 요청은 `hubs/{hubId}.staffIds`에 본인 `userId`가 포함되어야 한다.
- `storeId` 스코프가 다르거나, 주문 거점이 JWT 스코프 밖이거나, 거점 배정이 없으면 403을 반환한다.
- 판매자 요청은 기존처럼 `stores/{storeId}.ownerId === requesterId`를 유지한다.

### 검증

- [x] 판매자 소유자는 기존 픽업 확인 경로를 계속 사용할 수 있다.
- [x] 배정된 `hub_staff`는 거점 주문을 `PICKED_UP`으로 전환할 수 있다.
- [x] JWT 스코프 밖 거점 주문은 `hub_staff`에게 403을 반환한다.

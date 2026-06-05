# 관리자 드라이버 정렬·페이지네이션 계획

> 작업 ID: `ADMIN-DRIVERS-F5`
> 작성일: 2026-06-03

## 1. 문제

`/admin/drivers`는 현재 `role == driver` 조회 뒤 최대 100건만 가져오고, status 필터와 정렬을 메모리에서 처리한다. 드라이버 계정이 100건을 넘으면 초과분이 누락될 수 있고, status 탭별 목록도 전체 데이터 기준임을 보장하지 못한다.

## 2. 결정

- API 계약은 `GET /admin/drivers?status=&sort=&limit=&cursor=`로 확장한다.
- 기본 정렬은 `createdAt_desc`, 선택 정렬은 `createdAt_asc`만 허용한다.
- 기본 `limit`은 100, 최대 500으로 제한한다.
- `limit + 1` 조회로 `nextCursor`를 반환하고, 프론트는 `더 보기`로 append한다.
- status는 Firestore equality 조건으로 먼저 좁히되, 기존 문서의 `suspended` 누락 호환성을 유지한다.
  - `pending`: `role=driver`, `driverApproved=false` 조회 후 API에서 `!suspended` 보정
  - `approved`: `role=driver`, `driverApproved=true` 조회 후 API에서 `!suspended` 보정
  - `suspended`: `role=driver`, `suspended=true`
  - `all`: status 조건 없음
- cursor는 마지막 문서의 `createdAt` ISO 문자열만 사용한다.

## 3. 인덱스

status equality와 `createdAt` 정렬을 함께 쓰므로 `users` 복합 인덱스를 추가한다.

- `role + createdAt asc`
- `role + driverApproved + createdAt asc/desc`
- `role + suspended + createdAt asc/desc`

기존 `role + createdAt desc`는 유지한다.

## 4. 구현 범위

- `QueryAdminDriversDto`에 `sort`, `limit`, `cursor` 추가.
- `AdminService.getDrivers()`를 helper로 분리하고 커서 기반 응답으로 변경.
- 셀러 `useAdminDrivers`를 전용 hook 파일로 분리.
- `/admin/drivers`에 정렬 Select와 `더 보기` 버튼 추가.
- API 단위 테스트는 드라이버 전용 spec로 분리해 500라인 한도를 지킨다.

## 5. 완료 기준

- status 탭, 정렬, 추가 로딩이 같은 API 계약을 사용한다.
- 첫 페이지와 추가 페이지가 중복 없이 이어진다.
- 기존 approve/suspend 후 reload 동작이 유지된다.
- 수정·신규 코드 파일은 500라인 이하이다.

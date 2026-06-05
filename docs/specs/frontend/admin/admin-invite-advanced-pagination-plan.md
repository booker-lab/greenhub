# 어드민 초대 검색·페이지네이션 고도화

> 작업 ID: `ADMIN-INVITE-F6-F5-ADV`
> 작성일: 2026-06-04

## 목적

초대 토큰 발급량이 50건을 넘으면 기존 `/admin/invite` 목록의 51번째 이후 토큰을 볼 수 없다. 기존 4자 prefix 검색 계약은 유지하되, 기본 목록과 검색 결과 모두 `더 보기`로 이어 볼 수 있게 한다.

## 결정

- API는 `GET /admin/invite?q=&limit=&cursor=`를 지원한다.
- 응답은 `{ invites, nextCursor }` 형태로 고정하되, 프론트는 기존 배열 응답도 임시 호환한다.
- `q`가 4자 이상이면 `token` prefix 검색을 유지하고 `orderBy('token')` 기준으로 `cursor`를 해석한다.
- `q`가 없거나 4자 미만이면 기존 최신순 목록을 유지하고 `orderBy('createdAt','desc')` 기준으로 `cursor`를 ISO 일시로 해석한다.
- `limit` 기본값은 50, 허용 범위는 1~100이다. 서버는 `limit + 1` 조회로 다음 페이지 존재 여부를 판단한다.
- 검색어·limit 변경 시 프론트 목록은 첫 페이지부터 재조회한다. `더 보기`는 현재 조건의 다음 페이지만 append한다.

## 범위

- `QueryAdminInvitesDto` 추가.
- `AdminService.getInvites()`를 커서 페이지 응답으로 변경.
- `useAdminInvite()`에 `hasMore`, `loadingMore`, `loadMore` 추가.
- `/admin/invite` UI 하단에 `더 보기` 버튼 추가.
- API 단위 테스트와 기존 invite e2e fixture 계약 보강.

## 제외

- 1000건 이상 발급량의 검색·정렬 인덱스 재설계.
- 만료기간 지정.
- 사용됨·만료 토큰 취소 정책 변경.
- 가입 완료 판매자 되돌리기.

## 검증

- API 단위 테스트: 기본 최신순 페이지, 검색 페이지, 4자 미만 q 무시.
- e2e fixture: 기존 초대 복사·검색·취소 회귀가 새 응답 형태에서 유지된다.
- 정적 검증: 변경 파일 Biome, API·seller 타입체크와 빌드, `git diff --check`.

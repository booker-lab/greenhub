# 관리자 초대 1000건 이상 검색 확장 계획

> 작업 ID: `ADMIN-INVITE-SCALE-1000`
> 작성일: 2026-06-04

## 목적

초대 토큰 발급 이력이 1000건 이상으로 늘어나도 운영자가 4자 이상 prefix로 토큰을 검색하고, 결과를 최신 발급순으로 이어 볼 수 있게 한다. 기존 `token` range 검색은 prefix 검색은 가능하지만 `createdAt desc` 정렬과 결합하기 어려워 대량 이력에서 운영자가 기대하는 최신순 결과를 보장하지 못한다.

## 결정

- 초대 문서에 `tokenPrefixes` 배열을 저장한다.
- `tokenPrefixes`는 토큰을 대문자로 정규화한 뒤 4자부터 전체 길이까지 prefix를 모두 담는다.
- `GET /admin/invite?q=&limit=&cursor=`에서 `q`가 4자 이상이면 `where('tokenPrefixes', 'array-contains', prefix).orderBy('createdAt', 'desc')`를 사용한다.
- 검색 커서는 기본 목록과 동일하게 `createdAt` ISO 문자열을 사용한다.
- Firestore 복합 인덱스는 `invites.tokenPrefixes CONTAINS + createdAt DESC`로 고정한다.
- 새로 발급되는 토큰은 즉시 `tokenPrefixes`를 저장한다.
- 기존 운영 토큰은 backfill 전까지 신규 prefix 인덱스 검색 대상이 아니다. 운영 배포 시 기존 토큰 검색 보존이 필요하면 별도 backfill을 먼저 수행한다.

## 범위

- API invite helper 검색 전략 변경.
- 신규 초대 발급 시 `tokenPrefixes` 저장.
- Firestore 인덱스 정의 추가.
- helper 단위 테스트로 prefix 생성, 최신순 prefix 검색, 4자 미만 검색 무시를 검증.

## 제외

- 만료 기간 지정.
- 사용됨/만료됨 토큰 취소 정책 변경.
- 가입 완료 판매자 rollback 정책.
- 기존 운영 invite 문서 backfill 실행.

## 검증

- `admin-invites.helpers.spec.ts`에서 `tokenPrefixes` 생성과 `array-contains + createdAt desc` 쿼리 계약을 검증한다.
- 기존 `AdminService.getInvites` 테스트는 새 prefix 검색 커서 계약을 따른다.
- 정적 검증: API 테스트, API 빌드, 변경 파일 Biome, `git diff --check`.

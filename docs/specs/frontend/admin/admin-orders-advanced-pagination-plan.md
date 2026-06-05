# 관리자 주문 고급 페이지네이션 SDD

> 작업 ID: `ADMIN-ORDERS-F5-ADV`
> 작성일: 2026-06-03

## 1. 문제

F5 1차는 `createdAt` 정렬과 cursor `더 보기`만 제공했다. 운영자가 특정 페이지로 되돌아가거나 총 주문 수를 대조할 때는 현재 읽은 건수만 보이므로 CS 확인 흐름이 불안정하다.

## 2. 결정

- `GET /admin/orders`에 `page` 쿼리를 추가한다.
- `page`가 있으면 서버는 같은 필터의 `count()`와 `offset((page - 1) * limit)`을 사용해 `total`, `page`, `pageSize`, `totalPages`, `hasPrevious`, `hasNext`를 반환한다.
- 기존 `cursor` 계약은 호환용으로 유지한다. `page`와 `cursor`가 함께 오면 `page`를 우선한다.
- 프론트 `/admin/orders`는 페이지 번호 기반 UI를 사용하고, 필터·정렬·페이지 크기 변경 시 1페이지로 복귀한다.
- `limit` 선택지는 기존 25·50·100을 유지한다.

## 3. 제외

- `createdAt` 외 컬럼 정렬
- 대용량 검색 전용 인덱스나 별도 materialized count
- 주문 쓰기, 환불 정책 변경

## 4. 운영 기준

`offset`은 깊은 페이지에서 비용이 커진다. 관리자 주문이 수천 건 단위를 넘어 페이지 깊이 탐색이 일상 업무가 되면 서버 검색·커서 스택·전용 집계 문서로 별도 SDD를 승격한다. 현재 범위는 운영 CS가 필터된 주문 목록을 100건 단위로 대조하는 용도에 한정한다.

## 5. 검증

- API 단위 테스트로 `count`, `offset`, 페이지 메타를 확인한다.
- E2E fixture로 총 건수, 2페이지 이동, 필터 변경 시 1페이지 복귀, 모바일 가로 넘침 0을 확인한다.
- API·seller 타입체크, 빌드, 변경 파일 Biome, `git diff --check`를 실행한다.

# 어드민 users S2 진입 문서 — 가입일·전화 표시 + 새로고침 버튼 (#CL-55 §E)

> 작성: 2026-05-28
> 선행 상태: users S1 커밋 `be5def9`가 `codex/admin-users-s1-refresh-suspend`에 push 완료됨.
> 주의: S1은 아직 `main` 병합·배포 전이며, live E2E는 S5에서 수행한다.

## 1. 새 세션 진입 조건

- 새 작업 브랜치는 `be5def9`를 포함한 S1 브랜치에서 분기하거나, S1이 `main`에 병합된 뒤 만든다.
- 시작 직후 `git log --oneline -1` 또는 merge history에서 `be5def9` 포함 여부를 확인한다.
- 작업 트리가 깨끗한지 확인하고, S2에는 API/auth 변경을 섞지 않는다.

## 2. S1 인계 결과

- 변경: `apps/api/src/auth/auth.service.ts`의 `refresh()`가 rotation 검증 뒤 `users/{sub}.suspended`를 확인해 정지 계정의 재발급을 `401`로 차단한다.
- 테스트: `apps/api/src/auth/auth.service.spec.ts` Jest 2케이스 신설. API 전체 test `4/4`, `tsc --noEmit`, build 통과.
- 제한: API 전체 lint는 기존 baseline `408 errors / 20 warnings`로 green이 아니다. 신규 spec과 추가 refresh 블록에는 신규 Biome 진단이 없다.
- 미수행: `main` 병합, 운영 배포, 정지 계정 live refresh 호출/E2E.

## 3. S2 범위

**이번 세션에서 구현할 것**

- T1: `apps/seller/src/app/admin/users/_components/UsersTable.tsx`
  - 데스크톱 표에 가입일·전화 컬럼을 추가한다.
  - 모바일 카드에 가입일·전화 행을 추가한다.
  - 전화가 없으면 `—`를 표시하고, 기존 결정대로 마스킹하지 않는다.
- T2: `apps/seller/src/app/admin/users/_client.tsx`
  - `useAdminUsers().reload`를 노출해 헤더 우측 새로고침 버튼으로 연결한다.
  - 인접 어드민 탭의 `ActionIcon`/`IconRefresh`/loading 패턴을 확인한 뒤 동일한 표현을 따른다.

**이번 세션에서 하지 않을 것**

- S3 검색·상태 필터 및 `_lib.ts`/테스트 신설.
- S4 API limit 정책 변경.
- S5 E2E 또는 운영 데이터 조작.

## 4. 구현 전에 확인할 드리프트

- admin UI 실제 앱 경로는 `apps/admin`이 아니라 `apps/seller/src/app/admin/users`다.
- `AdminUser.createdAt` 타입은 현재 `unknown`이고, shared `toDateStrKST()`는 `Date`를 받는다. API 직렬화 형태와 기존 admin 날짜 표시 패턴을 먼저 확인한 뒤 동일한 정규화 방법으로 변환한다. `unknown`을 억지 캐스팅해 통과시키지 않는다.
- users 화면은 현재 초기 `loading`에서 조기 반환한다. 새로고침 중 버튼의 loading 표시가 보이려면 기존 hook의 loading 동작과 인접 화면 UX를 확인해 일관되게 처리한다.

## 5. 검증 게이트

- `pnpm --filter seller exec tsc --noEmit`
- `pnpm exec biome check apps/seller/src/app/admin/users`
- `pnpm --filter seller build`
- `UsersTable.tsx` 500라인 미만 확인.
- 데스크톱에서 이름·이메일·가입일·전화·상태·액션 컬럼이 깨지지 않는지 확인.
- 모바일 카드에서 가입일·전화 추가 후 정지/복구 버튼 접근성과 카드 간격을 확인.
- S2에서는 S5 E2E 완료로 표시하지 않는다. 화면 검증 항목은 구현 후 `pending-visual-verify.md`에 추가한다.

## 6. 다음 커밋 단위

- 권장 브랜치: `codex/admin-users-s2-display-refresh`
- 권장 커밋 메시지: `feat(admin): #CL-55 users 가입일·전화 표시 및 새로고침 (S2)`
- S2 커밋·push 후 새 세션에서 S3(검색·상태 필터)로 이어간다.

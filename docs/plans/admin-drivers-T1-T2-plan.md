# 어드민 드라이버 탭 — status 서버 필터 배선 + 타입 정합 (T1+T2)

> 작성: 2026-05-26 (세션95) · 출처: `/further` 확정안
> 상태: 계획 수립 완료 (구현 착수 전)
> 누적 진단: [`docs/specs/frontend/admin-tabs-improve-plan.md`](../specs/frontend/admin-tabs-improve-plan.md) §C

---

## 1. 문제 (Problem)

어드민 드라이버 관리 화면(`/admin/drivers`)의 탭(승인대기·승인완료·정지·전체)은
**화면 안에서만** 거르고 있다. 백엔드는 `status` 쿼리를 이미 받고 분기까지
완비돼 있지만(`admin.service.ts:224-230`), 프론트 hook이 status를
보내지 않아 **백엔드 분기는 죽은 코드**이고 클라이언트만 거른다.

여기에 백엔드 `getDrivers`가 `.limit(100)`을 걸어 두기 때문에,
**드라이버가 100명을 넘으면 일부 탭에서 사람이 누락돼 보일 수 있다.**
지금은 규모 미달이지만 구조적 결함이라 운영 전에 막아야 한다.

부수로 service의 `d.data()`가 `any`로 흐르고, `AdminDriver.suspended`가
옵셔널이라 undefined와 false를 화면이 살짝 다르게 다룰 여지가 있다.
눈에 보이는 버그는 아니지만 안전장치 성격.

**누가·언제:** 어드민이 드라이버 탭을 누르며 승인·정지를 관리할 때.

---

## 2. 범위 (Scope)

### 하는 것 (In)
- **T1 (C-2). status 서버 필터 배선** —
  - `useAdminDrivers`가 status를 쿼리로 전달 (`/admin/drivers?status=pending|approved|suspended`).
  - **'전체' 탭은 status 미전달** (지금 동작과 동일 — 정지 포함 전부).
  - 탭 전환 시 재조회.
  - `filterByTab` (클라 필터)은 백엔드 위임으로 **제거**.
  - 로딩·빈결과 화면에서도 탭은 유지 (세션86 C6 가드 유지).
- **T2 (C-3). 타입 정리** —
  - `admin.service.ts` `getDrivers`의 `any` → 최소 인터페이스 도입.
  - `AdminDriver.suspended` 기본값 정합 (undefined ↔ false 일관).

### 하지 않는 것 (Out)
- **F1 검색** (이름·이메일 텍스트 필터) — 진단 §C-4. 별도 세션.
- **F2 새로고침 버튼** — 진단 §C-4. 별도 세션.
- **F3 가입일 표시** — 진단 §C-4. 별도 세션.
- **F4 드라이버 상세 정보** (전화·차량) — 백엔드 데이터모델 선확인 필요. 별도 SDD.
- **F5 정렬·페이지네이션** — 백엔드 쿼리·커서 변경 필요. 현 규모 미달.
- **R1·R2 표현 레이어 정리** (액션 버튼 메타화·SegmentedTabs 통일) — 우선순위 최하.
- **백엔드 `getDrivers` 변경** — DTO·service는 이미 완비라 무변경.

---

## 3. 성공 기준 (Success)

눈으로 확인하는 기준:

- **승인대기·승인완료·정지·전체** 4탭 각각 맞는 드라이버만 나온다.
- 승인·정지·해제 버튼 동작이 이전과 **동일** (시각·기능 회귀 0).
- 로딩 중·빈 결과에서도 탭 UI는 사라지지 않는다.
- 탭 전환 시 네트워크 탭에서 `/admin/drivers?status=...` 호출이 보인다
  (전체 탭만 status 미전달).

코드 검증 (정합성):
- **C1** tsc 0
- **C2** biome 0 (신규 위반 0)
- **C3** `npm run build` 0 (`npx next build` 금지 — Turbopack 충돌)
- **C4** 500라인 한도
- **C5** SSOT 토큰 0
- **C6** 가드 유지 (로딩·빈결과에서 탭 유지)
- **C7** 시각 회귀 0

---

## 4. 꼭 넣을 것 (Must)

| ID | 항목 | 검증 |
| :--- | :--- | :--- |
| M1 | 탭(`pending`·`approved`·`suspended`)을 누르면 hook이 해당 status를 쿼리로 전달 | 네트워크 탭에서 URL 확인 |
| M2 | '전체' 탭은 status 미전달 | 네트워크 탭에서 URL 확인 |
| M3 | `filterByTab`(`_lib.ts`) 클라 필터 호출 제거 | `_client.tsx`에서 호출 사라짐 |
| M4 | 로딩·빈결과에서 탭 UI 유지 | 빈 탭 직접 클릭 |
| M5 | `AdminDriver.suspended`가 옵셔널일 때도 뱃지·버튼 분기가 동일 | undefined 시드 1건으로 확인 |
| M6 | service `getDrivers` 내부에 최소 인터페이스 도입 (`any` 제거) | grep `any` 잔존 0 |

---

## 5. 리스크·가설 (Risks)

| ID | 리스크 | 완화 |
| :--- | :--- | :--- |
| R1 | 탭 전환 시마다 재조회 → 짧은 네트워크 점프(스피너 깜빡임) | 기존 `useAdminList` 패턴이 status 변경을 deps로 받게 설계, 정산 탭(세션86) 선례 동일 — UX 회귀 없음 |
| R2 | '전체' 탭 의미 변경 우려 | 결정 = 정지 포함 전부 (지금 동작 그대로), 사용자 확정 완료 |
| R3 | 백엔드 `.limit(100)`은 그대로라 100명 초과 시 여전히 일부 누락 | 본 계획 범위 밖 (별도 페이지네이션 SDD에서 다룸) — 단 status별 필터로 누락이 **탭에 비례 분산**되므로 현 결함보다는 호전 |

---

## 6. 아토믹 태스크 (커밋 단위 — 세션91 패턴)

### T1. status 서버 필터 배선
- [apps/seller/src/hooks/useAdmin.ts](../../apps/seller/src/hooks/useAdmin.ts) `useAdminDrivers` —
  - `useAdminList` `buildPath`가 status를 쿼리로 합성, status 변경을 deps에 추가.
  - 인자로 status를 받게 시그니처 확장 (`useAdminDrivers(status: DriverStatus)`).
- [apps/seller/src/app/admin/drivers/_client.tsx](../../apps/seller/src/app/admin/drivers/_client.tsx) —
  - `useAdminDrivers(tab)` 호출, `filterByTab(allDrivers, tab)` 제거 (`drivers` 직접 사용).
  - 'all' 탭에서는 hook이 status 미전달.
- [apps/seller/src/app/admin/drivers/_lib.ts](../../apps/seller/src/app/admin/drivers/_lib.ts) —
  - `filterByTab` 함수 제거 (재사용처 없음 — 검증 후 삭제).
- 검증: C1·C2·C3·C7 · 4탭 육안 + 네트워크 탭.
- 커밋: `refactor(admin): #CL-XX drivers 탭 status 서버 필터 배선 (T1)`

### T2. 타입 정합
- [apps/api/src/admin/admin.service.ts](../../apps/api/src/admin/admin.service.ts) `getDrivers` —
  - 로컬 인터페이스 `DriverRow { driverApproved?: boolean; suspended?: boolean; createdAt?: ... }` 도입.
  - `snap.docs.map((d: any) => ...)` → 최소 타입 적용 (전체 사용자 도메인 타입 도입은 범위 밖).
- [apps/seller/src/hooks/useAdmin.ts](../../apps/seller/src/hooks/useAdmin.ts) `AdminDriver` —
  - `suspended?: boolean` 유지하되, `DriverBadge`·`DriverList`에서 `!!driver.suspended`로 명시 정규화 (이미 truthy 분기지만 명세화).
- 검증: C1·C2·C3 · 회귀 시각 0.
- 커밋: `refactor(admin): #CL-XX drivers 타입 정합 (T2)`

---

## 7. 핸드오프

| 준비됨 | 다음 |
| :---: | :--- |
| ✅ | 구현 = T1부터 순서대로 (T2는 독립이라 T1 후 동일 세션 가능) |
| ⬜ | 푸시·배포는 사용자 지시 대기 (세션91 패턴) |
| ⬜ | 상태변경 육안 (4탭 전환·승인·정지) → `docs/specs/frontend/pending-visual-verify.md` §5 (신설) |
| ⬜ | 진단 §C 보존 항목(F1·F2·F3·F4·F5·R1·R2) — 추후 별도 세션에서 우선순위 재평가 |

---

## 📋 업무 요약 (협업용)

### 세션 주제
어드민이 드라이버 탭을 누를 때, 화면 안에서만 거르던 것을 **서버에 직접 부탁하는 방식**으로 바꿉니다. 지금은 드라이버가 100명을 넘어가면 일부 탭에서 사람이 누락돼 보일 수 있는 숨은 결함이 있는데, 백엔드는 이미 준비돼 있고 화면 쪽 한 줄이 비어 있던 것입니다.

### 함께 확정한 것
- 하기로 한 것 — 탭(승인대기·승인완료·정지)을 누르면 서버에 그 조건을 보내고 새로 받아옴, '전체' 탭은 지금처럼 전부 받아옴.
- 하지 않기로 한 것 — 이름 검색·가입일 표시·새로고침 버튼·드라이버 전화번호/차량 정보·페이지 나누기. 모두 기록만 남기고 다음에.
- 잘 됐다고 말할 때 — 4탭 각각 맞는 드라이버만 나오고, 승인·정지 후 동작이 이전과 똑같음.
- 꼭 넣기로 한 것 — 100명 초과 상황에서도 누락이 없도록 서버에 위임.

### 나중에 다듬을 것
- 검색창(이름·이메일)
- 가입일 표시
- 새로고침 버튼

### 아직 열린 질문
- 드라이버 상세 정보(전화번호·차량)가 백엔드에 실제 저장돼 있는가 — 확인 후 별도 세션에서 결정.

### 다음에 할 일
1. 이 계획서대로 T1(서버 필터 배선) 구현
2. T2(타입 정합) 구현 — 동일 세션 가능
3. tsc·biome·build·500라인 검증
4. 4탭 육안 회귀 0 확인
5. 커밋 (T1·T2 분리) — 푸시는 사용자 지시 대기

### 어드민 관점에서 기대되는 변화
화면은 **그대로**입니다. 드라이버가 늘어도 탭별로 정확한 사람만 보인다는 안정성이 생기는 것이 핵심입니다.

---

작성일: 2026-05-26
참석·독자: 어드민·기획 공유

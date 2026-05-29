# 어드민 드라이버(drivers) 탭 개선 — 아토믹 태스크 (#CL-55 §C)

> **출처:** `admin-tabs-improve-plan.md` §C (세션93 진단, 세션95 `/further` 확정).
> SDD 분리·반응형(카드형)은 세션91에 끝남(`drivers`, `124768a`).
> 본 진단은 그 위의 **백엔드 필터 배선·타입 안전·기능 부재** 정리.
> **사용자 확정 = T1+T2 묶음 착수 대기.**

## 0. 공통 정합성 검토 기준 (모든 어드민 탭 공통)

각 커밋 직전 아래를 모두 통과해야 한다(세션85~91 동일).

- **C1 tsc 0** — 어드민·셀러·소비자 3앱 전체.
- **C2 biome 0** — 신규 경고 0.
- **C3 `npm run build` 0** — ⚠️ `npx next build` 금지(Turbopack 충돌).
- **C4 500라인 한도** — 단일 파일 500라인 초과 시 즉시 분할.
- **C5 SSOT 토큰** — 하드코딩 색·라벨 0, shared 재사용.
- **C6 가드 유지** — 로딩·빈결과에서도 탭·필터 UI 유지(세션86 선례).
- **C7 시각 회귀 0** — 시각 변경이 의도된 태스크는 단독 커밋·육안 격리.

---

## C-0. 사용자 확정 (착수 시)
- **필터 방식 = 서버 필터로 배선**(C-1의 T1). 백엔드 status 분기가 이미 완비라 죽은 코드 활성화 + limit(100) 누락 위험 해소. 정산 탭(세션86) 선례와 동일.
- **이번 세션 = 진단·문서화만**(코드 변경 0). 구현은 별도 착수.

## C-1. 진단 대상 파일 (현 상태)
| 파일 | 라인 | 역할 |
|------|------|------|
| `drivers/page.tsx` | 9 | dynamic ssr:false 래퍼 |
| `drivers/_client.tsx` | 92 | 탭 상태·ConfirmModal·approve/toggleSuspend 핸들러 |
| `drivers/_lib.ts` | 48 | ACTION_META·STATUS_TABS·filterByTab(클라 필터) |
| `_components/DriverList.tsx` | 102 | 카드 리스트 + 액션 버튼 분기(로딩·빈결과 가드 포함) |
| `_components/DriverBadge.tsx` | 24 | 상태 뱃지(정지/승인완료/승인대기) |

→ 모두 500 한도 내. **분할(과분할) 불필요** — 세션91 users/banner 전례.

## C-2. 정합성 진단 — 🔴 백엔드 status 필터가 프론트에 미배선 (반쪽 기능)

| 레이어 | status 필터 | 위치 |
|--------|------------|------|
| 백엔드 DTO | `status?: 'pending'\|'approved'\|'suspended'` 수신 | `admin.dto.ts:55-59` |
| 백엔드 service | status별 서버 필터 **완비** | `admin.service.ts:224-230` |
| **프론트 hook** | `() => '/admin/drivers'` — **status 쿼리 미전달** | `useAdmin.ts:285` |
| 프론트 필터 | `filterByTab`로 **클라이언트에서만** 필터 | `_lib.ts:43-48` |

→ **백엔드 status 분기 = 완전한 죽은 코드.** 세션86 정산 탭과 동형 결함(백·hook은 status 지원, UI/배선 한 겹만 비어 있음).
추가로 `getDrivers`는 `.limit(100)`(`admin.service.ts:216`) → 드라이버 100명 초과 시 일부 탭 누락 가능.
**사용자 확정 = 서버 필터로 배선**(C-0).

## C-3. 정합성 진단 — 타입 안전(any) + 도메인 타입 부재

| 출처 | 현황 | 비고 |
|------|------|------|
| `getDrivers` service | `d.data()` → `any[]`, `driverApproved`·`suspended` 타입 미보증 | `admin.service.ts:219-229` |
| `AdminDriver.suspended` | `boolean` **옵셔널** vs 백엔드 필터는 boolean 가정 | `useAdmin.ts:68` |
| `AdminDriver.createdAt` | `unknown` — 화면 미표시(사실상 미사용) | `useAdmin.ts:69` |

→ stores의 `StoreStatus` SSOT 불일치와 같은 계열. 단 drivers는 **상태 enum이 아니라 boolean 2개(`driverApproved`·`suspended`) 조합**이라 union 교정 대상은 아님. `DriverStatus`(`all\|pending\|approved\|suspended`)는 **UI 탭 키**일 뿐 도메인 필드와 1:1 아님(파생값).

## C-4. 기능 부재 (UX)

- **F1. 검색 없음** — 이름·이메일 텍스트 검색 부재. orders 탭 `TextInput` 패턴 재사용 가능. (stores T6·orders F1과 대칭)
- **F2. 새로고침 버튼 없음** — hook에 `reload` 있으나 UI 미노출. approve/suspend 후 자동 reload만 존재, 외부 변경 수동 갱신 불가. (stores T9·orders F2와 동일)
- **F3. 가입일 미표시** — `createdAt` 수신하나 화면에 없음. 승인 판단에 가입 시점 유용. 카드에 표시만 추가(저위험).
- **F4. 드라이버 상세 정보 부재** — 이름·이메일만. 전화번호·차량 등 운영 정보 없음. (백엔드 데이터모델 의존 → 필드 존재 여부 선확인 필요, 별도 SDD 가능성)
- **F5. 정렬·페이지네이션 없음** — 가입일 desc 고정, `limit(100)`. (현 규모 미달이나 부채 기록)
- **F6. 액션 후 카드 사라짐 UX 보강** — approve/suspend 후 reload가 같은 탭만 갱신하므로, 방금 누른 카드는 현재 탭 모수에서 즉시 빠짐(승인대기→승인완료, 승인완료→정지). 어드민 입장에서 "방금 누른 카드가 사라졌네?" 의외성 가능. 옵션 = (a) 토스트 강화로 추적 보장 (b) 자동 탭 이동(승인 후 승인완료로 점프) (c) 현 동작 유지. (저우선, 별도 SDD)

## C-5. 표현 레이어 — 소소한 정리

- **R1. 액션 버튼 분기 JSX 분산** — `DriverList.tsx:62-95` 승인/정지/해제 버튼이 `ACTION_META`(`_lib`)와 별개로 JSX에 흩어짐. `DriverBadge`처럼 메타 기반 렌더로 SSOT화 여지. (선택, 저우선)
- **R2. 탭 스타일 인라인 중복** — `_client.tsx:50-68` 탭 스타일이 타 탭과 중복. 세션86 정산 탭의 공통 `SegmentedTabs`로 통일 가능. (선택)

## C-6. 아토믹 태스크 (의존순) — 확정 대기

### 그룹 A — 핵심 배선 (이번 범위)
- **T1 (C-2). status 서버 필터 배선** — `useAdminDrivers`가 status를 쿼리로 전달(`/admin/drivers?status=...`), 탭 전환 시 재조회. `filterByTab`(클라 필터)은 백엔드 위임으로 축소/제거. 로딩·빈결과에서도 탭 유지(세션86 C6). **사용자 확정 = 서버 필터.** (백엔드 무변경 — 이미 완비)
  - 정합성: 'all' 탭은 status 미전달(전체). limit(100) 누락은 별도(T5).

### 그룹 B — 타입·기능 (저위험)
- **T2 (C-3). 타입 정리** — service `any` → 최소 인터페이스, `AdminDriver.suspended` 기본값 정합(undefined→false 일관). (독립)
- **T3 (F3). 가입일 표시** — 카드에 `createdAt` 표기(KST 포맷, `todayKST` util 계열 재사용). (독립, 저위험)
- **T4 (F1). 검색** — 이름·이메일 `TextInput` 필터. 클라이언트 필터(백엔드 무변경). 로딩·빈결과에서 유지(C6). (의존: 없음)
- **T5 (F2). 새로고침 버튼** — `_client.tsx`에 reload 노출. (독립)

### 그룹 C — 선택 (과분할 주의)
- **R1·R2** — 액션 버튼 메타화 / 공통 SegmentedTabs 통일. 우선순위 최하.

### 제외 (별도 SDD / 범위 밖)
- **F4 드라이버 상세 정보** — 데이터모델 필드 확인 + (없으면) 백엔드 신설.
- **F5 정렬·페이지네이션** — 백엔드 쿼리·커서 변경(현 규모 미달).

## C-7. 커밋 단위 (한 태스크씩 — 세션92~ 아토믹 패턴)
T1 / T2 / T3 / T4 / T5 / (R1·R2 선택).
**각 태스크 = 세션 분리·커밋 분리·푸시 분리·운영 배포 확인 분리** (grill-me Q-P1 확정).
세션91 패턴(탭별 한 커밋)에서 세션92 이후 **태스크별 한 세션** 패턴으로 강화됨.

## C-8. 차기 진입점
- 구현 착수 = **S1(T1 — status 서버 배선)부터.** 본 문서 §C-9 세션 S1 체크리스트(10항목) 그대로 따른다.
- S1 통과 → S2(T2 타입 정합) → S3(e2e) 순서. 각 세션 사이 운영 배포·육안 통과 대기 필수.
- 정산 탭(세션86) 육안 선례 = 탭별 재조회·전체복귀 회귀 확인 필요 → 본 문서 §C-9 S1-7(육안 §5 신설)에 흡수.

## C-9. 해야 할 작업 — 세션95 `/further` + grill-me 확정 (착수 대기)

> 출처: 2026-05-26 세션95 `/further` 4-결정 + grill-me 12-결정. 상세 계획서 = [`../../plans/admin-drivers-T1-T2-plan.md`](../../../plans/admin-drivers-T1-T2-plan.md).
> 본 항목은 구현 착수 시점에 §C 진단을 그대로 따른다(중복 본문 금지 — 결정·범위만 기록).

### 사용자 확정 (12결정 — `/further` 4 + grill-me 8 통합)
- **방향** = 숨은 결함부터 고치고 나머지(F1·F2·F3·F4·F5·F6·R1·R2)는 §C-4·§C-5에 기록 보존 → 별도 세션.
- **결함 범위** = **T1(status 서버 필터 배선) + T2(타입 정합)** 두 결함을 **별개 아토믹 태스크**로 처리.
- **세션 분절(아토믹 원칙)** = **S1(T1) / S2(T2) / S3(e2e)** **세 세션 분리**. 각 세션은 자체 커밋·자체 푸시·자체 운영 배포·자체 육안 통과를 끝낸 뒤에야 다음 세션 진입.
- **성공 기준** = 4탭(승인대기·승인완료·정지·전체) 각각 맞는 드라이버만 나옴 + 승인·정지 후 시각·기능 회귀 0. 100명 초과 시드 재현은 범위 밖(빌드·타입 검증 + 육안으로 갈음).
- **'전체' 탭 처리** = **status 미전달**(지금 동작과 동일 — 정지 포함 전부).

### grill-me 추가 확정 (세부 설계)
1. **시그니처** = `useAdminDrivers({ status }: { status: DriverStatus })` — 타 탭 선례(orders/settlements) 동형. `status === 'all'`이면 hook 내부에서 쿼리 미전달. (SSOT — 호출부는 탭 키 그대로 전달)
2. **캐싱** = 신규 인프라 없이 기존 `useAdminList` deps 메커니즘 그대로. `withQuery('/admin/drivers', { status })` + `deps=[filters?.status]`. 탭 전환 시 매번 fetch(로딩 깜빡임 허용).
3. **`filterByTab` 함수** = 재사용처 0 확인 후 **완전 제거**(`_lib.ts`).
4. **`limit(100)` 한도** = T1 범위 밖, F5 부채로 묶어 보존.
5. **service `any` 교정 범위** = `getDrivers` 내부 **로컬 `DriverRow` 인터페이스만** 신설. shared 도메인 타입 건드림 안 함.
6. **`!!driver.suspended` 정규화 범위** = `DriverBadge` + `DriverList` **둘에만**. `AdminDriver.suspended`는 옵셔널 유지(데이터 진실에 가깝다).
7. **승인/정지 액션 후 UX** = 카드가 다른 탭으로 사라지는 동작 그대로 — **F6**으로 §C-4에 신설하고 본 범위 밖.
8. **육안 시드** = 현 운영 데이터로 갈음. 부족한 status 조합이 있으면 그때만 시드 추가.

### 세션 S1 — T1 (status 서버 필터 배선)

> **세션 단독 목표**: 백엔드 status 분기 활성화 + 클라 필터 잔재 제거. 런타임 동작 변화 1건, 시각 회귀 0 보장.

#### S1 체크리스트
- [x] **S1-1.** `useAdminDrivers`를 `useAdminDrivers({ status }: { status: DriverStatus })`로 시그니처 확장.
- [x] **S1-2.** hook 내부에서 `status === 'all' ? undefined : status`로 분기, `withQuery('/admin/drivers', { status: <분기결과> })` 합성.
- [x] **S1-3.** `useAdminList`의 `deps`에 `[status]` 전달(타 탭 선례 동형, 탭 전환 시 자동 재조회 발생).
- [x] **S1-4.** `_client.tsx`에서 `filterByTab(allDrivers, tab)` 호출 제거 → hook 반환 `drivers` 직접 사용. `useAdminDrivers({ status: tab })`으로 호출부 갱신.
- [x] **S1-5.** `_lib.ts`의 `filterByTab` 함수 **재사용처 0 확인 후 완전 제거**. (Grep `filterByTab` repo-wide)
- [x] **S1-6.** 로딩·빈결과에서도 탭 UI 유지 — `_client.tsx` early return 제거·삼항 재배치(세션86 C6 가드 동형).
- [x] **S1-7.** **육안 검증 문서 `pending-visual-verify.md` §14(어드민 드라이버 4탭) 신설** — 코드 완료 직후·**커밋 전**. 항목 = ① 4탭 각각 진입 시 모수 일치 ② 'all' 탭 = 정지 포함 전부 ③ approve 후 카드 사라짐(승인대기 → 승인완료) ④ suspend 후 카드 사라짐(승인완료 → 정지) ⑤ 시각 회귀 0.
- [x] **S1-8.** **정합성검토 (C1~C7 — §0 공통 기준)**.
  - C1 tsc 0 (admin·seller·consumer)
  - C2 biome 0 (신규 경고 0)
  - C3 `npm run build` 0 (⚠️ `npx next build` 금지)
  - C4 500라인 한도 (현 최대 102 → 변동 없음)
  - C5 SSOT 토큰 (status 라벨은 기존 `_lib` STATUS_TABS 재사용)
  - C6 가드 유지 (로딩·빈결과에서 탭 표시)
  - C7 시각 회귀 0 (DOM 동일)
- [x] **S1-9.** **커밋** — `refactor(admin): #CL-55 drivers 탭 status 서버 필터 배선 (T1)`. 푸시·배포는 사용자 지시 대기.
- [ ] **S1-10.** **운영 배포 후 육안 통과 (§5 체크리스트)** — 통과 시 S1 종결, S2 진입 가능.

### 세션 S2 — T2 (타입 정합)

> **세션 단독 목표**: `any` 제거 + `suspended` 옵셔널 분기 정규화. 런타임 영향 0(시각·기능 회귀 0).

> **선행 조건**: S1이 운영 배포·육안 통과 완료. S1 미통과 상태에서 S2 진입 금지.

#### S2 체크리스트
- [x] **S2-1.** `admin.service.ts` `getDrivers` 내부에 로컬 `DriverRow` 타입 신설 — `id`·`name`·`email`·`driverApproved: boolean`·`suspended?: boolean`·`createdAt: unknown`. `d.data()` 반환 타입을 좁힘.
- [x] **S2-2.** `DriverBadge.tsx`에서 `suspended` 분기를 `!!driver.suspended`로 명시.
- [x] **S2-3.** `DriverList.tsx`에서 액션 버튼 분기(`driver.suspended ? '복구' : '정지'`)를 `!!driver.suspended` 기준으로 명시.
- [x] **S2-4.** `AdminDriver.suspended`는 **옵셔널 유지**(`suspended?: boolean`) — 데이터 진실 보존. 타입 변경 금지.
- [x] **S2-5.** **정합성검토 (C1~C7 — §0 공통 기준)**.
  - C1 tsc 0 (특히 `getDrivers` 좁히기로 `any` 경고 사라지는지 확인)
  - C2 biome 0
  - C3 `npm run build` 0
  - C4 500라인 한도
  - C5 SSOT 토큰 (변경 없음)
  - C6 가드 유지 (변경 없음)
  - C7 시각 회귀 0 (런타임 영향 0 → DOM 동일)
- [x] **S2-6.** **커밋** — `refactor(admin): #CL-55 drivers 탭 any 제거·suspended 분기 정규화 (T2)`. 푸시·배포는 사용자 지시 대기.
- [ ] **S2-7.** **운영 배포 후 육안 통과 (§5 재사용 — 시각·기능 회귀 0 확인)** — 통과 시 S2 종결, S3 진입 가능.

### 세션 S3 — e2e (4탭 재조회·자명 노출 증명)

> **세션 단독 목표**: T1 배선이 영구 보장되도록 e2e 박제. 세션 90 어드민 e2e 인프라 재사용.

> **선행 조건**: S1·S2 모두 운영 배포·육안 통과 완료. 코드 변경은 e2e 스펙 외 0.

#### S3 체크리스트
- [x] **S3-1.** 세션 90 어드민 e2e 인프라(`apps/e2e/tests/*.spec.ts`) 위치·진입점 확인. `ADMIN_STATE_PATH` 세션 격리, `domcontentloaded` 대기, `.env` 로드 패턴을 재사용했다.
- [x] **S3-2.** 신규 스펙 `apps/e2e/tests/admin-drivers-status-filter.spec.ts` 작성 — 시나리오 4건:
  - **사례 A**: '승인대기' 탭 진입 → `GET /admin/drivers?status=pending` 호출 관측 → 응답 명단 = 화면 카드 명단(이름·id 1:1 비교).
  - **사례 B**: '승인완료' 탭 진입 → `?status=approved` 관측 → 명단 일치.
  - **사례 C**: '정지' 탭 진입 → `?status=suspended` 관측 → 명단 일치.
  - **사례 D**: '전체' 탭 진입 → **status 쿼리 미전달**(`/admin/drivers`로 호출되는지 확인) → 정지 포함 전부 노출.
- [x] **S3-3.** approve/toggleSuspend 액션 검증은 **본 e2e 범위 밖**(grill-me Q-P2 확정 — 운영 데이터 부수효과 우려).
- [x] **S3-4.** 시드 = 운영 쓰기 없이 네트워크 fixture 사용. 4탭 모수는 pending/approved/suspended 3개 fixture로 보장하고, 전체 탭은 정지 포함 3건을 검증했다.
- [x] **S3-5.** **정합성검토** — 로컬 최신 seller 서버 기준 e2e 8/8(chromium·mobile), `pnpm typecheck` 0, 변경 파일 biome 0. 빌드는 변경 없음.
- [x] **S3-6.** **커밋** — `test(admin): #CL-55 drivers 탭 status 서버 필터 e2e 4건 (S3)`. 푸시는 사용자 지시 대기.
- [ ] **S3-7.** **CI 통과 후 #CL-55 §C 종결 선언** — 세션 메모리 `project_admin_tabs_improve.md` 갱신.

### 제외(별도 세션 — §C-4·§C-5 보존)
- **F1** 검색(이름·이메일) / **F2** 새로고침 버튼 / **F3** 가입일 표시 / **F4** 드라이버 상세(전화·차량, 데이터모델 선확인 필요) / **F5** 정렬·페이지네이션·`limit(100)` 한도 / **F6** 승인/정지 후 카드 자동 이동 vs 토스트 강화 (grill-me Q2-c 신설) / **R1** 액션 버튼 메타화 / **R2** 공통 `SegmentedTabs` 통일.

### 차기 진입점(C-8 보강)
- **S1(T1) → 운영 배포·육안 → S2(T2) → 운영 배포·육안 → S3(e2e) → CI 통과 → 종결**.
- 각 세션 사이 사용자 운영 배포·육안 통과 대기 반드시.
- 육안 = `pending-visual-verify.md` §5(S1 단계에서 신설).

---

## 참고 문서

### 본 탭이 직접 참조하는 외부 문서
- **세션95 `/further` 확정 상세 계획서** — [`../../plans/admin-drivers-T1-T2-plan.md`](../../../plans/admin-drivers-T1-T2-plan.md)
  - T1+T2 한 묶음 착수 시 본 계획서를 따른다. 4-결정·체크리스트 출처.
- **육안 검증 (코드 완료 후 §5 신설 예정)** — [`../pending-visual-verify.md`](../pending-visual-verify.md)
  - 4탭 재조회·전체복귀·승인·정지 후 시각·기능 회귀 0.
- **선결 결정·별도 SDD 후보 (이번 범위 제외)**
  - **F4 드라이버 상세 정보** — 데이터모델(전화·차량 등) 필드 선확인 → 없으면 백엔드 신설.
  - **F5 정렬·페이지네이션** — 백엔드 쿼리·커서 변경. 현 규모 미달 부채.

### 상위 인덱스 · 로드맵
- 통합 인덱스: [`../admin-tabs-improve-plan.md`](../admin-tabs-improve-plan.md)
- 멀티앱 리팩토링 로드맵: [`../app-refactor-roadmap.md`](../app-refactor-roadmap.md) — §4 드라이버 앱 리팩토링(차기 진입점).

### 인접 어드민 탭
- [stores](./admin-tab-stores-plan.md) · [orders](./admin-tab-orders-plan.md) · [settlements](./admin-tab-settlements-plan.md) · [users](./admin-tab-users-plan.md) · [invite](./admin-tab-invite-plan.md) · [banner](./admin-tab-banner-plan.md)

### 선례
- 세션86 정산 status 필터(`pending-visual-verify.md` §1-V) — 백엔드/hook 완비, UI 한 겹만 비어 있던 동형 결함의 해소 패턴.
- 세션91 SDD 분리 — `124768a` drivers 탭 SDD 분리(228→92), 과분할 회피.
- 세션85 타임존 KST 보정 — `todayKST`/`toDateStrKST` util(T3 가입일 표시 재사용).

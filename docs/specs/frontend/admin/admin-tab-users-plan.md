# 어드민 소비자(users) 탭 개선 — 아토믹 태스크 (#CL-55 §E)

> **출처:** `admin-tabs-improve-plan.md` §E (세션96 진단). 세션92 grill-me로 전 분기 해소(2026-05-26).
> SDD 분리는 세션91에 끝남(`_client`→`page`+`_client`+`_components/UsersTable`, `5bf29ff`).
> 순수함수가 없어 `_lib` 미생성(과분할 회피, 세션91 확정). 본 진단은 그 위의
> **기능 부재(검색·필터 전무)·정지 효과 결함·표시 정보 빈약·표현 중복** 정리.
>
> **사용자 확정(세션92 grill-me 종결) = 4축 전부 작업, 단 R1·R2·F3·F5는 별도 SDD.**
> 셀러앱 손님 정보(구 §E-11)는 본 문서에서 제거, 상위 인덱스에 한 줄 링크로 위임.

## 0. 공통 정합성 검토 기준 (모든 어드민 탭 공통)

각 커밋 직전 아래를 모두 통과해야 한다(세션85~91 동일).

- **C1 tsc 0** — 어드민·셀러·소비자 3앱 전체. shared·api 변경 시 재검증.
- **C2 biome 0** — 신규 경고 0.
- **C3 `npm run build` 0** — ⚠️ `npx next build` 금지(Turbopack 충돌).
- **C4 500라인 한도** — 단일 파일 500라인 초과 시 즉시 분할.
- **C5 SSOT 토큰** — 하드코딩 색·라벨 0, shared 재사용.
- **C6 가드 유지** — 로딩·빈결과에서도 검색·필터 유지(세션86 선례).
- **C7 시각 회귀 0** — 신규 요소 추가(D1 외 모두)는 의도적 변경, 육안 대상.

---

## E-1. 진단 대상 파일 (현 상태)
| 파일 | 라인 | 역할 |
|------|------|------|
| `users/page.tsx` | 8 | dynamic ssr:false 래퍼 |
| `users/_client.tsx` | 76 | 상태(processingId·pending)·toggleSuspend 핸들러·ConfirmModal |
| `_components/UsersTable.tsx` | 160 | 모바일 카드 / 데스크톱 테이블 (반응형 세션88) |

→ 모두 500 한도 내. `_lib` 없음(순수함수 부재). T3에서 `filterUsers` 도입으로 `_lib.ts` 신설.
hook = `useAdminUsers`(`useAdmin.ts:194`), 백엔드 = `getUsers`/`suspendUser`(`admin.service.ts:86-113`).

## E-2. 정합성 진단 — 🔴 검색·필터 전무 (7개 탭 중 가장 비어 있음)

| 항목 | 현황 | 비교 |
|------|------|------|
| 검색(이름·이메일·전화) | ❌ 없음 | drivers·orders 모두 검색 부재(공통 부채)이나 **소비자는 증가 속도 1위 집단** |
| 상태 필터(정상/정지) | ❌ 전체만 | drivers는 `STATUS_TABS`(대기/승인/정지) 보유 — 비대칭 |
| 정렬·페이지네이션 | ❌ 없음 | — |
| **백엔드 limit** | ❌ **없음**(`getUsers`가 limit 없는 전량 `.get()`) | orders는 `limit(200)`, drivers `limit(100)`, settlements `limit(500)` — **users만 무제한** |

→ **소비자는 판매자·드라이버와 달리 수가 빠르게 늘어나는 집단인데 검색·필터·정렬·페이지가 전무.**
운영 규모가 커지면 특정 소비자를 찾을 방법이 없고, 백엔드 `getUsers`도 limit 없는 전량 로드라 **확장성 결함**(타 탭 대비 유일하게 하드캡조차 없음).

## E-3. 정합성 진단 — 🔴 정지(suspended) 효과 결함 (grill-me 조사 결과)

| 레이어 | suspended 체크 | 위치 |
|--------|---------------|------|
| 비번 로그인 | `userData.suspended===true` → 401 차단 | `auth.service.ts:133` |
| 카카오 로그인 | `userData.suspended===true` → 401 차단 | `auth.service.ts:304` |
| **refresh 토큰 교환** | ❌ **체크 없음** | `auth.service.ts:329 refresh()` |
| 이미 발급된 access JWT | ❌ 체크 없음 | (가드·주문 경로에 suspended 검사 부재) |

**세션92 조사 결과 (실측):**
- access token = **1시간** (`JWT_EXPIRES_IN=1h`, `auth.module.ts:16`)
- refresh token = **30일** (`JWT_REFRESH_EXPIRES_IN=30d`, `auth.service.ts:379`)
- refresh 경로에 suspended 검사 부재 → **정지 후 최대 30일간 새 access 계속 발급 가능**

→ 정지는 로그인 시점만 차단되고, 로그인된 세션은 refresh로 30일간 우회 가능 = **실질 무력화**.
판매자 "치우기"(#CL-53)처럼 기록 가드도 없음.

→ **사용자 확정(D1) = `refresh()`에 suspended 한 줄 추가.** 차단 지연 최대 1시간(access 자연 만료)
  수용, JwtAuthGuard 매요청 DB read 회피로 비용 0. 가장 작은 변경·가장 큰 효과.

## E-4. 기능 부재 (표시 정보)

- **F1. 가입일 미표시** — `AdminUser.createdAt`(`useAdmin.ts:25`) 수신하나 화면에 없음. 가입 시점은 소비자 식별·CS에 유용. → **T1에 포함.**
- **F2. 전화번호 미표시** — `AdminUser.phone`(`useAdmin.ts:23`) 옵셔널 수신하나 화면에 없음. CS 시 연락 수단. → **T1에 포함.** 근거 = 셀러·드라이버 앱이 이미 buyerPhone 사용 중(`OrderCard.tsx` 등), 어드민이 더 강한 권한이라 마스킹 없이 전체 표시. 노출 정책 변경 0.
- **F3. 소비자→주문 이력 연결 없음** — 소비자 클릭 시 해당 유저 주문 보기 동선 부재. orders 백엔드에 `userId` 필터 신설 필요. → **별도 SDD**(stores F7·orders F3과 묶어 어드민 교차 필터 일괄).
- **F4. 새로고침 버튼 없음** — hook `reload` 있으나 UI 미노출. → **T2에 포함**, 헤더 우측 `IconRefresh` 표준 위치 = 후속 6탭 선례.
- **F5. 감사 로그 부재** — 누가 언제 정지/복구했는지 기록 없음. drivers·stores 정지에도 동일 결함. → **별도 SDD**(adminAuditLogs 컬렉션 신설 어드민 전역).

## E-5. 표현 레이어 — 소소한 정리 (본 범위 제외)

- **R1. `thBase` 스타일 상수 탭마다 중복** — `UsersTable.tsx:12`가 자체 `thBase` 선언. stores·orders·settlements 테이블도 각자 동일 상수 선언 → 어드민 공통 `_shared`로 추출 여지. **단독 해소 불가**(교차 변경) → **별도 SDD**.
- **R2. 테이블/카드 이중 렌더 패턴 5탭 반복** — 데스크톱 `<table>`(visibleFrom) + 모바일 `<Stack>` 카드(hiddenFrom) 구조가 5개 테이블에 반복. 제네릭 `<AdminTable columns rows>` 추출 후보. ⚠️ **과분할·추상화 비용 큼**(세션91 users/banner 과분할 회피 전례) → **별도 SDD**, 우선순위 최하.

---

## E-6. 아토믹 태스크 — 최종 확정 (세션92 grill-me 반영)

### 그룹 D — 정지 결함 차단 (최우선, 코드 시작 전)

#### **D1. refresh()에 suspended 차단 추가** (백엔드 단독, 독립 PR)
- **변경:** `apps/api/src/auth/auth.service.ts:329 refresh()` 메서드에서 user 문서 조회 후 `userData.suspended===true`면 401. `auth.service.ts:133`·`:304`의 기존 로그인 차단 로직과 동일 패턴.
- **선택:** 정지 시 `refreshTokens/{userId}` 즉시 delete까지는 하지 않음(차단 지연 최대 1시간 수용, 단순성 우선).
- **테스트:** vitest로 refresh-suspended 케이스 신설(현재 auth에 단위테스트 부재 시 인프라부터). e2e는 §E-9 참조.
- **위험:** 0. 기존 로그인 차단 로직 재사용. 인증 정상 사용자 영향 없음.
- **선행 = 없음.** T1~T4와 무관(parallel 가능하나 우선순위 최상).

### 그룹 A — 표시 정보 보강 (저위험, 묶음 커밋)

#### **T1. 가입일·전화 표시 (F1+F2)**
- **변경:**
  - `_components/UsersTable.tsx` 데스크톱: `<th>가입일</th>`·`<th>전화</th>` 컬럼 2개 추가
  - `_components/UsersTable.tsx` 모바일 카드: 이메일 아래에 `가입일` 별도 줄, `전화` 별도 줄
  - 가입일 = shared `toDateStrKST(createdAt)` 재사용(세션85 util)
  - 전화 = `phone || '—'` 폴백, 마스킹 없음
- **선행 = 없음.** T2와 함께 한 PR 묶음.
- **위험:** 모바일 카드 높이 증가 = C7 시각 회귀 항목. 의도적 변경, 육안 §추가.

#### **T2. 새로고침 버튼 (F4)**
- **변경:** `users/_client.tsx`에 `useAdminUsers().reload` 노출. 제목 헤더 우측에 `<ActionIcon><IconRefresh/></ActionIcon>`. 로딩 중 `loading` prop.
- **표준 위치 약속:** 후속 6개 탭(stores·orders·drivers·settlements·invite·banner)도 동일 위치 따라감(SDD 부채 기록).
- **선행 = 없음.** T1과 묶음 커밋.
- **위험:** 0.

### 그룹 B — 검색·필터 (이번 범위 핵심)

#### **T3. 검색·상태 필터 (E-2)**
- **신설 파일:**
  - `_components/UsersFilters.tsx` — `<TextInput placeholder="이름·이메일·전화">` + `<SegmentedTabs items=[전체,정상,정지] layout="scroll">`. 기본 탭 = '전체'.
  - `_lib.ts` — `filterUsers(users, {keyword, status})` 순수함수 신설(세션91 미생성 → 필터 도입으로 정당화).
  - `_lib.test.ts` — vitest 동반(세션85 선례). 5케이스: 공백·대소문자·하이픈 제거·빈 필드·정상+정지 분기.
- **변경:** `users/_client.tsx`에서 Mantine `useDebouncedValue(keyword, 200)` 적용 → `filterUsers(users, {debouncedKeyword, status})` → `<UsersTable>`.
- **검색 정규화:**
  - 이름·이메일 = `value.toLowerCase().includes(keyword.toLowerCase())`
  - 전화 = 입력·필드 모두 `replace(/-/g, '')` 후 includes
- **빈결과 카피 분기:**
  - 필터 적용 중 = "검색 결과 없음"
  - 원본 전체 빈 = "소비자 없음"
  - 판정: `users.length===0` vs `filteredUsers.length===0 && users.length>0`
- **C6 가드:** 로딩(`pending`)·빈결과에서도 `<UsersFilters>` 유지(early return 금지, 삼항 재배치).
- **모바일 UI:** 검색 인풋 1줄 + SegmentedTabs 1줄 수용(첫 화면 카드 1~2장만 보임, orders·settlements 선례).
- **선행 = T1·T2 PR 머지 후(컴포넌트 트리 안정화 후).**
- **위험:** C6 가드 누락 시 필터 사라짐 회귀. tsc·biome·build 통과 + 육안 검증.

#### **T4. getUsers 백엔드 limit·정렬 (E-2 한도)**
- **변경:** `apps/api/src/admin/admin.service.ts:86 getUsers()`에 `.orderBy('createdAt','desc').limit(5000)` 추가.
- **limit 값:** `5000`으로 확정. T3 클라이언트 필터와 모순 없는 큰 캡을 두되, 5000건 초과 운영 규모가 확인되면 서버 검색·커서 페이지네이션을 별도 SDD로 승격한다.
- **선행 = T3 PR 머지 후(클라이언트 필터의 한계 측정 후 적정 limit 결정 가능).** 2026-05-29 S4에서 반영 완료.
- **위험:** 정렬 추가 시 Firestore 복합 인덱스 필요 가능 → 배포 전 인덱스 확인(세션80 선례).

### 별도 SDD — 본 범위 제외 (E-7 제외군)
- **F3** 소비자→주문 드릴다운 — orders 백엔드 `userId` 필터 + stores F7·orders F3과 어드민 교차 필터 일괄 SDD
- **F5** 감사 로그 — `adminAuditLogs` 컬렉션 신설, drivers·stores 정지도 일괄
- **R1** thBase 공통화 — 어드민 공통 컴포넌트 SDD
- **R2** AdminTable 추출 — 어드민 공통 컴포넌트 SDD

---

## E-7. 세션별 진행표 (최종)

각 세션은 **1세션 1축** 원칙. 세션 종료 시점에 정합성 검토(§E-8) 전부 통과해야 함.

| 세션 | 범위 | 산출물 | 정합성 | 비고 |
|------|------|--------|--------|------|
| **S1** | D1 단독 | `auth.service.ts` refresh()에 suspended 차단 + vitest | C1~C3 (백엔드 only) | 정지 결함 30일→1시간 단축. 가장 시급 |
| **S2** | T1+T2 묶음 | `UsersTable.tsx` 가입일·전화 표시 + `_client.tsx` 새로고침 버튼 | C1~C5, C7 | 저위험. 모바일 카드 높이 회귀 의도적 |
| **S3** | T3 단독 | `UsersFilters.tsx`·`_lib.ts`·`_lib.test.ts` 신설 + `_client.tsx` 통합 | C1~C7 전부 | 본 범위 핵심. vitest 첫 통과 후 PR |
| **S4** | T4 단독 | `admin.service.ts:getUsers` limit·orderBy + 인덱스 배포 | C1~C3, 인덱스 확인 | user 수 확인 후 limit 값 확정 |
| **S5** | e2e | `apps/e2e/tests/admin-users.spec.ts` 신설 | 새 코드 반영 프리뷰에서 playwright 0 fail | fixture 격리로 운영 DB 쓰기 0 |
| **S6** | 육안 종결 | `pending-visual-verify.md` §추가 항목 전수 통과 | 사용자 확정 | 운영 배포 후 |

### 세션 간 의존
```
S1 (D1 백엔드)          ─┐
                          ├─→ S5 (e2e)
S2 (T1+T2 표시)          ┤
       ↓                  │
S3 (T3 검색·필터)        ┤
       ↓                  │
S4 (T4 limit)            ─┘
       ↓
      S6 (육안)
```
- **S1은 S2~S4와 독립** — 백엔드 단독, 가장 먼저(우선순위 최상) 혹은 병행 가능
- **S2 → S3 → S4 순차** — T3 필터가 T1·T2 변경된 UsersTable 위에서 동작, T4 limit는 T3 필터의 한계 측정 후
- **S5는 S1~S4 전부 머지된 환경에서만** — e2e가 검색·필터·정지·refresh 차단을 모두 검증

### 세션당 작업량 추정
- **S1** = 짧음(소). 백엔드 한 줄·테스트 한 건. 1세션 내 완결.
- **S2** = 짧음(소). 표현 레이어 2곳·핸들러 1곳. 1세션 내 완결.
- **S3** = 중. 신설 3파일·기존 1파일 통합·vitest·C6 가드·모바일 UI. 1세션 내 완결 추정.
- **S4** = 짧음(소). 백엔드 한 줄·인덱스 1건. user 수 확인 답변 도착 후 1세션.
- **S5** = 중. e2e 시나리오 4건. 시드·인증·셋업 포함. 1세션 내 완결 추정.
- **S6** = 사용자 위임(코드 작업 없음).

---

## E-8. 정합성 검토 기준 (세션별 체크리스트)

각 세션 커밋 직전 아래를 빠짐없이 통과한다. **하나라도 실패하면 커밋 금지.**

### S1 (D1 백엔드) 체크리스트
- [x] **C1 tsc 0** — `pnpm --filter api exec tsc --noEmit` 0 (2026-05-29)
- [ ] **C2 biome 0** — `pnpm --filter api lint`는 기존 ESLint 부채 409 errors/24 warnings로 실패. 신규 `auth.service.spec.ts` 단독 ESLint는 0.
- [x] **C3 build 0** — `pnpm --filter api build` 0 (2026-05-29)
- [x] **jest** — `auth.service.spec.ts`에 refresh-suspended 케이스 추가, 2/2 통과 (api 현재 테스트 러너는 jest)
- [x] **회귀 0** — 정상 사용자 refresh rotation 후 새 토큰 발급 케이스 통과
- [ ] **수동 확인** — 정지된 사용자로 refresh API 호출 → 401 응답

### S2 (T1+T2) 체크리스트
- [x] **C1 tsc 0** — `pnpm --filter seller exec tsc --noEmit` 0 (2026-05-29)
- [ ] **C2 biome 0** — `pnpm --filter seller lint` 종료 코드 0, 기존 `<img>` 경고 2건 유지. 신규 users/proxy 경고 0.
- [x] **C3 build 0** — `pnpm --filter seller build` 0 (2026-05-29, `next build --webpack`)
- [x] **C4 500라인** — `_client.tsx` 108, `UsersTable.tsx` 236, `proxy.ts` 36 (2026-05-29 최종 재측정)
- [x] **C5 SSOT** — 가입일은 shared `toDateStrKST` 재사용, 전화 빈값은 `-` 표시
- [ ] **C7 시각 회귀** — 데스크톱 테이블 컬럼 너비 회귀 0(기존 컬럼 유지), 모바일 카드 높이 증가는 의도

### S3 (T3 검색·필터) 체크리스트
- [x] **C1 tsc 0** — `pnpm --filter seller exec tsc --noEmit` 0 (2026-05-29)
- [x] **C2 biome 0** — `pnpm --filter seller lint` 종료 코드 0, 기존 `<img>` 경고 2건만 유지(신규 users 경고 0)
- [x] **C3 build 0** — `pnpm --filter seller build` 0 (2026-05-29, `next build --webpack`)
- [x] **C4 500라인** — `_client.tsx` 108, `UsersFilters.tsx` 38, `_lib.ts` 49, `_lib.test.ts` 79, `UsersTable.tsx` 236 (2026-05-29 최종 재측정)
- [x] **C5 SSOT** — `USER_STATUS_TABS`와 `UserStatusFilter`를 `_lib.ts`에 두고 `SegmentedTabs` 재사용
- [x] **C6 가드** — `<UsersFilters>`를 `<UsersTable>` 위에 고정 렌더, 로딩·빈결과 분기에서도 유지
- [ ] **C7 시각 회귀** — 로컬 `/admin/users`는 인증·Firebase env 오류로 실제 관리자 화면 육안 확인 미완료
- [x] **vitest** — `_lib.test.ts` 8케이스 전부 통과
- [x] **디바운스 동작** — `useDebouncedValue(keyword, 200)`로 적용
- [x] **검색 매칭** — 이름·이메일 대소문자 부분일치, 전화 하이픈 제거 매칭을 vitest로 확인

### S4 (T4 백엔드 limit) 체크리스트
- [x] **C1 tsc 0** — `pnpm --filter api exec tsc --noEmit` 0 (2026-05-29)
- [ ] **C2 biome 0** — `pnpm --filter api exec eslint src/admin/admin.service.ts src/auth/auth.service.ts src/auth/auth.service.spec.ts`는 기존 `any` 계열 ESLint 부채 148 errors/1 warning으로 실패. S4 신규 변경 자체의 타입체크·빌드는 통과.
- [x] **C3 build 0** — `pnpm --filter api build` 0 (2026-05-29)
- [ ] **인덱스** — `firestore.indexes.json`에 `users(role ASC, createdAt DESC)` 추가 완료. 운영 배포 확인은 미완료.
- [ ] **회귀 0** — 어드민 users 탭 데이터 로딩 정상, 정렬 순서 신규(최신순) 확인
- [ ] **수동 확인** — limit 값이 실제 user 수보다 큰지 재확인

### S5 (e2e) 체크리스트 — §E-9에서 상세

- [x] **e2e 파일 신설** — `apps/e2e/tests/admin-users.spec.ts` 9시나리오 × 2프로젝트 = 18건
- [x] **데이터 격리** — `GET /admin/users`, `PATCH /admin/users/:id/status`를 Playwright route fixture로 가로채 운영 DB 쓰기 0
- [x] **표시 필드 커버** — 데스크톱 테이블과 모바일 카드의 가입일·전화 표시 검증 포함
- [x] **새로고침 커버** — `reload` 클릭 시 목록 재조회 count 증가 검증 포함
- [x] **검색·상태 필터 커버** — 이름·이메일·전화 검색, 전체·정상·정지 탭, 검색 결과 없음 문구 검증 포함
- [x] **정지 모달 회귀 커버** — 검색·필터 적용 상태에서 ConfirmModal과 `suspended: true` 요청 본문 검증 포함
- [x] **playwright 0 fail** — 2026-06-02 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 chromium·mobile 18/18 통과. 전화 하이픈 정규화와 복구 `suspended:false` 요청 본문 포함.

---

## E-9. e2e 작업 플랜 (세션 S5)

**전제:** S1~S4 모든 코드가 머지·프리뷰 또는 운영 배포 완료 + 어드민 e2e 인프라(세션90 신설, 8/8 통과) 재사용.

**환경:**
- 운영 단일 Firestore(green-e4fe3) + 카카오 로그인만 가능(`reference_visual_verify_env`)
- 어드민 계정 = 운영 admin 1명(정연, role=admin·storeId=난플렉스)
- 세션 격리·networkidle·dotenv# 함정 회피(세션90 선례)

### 시나리오 (4건)

#### **E2E-1. D1 — 정지 사용자 refresh 차단**
- **선결:** 테스트 소비자 계정 1개에 `suspended=true` 세팅(시드 스크립트 신설 — `scripts/seed-suspended-user.ts`)
- **흐름:**
  1. 정지 직전에 발급된 refresh token 보유(시드에 포함)
  2. `POST /auth/refresh` with refreshToken → **401 기대**
  3. 응답 메시지 = "정지된 사용자입니다" 또는 동등 카피
- **회귀 가드:** 정상 사용자 refresh는 200 정상 발급
- **추정 작업:** 시드 1·테스트 2(정지·정상). 소.

#### **E2E-2. T1 — 가입일·전화 표시**
- **흐름:**
  1. 어드민 로그인 → `/admin/users` 진입
  2. 데스크톱 뷰포트(1280) → 테이블 첫 행에 가입일(YYYY-MM-DD)·전화 컬럼 보임
  3. 모바일 뷰포트(375) → 카드에 가입일·전화 별도 줄 보임
- **회귀 가드:** 기존 이름·이메일·상태·정지버튼 4요소 그대로 보임
- **추정 작업:** 테스트 2(데스크톱·모바일). 소.

#### **E2E-3. T2 — 새로고침 버튼**
- **흐름:**
  1. 어드민 로그인 → `/admin/users`
  2. 헤더 우측 `IconRefresh` 버튼 클릭
  3. `useAdminUsers().reload` 호출 확인(네트워크 탭 또는 spinner 표시)
- **추정 작업:** 테스트 1. 소.

#### **E2E-4. T3 — 검색·상태 필터**
- **선결:** 시드(정상 5명·정지 2명, 이름·이메일·전화 검색 매칭 가능한 더미)
- **흐름:**
  1. 어드민 로그인 → `/admin/users`
  2. 기본 탭 '전체' = 7명 보임
  3. 탭 '정상' 클릭 = 5명 보임, 탭 '정지' 클릭 = 2명 보임
  4. 검색 인풋에 이름 일부 입력(예: "홍") → 200ms 후 필터 적용 → 매칭 행만 보임
  5. 검색에 전화 하이픈 포함 입력(010-1234-5678) → 하이픈 제거되어 매칭
  6. 검색에 매칭 0건 키워드 입력 → "검색 결과 없음" 카피 확인
  7. 검색 초기화·탭 '전체' 복귀 → 7명 복원
- **C6 회귀 가드:** 로딩 중에도 `<UsersFilters>` 보임(시드 reload 시 확인)
- **추정 작업:** 시드 1·테스트 7스텝 1파일. 중.

### e2e 파일 구조
```
apps/e2e/tests/
  admin-users.spec.ts                # E2E-2~4 + 정지 모달 회귀, route fixture 격리
apps/api/src/auth/
  auth.service.spec.ts               # E2E-1의 핵심인 refresh 정지 차단을 단위 레벨에서 직접 검증
```

### e2e 정합성 가드
- [x] **세션 격리** — `ADMIN_STATE_PATH` 재사용, seller 세션과 분리
- [x] **networkidle 회피** — `domcontentloaded` + 명시적 셀렉터 대기
- [x] **dotenv #** — 세션90의 admin 인증 규칙 재사용
- [x] **시드 idempotent** — 실제 시드 대신 route fixture 사용, 이전 테스트 잔재 없음
- [x] **playwright 0 fail** — 2026-06-02 최신 seller 고정 프리뷰에서 chromium·mobile 18/18 통과

---

## E-10. 차기 진입점 (세션별 인계)

| 다음 세션 | 진입 명령 | 산출물 위치 |
|----------|----------|------------|
| S1 시작 | `apps/api/src/auth/auth.service.ts:329 refresh()` 메서드 열기 | `auth.service.ts` + `auth.service.test.ts`(또는 신설) |
| S2 시작 | `apps/admin/src/app/(authed)/admin/_components/UsersTable.tsx` 열기 | UsersTable + `_client.tsx` |
| S3 시작 | S2 머지 확인 후 `_components/UsersFilters.tsx` 신설 | UsersFilters·`_lib.ts`·`_lib.test.ts`·`_client.tsx` |
| S4 시작 | 사용자에게 운영 user 수 재확인, limit 값 확정 후 `admin.service.ts:86` | `admin.service.ts` + `firestore.indexes.json`(필요 시) |
| S5 시작 | S1~S4 운영 배포 확인 후 `apps/admin/e2e/` 4 spec 신설 | 시나리오 §E-9 |
| S6 시작 | 운영 환경에서 `pending-visual-verify.md` §추가 항목 사용자 직접 확인 | 통합 육안 문서 |

---

## 참고 문서

### 본 탭이 직접 참조하는 외부 문서
- **육안 검증 (S6용)** — [`../pending-visual-verify.md`](../pending-visual-verify.md) — D1·T1·T2·T3·T4 신규 요소 + 회귀 0.
- **연계 작업 SDD (셀러앱 손님 정보·검색·전화)** — [`../seller-orders-customer-info-plan.md`](../seller-orders-customer-info-plan.md) (본 문서와 독립, 상위 인덱스에서 추적)
- **별도 SDD 후보 (이번 범위 제외)**
  - **F3** 소비자→주문 드릴다운 — stores F7·orders F3과 어드민 교차 필터 일괄 SDD
  - **F5** 감사 로그 — `adminAuditLogs` 컬렉션 신설, 어드민 전역
  - **R1** thBase 공통화 — 어드민 7탭 공통 컴포넌트 SDD
  - **R2** AdminTable 추출 — 어드민 7탭 공통 컴포넌트 SDD(우선순위 최하)

### 상위 인덱스 · 로드맵
- 통합 인덱스: [`../admin-tabs-improve-plan.md`](../admin-tabs-improve-plan.md)
- 멀티앱 리팩토링 로드맵: [`../app-refactor-roadmap.md`](../app-refactor-roadmap.md)

### 인접 어드민 탭
- [stores](./admin-tab-stores-plan.md) · [orders](./admin-tab-orders-plan.md) · [drivers](./admin-tab-drivers-plan.md) · [settlements](./admin-tab-settlements-plan.md) · [invite](./admin-tab-invite-plan.md) · [banner](./admin-tab-banner-plan.md)

### 선례
- 세션90 어드민 판매자 "치우기"(#CL-53) — 정지 효과의 한계와 기록 가드 부재의 직접 선례. 어드민 e2e 인프라 신설.
- 세션91 SDD 분리 — `5bf29ff` users 탭 SDD 분리(234→76, `_lib` 미생성). 과분할 회피 기준.
- 세션88 어드민 반응형 — `UsersTable.tsx` 모바일 카드/데스크톱 테이블.
- 세션86 정산 status 필터 — C6(로딩·빈결과에서 필터 유지) 가드 패턴.
- 세션85 타임존 KST 보정 — `toDateStrKST`(T1 가입일 표시 재사용) + vitest 첫 도입.
- 세션80 인덱스 배포 — T4 Firestore 복합 인덱스 추가 시 절차 선례.
- **세션92 grill-me** — 본 계획서 전 분기 해소. D1(refresh 1줄)·F2(마스킹 없음)·§E-11 분리·커밋 순서·vitest 동반 확정.

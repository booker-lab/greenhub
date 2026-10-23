# 어드민 소비자(users) 탭 개선 — 아토믹 태스크 (#CL-55 §E)

> **출처:** `admin-tabs-improve-plan.md` §E (세션96 진단). 세션92 grill-me로 전 분기 해소(2026-05-26).
> SDD 분리는 세션91에 끝남(`_client`→`page`+`_client`+`_components/UsersTable`, `5bf29ff`).
> 순수함수가 없어 `_lib` 미생성(과분할 회피, 세션91 확정). 본 진단은 그 위의
> **기능 부재(검색·필터 전무)·정지 효과 결함·표시 정보 빈약·표현 중복** 정리.
>
> **사용자 확정(세션92 grill-me 종결) = 4축 전부 작업, 단 R1·R2·F3·F5는 별도 SDD.**
> 셀러앱 손님 정보(구 §E-11)는 본 문서에서 제거, 상위 인덱스에 한 줄 링크로 위임.
>
> **현재 상태(2026-10-23, main `e4d781db` 코드 대조 — 이 절이 아래 진행 서술보다 우선):**
> - **완료:** S1 D1 정지 계정 세션 차단(회귀 `apps/api/src/auth/auth.service.spec.ts`) · S2 T1 가입일·전화 + T2 새로고침(#317) · F5 변경 기록(#576 `adminAuditLogs`, 정지 사유 선택 입력 200자) · 목록 응답을 화면이 쓰는 6개 필드로 축소·탈퇴 소비자 제외(#578·#594) · 정지 대상은 소비자만·자기 자신 금지(`admin.service.ts` `suspendUser`) · 목록 정렬 `createdAt` 최신순(인덱스 `role+createdAt`).
> - **남은 것(IMPLEMENTATION_GAP):** S3 검색·상태 필터(T3) · S4 목록 건수 상한 또는 커서 "더 보기"(어드민 목록 중 users만 전량 로드) · S5 관리자 users e2e(`apps/e2e/tests/`에 없음) · F3 소비자→주문 드릴다운 · R1·R2.
> - **사람 결정(SEMANTIC_CONFLICT):** S4를 고정 상한으로 할지, 기사 탭처럼 커서 "더 보기"(`useAdmin.paged.ts`)로 할지.
> - 관리자 화면은 `apps/seller/src/app/admin/users/`다(별도 `apps/admin` 앱은 없다). 아래 E-1~E-10은 2026-05 진단 기록이며 줄 번호는 당시 값이다.

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

## E-1. 대상 파일 (2026-10-23 실측)
| 파일 | 라인 | 역할 |
|------|------|------|
| `users/page.tsx` | 8 | dynamic ssr:false 래퍼 |
| `users/_client.tsx` | 140 | 상태·정지/복구 핸들러·확인창·새로고침·조회 실패 표시 |
| `users/_lib.ts` | 57 | 가입일·전화 포맷(T1, #317) |
| `_components/UsersTable.tsx` | 187 | 모바일 카드 / 데스크톱 테이블 |

→ 모두 500 한도 내. T3는 `_lib.ts`에 `filterUsers`를 추가한다.
hook = `useAdminUsers`(`apps/seller/src/hooks/useAdmin.accounts.ts`), 타입 = `useAdmin.types.ts`, 백엔드 = `getUsers`/`suspendUser`(`apps/api/src/admin/admin.service.ts`).

## E-2. 정합성 진단 — 🔴 검색·필터 전무 (7개 탭 중 가장 비어 있음)

| 항목 | 현황 | 비교 |
|------|------|------|
| 검색(이름·이메일·전화) | ❌ 없음 | drivers·orders 모두 검색 부재(공통 부채)이나 **소비자는 증가 속도 1위 집단** |
| 상태 필터(정상/정지) | ❌ 전체만 | drivers는 `STATUS_TABS`(대기/승인/정지) 보유 — 비대칭 |
| 정렬·페이지네이션 | ❌ 없음 | — |
| **백엔드 limit** | ❌ **없음**(`getUsers`는 최신순 정렬만 있고 전량 `.get()`) | orders·drivers·settlements는 커서 "더 보기"(#592·#593) — **users만 전량 로드** |

→ **소비자는 판매자·드라이버와 달리 수가 빠르게 늘어나는 집단인데 검색·필터·정렬·페이지가 전무.**
운영 규모가 커지면 특정 소비자를 찾을 방법이 없고, 백엔드 `getUsers`도 limit 없는 전량 로드라 **확장성 결함**(타 탭 대비 유일하게 하드캡조차 없음).

## E-3. 정지(suspended) 효과 — ✅ 해소

2026-05 진단 때는 정지가 로그인 시점에만 걸렸다. 지금은 토큰 갱신 경로도 정지 계정을 거부하고(S1 D1), 정지할 때 기존 세션도 함께 끊는다. 직접 증거는 `apps/api/src/auth/auth.service.spec.ts`와 `apps/api/src/admin/admin.service.spec.ts`이며, 계약 정본은 [`../../api/admin.md`](../../api/admin.md) §4·[`../../api/auth.md`](../../api/auth.md)다.

## E-4. 기능 부재 (표시 정보)

- **F1. 가입일 미표시** — ✅ #317. `AdminUser.createdAt`(`useAdmin.ts:25`) 수신하나 화면에 없음. 가입 시점은 소비자 식별·CS에 유용. → **T1에 포함.**
- **F2. 전화번호 미표시** — ✅ #317. `AdminUser.phone`(`useAdmin.ts:23`) 옵셔널 수신하나 화면에 없음. CS 시 연락 수단. → **T1에 포함.** 근거 = 셀러·드라이버 앱이 이미 buyerPhone 사용 중(`OrderCard.tsx` 등), 어드민이 더 강한 권한이라 마스킹 없이 전체 표시. 노출 정책 변경 0.
- **F3. 소비자→주문 이력 연결 없음** — 소비자 클릭 시 해당 유저 주문 보기 동선 부재. orders 백엔드에 `userId` 필터 신설 필요. → **별도 SDD**(stores F7·orders F3과 묶어 어드민 교차 필터 일괄).
- **F4. 새로고침 버튼 없음** — ✅ #317. hook `reload` 있으나 UI 미노출. → **T2에 포함**, 헤더 우측 `IconRefresh` 표준 위치 = 후속 6탭 선례.
- **F5. 감사 로그 부재** — ✅ #576 `adminAuditLogs`(정지·복구와 사유 기록, "기록" 탭). 누가 언제 정지/복구했는지 기록 없음. drivers·stores 정지에도 동일 결함. → **별도 SDD**(adminAuditLogs 컬렉션 신설 어드민 전역).

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
- **상태(2026-10-04):** 구현·병합 완료(#317 `e2ed2983`), 육안 미확인. 실제 위치 `apps/seller/src/app/admin/users/` — `_lib.ts`(`formatJoinedDate`·`formatPhone`, `toDateStrKST` 재사용) + `_lib.test.ts`·`_components/UsersTable.test.tsx` 신설. API(`getUsers`)는 이미 `createdAt`·`phone`을 내려줘 변경 없음.
- **변경:**
  - `_components/UsersTable.tsx` 데스크톱: `<th>가입일</th>`·`<th>전화</th>` 컬럼 2개 추가
  - `_components/UsersTable.tsx` 모바일 카드: 이메일 아래에 `가입일` 별도 줄, `전화` 별도 줄
  - 가입일 = shared `toDateStrKST(createdAt)` 재사용(세션85 util)
  - 전화 = `phone || '—'` 폴백, 마스킹 없음
- **선행 = 없음.** T2와 함께 한 PR 묶음.
- **위험:** 모바일 카드 높이 증가 = C7 시각 회귀 항목. 의도적 변경, 육안 §추가.

#### **T2. 새로고침 버튼 (F4)**
- **상태(2026-10-04):** 구현·병합 완료(#317 `e2ed2983`), 육안 미확인. stores `StoresFilters` 새로고침 버튼 형태(`Button variant="light" color="gray"`)를 따름 — `ActionIcon` 대신 텍스트 버튼.
- **변경(실제):** `users/_client.tsx` 제목 헤더 우측 `Button variant="light" color="gray"` "새로고침"이 `useAdminUsers().reload`를 부른다. 로딩 중 `loading` prop.
- **표준 위치 약속:** 후속 6개 탭(stores·orders·drivers·settlements·invite·banner)도 동일 위치 따라감(SDD 부채 기록).
- **선행 = 없음.** T1과 묶음 커밋.
- **위험:** 0.

### 그룹 B — 검색·필터 (이번 범위 핵심)

#### **T3. 검색·상태 필터 (E-2)**
- **신설 파일:**
  - `_components/UsersFilters.tsx` — `<TextInput placeholder="이름·이메일·전화">` + `<SegmentedTabs items=[전체,정상,정지] layout="scroll">`. 기본 탭 = '전체'.
  - `_lib.ts`(이미 있음) — `filterUsers(users, {keyword, status})` 순수함수 추가.
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
- **상태(2026-10-23):** `orderBy('createdAt','desc')`와 인덱스는 이미 있다. 남은 것은 건수 상한 또는 커서 "더 보기"다(사람 결정).
- **변경(원안):** `getUsers()`에 `.limit(N)` 추가.
- **limit 값:** **사용자가 현 운영 user 수 확인 후 결정.**
  - <100 = 보류(BACKLOG에만 기록)
  - 100~1,000 = `limit(5000)` (T3 클라이언트 필터와 모순 없는 큰 캡)
  - 1,000+ = 서버 검색(Firestore where prefix) 별도 SDD로 승격
- **선행 = T3 PR 머지 후(클라이언트 필터의 한계 측정 후 적정 limit 결정 가능).**
- **위험:** 정렬 추가 시 Firestore 복합 인덱스 필요 가능 → 배포 전 인덱스 확인(세션80 선례).

### 별도 SDD — 본 범위 제외 (E-7 제외군)
- **F3** 소비자→주문 드릴다운 — orders 백엔드 `userId` 필터 + stores F7·orders F3과 어드민 교차 필터 일괄 SDD
- ~~F5 감사 로그~~ — ✅ #576
- **R1** thBase 공통화 — 어드민 공통 컴포넌트 SDD
- **R2** AdminTable 추출 — 어드민 공통 컴포넌트 SDD

---

## E-7. 세션별 진행표 (최종)

각 세션은 **1세션 1축** 원칙. 세션 종료 시점에 정합성 검토(§E-8) 전부 통과해야 함.

| 세션 | 범위 | 산출물 | 정합성 | 비고 |
|------|------|--------|--------|------|
| **S1** ✅ | D1 단독 (완료 — `auth.service.ts` `refresh()`가 `getAuthoritativeUser()`로 정지 계정 401, 회귀 `auth.service.spec.ts`) | `auth.service.ts` refresh()에 suspended 차단 + vitest | C1~C3 (백엔드 only) | 정지 결함 30일→1시간 단축. 가장 시급 |
| **S2** ✅ | T1+T2 묶음 (완료 — #317, 육안 미확인) | `UsersTable.tsx` 가입일·전화 표시 + `_client.tsx` 새로고침 버튼 | C1~C5, C7 | 저위험. 모바일 카드 높이 회귀 의도적 |
| **S3** ⬜ IMPLEMENTATION_GAP | T3 단독 | `UsersFilters.tsx`·`_lib.ts`·`_lib.test.ts` 신설 + `_client.tsx` 통합 | C1~C7 전부 | 본 범위 핵심. vitest 첫 통과 후 PR |
| **S4** ⬜ 사람 결정 | T4 단독 (상한 vs 커서 "더 보기") | `admin.service.ts:getUsers` (orderBy·인덱스는 완료) | C1~C3, 인덱스 확인 | user 수 확인 후 limit 값 확정 |
| **S5** ⬜ | e2e | §E-9 시나리오 4건 라이브 수행 | playwright 0 fail | S1~S4 코드 머지 후 |
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

### S1 (D1 백엔드)·S2 (T1+T2) 체크리스트
- [x] S1 완료 — 회귀 `apps/api/src/auth/auth.service.spec.ts`(원안의 `auth.service.test.ts` 아님).
- [x] S2 완료 — #317. 검증은 지금 PR CI(tsc·biome·build·test)가 대신한다.

### S3 (T3 검색·필터) 체크리스트
- [ ] **C1 tsc 0** — `pnpm --filter seller exec tsc --noEmit` 0
- [ ] **C2 biome 0** — 신규 경고 0
- [ ] **C3 build 0** — `npm run build` 0
- [ ] **C4 500라인** — `_client.tsx`·`UsersFilters.tsx`·`_lib.ts` 모두 한도 내
- [ ] **C5 SSOT** — `SegmentedTabs` 재사용, 라벨 하드코딩 0
- [ ] **C6 가드** — 로딩 중에도 `<UsersFilters>` 렌더, 빈결과(both 분기)에서도 필터 유지
- [ ] **C7 시각 회귀** — 신규 검색·필터는 의도, 기존 테이블·카드 회귀 0
- [ ] **vitest** — `_lib.test.ts` 5케이스 전부 통과
- [ ] **디바운스 동작** — 키 입력 → 200ms 후 필터 적용(콘솔 측정)
- [ ] **검색 매칭** — 이름·이메일·전화 부분일치(전화는 하이픈 제거 후) 수동 확인

### S4 (T4 백엔드 limit) 체크리스트
- [ ] **C1 tsc 0** — `cd apps/api && npx tsc --noEmit` 0
- [ ] **C2 biome 0** — 신규 경고 0
- [ ] **C3 build 0** — `npm run build` 0
- [ ] **인덱스** — `orderBy('createdAt','desc')` 필요 시 `firestore.indexes.json` 갱신·배포 확인(세션80 선례)
- [ ] **회귀 0** — 어드민 users 탭 데이터 로딩 정상, 정렬 순서 신규(최신순) 확인
- [ ] **수동 확인** — limit 값이 실제 user 수보다 큰지 재확인

### S5 (e2e) 체크리스트 — §E-9에서 상세

---

## E-9. e2e 작업 플랜 (세션 S5)

**전제:** S3·S4 코드 머지 후 + 어드민 e2e 인프라(세션90 신설) 재사용. **E2E-1(정지 계정 토큰 갱신 거부)은 API 단위 테스트가 이미 보장하므로 e2e에서 빼는 것을 검토한다.** E2E-2·E2E-3은 이미 병합된 기능의 회귀 확인이다.

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
  admin-users-display.spec.ts        # E2E-2·E2E-3 (가입일·전화·새로고침)
  admin-users-search-filter.spec.ts  # E2E-4
```
(세션90 어드민 스펙처럼 `page.route()` fixture로 응답을 고정하면 운영 시드가 필요 없다.)

### e2e 정합성 가드
- [ ] **세션 격리** — 각 spec은 새 BrowserContext(세션90 함정)
- [ ] **networkidle 회피** — `waitForLoadState('domcontentloaded')` + 명시적 셀렉터 대기
- [ ] **dotenv #** — `.env.e2e`에 `#` 포함 값 금지(세션90 함정)
- [ ] **시드 idempotent** — 재실행 가능, 이전 테스트 잔재 cleanup
- [ ] **playwright 0 fail** — 4 spec × 평균 2 case = ~8/8 통과 목표

---

## E-10. 차기 진입점 (2026-10-23 갱신)

| 다음 | 진입 | 산출물 위치 |
|------|------|------------|
| S3 | `apps/seller/src/app/admin/users/_client.tsx`·`_lib.ts` | `_components/UsersFilters.tsx` 신설·`filterUsers`·vitest |
| S4 | 사람 결정(상한 vs 커서) 뒤 `apps/api/src/admin/admin.service.ts` `getUsers` | 서비스·DTO·hook |
| S5 | S3 병합 뒤 | `apps/e2e/tests/admin-users-*.spec.ts` |

---

## 참고 문서

### 본 탭이 직접 참조하는 외부 문서
- **육안 검증** — [`../pending-visual-verify.md`](../pending-visual-verify.md)는 이제 역사 기록이다. S3 육안 항목은 필요할 때 새 확인 목록으로 만든다.
- **연계 작업 SDD (셀러앱 손님 정보·검색·전화)** — [`../seller-orders-customer-info-plan.md`](../seller-orders-customer-info-plan.md) (본 문서와 독립, 상위 인덱스에서 추적)
- **별도 SDD 후보 (이번 범위 제외)**
  - **F3** 소비자→주문 드릴다운 — stores F7·orders F3과 어드민 교차 필터 일괄 SDD
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

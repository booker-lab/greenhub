# 어드민 판매자(stores) 탭 개선 — 아토믹 태스크 (#CL-55 §A)

> **출처:** `admin-tabs-improve-plan.md` §A (세션92 진단).
> **세션91**에 SDD 분리·반응형 카드형은 끝났다. 본 문서는 그 위의 **타입 안전·SSOT 정리·기능 부재**를 한 탭으로 떼어 누적·관리한다.
> **진행 방식:** 한 탭씩 진단·확정 → 한 태스크씩 완결 후 커밋(세션91 패턴).
> **진행 상태:** PR-A(C1·C2) 완료(`6c474ce`, `1bd259a`) · **PR-B(C3) 구현 종결(`76f8f17`, 배포·육안 위임, 2026-05-28)** · **PR-C(C4) 구현 종결(2026-05-28)** · **PR-D(C5) 구현 종결·육안 위임(2026-05-28)** · **PR-E(E1) 프리뷰 실행 검증 종결(2026-05-28, 16/16 통과)**.
> **2026-05-26 갱신:** grill-me 13개 분기 답변 반영 — PR 단위 분리, default='활성', 모바일 정렬 대칭, URL 쿼리 동기, 빈결과 2종 분기, parseRate 시그니처 확정 등.

## 0. 공통 정합성 검토 기준 (모든 어드민 탭 공통)

각 커밋 직전 아래를 모두 통과해야 한다(세션85~91 동일).

- **C1 tsc 0** — 어드민·셀러·소비자·드라이버 4앱 전체. shared 변경 시 4앱 재검증.
- **C2 biome 0** — 신규 경고 0.
- **C3 `npm run build` 0** — ⚠️ `npx next build` 금지(Turbopack 충돌).
- **C4 500라인 한도** — 단일 파일 500라인 초과 시 즉시 분할(CLAUDE.md §1).
- **C5 SSOT 토큰** — 하드코딩 색·라벨 0, shared 재사용.
- **C6 가드 유지** — 로딩·빈결과에서도 필터·탭 UI 유지(세션86 선례).
- **C7 시각 회귀 0** — 시각 변경이 의도된 태스크(예: NumberInput 교체)는 단독 커밋·육안 격리.

---

## A-0. 사용자 확정 (착수 시)
- **T0(shared `StoreStatus` SSOT 교정) 포함** — A4·B2의 근본 해소.
- **T7(판매자 상세 드릴다운)·T8(기본 수수료 설정)은 본 PR 범위 제외·후속 구현 확정** — 백엔드·데이터모델 신설 규모이므로 `docs/BACKLOG.md`에 등록하고 별도 SDD 선설계 후 착수.

### A-0a. T0 사전 grep 검증 (착수 직전 필수 — Q1 결정)

T0 커밋 작성 직전, 아래 3개 명령을 4앱+api에 대해 실행하고 결과를 **본 절 하단 표에 첨부**한다. 미래에 archived가 또 다른 값으로 바뀔 때 같은 검증을 반복 가능하게 만들기 위함이다.

```powershell
# 1) store.status 직접 분기 grep
rg "store\.status" --type ts apps/ packages/

# 2) 'suspended' 리터럴 (driver/user suspended와 섞여 있을 수 있음 — store 컨텍스트만 식별)
rg "['""]suspended['""]" --type ts apps/ packages/

# 3) StoreStatus 타입 import 추적
rg "StoreStatus" --type ts apps/ packages/
```

**판정 기준:**
- `store.status === 'suspended'` 분기가 **어드민 외부**에서 나오면 → 회귀 가능성 있음, 사용자 확인 후 결정.
- 어드민 `_lib.ts` 내부의 죽은 라벨만 나오면 → T1+T2에서 일괄 제거.
- `StoreStatus` 참조처가 `store.types.ts` + 어드민 `useAdmin.ts` 외에 추가로 나오면 → 영향 범위 재산정.

| 실행 일자 | 명령 | 결과 (파일·라인 수) | 판정 |
|-----------|------|---------------------|------|
| 2026-05-26 (세션93 T0 착수) | rg "store\.status" | **0건** (활성·dist 모두 0) | ✅ store 컨텍스트 분기 어디에도 없음 → T0 안전 |
| 2026-05-26 (세션93 T0 착수) | rg "'suspended'" | **9건** — 전부 store 무관: `DriverStatus`(useAdmin.ts:61), `admin.dto.ts:58`·`admin.service.ts:228`(드라이버 DTO), `auth.service.ts:133·304`(사용자 suspended), `drivers/_lib.ts:39·46`(드라이버 탭), `store.types.ts:1`·`dist/...:1`(교정 대상 본인) | ✅ store status 'suspended' 사용처 0 → T0 안전 |
| 2026-05-26 (세션93 T0 착수) | rg "StoreStatus" | **활성 3건**: `store.types.ts:1`(선언)·`:12`(`Store.status`)·`stores/_lib.ts:4`(주석). dist 2건은 빌드 산출물(자동 재생성). 활성 import = **0** | ✅ 세션92 스냅샷과 일치. T1에서 `useAdmin.ts` 신규 import 추가 예정 |

---

## A-0b. 확정된 구현 작업 — 세션·PR·커밋 단위 (Q1~Q13 반영 — 착수 큐)

> **목적**: 판매자 탭 개선의 **세션별 진행 단위·PR 분리·커밋 단위·정합성 검토 시점·e2e 위치**를 못박는다.
> 코드는 아직 손대지 않음 — 본 절은 **착수 대기 목록**이자 **실행 절차서**다.

### 전체 구도 (한눈에)

```
┌────────────── 세션 N (PR-A: SSOT 교정) ──────────────┐
│ C1 T0  → C2 T1+T2                                  │
│ 정합성 C1~C5 + 4앱 tsc 0  →  머지·배포             │
└─────────────────────────────────────────────────────┘
                       ↓
┌────────────── 세션 N+1 (PR-B: 검색·필터·정렬) ──────┐
│ C3 T6+T9 (URL 쿼리 동기 포함)                       │
│ 정합성 C1~C7 + 모바일·데스크톱 동작 확인  →  머지   │
└─────────────────────────────────────────────────────┘
                       ↓
┌────────────── 세션 N+2 (PR-C: parseRate) ──────────┐
│ C4 T3 + vitest                                     │
│ 정합성 C1~C5 + vitest 5+ 케이스 통과  →  머지       │
└─────────────────────────────────────────────────────┘
                       ↓
┌────────────── 세션 N+3 (PR-D: NumberInput) ────────┐
│ C5 T4 (시각 회귀 격리)                              │
│ 머지 전 로컬·프리뷰 육안  →  통과 후 머지           │
└─────────────────────────────────────────────────────┘
                       ↓
┌────────────── 세션 N+4 (PR-E: e2e) ────────────────┐
│ 어드민 stores e2e 스펙 신설 (검색·필터·정렬·수수료) │
│ 8시나리오×2 viewport = 16통과 목표  →  머지         │
└─────────────────────────────────────────────────────┘
                       ↓
   (선택) T5 분할 — C3 후 StoresTable.tsx 300줄 초과 시 자동 트리거
```

---

### 완료 이력 — PR-A (C1 + C2): SSOT 교정

- `StoreStatus`를 실제 전이값 `invited | active | archived`로 교정하고, 어드민 라벨·타입에서 죽은 `suspended`를 제거했다(`6c474ce`, `1bd259a`).
- 상세 구현·검증 근거는 `docs/CRITICAL_LOGIC.md`의 `[#CL-55] 어드민 stores 탭 — StoreStatus SSOT 3중 불일치 교정`을 SSOT로 참조한다.

---

### 세션 N+1 — PR-B (C3): 검색 + 상태 필터 + 정렬 + 새로고침 + URL 쿼리 (Q3, Q4, Q8, Q10, Q12, Q13 반영)

**범위:** 어드민 stores 탭 운영 UI 추가, 백엔드 무변경. 상세 결정 근거는 `docs/CRITICAL_LOGIC.md`의 `[#CL-55 / PR-B C3]`을 참조한다.

**PR-B 구현 결과 (2026-05-28, 커밋 `76f8f17`):**
- `StoresFilters` 신설, 기존 archived Switch를 상태 Select(기본 `current` = 활성)로 흡수했다.
- `_lib.ts`에 `filterStores`·`sortStores`·`getEmptyKind` 및 필터/정렬 옵션 SSOT를 추가했다.
- `_client.tsx`가 `keyword`·`status`·`sort`·`dir` 쿼리를 동기화하며, 기본값 쿼리는 생략한다.
- 데스크톱은 헤더 정렬 토글, 모바일은 정렬 Select를 사용하며 새로고침과 조건 불일치 초기화 동선을 추가했다.
- 기존 읽기 전용 `admin-store-archive.spec.ts`는 제거된 Switch 대신 상태 필터 기본값을 확인하도록 갱신했다(PR-E 신규 상호작용 8건은 미착수 유지).

**정합성 검토 (PR-B 코드 완료 시점):**
- [x] C1 tsc 0 — seller·consumer·driver·api 4앱 통과.
- [x] C2 biome 신규 0 — seller 잔존 warning 2건(`<img>`, 기존 PERF-01)만 확인. 변경 stores 경로 0건.
- [x] C3 build 0 — `pnpm --filter seller build` 통과(`/admin/stores` 포함 23라우트).
- [x] C4 500라인 — `_client.tsx` 160, `_lib.ts` 96, `StoresFilters.tsx` 66, `StoresTable.tsx` 274라인. T5 300라인 트리거도 미발동.
- [x] C5 SSOT — 상태·정렬 옵션과 상태 라벨/색을 `_lib.ts` 한 곳에서 관리.
- [x] C6 가드 — 로딩·데이터 없음·조건 불일치에서 필터 영역을 유지하도록 렌더 구조 교체.
- [ ] C7 육안·URL 상호작용 — 로컬 런타임 `AUTH_SECRET` 부재(`Auth.js MissingSecret`, `/api/auth/csrf` 500)로 인증 스모크 실행 전 차단, 배포 환경 육안으로 이관(`pending-visual-verify.md` #55·#60).
- [x] e2e 수집 확인 — 갱신된 `admin-store-archive.spec.ts` 8개 사례가 `playwright test --list`에 정상 수집됨.
- [x] C3 구현 세션 종결 — 배포 후 육안 확인만 `pending-visual-verify.md` #55·#60으로 위임.

---

### 세션 N+2 — PR-C (C4): parseRate 순수함수 추출 + vitest (Q6, Q9 반영)

**범위:** 검증 로직을 컴포넌트에서 분리. 테스트 가능한 단위로.

#### 커밋 C4 — T3 parseRate 추출

**변경 파일 (2):**
- `apps/seller/src/app/admin/stores/_lib.ts`:
  ```ts
  export type ParseRateError = 'EMPTY' | 'NOT_NUMBER' | 'OUT_OF_RANGE';
  export type ParseRateResult =
    | { ok: true; rate: number }
    | { ok: false; errorCode: ParseRateError };

  export function parseRate(input: string): ParseRateResult {
    const trimmed = input.trim();
    if (trimmed === '') return { ok: false, errorCode: 'EMPTY' };
    const rate = Number.parseFloat(trimmed);
    if (Number.isNaN(rate)) return { ok: false, errorCode: 'NOT_NUMBER' };
    if (rate < 0 || rate > 1) return { ok: false, errorCode: 'OUT_OF_RANGE' };
    return { ok: true, rate };
  }
  ```
  - **시그니처는 `(input)`만**. T8(기본 수수료) 도입 시 확장(Q9 YAGNI).
- `apps/seller/src/app/admin/stores/_client.tsx`:
  - 인라인 parseFloat+범위검증 → `parseRate(input)` 호출.
  - 에러코드 해석은 호출부 책임(Q6)으로 남기되, **PR-C는 순수 추출이므로 기존 사용자 메시지** `'0~1 사이의 수수료율을 입력해야 합니다 (예: 0.05 = 5%).'`를 세 코드 모두에 유지한다. 오류별 문구 세분화는 별도 UX 변경으로 격리한다(C7).

**신규 파일 (1):**
- `apps/seller/src/app/admin/stores/_lib.test.ts` — vitest 스펙. 5+ 케이스:
  ```
  1. '0.05'  → { ok: true, rate: 0.05 }
  2. '0'     → { ok: true, rate: 0 }
  3. '1'     → { ok: true, rate: 1 }
  4. ''      → { ok: false, errorCode: 'EMPTY' }
  5. '  '    → { ok: false, errorCode: 'EMPTY' }
  6. 'abc'   → { ok: false, errorCode: 'NOT_NUMBER' }
  7. '-0.1'  → { ok: false, errorCode: 'OUT_OF_RANGE' }
  8. '1.5'   → { ok: false, errorCode: 'OUT_OF_RANGE' }
  9. ' 0.5 ' → { ok: true, rate: 0.5 } (trim 적용)
  ```

**테스트 실행 기반 보정 (2026-05-28 착수 실측):**
- 세션85 `vitest`는 `packages/shared` 작업공간에만 설치돼 있으며, 테스트 소유 경로인 `apps/seller`에는 `test` 스크립트와 의존성이 없다.
- 테스트 파일을 표현 레이어 소유 경로에 유지하기 위해 `apps/seller/package.json`에 `test: "vitest run"`과 `vitest` 개발 의존성을 추가하고 `pnpm-lock.yaml`을 동기화한다.
- 별도 런타임·API 의존은 도입하지 않으며, `_lib.test.ts`는 순수함수만 직접 검증한다.

**커밋 메시지:**
```
refactor(admin): #CL-55 parseRate 순수함수 추출 + vitest

_client.tsx 인라인 검증 → _lib.ts parseRate(input): ParseRateResult.
에러코드 3종(EMPTY·NOT_NUMBER·OUT_OF_RANGE), 메시지는 호출부에서 매핑.
vitest 9 케이스 추가(세션85 인프라 재사용). 호출부 행동 무변경.
```

**정합성 검토 (C4 커밋 직전):**
- [x] C1 tsc 0 — seller·consumer·driver·api 4앱 통과.
- [x] C2 biome 신규 0 — seller 기존 `<img>` warning 2건만 유지, 변경 stores 경로 0건.
- [x] C3 build 0 — `pnpm --filter seller build` 통과(`/admin/stores` 포함 23개 정적 생성 단계 통과).
- [x] C4 500라인 — `_lib.ts` 123, `_client.tsx` 177, `_lib.test.ts` 40, 활성 SDD 문서 447라인.
- [x] **vitest** — `pnpm --filter seller test` → parseRate 9/9 통과.
- [x] C7 시각 회귀 0 — UI 구조 무변경, 기존 수수료 입력 오류 메시지 문자열 유지.
- [x] 호출부 분기 누락 없음 — 모든 ParseRateError 3종 실패 결과가 기존 수수료 입력 알림 경로로 귀결된다.

**PR-C 구현 결과 (2026-05-28):**
- `_lib.ts`에 `parseRate(input): ParseRateResult`와 오류코드 `EMPTY | NOT_NUMBER | OUT_OF_RANGE`를 추가하고, `_client.tsx`의 인라인 `parseFloat` 검증을 순수함수 호출로 치환했다.
- `_lib.test.ts`에 하한·상한·공백·비숫자·범위 초과·trim을 포함한 9개 단언을 추가했다. 테스트 소유 경로에 맞춰 `apps/seller/package.json`과 `pnpm-lock.yaml`에 `vitest` 실행 기반을 연결했다.
- C7 기준에 따라 실패 알림 문구는 기존 값을 유지했다. 오류별 문구 구분은 행동 변경이므로 본 순수 추출 PR에 섞지 않는다.

**PR-C 머지 후:** 별도 육안 불필요(행동 무변경).

---

### 세션 N+3 — PR-D (C5): NumberInput 교체 (Q5 반영 — 시각 회귀 격리)

**범위:** native input → Mantine `NumberInput`. **단독 PR·단독 커밋** — 시각 회귀 격리.

#### 커밋 C5 — T4 NumberInput 교체

**변경 파일 (1):**
- `apps/seller/src/app/admin/stores/_components/StoresTable.tsx:56` (데스크톱 테이블) + 모바일 카드 입력칸:
  - native `<input type="number">` → Mantine `<NumberInput min={0} max={1} step={0.01} decimalScale={2} clampBehavior="strict" inputMode="decimal" />`.
  - `clampBehavior="strict"`로 직접 타이핑을 포함해 범위 밖 입력을 차단하고, `inputMode="decimal"`로 모바일 소수 입력 키보드 의도를 명시한다.
  - PR-C에서 추출한 `parseRate`는 NumberInput의 onChange 값(`number | string`)도 처리하도록 호출부에서 `String(value)`로 정규화.

**커밋 메시지:**
```
refactor(admin): #CL-55 stores 수수료 입력 native → Mantine NumberInput

min=0·max=1·step=0.01·decimalScale=2. 0~1 범위 밖 입력 차단,
±버튼·키보드 화살표 지원. 시각 회귀 가능성으로 단독 PR·격리.
육안 통과 후 머지(§세션 N+3 절차 참조).
```

**정합성 검토 (C5 머지 전):**
- [x] C1 tsc 0 — seller·consumer·driver·api 4앱 통과. seller는 build와 병렬 실행 시 `.next/types` 재생성 경합이 발생해 build 완료 후 단독 재실행으로 통과를 확인했다.
- [x] C2 biome 신규 0 — seller 전체 검사에서 기존 `<img>` warning 2건만 유지, 변경 stores 경로 `biome check` 통과.
- [x] C3 build 0 — `pnpm --filter seller build` 통과(`/admin/stores` 포함).
- [x] C4 500라인 — `StoresTable.tsx` 294, `_client.tsx` 177, `_lib.ts` 123라인으로 코드 한도 내이며, `StoresTable.tsx`는 300행 선택 분할 기준도 넘지 않는다.
- [ ] C7 시각 회귀 검토 — **머지 전 운영 미적용 로컬·프리뷰에서 육안**:
  - 데스크톱 테이블 행 높이 변화 ±1px 이내 수용.
  - 모바일 카드 입력칸 height/padding 데스크톱과 시각 격차 없음.
  - focus ring이 인접 셀과 충돌 없음.
  - `+`/`−` 버튼 모바일 터치 영역 32px 이상.
  - iOS Safari 가상 키보드 = 명시한 `inputMode="decimal"`로 소수 입력 동작 확인.
  - 0~1 범위 밖 입력 시 NumberInput 자체가 차단(parseRate 도달 전).

**PR-D 구현 결과 (2026-05-28, 육안 위임):**
- `StoresTable.tsx`의 공용 편집 렌더에서 native input을 Mantine `NumberInput`으로 교체해 모바일 카드와 데스크톱 테이블에 함께 적용했다. `min={0}`·`max={1}`·`step={0.01}`·`decimalScale={2}`·`clampBehavior="strict"`·`inputMode="decimal"`을 지정하고, `onChange` 값은 `String(value)`로 PR-C 검증 경로에 전달한다.
- 로컬 `/admin/stores` 확인은 입력 UI가 렌더되기 전에 기존 인증 환경 제약으로 차단됐다. `AUTH_SECRET` 부재로 `Auth.js MissingSecret`이 발생하고 `proxy.ts:14`가 비어 있는 `session.user.role`을 읽어 오류 화면이 되므로, C7 6개 확인 항목은 `pending-visual-verify.md` #61~#66으로 위임한다.

**PR-D 머지 후:**
- 통합 육안 검증 문서에 NumberInput §추가 — 위 6개 항목 운영에서 회귀 0 확인.

---

### 세션 N+4 — PR-E (e2e): 어드민 stores e2e 스펙 신설

**범위:** 위 PR-A~D의 회귀 방지용 e2e 자동화. 세션90의 어드민 e2e 인프라(`apps/e2e/tests/admin-store-archive.spec.ts`, `.admin-state.json`)를 재사용한다. PR-D 육안은 인증 환경 차단으로 사용자 검증에 위임됐으며, 사용자의 후속 작업 지시에 따라 이 위임 상태를 PR-E 자동화 착수 조건으로 수용한다.

**검증 데이터 정책 (착수 실측 보정):**
- 기존 `scripts/seed-test-data.mjs`는 `디어` 검색어와 `archived` 판매자를 보장하지 않으므로, 신규 필터·정렬 상호작용은 `page.route()`로 인증된 화면의 `GET /admin/stores` 응답만 고정한다. 활성·초대됨·정리됨 판매자와 서로 다른 수수료율을 담은 표현 계층 fixture를 사용한다.
- 기존 `admin-store-archive.spec.ts`가 실제 인증·실 API 목록 렌더 스모크를 계속 담당하므로, PR-E는 API 계약을 중복 검증하지 않고 PR-A~D의 화면 상태 변환 계약에 집중한다.
- 수수료 저장 시나리오의 `PATCH /admin/stores/:id/commission`도 테스트 컨텍스트에서 가로채어 **운영 DB 변경을 만들지 않으며**, 범위 밖 값 `1.5`가 요청 본문으로 전달되지 않음을 단언한다.

#### 커밋 E1 — admin-stores-filter-sort.spec.ts 신설

**신규 파일 (1):**
- `apps/e2e/tests/admin-stores-filter-sort.spec.ts`

**커버 시나리오 (8개 선언, `chromium`·`mobile` 양쪽 실행 = 16통과 목표):**

| # | 시나리오 | 기대 동작 |
|---|----------|-----------|
| 1 | 어드민 로그인 → /admin/stores 진입 | 테이블 표시, default='활성'(archived 숨김). |
| 2 | 검색어 "디어" 입력 | 즉시 필터, "디어 플라워"만 남음. |
| 3 | 상태 Select '정리됨' 선택 | archived 가게만 노출, URL `?status=archived` 반영. |
| 4 | 상태 '전체' 선택 후 새로고침 버튼 | 고정 `GET /admin/stores` 재조회 호출. |
| 5 | 반응형 수수료율 정렬 제어 조작 | 데스크톱 헤더·모바일 Select 각각 asc ↔ desc 순환, URL `?sort=rate`(기본 asc 방향 생략) → `?sort=rate&dir=desc`. |
| 6 | 검색어 "존재하지않는브랜드xyz" | 빈결과 = "조건에 맞는 가게가 없습니다." + [필터 초기화] 버튼 노출, 클릭 시 default 복원. |
| 7 | URL 직접 진입 `?keyword=디어&status=active` | 필터 상태 복원, 결과 일치. |
| 8 | 수수료 입력칸에 `1.5` 입력 후 저장 | NumberInput/parseRate 경계가 차단하며 PATCH 본문에 `rate: 1.5`가 없음. |

**전제 (세션90 함정 회피):**
- 세션 격리: 각 테스트 `test.use({ storageState: '.admin-state.json' })`.
- `networkidle` 대신 명시적 selector wait.
- `.env.local` 읽기 시 `#` 주석 dotenv 파싱 함정 회피(세션90 발견 3건 그대로 준수).

**PR-E 구현 결과 (2026-05-28):**
- `admin-stores-filter-sort.spec.ts`를 신설하고 `GET /admin/stores` 상태 3종 fixture와 `PATCH /commission` 쓰기 차단 관찰기를 같은 스펙에 캡슐화했다.
- 선언 8건은 `chromium`과 `mobile`에서 모두 수집된다. 반응형 정렬은 데스크톱 헤더와 모바일 Select를 각각 조작하므로 PR-B의 대칭 계약도 자동화 범위에 포함된다.
- `NumberInput` 범위 차단 사례는 `1.5` 입력 뒤 저장 동선을 실행하되 PATCH 요청 본문으로 해당 값이 전달되지 않음을 검사하며, 실제 API 쓰기는 발생시키지 않는다.
- 프리뷰 실행에서 Mantine 접근성 트리와 맞지 않던 테스트 단언을 보정했다. 상태·모바일 정렬 조작은 정확한 `combobox` 역할로 한정하고, 상태 복원 단언은 화면에 노출되는 `활성`·`운영중` 표시값을 기준으로 확인한다.

**커밋 메시지:**
```
test(e2e): #CL-55 어드민 stores 검색·필터·정렬·수수료 e2e 8 케이스

세션90 어드민 e2e 인프라(.admin-state.json) 재사용. PR-A~D 회귀 방지.
시드: 활성/초대됨/정리됨 가게 각 1개 이상 필요(육안 시드 재활용).
```

**정합성 검토 (PR-E 머지 전):**
- [x] C1 tsc 0 — seller·consumer·driver·api 통과. e2e 작업공간은 기존 `tsconfig`/`@types/node` 기반이 없어 프로젝트 실행 경로인 Playwright 변환·수집으로 신규 스펙 해석을 확인했다.
- [x] C2 biome 0 — 신규 e2e와 연관 stores 코드 경로 검사 통과.
- [x] C3 build 0 — `pnpm --filter seller build` 통과(`/admin/stores` 포함).
- [x] C4 500라인 — 신규 e2e 192라인, 활성 SDD 447라인. 누적 결정 로그는 1000라인 이관 기준 미만.
- [x] 단위 검증 유지 — `pnpm --filter seller test`로 PR-C `parseRate` 9/9 통과.
- [x] 수집 검증 — `playwright test admin-stores-filter-sort --list`로 `chromium` 8건 + `mobile` 8건 = 16건 확인.
- [x] **e2e 16/16 통과** — 임시 seller 프리뷰 대상으로 `pnpm test:e2e -- admin-stores-filter-sort` 실행, 8시나리오×2 viewport **16 passed**(27.3초).
- [x] 운영 미적용 프리뷰 환경에서도 16/16 통과 확인 — `greenhub-seller-blkcqzhnf-jos-projects-d1cecc0c.vercel.app` 배포 상태 `READY` 확인 후 해당 URL을 `SELLER_BASE`로 지정해 실행했다.
- [x] 데이터 격리 검증 — 상태 3종 fixture 응답과 수수료 PATCH 가로채기로 운영 DB 쓰기 0을 코드로 보장.

**실행 종결 근거:** 작업 트리를 seller 임시 프리뷰로 직접 배포해 고정 `preview` 별칭의 오래된 배포를 검사하는 위험을 피했다. 첫 실행은 신규 스펙 선택자·표시값 단언 결함을 드러냈고 이를 교정한 뒤, 동일 `READY` 프리뷰에서 런타임 **16/16 통과**를 확인했다.

**PR-E 머지 후:**
- 프리뷰 런타임 16/16 확인 완료. 머지 시 기존 CI green 확인은 배포 절차로 유지한다.
- 어드민 stores e2e 누적 선언 = 4(세션90) + 8(본 PR) = 12, 두 viewport 실행 기준 신규 PR-E **16/16 달성**.

---

### 후속 구현 확정 (본 범위 제외 — Q9·문서 §A-2)

- **T5 (StoresTable 분할)** — C3 머지 후 `StoresTable.tsx` **300줄 초과 시** 자동 트리거(Q7). 미달 시 미실행.
- **T7 (판매자 상세 드릴다운)·T8 (기본 수수료 설정)** — 사용자가 향후 구현 대상으로 확정했다. `docs/BACKLOG.md` §1-8·§12-1에 등록하며, 본 PR-E 종결 범위에는 포함하지 않는다.
  - T7 도입 시 본 PR-B의 URL 쿼리 동기(Q8)가 뒤로가기 호환을 자동 제공함.
  - T8 도입 시 `parseRate(input)` 시그니처 확장(Q9): `(input, options?: { min, max })`.

---

### 잘 됐다고 말할 때 (성공 기준)

- 가게 **이름 일부**로 목록이 좁혀진다.
- 상태 Select에 **전체·활성·초대됨·운영중·정리됨** 5종이 보이고(가짜 '정지' 없음), 고른 상태만 남는다.
- 새로고침 버튼 한 번으로 외부 변경이 반영된다.
- 데스크톱 테이블 헤더로 이름·상태·수수료율이 오름차/내림차 정렬된다.
- 모바일 카드 상단 정렬 Select로 동일하게 정렬 가능하다.
- URL을 공유하면 받는 사람도 같은 필터·정렬 상태를 본다.
- 빈결과 메시지가 "데이터 없음" vs "필터 조건 안 맞음"으로 구분된다.
- 수수료 입력칸이 0~1 범위 밖 입력을 막고 0.01 단위로 ±버튼이 동작한다.
- vitest로 `parseRate` 9 케이스 단언이 통과한다.
- 어드민 stores e2e 신규 8시나리오가 두 viewport에서 16/16 통과.
- 정합성 검토 C1~C7(§0) 모두 통과.

---

### 리스크 (그릴미 답변 반영 갱신)

| ID | 리스크 | 대응 (확정) |
|----|--------|-------------|
| R1 | 공용 타입 변경의 파급(C1) | §A-0a 사전 grep 3종 명문화. 4앱 tsc 재확인. PR-A 단독 분리로 롤백 단위 축소. |
| R2 | `filterVisible` 흡수 시 default 동작 비대칭(C3) | Select 항목에 '활성'(invited+active) 추가, default='활성'으로 기존 체감 보존. |
| R3 | NumberInput 시각 회귀(C5) | PR-D 단독 분리·머지 전 로컬/프리뷰 육안·6개 통과 기준 명문. |
| R4 | 정렬 토글로 카드 영역 일관성 깨질 위험 | 모바일 카드 상단 정렬 Select로 데스크톱과 기능 대칭, 카드 자체는 정렬 토글 미적용. |
| R5 | URL 쿼리 동기 신규 도입의 부담 | `useSearchParams` 표준 사용·shallow routing. 미래 T7 드릴다운 뒤로가기 보존이라는 부가 효과. |
| R6 | 검색 입력 IME 조합 중 끊김 | 디바운스 없음 정책(Q12). onChange 즉시 필터 + trim + toLowerCase. |
| R7 | e2e 시드 archived 가게 부족·수수료 저장의 운영 DB 변경 위험 | PR-E 상호작용 spec에서 상태 3종 `GET` fixture와 `PATCH` 가로채기를 사용한다. 실 API 인증·렌더 스모크는 세션90 spec이 유지한다. |
| R8 | PR-A·PR-B·PR-C·PR-D 사이 main 변경 충돌 | PR마다 머지 후 다음 PR 브랜치 rebase. 운영자 1명 환경이라 실위험 낮음. |

---

## A-1. 정합성 진단 — store status SSOT 불일치 (이 계획의 근본 전제)

코드 교차 확인 결과 store status가 세 곳에서 어긋나 있다:

| 출처 | status 값 | 비고 |
|------|-----------|------|
| `@greenhub/shared` `StoreStatus` | `invited` \| `active` \| **`suspended`** | **archived 없음** |
| 어드민 `_lib.ts` 로컬 맵 | invited · active · suspended · **archived** | shared와 달리 archived 추가, suspended는 죽은 라벨 |
| **실제 set되는 값** (`stores.service`) | `invited`(온보딩 전)→`active`(완료)→`archived`(치우기) | **suspended는 어디서도 set 안 됨** |

→ **suspended는 타입엔 있으나 미사용, archived는 사용되나 타입에 없음.** `_lib.ts:4` 주석이 이 불일치를 자인.

### 영향 범위 검증 (전수 grep 완료 — 세션92 시점 스냅샷)
- `StoreStatus` 직접 참조처 = **`store.types.ts:12` `Store.status` 단 1곳**. (dist는 빌드 산출물)
- consumer/driver 앱은 store status를 분기하지 않음(모두 order status). → **변경 영향 = shared `Store` + 어드민 탭 내부로 한정.**
- api의 `'suspended'` 등장 3건은 전부 **driver/user의 suspended**(store 무관) → T0/T2가 건드리지 않음.

> ⚠️ 이 스냅샷은 세션92 작성 시점 기준. **T0 착수 직전 §A-0a grep을 재실행**해 현행 상태로 갱신할 것.

## A-2. 아토믹 태스크 (의존순)

### 그룹 0 — SSOT 정리 (선결)
- **T0. `StoreStatus` 타입 교정**
  - `packages/shared/src/store.types.ts`: `'invited'|'active'|'suspended'` → `'invited'|'active'|'archived'`
  - 리스크: shared 변경 → 4앱 tsc 재검증 필수. 사용처 1곳뿐이라 실제 위험은 낮음.
  - 정합성: 변경 후 4앱 tsc 0. api의 `status:'active'` 리터럴 set은 union 포함이라 무영향.
  - **세션 N · PR-A · 커밋 C1**

### 그룹 A — 타입·표현 레이어
- **T1 (A4). 어드민 status union 적용** — `useAdmin.ts` `status: string`→`StoreStatus`, `_lib.ts` `Record<string,string>`→`Record<StoreStatus,string>`. 폴백(`?? store.status`) 유지. (의존: T0)
  - **세션 N · PR-A · 커밋 C2**
- **T2 (B2). 죽은 '정지' 라벨 제거** — `_lib.ts` STATUS_LABEL/COLOR에서 suspended 항목 삭제. `_lib.ts:4` 주석도 갱신. (의존: T1) — 세션90 grill-me 결론("판매자 정지 기능 없음")과 일치.
  - **세션 N · PR-A · 커밋 C2** (T1과 동일 커밋)
- **T3 (A3). 수수료 검증 순수함수 추출** — `_client.tsx:18` parseFloat+범위검증 → `_lib.ts parseRate(input): ParseRateResult`. vitest 9 케이스. (독립, 병렬 가능하나 PR-C로 격리)
  - **세션 N+2 · PR-C · 커밋 C4**
- **T4 (A2). native input → Mantine NumberInput** — `StoresTable.tsx:56`. ⚠️ **시각 회귀 격리**. (의존: T3 — parseRate가 NumberInput value를 정규화 받아야 하므로)
  - **세션 N+3 · PR-D · 커밋 C5**
- **T5 (A1). StoresTable 분할** — `StoreRow`+`StoreCard` 추출. **C3 머지 후 300줄 초과 시 자동 트리거**(Q7). 미달 시 미실행.
  - **(선택) C3 머지 후 검토**

### 그룹 B — 기능 추가 (이번 범위)
- **T6 (B1). 검색·상태 필터** — `StoresFilters.tsx` 신설(`TextInput`+`Select` 패턴), `_lib.ts filterStores(stores,{keyword,status})`로 기존 `filterVisible` 흡수. 클라이언트 필터(백엔드 무변경). 로딩·빈결과에서도 필터 유지(C6). 빈결과 2종 분기(Q10). URL 쿼리 동기(Q8). (의존: T0~T2)
  - **세션 N+1 · PR-B · 커밋 C3**
- **T9 (B5). 새로고침·정렬** — reload 버튼 + 데스크톱 헤더 정렬 토글 + 모바일 정렬 Select(Q4). T6과 동일 커밋.
  - **세션 N+1 · PR-B · 커밋 C3** (T6과 동일 커밋)

### 그룹 C — 회귀 방지 (신설)
- **T_E1. 어드민 stores e2e 스펙** — `admin-stores-filter-sort.spec.ts` 8시나리오×2 viewport. 세션90 인프라 재사용.
  - **세션 N+4 · PR-E · 커밋 E1**

### 후속 구현 백로그 (PR-A~E 범위 외, 별도 SDD 선행)
- **T7 (B3). 판매자 상세 드릴다운** — store별 주문·정산 집계 API와 상세 라우트를 신설한다. 착수 전 집계 범위, 권한 경계, URL 복원 및 조회 성능을 별도 SDD로 확정한다.
- **T8 (B4). 플랫폼 기본 수수료율 설정** — 전역 config 데이터모델과 적용 정책을 신설한다. 착수 전 기존 store별 수수료와의 우선순위·소급 여부를 별도 SDD로 확정하고, 도입 시 `parseRate(input, { min, max })`로 시그니처를 확장한다.

## A-3. 작업 순서 요약 (한눈에)

```
세션 N    : PR-A = [C1 T0]  →  [C2 T1+T2]            (정합성 C1~C5)
세션 N+1  : PR-B = [C3 T6+T9 + URL 쿼리 + 빈결과 분기] (정합성 C1~C7)
세션 N+2  : PR-C = [C4 T3 parseRate + vitest 9]      (정합성 C1~C5 + vitest)
세션 N+3  : PR-D = [C5 T4 NumberInput] (시각 격리)    (정합성 C1~C5 + 6 육안 기준)
세션 N+4  : PR-E = [E1 e2e 8시나리오×2 viewport]       (e2e 16/16)
(선택)    : T5 분할 — C3 후 300줄 초과 시
```

**총 5개 PR / 6개 커밋 / 9개 아토믹 태스크(T0·T1·T2·T3·T4·T6·T9·T_E1·T5선택).**

## A-4. 차기 진입점
- **PR-C(C4) 구현 종결(2026-05-28)**: T3 `parseRate(input): ParseRateResult` 순수함수 추출 + vitest 9/9 통과. 오류 메시지는 기존 값을 보존해 별도 육안 불필요.
- **배포 후 육안 잔여**: PR-B 검색·필터·정렬·새로고침·URL 복원은 `pending-visual-verify.md` #55·#60에서 확인.
- **PR-D(C5) 구현 종결·육안 위임(2026-05-28)**: Mantine `NumberInput` 교체 코드는 정합성 검토를 통과했으며, 인증 환경 차단으로 C7은 `pending-visual-verify.md` #61~#66에 남긴다.
- **PR-E(E1) 프리뷰 실행 검증 종결(2026-05-28)**: 작업 트리 반영 seller 임시 프리뷰를 `READY`까지 확인한 뒤, 고정 fixture·쓰기 차단 기반 회귀 스펙 8시나리오를 양 viewport에서 실행해 **16/16 통과**했다. 실행 과정에서 Mantine `Select`의 역할·표시값 계약에 맞게 e2e 선택자를 보정했다.
- **후속 구현 등록 완료:** T7 판매자 상세 드릴다운과 T8 플랫폼 기본 수수료율 설정은 `docs/BACKLOG.md`의 미완료 작업으로 이관했다. 착수 시 각각 별도 SDD를 먼저 작성한다.

---

## 참고 문서

### 본 탭이 직접 참조하는 외부 문서
- **육안 검증 (각 PR 머지 후 §추가)** — [`../pending-visual-verify.md`](../pending-visual-verify.md)
  - PR-A 머지 후 = 라벨 표시 회귀 0.
  - PR-B 머지 후 = 검색·필터·정렬·새로고침·URL 복원·빈결과 2종.
  - PR-D 머지 후 = NumberInput 시각 회귀(6 항목).
- **e2e 인프라** — `apps/e2e/tests/admin-store-archive.spec.ts`, `apps/e2e/.admin-state.json` (세션90 신설).
- **vitest 인프라** — 세션85 `packages/shared/src/__tests__/date.test.ts` 패턴 재사용.
- **선설계가 필요한 확정 후속 구현 (이번 범위 제외)**
  - **T7 판매자 상세 드릴다운** — store별 주문·정산 집계 API+라우트 신설. `docs/BACKLOG.md` 등록 완료, SDD 미작성.
  - **T8 플랫폼 기본 수수료율 설정** — 전역 config 데이터모델 신설. `docs/BACKLOG.md` 등록 완료, SDD 미작성.

### 상위 인덱스 · 로드맵
- 통합 인덱스: [`../admin-tabs-improve-plan.md`](../admin-tabs-improve-plan.md)
- 멀티앱 리팩토링 로드맵: [`../app-refactor-roadmap.md`](../app-refactor-roadmap.md)

### 인접 어드민 탭
- [orders](./admin-tab-orders-plan.md) · [drivers](./admin-tab-drivers-plan.md) · [settlements](./admin-tab-settlements-plan.md) · [users](./admin-tab-users-plan.md) · [invite](./admin-tab-invite-plan.md) · [banner](./admin-tab-banner-plan.md)

### 선례 (정합성 검토 기준의 출처)
- 세션86 정산 status 필터 — C6(로딩·빈결과에서 필터 유지) 가드 패턴.
- 세션85 타임존 KST 보정 — vitest 인프라(T3 `parseRate` 유닛테스트 재사용처).
- 세션91 SDD 분리 — 한 탭씩 완결 후 커밋, 과분할 회피 패턴.
- 세션90 어드민 판매자 "치우기"(#CL-53) — "판매자 정지 기능 없음" grill-me 결론(T2 죽은 라벨 제거의 근거) + 어드민 e2e 인프라 신설(PR-E 재사용처) + 함정 3건(세션격리·networkidle·dotenv#).
- 세션92 본 문서 grill-me 13개 분기 — §A-0b 결정 사항의 출처.

# 타임존 KST 보정 결함 정리 — 아토믹 플랜

> 작성: 2026-05-24 (세션84) · 대상: BACKLOG `[타임존-UTC]` (세션83 M-PATH M5 발견)
> 결정 로그: `docs/CRITICAL_LOGIC.md` #CL-48
> 원칙: 로직 불변(동작 의도 보존), 토큰 SSOT, 타입/유틸 SSOT(`@greenhub/shared`)

---

## 1. 결함 요약

`new Date().toISOString()`은 **UTC 기준**이라 KST(UTC+9) 환경의 **00:00~08:59** 시간대에는
`split('T')[0]` / `slice(0,10)`로 추출한 날짜가 **전날**로 밀린다.
사용자가 KST 5/24 00:52(자정 직후) 배송 슬롯 캘린더에서 **5/23이 "오늘"로 표시·과거 차단 오작동**을 겪음.

### 정상 패턴 (이미 존재, 결함 아님)
`apps/seller/src/app/orders/[id]/_lib.ts:18` — `makePreparedAtOptions()` 내부
```ts
const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
const todayKST = nowKST.toISOString().slice(0, 10); // KST 보정됨
```

---

## 2. 영향 범위 (정밀 실측)

| 위치 | 라인 | 현재 코드 | 영향 | 조치 |
|------|------|-----------|------|------|
| `settings/daily-caps/page.tsx` | 134 | `now.toISOString().split('T')[0]` | **직접** — 캘린더 isToday/isPast 오판(과거날짜 차단 오작동) | `todayStr`만 교체 |
| `settlements/_hooks/useSettlements.ts` | 36 | `new Date().toISOString().split('T')[0]` | 일별요약 기본 선택일 전날 | 교체 |
| `hooks/useDashboardSummary.ts` | 30 | `new Date().toISOString().split('T')[0]` | 홈 "정산 예정" 날짜 전날 조회 | 교체 |
| `orders/[id]/_lib.ts` | 18~19 | 인라인 KST 보정(정상) | 없음 | **공통 util로 치환(중복 제거)** |

### ⚠️ 건드리면 안 되는 것 (회귀 방지)
- `daily-caps/page.tsx:53~55` — `const now = new Date()` → `now.getFullYear()`·`now.getMonth()`로
  `year`/`month` state 초기값에 사용. **이는 로컬 시간대(브라우저=KST) 기준이라 정상.** `now` 자체는 유지,
  라인 134의 `toISOString()` 추출만 교체.

---

## 3. util 위치 결정 (사용자 결정: `@greenhub/shared`)

`packages/shared/src/date.ts` 신설 → `index.ts`에 export.
**성격 변경 주의**: shared가 '타입 전용'에서 '런타임 함수 포함'으로 확장됨.
dual ESM/CJS 빌드(`tsc` + `tsc -p tsconfig.cjs.json`)이므로 함수도 정상 산출되나, **빌드 검증 필수**.

### API 설계
```ts
// packages/shared/src/date.ts
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 오늘 날짜를 YYYY-MM-DD로 반환 (UTC 자정~오전9시 하루 밀림 방지) */
export function todayKST(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 주어진 시각의 KST 기준 날짜를 YYYY-MM-DD로 반환 */
export function toDateStrKST(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
```
- `toDateStrKST`는 `orders/_lib.ts`의 `tomorrowKST`(nowKST+1일) 흡수에 사용 → 인라인 완전 제거.

---

## 4. 아토믹 태스크

### T1 — 공통 util 신설 (shared)
- `packages/shared/src/date.ts` 작성(위 API).
- `packages/shared/src/index.ts`에 `export * from './date.js'` 추가.
- 검증: `pnpm --filter @greenhub/shared build` → `dist/esm/date.js`·`dist/cjs/date.js` 산출 확인, `typecheck` exit 0.

### T2 — daily-caps 교체 (직접 영향, 최우선)
- `settings/daily-caps/page.tsx:134` `now.toISOString().split('T')[0]` → `todayKST()`.
- import 추가: `import { todayKST } from '@greenhub/shared'`.
- **라인 53~55 `now`/`year`/`month`는 불변.**
- 검증: isToday/isPast가 KST 자정 직후에도 당일 기준 동작(단위 테스트 또는 로직 추적).

### T3 — useSettlements 교체
- `settlements/_hooks/useSettlements.ts:36` → `todayKST()`. import 추가.

### T4 — useDashboardSummary 교체
- `hooks/useDashboardSummary.ts:30` → `todayKST()`. import 추가.

### T5 — orders/_lib.ts 중복 제거 (정상패턴 흡수)
- `makePreparedAtOptions()` 내 `nowKST`/`todayKST`/`tomorrowKST` 인라인을
  `todayKST()` + `toDateStrKST(new Date(Date.now()+86400000))`로 치환.
- **산출 ISO 문자열·라벨 불변 확인**(시각 회귀 0). PrepareForm 동작 동일.

### T6 — 단위 테스트 (vitest 인프라 신설, 사용자 결정)
> ⚠️ 정합성 검토 결과: 셀러·shared 어디에도 vitest/jest·`.test.ts` 없음(전수 0건).
> **`packages/shared`에 vitest를 신설**(프로젝트 첫 유닛테스트 인프라).
- `packages/shared/package.json`: `vitest` devDependency + `"test": "vitest run"` 스크립트.
- `packages/shared/vitest.config.ts` 최소 설정.
- `packages/shared/src/date.test.ts` — KST 경계 케이스:
  - UTC `2026-05-23T15:30:00Z`(=KST 5/24 00:30) → `todayKST()` === `'2026-05-24'` (UTC라면 5/23, 회귀 검출).
  - UTC 정오(`2026-05-24T03:00:00Z`=KST 정오) → `'2026-05-24'`.
  - `toDateStrKST` 익일 경계 1건.
- `vi.setSystemTime()`(또는 `vi.useFakeTimers`)으로 `Date.now` 고정해 결정적 테스트.
- 검증: `pnpm --filter @greenhub/shared test` 통과.

---

## 5. 정합성 검토 체크포인트 (구현 전 검증)

| # | 항목 | 통과 기준 |
|---|------|----------|
| C1 | shared 런타임 함수 빌드 | `dist/esm`·`dist/cjs` 양쪽 `date.js` 산출, import/require 양쪽 해소 |
| C2 | daily-caps `year`/`month` 미오염 | 라인 53~55 diff 없음, 캘린더 월 네비 정상 |
| C3 | 흡수 후 ISO 불변 | `makePreparedAtOptions()` 반환 3건 라벨·iso 동일(스냅샷 비교) |
| C4 | 잔존 `toISOString().split`/`.slice(0,10)` 스캔 | 셀러 src 전역 grep — KST 미보정 잔존 0건(소비자 e2e baseline 등 의도된 것 제외) |
| C5 | 타입체크·빌드 | `pnpm --filter @greenhub/shared build` + `pnpm --filter seller build` exit 0 |
| C6 | biome 신규 0건 | baseline 대비 신규 에러 0 |
| C7 | 단위 테스트 | T6 KST 경계 케이스 통과 |

---

## 5-1. 정합성 검토 실측 결과 (2026-05-24 세션84, 구현 전 완료)

플랜 작성 후 실코드 교차검증 — 핵심 가정 4건 확인.

| 검토 | 결과 |
|------|------|
| **영향 범위 전수 일치** | 셀러 src 전역 `toISOString().split/slice(0,10)` = **정확히 5곳**. 보정됨 2곳(`_lib.ts:19,20`, 라인18 +9h), 미보정 3곳(daily-caps:134·useSettlements:36·useDashboardSummary:30). **플랜 영향범위와 전수 일치 — 누락·과대 없음.** |
| **daily-caps year/month 안전** | 라인53~55 `now`는 `getFullYear()`/`getMonth()`(로컬=KST)로 month state 초기화 — 정상. 라인134 추출만 결함. **C2 가정 확정.** |
| **shared import 컨벤션** | index.ts가 `'./xxx.types.js'` `.js` 확장자 사용 → 플랜대로 `export * from './date.js'` 정합. |
| **🔴 테스트 인프라 부재** | 셀러·shared vitest/jest·`.test.ts` **0건**. → T6은 vitest 신설 전제(사용자 결정 반영, §4 T6 갱신). |

**결론: 플랜 실행 가능. T1→T2(직접영향)→T3→T4→T5→T6 순. 회귀 위험은 T5(인라인 흡수)뿐 — C3 스냅샷으로 가드.**

---

## 6. 범위 외 (이번 작업 제외)
- 소비자 앱의 `toISOString` 사용처 — 별도 소비자 리팩토링 트랙에서 점검(C4 스캔 시 목록만 기록).
- daily-caps의 월 네비게이션 로직 변경 — 결함 아님, 손대지 않음.

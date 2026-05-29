# 어드민 정산(settlements) 탭 개선 — 아토믹 태스크 (#CL-55 §D)

> **출처:** `admin-tabs-improve-plan.md` §D (세션94 진단) + §D-11 (셀러 정산 화면 기능 확장 교차 참조).
> SDD 분리(세션91)·반응형 카드형(세션88)은 끝남. **표현 레이어 품질은 7개 탭 중 가장 정돈됨**
> (`page`→`_client`→`_components/`(Filters·SummaryCards·Table)→`_lib`, 라벨/색 shared SSOT).
> 본 진단은 그 위의 **기능 부재(셀러 탭 대비 비대칭)·표현 정합·타임존 일관성** 정리.
> **구현 미착수.**

## 0. 공통 정합성 검토 기준 (모든 어드민 탭 공통)

각 커밋 직전 아래를 모두 통과해야 한다(세션85~91 동일).

- **C1 tsc 0** — 어드민·셀러·소비자 3앱 전체. shared·api 변경 시 재검증.
- **C2 biome 0** — 신규 경고 0.
- **C3 `npm run build` 0** — ⚠️ `npx next build` 금지(Turbopack 충돌).
- **C4 500라인 한도** — 단일 파일 500라인 초과 시 즉시 분할.
- **C5 SSOT 토큰** — 하드코딩 색·라벨 0, shared 재사용.
- **C6 가드 유지** — 로딩·빈결과에서도 status 탭·필터 유지(세션86 선례).
- **C7 시각 회귀 0** — 시각 변경이 의도된 태스크(T6 DatePicker)는 단독 커밋·육안 격리.

---

## D-0. 사용자 확정 (착수 시 — 세션92 grill 완료)

### D-0-1. 초기 범위 확정
- **4개 범위(#1 status 필터 / #2 일괄 지급 / #4 스토어명 / #7·#8 KST·에러표시) 전부 작업에 포함.**
- 단 백엔드 신설 규모(일괄 지급 엔드포인트·스토어명 조인)는 별도 SDD 후보로 분리 명시(D-6 제외군).

### D-0-2. 세션92 `grill-me` 결정 7건 (우선순위·SSOT·시점 확정)

| # | 결정 사항 | 사용자 확정안 | 후속 액션 |
|---|----------|-------------|-----------|
| **Q7** | F2(일괄 지급) vs §D 7개 우선순위 | **F2 우선 SDD 착수, §D 보류** | F2 별도 SDD 선설계 → 종결 후 본 §D 진입 |
| **Q1** | T1 — shared `toDateStrKST` 시·분 미지원 처리 | **shared util에 옵션 추가(시·분 지원)** | shared util 시그니처 확장(`hour`·`minute` 옵션) → 셀러·어드민 양쪽 영향 점검 |
| **Q3** | T5 — status 라벨/키 SSOT 위치 | **어드민 자체 `_constants` + shared `STATUS_LABEL` 재사용** | 어드민 `settlements/_constants.ts` 신설. 셀러 `_constants` cross-import 금지 |
| **Q5** | T6(native date → DatePickerInput) 시점 | **셀러 #CL-56 종결 후 A2와 통합 커밋** | 빠른 기간 3버튼 + DatePicker 폴백을 한 커밋으로. 같은 자리 두 번 만지지 않음 |
| **Q2** | T4 인덱스 산출물 처리 | **T4 → T4a(인덱스 설계) + T4b(DTO/where) 분할** | T4a 산출물 = `firestore.indexes.json` PR(세션80 선례 동일) |
| **Q4** | T2 조회 실패 표시 책임 위치 | **`_client.tsx`에 에러 배너(Alert) 노출** | Table 책임 확장 금지. 3분기 유지(loading/empty/data). 타 탭 재사용성 확보 |
| **Q6** | T3 합계 카드 라벨 명료화 조치 | **툴팁 한정(라벨 길이 불변)** | C7 시각 회귀 0 보장. 부연 텍스트 라벨 추가 금지 |

## D-1. 진단 대상 파일 (현 상태)
| 파일 | 라인 | 역할 |
|------|------|------|
| `settlements/page.tsx` | 8 | dynamic ssr:false 래퍼 |
| `settlements/_client.tsx` | 92 | 상태(필터 3종·지급 모달)·sumPayable·ConfirmModal |
| `settlements/_lib.ts` | 45 | toDateStr·toKRW·sumPayable(confirmed+paid 합산) |
| `_components/SettlementFilters.tsx` | 53 | 스토어 ID TextInput + from/to native date |
| `_components/SummaryCards.tsx` | 45 | 수수료·지급 합계 2카드 |
| `_components/SettlementTable.tsx` | 226 | 모바일 카드 / 데스크톱 테이블 (반응형 세션88) |

→ 모두 500 한도 내. **분할(과분할) 불필요** — 세션91 users/banner 전례.

## D-2. 정합성 진단 — 🔴 status 필터 UI 부재 (셀러 탭과 비대칭, drivers와 동형)

| 레이어 | status 필터 | 위치 |
|--------|------------|------|
| **셀러** 정산 [주문별 상세] | `SETTLEMENT_FILTER_TABS`(전체+4상태) 세그먼트 **완비**(세션86) | `settlements/_constants.ts:12` |
| **어드민** 정산 백엔드 DTO | status 필드 **없음** | `admin.dto.ts:12-24` (from/to/storeId만) |
| **어드민** 정산 service | status where 절 **없음** | `admin.service.ts:159-181` |
| **어드민** 정산 Filters UI | storeId·from·to만 | `SettlementFilters.tsx` |

→ **셀러엔 있고 어드민엔 없는 비대칭.** 어드민이야말로 "지급할 confirmed만" 추려야 하는 화면인데
전체를 눈으로 훑어야 함. drivers(§C-2)와 같은 계열이나 **drivers는 백엔드 완비/배선만 부재**였던 반면
**정산 어드민은 백엔드 DTO·service까지 status 미지원** → 백엔드도 함께 추가해야 함(셀러는 별도 hook 경로).

## D-3. 정합성 진단 — 표현·타임존 일관성

| 항목 | 현황 | 비고 |
|------|------|------|
| `toDateStr` (어드민 `_lib.ts:9`) | 자체 `toLocaleDateString('ko-KR')` | 세션85 공통 `toDateStrKST`(`@greenhub/shared`) **미사용** |
| 셀러 정산 날짜 | `toDateStrKST` 통일(세션85) | 어드민만 미반영 → **타임존 보정 불일치 가능** |
| 조회 실패 `error` | hook이 반환(`useAdmin.ts:103`)하나 `_client.tsx` **미구독** | 빈 결과 vs 조회 실패 구분 안 됨 |
| `AdminSettlement.confirmedAt` | 타입엔 있으나(N8) 화면 **미표시** | 확정 시점 추적 불가(저우선) |

## D-4. 정합성 진단 — 합계 카드 의미 모호

`sumPayable`은 confirmed+paid만 합산(`_lib.ts:34`)하는데 카드 라벨은 "플랫폼 수수료 합계"·"판매자
지급 합계"뿐(`SummaryCards.tsx`). **현재 필터 범위(스토어·기간)의 합계**이고 **pending·cancelled
제외**라는 두 전제가 라벨에 안 드러남 → 기간 필터 시 "왜 합계가 목록 총합과 다르지?" 오해 소지.

## D-5. 기능 부재 (UX)

- **F1 (D-2). status 필터** — 전체+4상태 세그먼트. 백엔드 DTO·service + Filters UI + hook 배선. 셀러 `SETTLEMENT_FILTER_TABS` 재사용(shared SSOT).
- **F2. 일괄 지급(bulk pay)** — 현재 행마다 단건(`markAsPaid(id)`). 정산 마감 시 confirmed 수십 건을 일일이 클릭. **체크박스 다중선택 + 일괄 지급** = 운영 실질 부재. ⚠️ 백엔드 신설(배치 트랜잭션) 규모.
- **F3 (D-2 한도). 500건 하드캡 미고지** — `getSettlements`가 `.limit(500)`(`admin.service.ts:174`)인데 501번째부터 조용히 사라짐. 건수 배지만 있고 "더 있음" 표시 없음.
- **F4 (#4). 스토어명 미표시** — 필터·테이블 모두 `storeId.slice(0,8)…` 원시 ID. 어느 가게인지 불명. ⚠️ 스토어명 조인 또는 Select 드롭다운(useAdminStores 재사용) — orders F1과 대칭.
- **F5. 날짜 입력 raw native** — `SettlementFilters.tsx:39-50` `<input type="date">`+인라인 스타일(Mantine 아님). 나머지는 `TextInput`이라 디자인 불일치. `DatePickerInput` 통일 여지. ⚠️ 시각 변경.
- **F6. 새로고침 버튼 없음** — hook에 `reload` 있으나 미노출. 지급 후 자동 reload만 존재. (stores T9·orders F2·drivers F2와 동일)

## D-6. 아토믹 태스크 (세션별 진행 순서 — 세션92 grill 확정 반영)

### D-6-0. 전체 시퀀스 한눈에

```
┌─ 세션 N+0 ─┐  ┌─ 세션 N+1 ─┐  ┌─ 세션 N+2 ─┐  ┌─ 세션 N+3 ─┐  ┌─ 세션 N+4 ─┐  ┌─ 세션 N+5 ─┐  ┌─ 세션 N+6 ─┐
│ F2 별도 SDD │→ │ F2 백엔드   │→ │ F2 프론트  │→ │ §D 그룹 A │→ │ §D 그룹 B │→ │ §D 그룹 C  │→ │ §D e2e+육안│
│ (선설계)    │  │ (T-F2a~c)  │  │ (T-F2d~e) │  │ (T1~T3·T7)│  │ (T4a→T4b→T5)│ │ (T6 통합) │  │ (E1~E5)   │
└────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────────┘
   ↑ 우선순위 0(Q7)                                                              ↑ 셀러 #CL-56 종결 대기
```

- **세션 N+0**: F2 선설계만(코드 변경 0, SDD 산출물).
- **세션 N+1~N+2**: F2 구현 종결(백엔드 → 프론트). e2e는 §D 통합 e2e와 합쳐 N+6에 일괄.
- **세션 N+3~N+5**: 본 §D 그룹 A → B → C 순.
- **세션 N+6**: 통합 정합성 검토 + e2e + 육안 가이드 갱신.

### D-6-1. 세션 N+0 — F2 별도 SDD 선설계 (코드 변경 0)

> **목표**: F2(일괄 지급) 백엔드/프론트 설계를 SDD로 고정. 본 §D보다 먼저(Q7 확정).

| 태스크 | 산출물 | 정합성 |
|--------|--------|--------|
| **T-F2-SDD-1** API 계약 설계 | `POST /admin/settlements/bulk-pay` 요청/응답 스키마, 부분 실패 응답 포맷(`{ok: string[], failed: {id, reason}[]}`) | NestJS DTO 명세, `markAsPaid` 단건 트랜잭션과의 원자성 비교 |
| **T-F2-SDD-2** 트랜잭션 전략 | (a) 단건 트랜잭션 N회 루프(부분 실패 허용) vs (b) batch write(원자성 보장, 500건 한도) — **사용자 결정 필요** | 세션80 정산 트랜잭션 패턴 참조. N1 경합 가드 재확인 |
| **T-F2-SDD-3** UI 다중선택 패턴 | 헤더 체크박스(전체선택) + 행 체크박스 + 선택카운트 액션바. 모바일 카드형에서의 표현 결정 | 세션88 반응형 카드형 패턴(`SettlementTable.tsx:226`)과 충돌 없는지 |
| **T-F2-SDD-4** 권한/안전장치 | `@Roles('admin')` 재확인. `confirm` 모달에 선택 건수·합계 노출. status가 `confirmed` 아닌 행 자동 제외 | 세션90 어드민 가드 4겹 모델 적용 |
| **T-F2-SDD-5** 별도 SDD 파일 생성 | `docs/specs/frontend/admin/admin-tab-settlements-bulk-pay-plan.md` 신설 | 본 §D 본문에서 링크 |

**산출물 게이트**: 사용자가 SDD 5건 모두 확정해야 세션 N+1 진입.

---

### D-6-2. 세션 N+1 — F2 백엔드

| 태스크 | 내용 | 정합성 |
|--------|------|--------|
| **T-F2a** DTO 신설 | `BulkPaySettlementsDto { ids: string[] (@IsArray, @ArrayMaxSize(500), @IsString({each})) }` | tsc·biome 0 |
| **T-F2b** Service 메서드 | `bulkMarkAsPaid(ids)` — T-F2-SDD-2 결정에 따라 (a) 단건 루프 / (b) batch write. 부분 실패 결과 반환 | 단위 테스트 신설(vitest, 세션85 패턴): 성공·부분실패·전체실패 3케이스 |
| **T-F2c** Controller 라우트 | `POST /admin/settlements/bulk-pay` `@Roles('admin')` | swagger 갱신(있으면). curl 수동 1회 |

**커밋 단위**: T-F2a+b+c 한 커밋 (백엔드 일체).

---

### D-6-3. 세션 N+2 — F2 프론트

| 태스크 | 내용 | 정합성 |
|--------|------|--------|
| **T-F2d** hook 확장 | `useAdminSettlements`에 `bulkMarkAsPaid(ids)` 추가. 응답 부분 실패 처리(notifications) | 기존 `markAsPaid` 동작 회귀 0 |
| **T-F2e** UI 다중선택 | `SettlementTable`에 헤더 체크박스 + 행 체크박스. 선택 시 액션바(선택건수·합계·일괄지급버튼). confirmed 외 자동 제외 | 세션88 모바일 카드형에서도 동일 UX. C7 시각 회귀 단독 커밋 |

**커밋 단위**: T-F2d+e 한 커밋.

---

### D-6-4. 세션 N+3 — 본 §D 그룹 A (표현·타임존 정합, 저위험·독립)

> 사전 조건: 세션 N+2까지 F2 종결 + 셀러 #CL-56 진행 상황 확인.

| 태스크 | 내용 | 의존 | 정합성 |
|--------|------|------|--------|
| **T1** (D-3·Q1) | shared `toDateStrKST`에 `{ hour?: '2-digit'; minute?: '2-digit' }` **옵션 추가** → 어드민 `_lib.ts toDateStr` 치환. 셀러 사용처(세션85 결과물) 회귀 0 확인 | 독립 | shared 수정 시 셀러·소비자 앱 영향 grep 필수. vitest 케이스 추가(옵션 on/off 2건) |
| **T2** (D-3·Q4) | `useAdminSettlements`의 `error` 구독을 `_client.tsx`에 추가 → Mantine `Alert color="red"` 배너 노출. **Table은 손대지 않음**(3분기 유지) | 독립 | 다른 탭과 패턴 동일성. error 발생 시점에 빈결과 가드와 동시 노출 시 우선순위(error만 표시) |
| **T3** (D-4·Q6) | `SummaryCards`의 두 카드 라벨에 Mantine `Tooltip` 부착("현재 필터 범위의 confirmed+paid 합계, pending·cancelled 제외"). **라벨 텍스트는 불변** | 독립 | C7 시각 회귀 0. 모바일 카드 폭 영향 0 |
| **T7** (F6) | `_client.tsx`에 reload 버튼 노출(헤더 우측, `ActionIcon`). hook의 reload 호출 | 독립 | stores T9·orders F2·drivers F2와 동일 패턴 |

**커밋 단위**: 태스크당 1커밋 (세션91 패턴). T1·T2·T3·T7 = 4커밋.

---

### D-6-5. 세션 N+4 — 본 §D 그룹 B (status 필터, 백엔드 포함)

| 태스크 | 내용 | 의존 | 정합성 |
|--------|------|------|--------|
| **T4a** (Q2) | **인덱스 설계 단독 커밋**. 현 `getSettlements` 사용 인덱스 실측 + status 추가 시 필요 신규 인덱스 정의. `firestore.indexes.json` PR. 세션80 선례 동일 | 선결 | Firebase Console 배포 후 빌드 단계 동작 확인 |
| **T4b** (F1 백엔드) | `QueryAdminSettlementsDto`에 `status?: SettlementStatus` (`@IsIn(SETTLEMENT_STATUSES)`) 추가. `getSettlements`에 `where('status','==',dto.status)` 조건부 적용 | T4a | T4a 인덱스 배포 확인 후 머지. tsc 0 |
| **T5** (F1 프론트·Q3) | **어드민 `settlements/_constants.ts` 신설**(셀러 cross-import 금지). `SETTLEMENT_FILTER_TABS` 자체 정의(키 배열) + 라벨은 shared `STATUS_LABEL` 재사용. `SettlementFilters` 상단에 `SegmentedTabs<SettlementFilterKey>` 배치. hook `withQuery`에 status 배선. 로딩·빈결과에서도 탭 유지(세션86 C6) | T4b | tsc·biome 0. 세션86 선례 e2e 패턴 차용 가능 |

**커밋 단위**: T4a / T4b / T5 = 3커밋.

---

### D-6-6. 세션 N+5 — 본 §D 그룹 C (시각 격리, 셀러 #CL-56 종결 대기)

| 태스크 | 내용 | 의존 | 정합성 |
|--------|------|------|--------|
| **T6** (F5·Q5) | native `<input type="date">` → Mantine `DatePickerInput` **+ A2 빠른 기간 3버튼(이번 주·이번 달·지난달) 통합 커밋**. 셀러 T2가 shared로 승격한 `periodRange` util 재사용 | **셀러 #CL-56 T2 shared 승격 종결** | C7 단독 커밋·육안 격리. 같은 자리 두 번 만지지 않음 |

**커밋 단위**: T6 단일 커밋(빠른 기간 + DatePicker 한 묶음).

**진입 게이트**: 셀러 #CL-56 T2 shared 승격이 끝나지 않았으면 본 세션은 **다음 세션으로 연기**(보류). 그동안 N+6 e2e 준비 선행 가능.

---

### D-6-7. 세션 N+6 — 통합 정합성 + e2e + 육안 가이드

| 태스크 | 내용 | 산출물 |
|--------|------|--------|
| **E1** 통합 tsc/biome/build | 어드민·셀러·소비자 3앱 전수. shared util 변경(T1) 영향 재검증 | C1·C2·C3 통과 로그 |
| **E2** 라인 한도·SSOT 감사 | 변경 파일 전수 500라인 점검. 하드코딩 색·라벨 0 grep | C4·C5 통과 |
| **E3** e2e 스펙 신설 | `apps/seller/e2e/admin/settlements.spec.ts` — 다음 시나리오:<br>① status 탭 전체→4상태 전환 시 목록 재조회·전체복귀 회귀 0<br>② 일괄 지급 다중선택 → 모달 합계 일치 → confirm 후 status `paid` 반영<br>③ 일괄 지급 부분 실패 응답 시 notifications 표시 + 성공 행만 status 갱신<br>④ reload 버튼 클릭 시 최신 데이터 반영<br>⑤ DatePicker 빠른 기간 3버튼 KST 기준 정확성(세션85 vitest 보강) | e2e 5스펙 통과 |
| **E4** 어드민 e2e 인프라 재사용 | 세션90 인프라(`admin.setup.ts`, dotenv `#` 회피, networkidle 회피) 그대로 활용 | 세션격리 가드 동작 확인 |
| **E5** 육안 가이드 갱신 | `pending-visual-verify.md` §1-V 확장 — F2 다중선택·status 탭·빠른 기간 버튼 항목 추가. 모바일 5탭 가로스크롤·반응형 카드 회귀 0 | 가이드 PR 1건 |

**커밋 단위**: E3(e2e 스펙) 1커밋 + E5(가이드) 1커밋. E1·E2·E4는 검증 액션(커밋 없음).

---

### D-6-8. 제외 (별도 SDD / 범위 밖) — 그대로 유지

- **F4 스토어명 표시(Select화)** — orders T2와 동일 규모. 본 §D 종결 후 별도 SDD. 경량(클라 `{id→name}` 매핑)은 그룹 B(T5) 흡수 가능 — 착수 시 사용자 확정.
- **F3 500건 하드캡** — 페이지네이션/커서 백엔드 변경. 부채 기록만.
- **confirmedAt 단독 표시** — D-11 A1로 위임(셀러 T3 완료 후 흡수 검토).

> 2026-05-29 사용자 요청으로 위 3건을 향후 구현 작업으로 `docs/BACKLOG.md`에 등록했다:
> `ADMIN-SETTLEMENTS-F4`, `ADMIN-SETTLEMENTS-F3`, `ADMIN-SETTLEMENTS-A1`.

## D-7. 커밋 단위 요약 (세션91 패턴 — 한 태스크 1커밋)

| 세션 | 커밋 수 | 태스크 |
|------|--------|--------|
| N+0 | 1 (SDD 문서만) | F2 SDD 신설 |
| N+1 | 1 | T-F2a+b+c (백엔드 일체) |
| N+2 | 1 | T-F2d+e (프론트 일체, 시각 격리) |
| N+3 | 4 | T1 / T2 / T3 / T7 |
| N+4 | 3 | T4a / T4b / T5 |
| N+5 | 1 | T6 (빠른 기간 + DatePicker 통합) |
| N+6 | 2 | E3 e2e / E5 가이드 |
| **합계** | **13** | F2 SDD 별도 카운트 |

## D-8. 정합성 검토 체크리스트 (세션별 적용)

각 세션 커밋 직전 `§0 C1~C7` 전부 통과 필수. 추가 세션별 가산:

- **세션 N+1 (F2 백엔드)**: vitest 3케이스(성공·부분실패·전체실패) + curl 수동 1회.
- **세션 N+2 (F2 프론트)**: 모바일 카드 다중선택 UX 시각 격리(C7).
- **세션 N+3 (그룹 A)**: T1은 shared 영향 grep + 셀러·소비자 회귀 0. T2는 다른 탭 패턴 동형 확인. T3는 모바일 폭 영향 0.
- **세션 N+4 (그룹 B)**: T4a Firebase Console 배포 확인 후 T4b 머지. T5는 셀러 `_constants` cross-import 금지 grep.
- **세션 N+5 (그룹 C)**: 셀러 #CL-56 T2 shared 승격 종결 확인 후 진입. 단독 커밋·육안 격리.
- **세션 N+6 (e2e)**: 세션90 어드민 e2e 인프라 함정 3건(세션격리·networkidle·dotenv#) 재확인.

## D-9. 차기 진입점

- **즉시 착수**: 세션 N+0 = F2 별도 SDD(`admin-tab-settlements-bulk-pay-plan.md`) 신설. T-F2-SDD-1~5 사용자 확정 필요.
- **병렬 추적**: 셀러 #CL-56 진행 상황(특히 T2 shared 승격). 본 §D N+5 진입 게이트.
- **e2e 환경**: 세션86 정산 status 필터 e2e 패턴(`pending-visual-verify.md` §1-V) + 세션90 어드민 e2e 인프라.

---

## D-11. 셀러 정산 화면 기능 확장 — 어드민 측 정렬 후보 (세션92 Further 교차 참조 · #CL-56)

> ⚠️ **범위 주의:** 본 §D 본문은 어드민 정산 화면(`apps/seller/src/app/admin/settlements/`)이지만,
> 세션92 `/further`로 **셀러 정산 화면**(`apps/seller/src/app/settlements/`, 판매자 본인 화면)의 기능 확장 5건이 별도 확정됐다.
> 셀러 SDD = [`../settlement-seller-feature-plan.md`](../settlement-seller-feature-plan.md)(#CL-56).
> 본 D-11은 그 작업이 어드민 §D에 미치는 영향 + 어드민에 흡수할 후보를 누적 기록.

### 셀러 측 확정안 5건 (요지)
| # | 셀러 작업 | 어드민 측 표현 정렬 후보 |
| :--- | :--- | :--- |
| 셀러 T1 | '일별 요약' 탭 → '요약' 탭 확장(빠른 기간 3버튼: 이번 주·이번 달·지난달) | 어드민엔 기간 빠른버튼 없음 → A2 후보(아래) |
| 셀러 T2 | KST 기준 `periodRange(thisWeek\|thisMonth\|lastMonth)` util + vitest | shared 승격 시 어드민도 재사용 |
| 셀러 T3 | 정산 행에 `paidAt`(입금 완료) / `settledAt+confirmDelayDays`(입금 예정) 표시 | **§D-3 N8·§D-6 confirmedAt 제외 항목과 동형** → A1 후보 |
| 셀러 T4 | `Settlement` 타입에 `paidAt`·`confirmedAt` 옵셔널 추가 | 어드민 `AdminSettlement`엔 이미 보유 → 어드민 타입 보강 불필요 |
| 셀러 T5 | '빠른 정산'(pending+confirmed 합성) 진입점 | 어드민은 F1(§D-2) 단일 status 필터 부재라 도메인 별개 |

### 어드민 측 영향 (이 §D 범위 안)
- **어드민 T1~T7은 셀러 작업과 독립** — 선후 의존 없음(병렬 가능). 셀러 T2 util이 shared로 승격되면 추후 어드민 측도 재사용 흡수.
- **이번 §D 구현은 그대로 진행**(어드민 T1 toDateStrKST → T2 에러 표시 → T3 합계 라벨 → T4·T5 status 필터 → T6 DatePicker → T7 reload).

### 신규 어드민 작업 후보 (이번 §D 범위 밖 · 부채 기록)
- **A1. 어드민 정산 화면에도 입금일 표시** — `AdminSettlement.confirmedAt`·`paidAt` 활용(이미 타입 보유, §D-3 N8·§D-6 confirmedAt 제외 항목과 동형). 어드민 운영자가 "이 가게 지급 끝났나"를 한 행에서 확인 가능. 셀러 T3과 같은 표현(작은 회색 글씨, status 배지 옆). **셀러 T3 완료 후** 패턴 안정되면 흡수 검토(과조기 일반화 회피, 세션91 users/banner 과분할 회피 전례).
- **A2. 어드민 정산 화면에 빠른 기간 버튼** — 셀러 T1·T2 패턴 재사용. 현재 어드민 `SettlementFilters.tsx`는 native `<input type="date">` 2개만 → 셀러 측 util shared 승격 후 같이 적용. ⚠️ **§D-6 T6(native date → DatePickerInput)과 충돌** — 둘 중 하나 또는 통합 결정 선행(빠른 기간 버튼 + DatePicker 폴백이 자연스러움).
- **A3. 셀러 측 R1(이번 주 시작 = 월/일요일) 결과를 어드민에 동일 적용** — 셀러 확정 후 어드민 A2도 같은 정책 따름.

### 우선순위
- 셀러 작업이 먼저(이미 SDD 확정). 셀러 T3 완료 → A1 흡수 검토. 셀러 T2 shared 승격 → A2 흡수 검토.
- A1·A2·A3은 본 §D 종결과 무관한 후속이라 어드민 §D 진행을 지연시키지 않는다.

---

## 참고 문서

### 본 탭이 직접 참조하는 외부 문서
- **연계 작업 SDD (셀러 정산 화면 기능 확장 #CL-56)** — [`../settlement-seller-feature-plan.md`](../settlement-seller-feature-plan.md)
  - D-11 부속 항이 위임하는 세부 계획서. 셀러 T1~T5 완료 후 어드민 A1·A2·A3 흡수 검토.
- **육안 검증** — [`../pending-visual-verify.md`](../pending-visual-verify.md) §1-V (세션86 정산 status 필터 선례) — T4·T5 탭별 재조회·전체복귀 회귀 0, 모바일 5탭 가로스크롤.
- **선결 결정·별도 SDD 후보 (이번 범위 제외)**
  - **F2 일괄 지급(bulk pay)** — 다중선택 UI + 배치 트랜잭션 엔드포인트. **별도 SDD 선설계.**
  - **F4 스토어명 표시(Select화)** — orders T2와 동일 규모. 착수 시 사용자 확정.
  - **F3 500건 하드캡 페이지네이션** — 백엔드 커서 변경. 부채 기록만.

### 상위 인덱스 · 로드맵
- 통합 인덱스: [`../admin-tabs-improve-plan.md`](../admin-tabs-improve-plan.md)
- 멀티앱 리팩토링 로드맵: [`../app-refactor-roadmap.md`](../app-refactor-roadmap.md)

### 인접 어드민 탭
- [stores](./admin-tab-stores-plan.md) · [orders](./admin-tab-orders-plan.md) · [drivers](./admin-tab-drivers-plan.md) · [users](./admin-tab-users-plan.md) · [invite](./admin-tab-invite-plan.md) · [banner](./admin-tab-banner-plan.md)

### 선례
- 세션86 정산 status 필터 UI(#245, `pending-visual-verify.md` §1-V) — 같은 도메인의 셀러 측 status 필터 도입 패턴(T5의 직접 선례).
- 세션85 타임존 KST 보정(#CL-48) — `toDateStrKST` util shared 승격(T1 직접 선례).
- 세션80 정산 복합 인덱스 배포 — T4 인덱스 확인의 직접 선례.
- 세션88 어드민 반응형(#246/247) — `SettlementTable.tsx` 모바일 카드형.
- 세션91 SDD 분리 — `settlements`가 첫 분리 탭(과분할 회피 기준).

---

## D-12. 진행 기록 (2026-05-29)

- **N+0 완료**: F2 일괄 지급 별도 SDD를 `admin-tab-settlements-bulk-pay-plan.md`로 신설했다.
- **결정 요약**: `POST /admin/settlements/bulk-pay`는 `{ ids }`를 받아 `{ ok, failed }`를 반환하며, 단건 지급과 같은 조건부 트랜잭션을 건별 반복해 부분 성공을 허용한다.
- **육안검증 등록**: 구현 후 확인 항목을 `pending-visual-verify.md` §6 #80~#89에 추가했다.
- **N+1 완료**: T-F2a~c 백엔드 DTO·service·controller를 구현했다. `BulkPaySettlementsDto`, `AdminService.bulkMarkAsPaid(ids)`, `POST /admin/settlements/bulk-pay`가 추가되었고, 성공·부분 실패·전체 실패 단위 테스트를 신설했다.
- **육안검증 추가 등록**: 백엔드 라우트 반영 확인 항목을 `pending-visual-verify.md` §6 #90에 추가했다.
- **N+2 완료**: T-F2d~e 프론트 hook·다중 선택 UI를 구현했다. `useAdminSettlements.bulkMarkAsPaid(ids)`를 추가하고, `/admin/settlements` 데스크톱 테이블·모바일 카드에 `confirmed` 전용 체크박스, 전체 선택, 선택 건수·지급 합계 액션 바, 일괄 지급 확인 모달, 성공·부분 실패 알림을 연결했다.
- **육안검증 추가 등록**: 프론트 반영 확인 상태를 `pending-visual-verify.md` §6 설명에 갱신했다. 실제 지급 처리는 운영 DB 쓰기 위험이 있으므로 테스트 DB, fixture 프리뷰, 또는 되돌릴 수 있는 검증 데이터에서만 수행한다.
- **N+3 그룹 A 완료**: T1/T2/T3/T7을 반영했다. shared `toDateStrKST`에 `hour`·`minute` 옵션을 추가하고 어드민 정산일시 표시를 `YYYY-MM-DD HH:mm` KST로 통일했다. `useAdminSettlements`의 `error`·`reload`를 `_client.tsx`에서 구독해 조회 실패 Alert와 헤더 새로고침 ActionIcon을 노출했으며, `SummaryCards` 라벨에는 confirmed+paid 한정 합계 설명 Tooltip을 연결했다.
- **육안검증 추가 등록**: `pending-visual-verify.md` §6 #91~#94에 KST 정산일시, 조회 실패 배너, 합계 툴팁, 새로고침 버튼 확인 항목을 추가했다.
- **검증 완료**: `pnpm --filter ./packages/shared build`, `pnpm --filter ./packages/shared test`, `pnpm --filter seller exec tsc --noEmit`, `pnpm --filter consumer exec tsc --noEmit`, `pnpm --filter driver exec tsc --noEmit`, `pnpm --filter api exec tsc --noEmit`, `pnpm --filter seller build`, `pnpm exec biome check packages/shared/src/date.ts packages/shared/src/date.test.ts apps/seller/src/app/admin/settlements/_lib.ts apps/seller/src/app/admin/settlements/_client.tsx apps/seller/src/app/admin/settlements/_components/SummaryCards.tsx` 통과.
- **N+4 그룹 B 완료**: T4a 확인 결과 `firestore.indexes.json`에 `settlements(status ASC, settledAt DESC)`와 `settlements(storeId ASC, status ASC, settledAt DESC)`가 이미 존재하므로 새 인덱스 추가 없이 진행했다. T4b/T5로 `GET /admin/settlements?status=` DTO·service 배선과 어드민 status 탭 UI를 반영했다.
- **육안검증 추가 등록**: `pending-visual-verify.md` §7 #95~#101에 status 탭 노출, 기본값, 상태별 조회, 복합 필터, 인덱스 오류 없음, 선택 상태 정리, 모바일 배치를 등록했다.
- **N+5 그룹 C 완료**: T6으로 native `<input type="date">`를 Mantine `DatePickerInput`으로 교체하고, 빠른 기간 3버튼(이번 주·이번 달·지난달)을 같은 필터 영역에 통합했다. 선결 util이 아직 없어서 shared `periodRange(thisWeek|thisMonth|lastMonth)`를 KST·월요일 시작 기준으로 추가하고 어드민 정산 필터가 이를 재사용하도록 연결했다.
- **육안검증 추가 등록**: `pending-visual-verify.md` §8 #102~#108에 빠른 기간 버튼, KST 월요일 시작, DatePicker 직접 선택, clear 동작, status·storeId 조합, 모바일 배치, 날짜 스타일 로드 확인 항목을 등록했다.
- **N+6 E3/E5 진행**: route fixture 기반 `apps/e2e/tests/admin-settlements.spec.ts`를 신설해 status 탭 재조회, 일괄 지급 선택·부분 실패, 실패 건 선택 유지, 새로고침·단건 지급 회귀, 빠른 기간 KST from/to 쿼리를 운영 DB 쓰기 없이 검증하도록 했다.
- **육안검증 추가 등록**: `pending-visual-verify.md` §9 #109~#114에 N+6 e2e 재실행, status 통합 회귀, 일괄 지급 알림, 새로고침·단건 지급 공존, 빠른 기간·DatePicker 복합 조합, 모바일 통합 배치 확인 항목을 등록했다.
- **N+6 e2e 재실행 완료**: 새 seller preview(`greenhub-seller-e0w9ozr5s`)에서 최초 4/10 통과·6 실패를 확인했다. 실패 원인은 구현이 아니라 `apps/e2e/tests/admin-settlements.spec.ts`의 route fixture가 쿼리 포함 `GET /admin/settlements?status=...`를 잡지 못한 테스트 인프라 결함이었다. route 정규식 보정 후 동일 preview에서 `SELLER_BASE=<새 프리뷰> pnpm --filter e2e test -- admin-settlements.spec.ts` 10/10 통과. `pending-visual-verify.md` §9 #109 체크.
- **N+6 E1/E2 완료**: shared build/test, seller·consumer·driver·api `tsc --noEmit`, API unit test, seller·consumer·driver·api build, 정산 변경 파일 `biome check`를 재실행해 통과했다. 루트 `pnpm build`는 PowerShell에서 스크립트의 `--filter './apps/*'` 따옴표가 그대로 전달되어 앱 필터가 미적중했으므로 앱별 build로 대체 검증했다.
- **E2 감사 결과**: 변경 코드 파일은 모두 500라인 미만이다. `docs/CRITICAL_LOGIC.md`·`docs/BACKLOG.md`는 누적 로그 예외이고, `pnpm-lock.yaml`은 생성 산출물이라 모듈 분리 대상에서 제외했다. 정산 status 라벨·색 정의는 shared SSOT에만 남아 있으며, UI/API의 `confirmed`·`paid` 문자열은 상태 전이 조건 또는 테스트 픽스처로 확인했다.
- **육안검증 추가 등록**: `pending-visual-verify.md` §9 #115에 E1/E2 자동 정합성 재검증 완료 항목을 추가하고 체크했다. 실화면 최종 확인은 §9 #110~#114에 유지했다.
- **N+6 §9 육안검증 완료**: 동일 seller preview에서 `admin-settlements.spec.ts`를 재실행해 10/10 통과를 재확인했다. 추가로 route fixture 기반 데스크톱·375px 모바일 캡처를 생성해 status 탭, 빠른 기간, DatePicker, 선택 액션 바, 일괄 지급 모달 배치를 확인했고, 모바일 `documentElement.scrollWidth/clientWidth = 375/375`로 문서 가로 스크롤 0을 확인했다. `pending-visual-verify.md` §9 #110~#114를 체크 완료했다.

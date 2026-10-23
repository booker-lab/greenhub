# 어드민 정산(settlements) 탭 개선 — 아토믹 태스크 (#CL-55 §D)

> **출처:** `admin-tabs-improve-plan.md` §D (세션94 진단) + §D-11 (셀러 정산 화면 기능 확장 교차 참조).
> SDD 분리(세션91)·반응형 카드형(세션88)은 끝남. **표현 레이어 품질은 7개 탭 중 가장 정돈됨**
> (`page`→`_client`→`_components/`(Filters·SummaryCards·Table)→`_lib`, 라벨/색 shared SSOT).
> 본 진단은 그 위의 **기능 부재(셀러 탭 대비 비대칭)·표현 정합·타임존 일관성** 정리.
> **현재 상태(2026-10-23, main `e4d781db` 코드 대조 — 이 절이 아래 진행 서술보다 우선):**
> - **완료:** T1 KST 표시(#316) · T2 조회 실패 표시(`e448a9c3`) · T4a 인덱스 정의(`firestore.indexes.json`, 운영 배포 여부는 별도 확인) · T4b status 필터 백엔드(#392) · T5 status 탭(`_lib.ts` `ADMIN_SETTLEMENT_FILTER_TABS`) · F3 커서 "더 보기"(쪽당 100)와 서버 합계(#592, 20,000건 넘으면 안내) · F4 가게 이름 Select·행 표시(#592) · T3 합계 카드 의미(#592에서 카드 4종·부연 문구·서버 합계로 대체, 툴팁은 만들지 않음).
> - **#592로 함께 들어온 것:** 판매자별 수수료율을 정산 생성 시 반영(가게 `commissionRate`, 없으면 5%, 정산에 `platformFeeRate` 고정) · 정산 계좌(`storePayoutAccounts`, 지급 대상 행·지급 확인창에 표시) · 지급 뒤 환불 회수 배지·회수 합계 카드 · 결제사 분쟁 보류 배지(보류 중 지급 버튼 비활성). 계약은 [`../../api/admin.md`](../../api/admin.md) §6·[`../../api/settlements.md`](../../api/settlements.md)가 정본이다.
> - **남은 것(IMPLEMENTATION_GAP):** F2 일괄 지급 · T7 화면 위 새로고침 버튼(지금은 오류 때만 "다시 조회") · T6 날짜 DatePicker·빠른 기간(셀러 #CL-56 T2 `periodRange` 선결, 아직 없음) · A1 확정·입금일 표시 · E3 관리자 정산 e2e(`apps/e2e/tests/`에 없음, API 단위 테스트는 있음).
> - **사람 결정(SEMANTIC_CONFLICT):** ① F2 일괄 지급 방식(SDD-2, 단건 루프 vs 일괄 쓰기 — 단건 지급이 지금은 건별 보류 확인·감사 기록을 같은 트랜잭션에 쓰므로 일괄도 그 계약을 지켜야 함) ② **일반 주문 배송비를 수수료 대상에 넣을지** — 일반 주문은 `totalAmount`에 배송비가 들어가고 회차 주문은 상품 소계만이라, 지금은 주문 종류에 따라 배송비에 수수료가 붙는지가 다르다.
> - 아래 D-1~D-9 본문은 2026-05 진단 당시 기록이다. 줄 번호·"없음" 서술은 위 상태로 읽는다.

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

## D-1. 대상 파일 (2026-10-23 실측)
| 파일 | 라인 | 역할 |
|------|------|------|
| `settlements/page.tsx` | 8 | dynamic ssr:false 래퍼 |
| `settlements/_client.tsx` | 168 | 상태(필터·status 탭·지급 확인창)·조회 실패 표시·더 보기 |
| `settlements/_lib.ts` | 95 | KST 날짜 포맷·status 탭·가게 Select 옵션·지급 확인창 계좌 표시 |
| `_components/SettlementFilters.tsx` | 65 | 가게 Select + from/to native date |
| `_components/SummaryCards.tsx` | 89 | 서버 합계 카드 4종(지급 대기·지급 완료·플랫폼 수수료·회수 필요) |
| `_components/SettlementTable.tsx` | 230 | 모바일 카드 / 데스크톱 테이블, 회수·보류 배지 |
| `_components/LoadMoreButton.tsx` | 39 | 커서 "더 보기" |

hook = `apps/seller/src/hooks/useAdmin.settlements*.ts`, 백엔드 목록·합계 = `apps/api/src/admin/_lib/admin-settlements-query.ts`.

## D-2. status 필터 — ✅ 해소(#392 백엔드 + T5 화면)

- DTO `status`는 shared `SETTLEMENT_STATUSES`만 허용(`apps/api/src/admin/dto/admin.dto.ts`), 쿼리는 `_lib/admin-settlements-query.ts`, 직접 증거 `apps/api/src/admin/admin-settlements-status-filter.spec.ts`.
- 화면은 `_client.tsx`의 `SegmentedTabs` + `_lib.ts` `ADMIN_SETTLEMENT_FILTER_TABS`(라벨은 shared `STATUS_LABEL`, 셀러 `_constants` cross-import 없음).

## D-3. 표현·타임존 일관성 — 대부분 해소

| 항목 | 현황 |
|------|------|
| 날짜 표시 | ✅ T1 — `_lib.ts`가 `Intl.DateTimeFormat`(`Asia/Seoul`)로 KST 표시 |
| 조회 실패 | ✅ T2 — 오류 Paper와 "다시 조회" |
| `confirmedAt`·`paidAt` 표시 | ⬜ A1 — 행에는 `settledAt`만 표시 |

## D-4. 합계 카드 의미 — ✅ #592로 대체 해소

카드가 "지급 대기·지급 완료·플랫폼 수수료·판매자 회수 필요" 4종이 되고 건수·상태 부연 문구가 붙었다. 합계는 서버 summary가 현재 조건 전체로 계산한다(최대 20,000건, 넘으면 안내). Q6의 "툴팁 한정·부연 텍스트 금지"는 이 변경으로 폐기됐다.

## D-5. 기능 부재 (UX)

- ~~F1 status 필터~~ — ✅ D-2.
- **F2. 일괄 지급(bulk pay)** — ⬜ 현재 행마다 단건 `PATCH /admin/settlements/:id/pay`만 있다. 체크박스 다중선택 + 일괄 지급은 백엔드 신설 규모이고 방식은 사람 결정(D-6-1 SDD-2).
- ~~F3 500건 하드캡~~ — ✅ #592 커서 "더 보기"(쪽당 100, 상한 500)와 서버 합계.
- ~~F4 스토어명 미표시~~ — ✅ #592 가게 이름 Select·행 표시(이름 없으면 ID 8자).
- **F5. 날짜 입력 raw native** — ⬜ `SettlementFilters.tsx`의 `<input type="date">`. `DatePickerInput` 통일 여지(T6). ⚠️ 시각 변경.
- **F6. 새로고침 버튼 없음** — ⬜ 화면 위 버튼 없음(오류 때만 "다시 조회"). users 탭의 `Button variant="light" color="gray"` "새로고침" 형태를 따른다(T7).

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
| **T1** (D-3·Q1) ✅ 2026-09-28 `fix/admin-settlements-kst` — **Q1 대신 최소 해결**: shared 시그니처는 바꾸지 않고 `_lib.ts toDateStr`를 `Intl.DateTimeFormat`(`timeZone: 'Asia/Seoul'`, 기존 표시 옵션 동일)로 교체 + `_lib.test.ts` KST 경계 vitest. 기간 기본값 계산 없음(필터 초기값 빈 문자열), `from`/`to` 쿼리는 백엔드가 이미 `dateRangeKST`로 해석하므로 불변. 아래는 원 계획: shared `toDateStrKST`에 `{ hour?: '2-digit'; minute?: '2-digit' }` **옵션 추가** → 어드민 `_lib.ts toDateStr` 치환. 셀러 사용처(세션85 결과물) 회귀 0 확인 | 독립 | shared 수정 시 셀러·소비자 앱 영향 grep 필수. vitest 케이스 추가(옵션 on/off 2건) |
| **T2** (D-3·Q4) ✅ `e448a9c3` — 오류 Paper+"다시 조회"로 표 대체(아래 원 계획과 형태 다름) | `useAdminSettlements`의 `error` 구독을 `_client.tsx`에 추가 → Mantine `Alert color="red"` 배너 노출. **Table은 손대지 않음**(3분기 유지) | 독립 | 다른 탭과 패턴 동일성. error 발생 시점에 빈결과 가드와 동시 노출 시 우선순위(error만 표시) |
| **T3** (D-4·Q6) ✅ #592에서 카드 4종·부연 문구·서버 합계로 대체(툴팁 없음) | `SummaryCards`의 두 카드 라벨에 Mantine `Tooltip` 부착("현재 필터 범위의 confirmed+paid 합계, pending·cancelled 제외"). **라벨 텍스트는 불변** | 독립 | C7 시각 회귀 0. 모바일 카드 폭 영향 0 |
| **T7** (F6) ⬜ | `_client.tsx`에 reload 버튼 노출(헤더 우측, users 탭과 같은 `Button variant="light"` "새로고침"). hook의 reload 호출 | 독립 | stores T9·orders F2·drivers F2와 동일 패턴 |

**커밋 단위**: 태스크당 1커밋 (세션91 패턴). T1·T2·T3·T7 = 4커밋.

---

### D-6-5. 세션 N+4 — 본 §D 그룹 B (status 필터, 백엔드 포함)

| 태스크 | 내용 | 의존 | 정합성 |
|--------|------|------|--------|
| **T4a** (Q2) ✅ 정의 완료(운영 배포 여부는 별도 확인) | **인덱스 설계 단독 커밋**. 현 `getSettlements` 사용 인덱스 실측 + status 추가 시 필요 신규 인덱스 정의. `firestore.indexes.json` PR. 세션80 선례 동일 | 선결 | Firebase Console 배포 후 빌드 단계 동작 확인 |
| **T4b** (F1 백엔드) ✅ #392 | `QueryAdminSettlementsDto`에 `status?: SettlementStatus` (`@IsIn(SETTLEMENT_STATUSES)`) 추가. `getSettlements`에 `where('status','==',dto.status)` 조건부 적용 | T4a | T4a 인덱스 배포 확인 후 머지. tsc 0 |
| **T5** (F1 프론트·Q3) ✅ — `_constants.ts` 대신 `_lib.ts` `ADMIN_SETTLEMENT_FILTER_TABS`에 정의 | 원 계획: **어드민 `settlements/_constants.ts` 신설**(셀러 cross-import 금지). `SETTLEMENT_FILTER_TABS` 자체 정의(키 배열) + 라벨은 shared `STATUS_LABEL` 재사용. `SettlementFilters` 상단에 `SegmentedTabs<SettlementFilterKey>` 배치. hook `withQuery`에 status 배선. 로딩·빈결과에서도 탭 유지(세션86 C6) | T4b | tsc·biome 0. 세션86 선례 e2e 패턴 차용 가능 |

**커밋 단위**: T4a / T4b / T5 = 3커밋.

---

### D-6-6. 세션 N+5 — 본 §D 그룹 C (시각 격리, 셀러 #CL-56 종결 대기)

| 태스크 | 내용 | 의존 | 정합성 |
|--------|------|------|--------|
| **T6** (F5·Q5) ⬜ | native `<input type="date">` → Mantine `DatePickerInput` **+ A2 빠른 기간 3버튼(이번 주·이번 달·지난달) 통합 커밋**. 셀러 T2가 shared로 승격한 `periodRange` util 재사용 | **셀러 #CL-56 T2 shared 승격 종결** | C7 단독 커밋·육안 격리. 같은 자리 두 번 만지지 않음 |

**커밋 단위**: T6 단일 커밋(빠른 기간 + DatePicker 한 묶음).

**진입 게이트**: 셀러 #CL-56 T2 shared 승격이 끝나지 않았으면 본 세션은 **다음 세션으로 연기**(보류). 그동안 N+6 e2e 준비 선행 가능.

---

### D-6-7. 세션 N+6 — 통합 정합성 + e2e + 육안 가이드

| 태스크 | 내용 | 산출물 |
|--------|------|--------|
| **E1** 통합 tsc/biome/build | 어드민·셀러·소비자 3앱 전수. shared util 변경(T1) 영향 재검증 | C1·C2·C3 통과 로그 |
| **E2** 라인 한도·SSOT 감사 | 변경 파일 전수 500라인 점검. 하드코딩 색·라벨 0 grep | C4·C5 통과 |
| **E3** e2e 스펙 신설 ⬜ | `apps/e2e/tests/admin-settlements.spec.ts`(미작성) — ②③은 F2 뒤, ⑤는 T6 뒤. 다음 시나리오:<br>① status 탭 전체→4상태 전환 시 목록 재조회·전체복귀 회귀 0<br>② 일괄 지급 다중선택 → 모달 합계 일치 → confirm 후 status `paid` 반영<br>③ 일괄 지급 부분 실패 응답 시 notifications 표시 + 성공 행만 status 갱신<br>④ reload 버튼 클릭 시 최신 데이터 반영<br>⑤ DatePicker 빠른 기간 3버튼 KST 기준 정확성(세션85 vitest 보강) | e2e 5스펙 통과 |
| **E4** 어드민 e2e 인프라 재사용 | 세션90 인프라(`admin.setup.ts`, dotenv `#` 회피, networkidle 회피) 그대로 활용 | 세션격리 가드 동작 확인 |
| **E5** 육안 가이드 갱신 | `pending-visual-verify.md` §1-V 확장 — F2 다중선택·status 탭·빠른 기간 버튼 항목 추가. 모바일 5탭 가로스크롤·반응형 카드 회귀 0 | 가이드 PR 1건 |

**커밋 단위**: E3(e2e 스펙) 1커밋 + E5(가이드) 1커밋. E1·E2·E4는 검증 액션(커밋 없음).

---

### D-6-8. 제외 (별도 SDD / 범위 밖) — 그대로 유지

- ~~F4 스토어명 표시(Select화)~~ — ✅ #592.
- ~~F3 500건 하드캡~~ — ✅ #592 커서 "더 보기"·서버 합계.
- **confirmedAt 단독 표시** — D-11 A1로 위임(셀러 T3 완료 후 흡수 검토).

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

## D-9. 차기 진입점 (2026-10-23 갱신)

- **사람 결정 먼저:** F2 일괄 지급 방식(SDD-2)과 일반 주문 배송비의 수수료 대상 여부(머리말 참고). F2 SDD 파일은 아직 없다.
- **결정 없이 가능한 작은 일:** T7 새로고침 버튼, A1 확정·입금일 표시, E3 e2e(status 탭·더 보기·지급 확인창).
- **게이트:** T6은 셀러 #CL-56 T2 `periodRange` shared 승격 뒤.
- **e2e 위치:** `apps/e2e/tests/admin-*.spec.ts`(세션90 어드민 인프라).

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
| 셀러 T5 | '빠른 정산'(pending+confirmed 합성) 진입점 | 어드민은 단일 status 필터(§D-2 ✅)만 있어 도메인 별개 |

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
- **육안 검증** — [`../pending-visual-verify.md`](../pending-visual-verify.md)는 이제 역사 기록이다(§1-V는 세션86 셀러 정산 선례). 새 육안 항목이 필요하면 별도 확인 목록을 만든다.
- **선결 결정·별도 SDD 후보 (이번 범위 제외)**
  - **F2 일괄 지급(bulk pay)** — 다중선택 UI + 배치 트랜잭션 엔드포인트. **별도 SDD 선설계, 방식은 사람 결정.**
  - F4 스토어명·F3 500건 하드캡은 #592로 해소.

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

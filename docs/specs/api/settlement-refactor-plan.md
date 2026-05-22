# 정산(Settlement) 탭 리팩토링 — 플랜 (SETTLE-REFACTOR)

> 작성: 2026-05-22 (세션72 선설계). 구현은 차기 세션.
> 사용자 결정: ① confirm 전이 방식 = **정산 마감 배치**(주기 cron으로 pending→confirmed 일괄 확정) ② 진행 = **선(先) 설계 플랜 문서**(CLAUDE.md 원칙).
> 연관: `docs/specs/api/settlements.md`(도메인 스펙), `docs/CRITICAL_LOGIC.md`.

---

## 0. 문제 정의 — 왜 이 작업이 필요한가

### 치명 갭 — 상태 머신의 빠진 고리 (실측 — 세션72)

`settlements.md §2`는 상태 흐름을 `pending → confirmed → paid`로 명시하고 `confirmed`를 "운영자 확인"으로 정의한다. 그러나:

- [settlements.service.ts:41](../../../apps/api/src/settlements/settlements.service.ts#L41) — `createSettlement`는 항상 `status: 'pending'` 생성.
- [admin.service.ts:155](../../../apps/api/src/admin/admin.service.ts#L155) — `markAsPaid`는 `status === 'confirmed'`만 지급 허용.
- **`pending → confirmed` 전이 코드가 코드베이스 전체에 부재** (Grep 실측: `confirmed`로 set/update하는 곳 없음).

→ **결과: 모든 정산이 `pending`에 영구 고착 → 지급 처리 영구 불가.** 어드민 "지급처리" 버튼은 `confirmed`에서만 렌더([_client.tsx:288](../../../apps/seller/src/app/admin/settlements/_client.tsx#L288)) → **버튼이 절대 나타나지 않음.** 정산 핵심 워크플로가 단절돼 있다.

### 부수 갭

- ~~**인코딩 손상**: [orders-lifecycle.service.ts:144](../../../apps/api/src/orders/orders-lifecycle.service.ts#L144) 주석 한글 UTF-8 손상.~~ → **세션74 전수 검사에서 사실 아님으로 정정**(바이트 실측 정상, mojibake 0건 — §2.7 정정 5). 태스크 불필요.
- **타입·상수 3중 정의 + 값 불일치**: `SettlementStatus`/`STATUS_LABEL`/`STATUS_COLOR`가 셀러 `_constants.ts`·어드민 `_client.tsx`·백엔드 `service.ts` 3곳에 따로. pending 라벨이 "정산 대기"(셀러) vs "대기"(어드민), 색이 yellow vs gray로 **실제로 다름**.
- **SDD 레이어 혼재**(CLAUDE.md 위반): `settlements.service.ts`에 수수료 계산(비즈니스)·Firestore 쿼리(인프라)·권한 검증(인증)·집계 루프가 한 파일에.
- **status 필터 부재**: `getSettlements`는 `from`/`to`만 받음. `settlements.md §5`엔 status 인덱스가 이미 정의됐는데 미사용.

---

## 1. 핵심 정합성 갭 (구현 전 반드시 해소)

### GAP-1 — confirm 배치의 멱등성·경합 (치명)

배치가 `pending → confirmed` 일괄 업데이트 시: ① cron 중복 실행(인스턴스 다중화) ② 배치 도중 주문 취소(`cancelSettlement`가 같은 문서를 `cancelled`로) 경합.

**해법**: 배치 쿼리를 `status == 'pending'` **AND `settledAt` 마감 경계 이전**으로 한정 + 업데이트 시 트랜잭션 내 재확인(`status === 'pending'`일 때만 confirmed). `cancelled`는 절대 덮어쓰지 않음. (payments의 `cleanupPendingOrders` 패턴 = 쿼리 후 개별 처리와 동형.)

### GAP-2 — 마감 경계 정의 (정산 주기)

"주기"의 구체값 미정. payments cron은 `EVERY_MINUTE`, notifications는 `*/10`. 정산은 그보다 길어야 한다(일/주 단위).

**해법(플랜 제안, T0 사용자 확정)**: `@Cron('0 4 * * *')`(매일 04:00 KST) — 전일 자정 이전 `settledAt`인 pending을 confirmed. **단, KST/UTC 오프셋 주의** — 서버 TZ 실측 필요(payments cutoff는 UTC 기준 `Date.now()` 사용). 마감 경계는 환경변수 `SETTLEMENT_CONFIRM_DELAY_DAYS`(기본 1)로 파라미터화.

### GAP-3 — Firestore 복합 인덱스 (배포 차단 가능)

confirm 배치 쿼리 `status == 'pending' AND settledAt < cutoff`는 복합 인덱스 필요. `settlements.md §5`에 `storeId + settledAt + status`는 있으나 **storeId 없는 `status + settledAt` 인덱스는 부재** → 런타임 `FAILED_PRECONDITION`.

**해법**: `firestore.indexes.json`에 `status ASC + settledAt ASC` 추가. T0에서 기존 인덱스 파일 위치·배포 경로 실측.

### GAP-4 — 타입 SSOT 이관 위치 (UX-11 패턴 준용)

3중 정의 통합 시 단일 위치 필요. UX-11 orderNumber는 `packages/`로 통합(세션69). 정산 status도 동일 패턴이 일관적이나, **백엔드(NestJS)와 프론트(Next.js)가 같은 패키지를 import하는 빌드 설정이 현존하는지** 미검증.

**해법**: T0에서 `packages/` 공유 타입의 기존 사례(orderNumber) import 경로를 양 앱에서 실측. 불가 시 차선 = 프론트 2곳만 셀러 `_constants.ts`로 통합(백엔드는 자체 유지, 값 일치만 보장).

---

## 2. 사전 정합성 검토 (실측 — 2026-05-22 세션72)

> 추측 아닌 실측 결과. 구현 진입 전 확인 항목.

| # | 항목 | 실측 결과 | 판정 |
|---|------|-----------|------|
| C1 | 직전 머지 정합 | working tree clean, `3f27068`(세션71 PREVIEW-GATE 종결) | ✅ |
| C2 | `@nestjs/schedule` 설치·구성 | `package.json` `^6.1.1` + `app.module.ts:29` `ScheduleModule.forRoot()` | ✅ 재사용 |
| C3 | 기존 cron 패턴 | payments `@Cron(EVERY_MINUTE)` cleanupPendingOrders = 쿼리→개별처리 동형 참조 | ✅ |
| C4 | confirm 전이 코드 | 부재 실측(Grep) — GAP 핵심 | ⚠ 신설 |
| C5 | 상태 타입 3중 정의 | 셀러·어드민·백엔드 + 값 불일치 실측 | ⚠ 통합 |
| C6 | status 인덱스 | `§5`에 storeId 포함본만, status+settledAt 부재 | ⚠ GAP-3 |
| C7 | 셀러 정산 화면 라인 | 최대 124행(useSettlements) — 500 한도 여유, 라인 리팩토링 대상 아님 | ✅ |
| C8 | 어드민 화면 라인 | `_client.tsx` 323행 — 한도 내이나 셀러와 구조 불일치 | ⚠ 분리 |
| C9 | confirm 트리거 방식 | 사용자 결정 = **정산 마감 배치** | ✅ 확정 |

**500라인 한도**: 신규 배치 메서드는 기존 `settlements.service.ts`(142행)에 추가 시 ~180행 예상 — 한도 내. SDD 분리(A-3) 수행 시 `_lib/` 추출로 오히려 감소.

**유일한 잔여 리스크**: GAP-2 서버 TZ(T0 실측), GAP-4 공유 패키지 빌드(T0 실측).

---

## 2.5 T0 게이트 실측 확정 (세션73, 2026-05-22)

> 차기 세션 진입점이었던 "T0 3대 전제 실측"을 완료. **플랜의 GAP 전제 4건이 실제와 달라 정정**한다. 이하는 추측 아닌 코드 실측 결과.

| T0 항목 | 실측 결과 | 판정 |
|---|---|---|
| ① 서버 TZ (GAP-2) | API 코드에 TZ/timezone/Asia/Seoul 설정 **전무**(Grep) → 서버 기본 TZ 의존. payments cron은 UTC `Date.now()` 기준 ([payments.service.ts:203](../../../apps/api/src/payments/payments.service.ts#L203)) | ⚠ KST 보정 필요 **확정** |
| ② 인덱스 배포 (GAP-3) | [firebase.json:4](../../../firebase.json#L4)가 `firestore.indexes.json` 지정. 그러나 **CI(.github/workflows)에 firestore:indexes 자동 배포 단계 부재**(Grep) → **수동 배포 의존** | ⚠ 배포 누락 리스크 신규 |
| ③ 공유 패키지 (GAP-4) | `@greenhub/shared`를 **API([api/package.json:24](../../../apps/api/package.json#L24)) + 셀러 모두 `workspace:*`로 import**. `payment.types.ts` 등 7개 도메인 공유 중 | ✅ 3곳 전부 통합 가능 |

### 정정 1 — GAP-3: status 인덱스는 일부 존재

[firestore.indexes.json:84-92](../../../firestore.indexes.json#L84-L92)에 `storeId + status + settledAt` 3필드 복합 인덱스가 **이미 존재**. 그러나 B-1 배치 쿼리는 `status + settledAt`(storeId 없음)이라 **storeId 없는 2필드 인덱스는 여전히 부재** → 신규 추가 대상 변함없음. **추가 리스크**: CI 자동 배포가 없으므로 B-2 DoD에 **수동 `firebase deploy --only firestore:indexes` 실행을 명시**해야 함(인덱스 추가만 하고 미배포 시 런타임 `FAILED_PRECONDITION`).

### 정정 2 — GAP-4: 차선책 폐기, 3곳 전부 packages/shared 통합

플랜은 "백엔드+프론트가 같은 패키지를 import하는 빌드 설정이 현존하는지 미검증"이라 차선책(프론트 2곳만 통합)을 뒀으나, **API도 `@greenhub/shared`를 `workspace:*`로 의존함이 확정**됐다. → **차선책 불필요**. 정산 status 타입·라벨·색을 `packages/shared/src/settlement.types.ts`로 신설해 **백엔드·셀러·어드민 3곳 전부 통합**. (단 백엔드는 타입만 쓰고 라벨/색 상수는 프론트만 import — payment.types가 타입만 export하는 기존 패턴 준용.)

### 정정 3 — createSettlement에 confirmedAt 필드 부재

[settlements.service.ts:33-47](../../../apps/api/src/settlements/settlements.service.ts#L33-L47) `createSettlement`가 set하는 필드에 `confirmedAt` 없음(`paidAt: null`만 있음). → B-1 배치가 confirmed 전이 시 `confirmedAt`을 신규 set. createSettlement에도 `confirmedAt: null` 추가해 스키마 일관성 확보(선택).

### 정정 4 — 값 불일치 실측 확정 (F-1 합의 필요)

| 위치 | pending 라벨 | pending 색 |
|---|---|---|
| 셀러 [_constants.ts:24,31](../../../apps/seller/src/app/settlements/_constants.ts#L24) | "정산 대기" | yellow |
| 어드민 [_client.tsx:20,27](../../../apps/seller/src/app/admin/settlements/_client.tsx#L20) | "대기" | gray |
| 백엔드 [settlements.service.ts:6](../../../apps/api/src/settlements/settlements.service.ts#L6) | (타입만) | — |

→ **사용자 확정(세션73): 셀러본 채택** — "정산 대기"/yellow.

---

## 2.6 미검토 파일 + 신규 발견 N1~N5 (세션73 — ⚠ 전수 검사 미완)

> **중요한 한계**: 세션72 플랜은 **치명 갭(confirm 전이 부재)에 직결된 파일만** 본 부분 분석이다. 정산 탭 전체를 격자로 훑은 **전수 조사가 아니다**. 세션73에서 미검토 파일 일부를 읽자 **플랜에 없던 문제 5건(N1~N5)**이 즉시 나옴 → 더 있을 가능성 높음. **다음 세션에서 정산 탭 전 파일 전수 검사 필수**(§7).

### 정산 탭 전체 파일 인벤토리 (16개)

| 영역 | 파일 | 세션72 검토 |
|---|---|---|
| 백엔드 | `settlements/{service,controller,module}.ts`, `dto/query-settlements.dto.ts` | service만 (controller/dto/module ❌) |
| 백엔드 | `admin/admin.service.ts`(markAsPaid) | 부분(L155만) |
| 셀러 화면 | `settlements/{page,_constants,_lib}.ts(x)` | _constants만 (page/_lib ❌) |
| 셀러 화면 | `settlements/_components/{SettlementListItem,DailySummaryTab,OrdersTab,PeriodTab}.tsx` | ❌ 전부 미검토 |
| 셀러 화면 | `settlements/_hooks/useSettlements.ts` | ❌ |
| 어드민 | `admin/settlements/{page,_client}.tsx` | _client 부분 |
| hooks | `hooks/useAdmin.ts`(useAdminSettlements) | ❌ |

### 신규 발견 (세션73 실측 — 차기 전수 검사 시 정합성 확정)

- **N1 (🟠 markAsPaid 트랜잭션 부재)**: [admin.service.ts:146-167](../../../apps/api/src/admin/admin.service.ts#L146-L167) `markAsPaid`가 **트랜잭션 없이 read→update**. 어드민이 "지급처리" 더블클릭/동시 클릭 시 이중 `paid` 경합 가능. confirm 배치(B-1)는 트랜잭션 멱등인데 지급 경로는 비보호 → 비대칭. **신규 태스크 후보 B-5**.
- **N2 (🟡 status 필터 hook 미연결)**: B-4가 `getSettlements`에 status 필터를 추가해도 [useSettlements.ts:78-99](../../../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L78-L99) `fetchSettlements`가 `from`/`to`만 보냄 → **프론트가 안 쓰면 무용**. B-4 DoD에 hook 연결 포함 필요.
- **N3 (🟡 타입 4중 정의)**: 플랜은 "3중"이라 했으나 [useAdmin.ts:38-48](../../../apps/seller/src/hooks/useAdmin.ts#L38-L48) `AdminSettlement`(`status: string`)가 **4번째 정의**. F-1 SSOT 통합 범위를 4곳으로 확대.
- **N4 (🟢 CSV가 STATUS_LABEL 직접 의존)**: [_lib.ts:26](../../../apps/seller/src/app/settlements/_lib.ts#L26) `downloadCSV`가 `STATUS_LABEL[s.status]` 직참 → F-1로 상수 이동 시 import 경로 갱신 필요. F-1 영향 범위에 명시.
- **N5 (🟡 검증 시드 전제)**: [useAdmin.ts:248](../../../apps/seller/src/hooks/useAdmin.ts#L248) markAsPaid는 confirmed 정산이 있어야 버튼 노출 → **confirmed 시드 없이는 어드민 지급 e2e 불가**. T-검증 시드 단계에 confirmed 정산 생성 명시(배치 실행 또는 직접 시드).

---

## 2.7 전수 검사 완료 (세션74, 2026-05-22) — §7 DoD 종결

> **§7 지시(정산 탭 전 파일 전수 검사) 수행 결과.** 인벤토리 16개 파일을 **전부 정독**(부분검토 없음). 미검토였던 11개 파일 + 호출처(`orders-lifecycle.service.ts`)·어드민 controller/dto까지 격자로 훑음. 추측 아닌 실측. **결론: N1~N5 전부 재확인됨 + 신규 6건(N6~N11) 발견 + 스테일 클레임 2건 정정.**

### 전수 검사 커버리지 (16/16 + 호출처)

| 영역 | 파일 | 세션74 검사 |
|---|---|---|
| 백엔드 | `settlements.service.ts` | ✅ 전체(L1-142) |
| 백엔드 | `settlements.controller.ts` | ✅ 전체(L1-31) — 깨끗 |
| 백엔드 | `settlements.module.ts` | ✅ 전체 — 깨끗 |
| 백엔드 | `dto/query-settlements.dto.ts` | ✅ 전체(L1-17) |
| 백엔드 | `admin/admin.service.ts` (정산부) | ✅ getSettlements(L122-144)+markAsPaid(L146-167) |
| 백엔드 | `admin/admin.controller.ts` (정산부) | ✅ L62-70 — 깨끗(@Roles 가드 확인 필요, N9) |
| 백엔드 | `admin/dto/admin.dto.ts` (QueryAdminSettlementsDto) | ✅ L12-24 |
| 백엔드 | `orders/orders-lifecycle.service.ts` (호출처) | ✅ createSettlement×4·cancelSettlement×2 전이 경로 |
| 셀러 화면 | `settlements/page.tsx` | ✅ 전체(L1-71) — 깨끗 |
| 셀러 화면 | `settlements/_constants.ts` | ✅ 전체(L1-41) |
| 셀러 화면 | `settlements/_lib.ts` | ✅ 전체(L1-37) |
| 셀러 화면 | `_components/SettlementListItem.tsx` | ✅ 전체 |
| 셀러 화면 | `_components/DailySummaryTab.tsx` | ✅ 전체 |
| 셀러 화면 | `_components/OrdersTab.tsx` | ✅ 전체 |
| 셀러 화면 | `_components/PeriodTab.tsx` | ✅ 전체 |
| 셀러 화면 | `_hooks/useSettlements.ts` | ✅ 전체(L1-124) |
| 어드민 | `admin/settlements/page.tsx` | ✅ 전체(dynamic ssr:false 래퍼) |
| 어드민 | `admin/settlements/_client.tsx` | ✅ **전체(L1-323, L50+ 신규 검토)** |
| hooks | `hooks/useAdmin.ts` (정산부) | ✅ AdminSettlement(L38-48)+useAdminSettlements(L229-257) |

### 스테일 클레임 정정 (세션72 플랜 §0 부정확)

- **정정 5 — orders-lifecycle:144 인코딩 손상 = 사실 아님(이미 정상)**: §0은 [orders-lifecycle.service.ts:144](../../../apps/api/src/orders/orders-lifecycle.service.ts#L144) 주석이 UTF-8 손상이라 했으나, **바이트 실측(`od -c`) 결과 정상 UTF-8**(`// settlement 취소 반영 (안전망: 정상 플로우에서는 settlement 미생성 상태)`). 정산 관련 전 파일 mojibake 패턴(`�`·`Ã`·`ì`) Grep도 **0건**. → **인코딩 수정 태스크 불필요**(세션72~73 사이 또는 이전에 이미 해소됐거나 처음부터 정상). §0 부수 갭 항목에서 제외.
- **정정 6 — createSettlement 다중 호출처 확정**: §0/§2.5는 `createSettlement`만 언급했으나 호출처 전수 확인 결과 **4개 전이 경로**에서 호출: `DELIVERED`(L99)·`REVIEWED`(L177)·`PICKED_UP`(L202·L237 2곳). cancelSettlement는 2곳(L94 셀러강제취소·L145 소비자취소). → B-1 배치 cutoff·confirmedAt 추가 시 **이 4경로가 만드는 pending 전부가 대상**임을 인지(특정 경로만이 아님).

### 신규 발견 (세션74 전수 검사 실측 — N6~N11)

- **N6 (🟠 createSettlement read→set 비트랜잭션 + 중복생성 경합)**: [settlements.service.ts:24-47](../../../apps/api/src/settlements/settlements.service.ts#L24-L47) `createSettlement`가 `existing.get()`로 중복 확인 후 `ref.set()` — **트랜잭션 밖 read→write**. 동일 주문이 짧은 간격으로 두 전이(예: DELIVERED→REVIEWED)를 타거나 동시 호출 시 **중복 확인을 통과한 2회 set이 경합**(둘 다 `exists=false` 읽고 둘 다 set → 후자가 전자 덮어씀, settledAt 갱신). N1(markAsPaid)과 동류 — **정산 도메인 write 3종(create·cancel·markAsPaid) 전부 비트랜잭션**. B-1 confirm만 트랜잭션이라 비대칭 심화. B-5 범위를 markAsPaid+create+cancel **3종 일괄 트랜잭션화**로 확대 검토.
- **N7 (🟡 cancelSettlement가 paid도 덮어씀)**: [settlements.service.ts:125-133](../../../apps/api/src/settlements/settlements.service.ts#L125-L133) `cancelSettlement`는 status 무관 무조건 `cancelled`로 update. **이미 `paid`(지급 완료)된 정산도 주문 취소 경로 타면 `cancelled`로 덮임** → 지급 후 환불 회계 불일치 가능. B-1 배치는 "cancelled 미덮어씀"을 GAP-1로 보호하나 **역방향(paid→cancelled) 가드는 부재**. 상태 머신 정합 핵심 갭. cancelSettlement에 `paid면 skip 또는 별도 환불 처리` 가드 신설 필요(신규 태스크 후보 **B-6**).
- **N8 (🟡 셀러 Settlement 인터페이스가 storeId·paidAt·confirmedAt 누락)**: [_constants.ts:4-12](../../../apps/seller/src/app/settlements/_constants.ts#L4-L12) 셀러 `Settlement`에 `storeId`/`paidAt`/`confirmedAt` 없음. 어드민 `AdminSettlement`(N3)는 `storeId`/`paidAt` 보유. F-1 SSOT 통합 시 **공유 타입 필드 합집합 정의 + 앱별 사용 필드 차이** 정리 필요. confirmedAt(B-1 신규 필드)은 **양쪽 다 미정의** → F-1에서 공유 타입에 추가.
- **N9 (🟢 어드민 정산 엔드포인트 권한 가드 확인 필요)**: [admin.controller.ts:62-70](../../../apps/api/src/admin/admin.controller.ts#L62-L70) getSettlements·markAsPaid에 메서드 레벨 `@Roles` 데코레이터 미부착(컨트롤러 레벨 가드 의존 추정). 전수 검사 범위로 **컨트롤러 클래스 레벨 `@UseGuards`/`@Roles('admin')` 적용 여부 B-구현 시 1줄 확인**(셀러 정산은 storeId 소유권 verifyOwnership으로 보호되나 어드민 경로는 role 가드가 유일 방벽).
- **N10 (🟢 어드민 화면 confirmedAt·settledAt 미표시 + 정렬 desc vs 셀러 asc)**: [_client.tsx](../../../apps/seller/src/app/admin/settlements/_client.tsx)는 정산일시 컬럼 자체가 없음(스토어/거래금액/수수료/지급액/상태/액션만). 셀러는 settledAt 표시. 또 어드민 `getSettlements`는 `orderBy('settledAt','desc')`(admin.service:137), 셀러는 `asc`(settlements.service:70) → **정렬 방향 불일치**(UX 일관성). F-2 구조 분리 시 정산일시 컬럼 추가·정렬 합의.
- **N11 (🟡 어드민 합계가 cancelled 포함 전체 합산)**: [_client.tsx:63-64](../../../apps/seller/src/app/admin/settlements/_client.tsx#L63-L64) `totalNet`/`totalFee`가 `settlements.reduce`로 **status 무관 전건 합산** → cancelled·pending 정산도 "판매자 지급 합계"에 포함돼 **실제 지급액 과대 표시**. 어드민이 status 필터(현재 storeId/from/to만, status 필터 없음 — N2 백엔드 미연결과 별개로 어드민 UI엔 status 필터 자체 부재) 못 거니 합계 신뢰 불가. F-2에서 합계를 confirmed/paid 한정 또는 status 필터 추가 검토.

### 검사 관점 체크리스트 결과 (§7)

- [x] **상태 머신 정합**: pending(create)→confirmed(B-1 부재)→paid(markAsPaid) / cancelled(cancelSettlement). **갭 = ① confirm 전이 부재(기존 A-1) ② cancelSettlement가 paid 역덮어씀(N7 신규)**.
- [x] **트랜잭션·경합**: 정산 write 3종(create·cancel·markAsPaid) **전부 비트랜잭션**(N1+N6). confirm 배치만 트랜잭션 예정.
- [x] **타입 SSOT**: **4곳 확정**(백엔드 service / 셀러 _constants / 어드민 _client 로컬 / useAdmin AdminSettlement) + 필드 집합 불일치(N8). 5번째 없음.
- [x] **백/프론트 연결**: status 필터 셀러 hook 미연결(N2) + 어드민 UI에 status 필터 자체 부재(N11).
- [x] **SDD 레이어**: service.ts에 비즈니스(수수료)+인프라(쿼리)+인증(verifyOwnership)+집계 혼재(기존 A-3). 타 파일은 레이어 혼재 추가 없음.
- [x] **라인 한도**: 최대 어드민 `_client.tsx` 323행 — **전부 500 한도 내**. 한도 위반 0건.
- [x] **UX·일관성**: 라벨/색 불일치(F-1) + 정산일시 컬럼 유무·정렬 방향(N10) + 합계 산정 기준(N11) 차이.
- [x] **인코딩 손상**: **0건**(정정 5). §0 클레임 스테일.

### §7 DoD 종결 → §3 태스크 최종 확정 (B-5·B-6 신설)

전수 검사 완료. N1~N11을 §3에 반영: **B-5(정산 write 3종 트랜잭션화 — N1+N6)**, **B-6(cancelSettlement paid 가드 — N7)** 신설. F-1 범위에 N8(필드 집합), F-2 범위에 N10(컬럼·정렬)·N11(합계 기준) 추가. **다음 단계 = B-1부터 구현 진입.** 여전히 미커밋 유지(사용자 지시).

---

## 3. 아토믹 태스크 분해 (구현 세션 — 세션73 확정)

순서 의존: ~~T0~~(완료) → [백엔드 B군] → [프론트 F군] → T-검증. 각 태스크 독립 롤백 가능.

> **세션73 확정 사항**: T0 게이트 완료(§2.5). 사용자 3대 결정 — ① 라벨/색 = **셀러본**("정산 대기"/yellow) ② 배치 = **매일 04:00 KST, 1일 지연**(`SETTLEMENT_CONFIRM_DELAY_DAYS=1`) ③ 진행 = 태스크 재분해 확정 후 구현. 차선책(프론트 2곳만 통합) **폐기** — shared 3곳 통합 확정.

### ~~T0. 진입 게이트~~ ✅ 완료 (세션73, §2.5 참조)

3대 전제 실측 종결 → ① 서버 TZ 설정 부재(KST 보정 필요 확정) ② 인덱스 일부 존재·CI 자동배포 없음(수동 배포 필요) ③ shared 3곳 통합 가능. 정정 4건은 §2.5.

---

### 3.1 세션 로드맵 (세션74 확정 — 우선순위·의존 기준)

> **기록**: #CL-44(confirm 배치) + #CL-45(정합 갭 일괄). **각 세션 DoD = 빌드+타입체크 통과**(사용자 결정). e2e·육안 검증은 S6 통합 세션 일괄. 모든 세션 독립 롤백 가능, **여전히 미커밋 유지 원칙은 사용자 지시 따름**.

| 세션 | 태스크 | 우선순위 근거 | 의존 |
|---|---|---|---|
| **S1** | B-1 + B-2 (+N9 1줄 확인) | 🔴 A-1 핵심 워크플로 단절 복구. 인덱스(B-2) 미동반 시 런타임 `FAILED_PRECONDITION` → **필수 동반** | T0 완료 |
| **S2** | B-5 + B-6 | 🔴 데이터 정합 치명 — N7(paid→cancelled 회계 손실)·N6/N1(write 경합). confirm과 **독립 축** → 병렬 가능하나 순차 권장 | 없음(B-1 무관) |
| **S3** | B-3 + B-4 | 🟡 SDD 레이어 분리(CLAUDE.md) + status 필터·N2 hook 연결 | 없음 |
| **S4** | F-1 | 🟡 SSOT 4중→1(N3·N4·N8). 백엔드 타입 이동 포함 → B군 후 진입 | B군(타입 참조 안정) |
| **S5** | F-2 (+F-3 선택) | 🟢 어드민 구조 분리 + N10(정산일시·정렬)·N11(합계 과대) | F-1(공유 타입) |
| **S6** | T-검증 + T-기록 | 통합 검증(e2e·육안) + #CL-44/45 적용 결과 기록·메모리 | 전 세션 |

**우선순위 원칙**: 데이터 정합·회계 치명(S1·S2) → 구조·SSOT(S3·S4) → UX 일관(S5) → 검증(S6). S1·S2는 독립이라 순서 교환 가능하나, S1이 워크플로 복구라 먼저.

---

### 백엔드 (B군)

#### B-1. confirm 마감 배치 신설 (핵심, A-1 해소) — 확정값

**파일**: [settlements.service.ts](../../../apps/api/src/settlements/settlements.service.ts)

- `@Cron('0 4 * * *')`로 `confirmDueSettlements()` 신설(**매일 04:00**, 사용자 확정). 단 **서버 TZ 미설정 확정(§2.5 ①)** → cutoff 계산을 KST 기준으로 명시적 보정(`Asia/Seoul` 오프셋 +9h)하거나 `@Cron`에 `{ timeZone: 'Asia/Seoul' }` 옵션 전달(@nestjs/schedule v6 지원 — B-1 구현 시 옵션 방식 우선 검토).
- cutoff = `지금 - SETTLEMENT_CONFIRM_DELAY_DAYS일`(기본 **1**, env 파라미터). 쿼리: `status == 'pending'` AND `settledAt < cutoff`.
- 각 문서 **트랜잭션 재확인 후 `pending`일 때만** `status: 'confirmed'` + `confirmedAt`/`updatedAt` set (GAP-1 멱등·취소 경합 차단 — `cancelled` 절대 미덮어씀). payments `cleanupPendingOrders`(쿼리→개별처리) 패턴 동형.
- `createSettlement`에 `confirmedAt: null` 추가(§2.5 정정3, 스키마 일관성).
- 처리 건수 `console.log('[SettlementScheduler] confirmed N건')`(payments 패턴).
- **DoD**: 배치 1회 실행 시 마감 경과 pending만 confirmed, cancelled 불변, 중복 실행 무해, KST 경계 정확.
- **롤백**: 메서드·@Cron·confirmedAt 제거.

#### B-2. status 인덱스 추가 + 수동 배포 (GAP-3) — 정정 반영

**파일**: [firestore.indexes.json](../../../firestore.indexes.json)

- `settlements`: `status ASC + settledAt ASC` 2필드 복합 인덱스 추가(기존 `storeId+status+settledAt`은 storeId 필수라 배치 쿼리 미적용 — §2.5 정정1).
- **CI 자동배포 부재 확정(§2.5 ②)** → 인덱스 추가만으로 미반영. **`firebase deploy --only firestore:indexes` 수동 실행을 DoD에 포함**.
- **DoD**: 인덱스 파일 추가 + **수동 배포 완료** + 배치 쿼리 `FAILED_PRECONDITION` 안 남(B-검증 실증).
- **롤백**: 인덱스 항목 제거(배포 인덱스는 잔존해도 무해).

#### B-3. SDD 레이어 분리 (A-3, CLAUDE.md 준수)

**파일**: `settlements.service.ts` → `settlements/_lib/` 추출

- `fee-calculator.ts`: 수수료/순액 순수 함수(`calcFee(total, rate)`).
- `settlement-aggregator.ts`: `getSummary`의 byStatus 집계 루프.
- `verifyOwnership` → 기존 공용 가드/데코레이터 존재 시 그쪽으로(중복 확인 후).
- **DoD**: service.ts 라인 감소, 순수 함수 단위 테스트 가능, 기존 동작 불변.
- **롤백**: 추출 역병합.

#### B-4. status 필터 + confirm 스펙 명문화 (A-4)

**파일**: `query-settlements.dto.ts`, `settlements.service.ts`, `settlements.md`

- `QuerySettlementsDto`에 `status?` 옵션 추가 → `getSettlements` where 절 반영.
- **N2 연결**: [useSettlements.ts:78-99](../../../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L78-L99) `fetchSettlements`가 status 파라미터를 실제 전송하도록 hook 갱신(백엔드만 추가하면 무용).
- `settlements.md`에 confirm 배치 트리거(§4 보강)·status 필터 API 추가. **선설계 원칙**: 스펙 먼저 갱신.
- **DoD**: `?status=paid` 필터 동작 + 셀러 hook이 status 전송, 스펙 현행화.

#### B-5. 정산 write 3종 트랜잭션화 (N1+N6) — 신설

**파일**: `settlements.service.ts`(createSettlement·cancelSettlement), `admin.service.ts`(markAsPaid)

- 정산 도메인 write 3종이 전부 비트랜잭션 read→write(N6 실측). confirm 배치(B-1)만 트랜잭션이라 비대칭.
- `markAsPaid`: 트랜잭션 내 재확인(`status === 'confirmed'`일 때만 paid). 더블클릭/동시 클릭 이중 paid 차단(N1).
- `createSettlement`: 트랜잭션 내 `exists` 재확인 후 set(중복 전이 경합 차단 — N6). 또는 문서ID = orderId 고정이므로 `create()`(존재 시 실패) 활용 검토.
- **DoD**: 3종 전부 트랜잭션, 동시 호출 무해, 기존 단건 동작 불변.
- **롤백**: 트랜잭션 래핑 제거.

#### B-6. cancelSettlement paid 역전이 가드 (N7) — 신설

**파일**: `settlements.service.ts`(cancelSettlement)

- 현재 `cancelSettlement`는 status 무관 무조건 `cancelled` update → **이미 `paid`된 정산도 주문 취소 시 cancelled로 덮임**(N7, 회계 불일치).
- 가드 추가: `status === 'paid'`면 cancelled 미덮어씀(로그 남기고 skip, 또는 환불 회계 별도 처리는 범위 외 — 최소 덮어쓰기 차단). B-1 GAP-1의 "cancelled 미덮어씀"과 대칭(paid 미덮어씀).
- **DoD**: paid 정산은 주문 취소 경로에서 cancelled로 안 바뀜, pending/confirmed는 기존대로 cancelled.
- **롤백**: 가드 제거.

---

### 프론트엔드 (F군)

#### F-1. 상태 타입·상수 SSOT 통합 (GAP-4, 값 불일치 해소) — 확정값

**파일**: `packages/shared/src/settlement.types.ts`(**신설**, §2.5 정정2 확정) + `packages/shared/src/index.ts`(export 추가)

- `settlement.types.ts` 신설: `SettlementStatus` 타입 + `STATUS_LABEL`/`STATUS_COLOR` 상수(payment.types가 타입만 export하나 정산은 라벨/색 상수도 공유 — `notification.types` 등에 상수 export 선례 있는지 구현 시 확인, 없으면 신규 패턴).
- **값 = 셀러본 채택**(사용자 확정): pending "정산 대기"/yellow, confirmed "확정"/blue, paid "지급 완료"/green, cancelled "취소"/red.
- 백엔드 [settlements.service.ts:6](../../../apps/api/src/settlements/settlements.service.ts#L6) 로컬 `SettlementStatus` 제거 → `@greenhub/shared` import.
- 셀러 [_constants.ts](../../../apps/seller/src/app/settlements/_constants.ts) `SettlementStatus`/`STATUS_LABEL`/`STATUS_COLOR` 제거 → re-export 또는 직접 import(`Settlement`/`Summary` 인터페이스는 셀러 로컬 유지 검토).
- 어드민 [_client.tsx:19-31](../../../apps/seller/src/app/admin/settlements/_client.tsx#L19-L31) 자체 정의 제거 후 import.
- **N3 반영**: [useAdmin.ts:38-48](../../../apps/seller/src/hooks/useAdmin.ts#L38-L48) `AdminSettlement.status: string`도 4번째 정의 → 공유 `SettlementStatus`로 교체.
- **N8 반영**: 셀러 `Settlement`는 `storeId`/`paidAt`/`confirmedAt` 누락, 어드민 `AdminSettlement`는 `confirmedAt` 누락. 공유 타입은 **필드 합집합**으로 정의(`confirmedAt` 신규 포함 — B-1 set 필드)하되 앱별 사용 필드 차이는 허용.
- **N4 반영**: [_lib.ts:26](../../../apps/seller/src/app/settlements/_lib.ts#L26) `downloadCSV`의 `STATUS_LABEL` import 경로 갱신.
- **DoD**: 4중 정의 → 1곳(`packages/shared`), 셀러·어드민 동일 라벨·색("정산 대기"/yellow), `confirmedAt` 공유 타입 포함, `pnpm --filter @greenhub/shared build` 후 양 앱 타입체크 통과.
- **롤백**: settlement.types.ts 삭제, 로컬 정의 복원.

#### F-2. 어드민 정산 화면 구조 분리 (B-2, 셀러와 일관성)

**파일**: `apps/seller/src/app/admin/settlements/` → `_components/` 신설

- `_client.tsx`(323행)에서 `SettlementFilters`·`SummaryCards`·`SettlementTable` 추출(셀러 `_components/` 패턴 동형).
- **N10 반영**: 어드민 표에 정산일시 컬럼 부재(셀러는 있음) + 정렬 방향 불일치(어드민 `desc`/셀러 `asc`). 컬럼 추가·정렬 방향 합의(권장: 양쪽 `desc` 최신순 통일 — 단 셀러 정렬 변경 시 회귀 확인).
- **N11 반영**: [_client.tsx:63-64](../../../apps/seller/src/app/admin/settlements/_client.tsx#L63-L64) `totalNet`/`totalFee`가 status 무관 전건 합산 → cancelled/pending 포함 과대 표시. 합계를 confirmed+paid 한정 또는 어드민 status 필터 추가.
- **DoD**: `_client.tsx` 축소, 컴포넌트 구조가 셀러 정산과 일관, 합계가 실제 지급 대상만 반영, 정산일시 표시.
- **롤백**: 컴포넌트 역병합.

#### F-3. (선택) 공용 DateInput·CSV export (B-3/B-4)

- `<input type="date">` 인라인 스타일 5곳 반복 → 디자인 시스템 컴포넌트화(YAGNI 판단).
- CSV는 현 클라이언트 전용 유지(대량 export 백엔드화는 별건 — §5).
- **DoD**: 중복 스타일 제거 시에만 진행.

---

### T-검증. 통합 검증

- **B**: 마감 경과 pending 시드 → 배치 실행 → confirmed 전이 + 인덱스 무에러 + 어드민 "지급처리" 버튼 노출 → markAsPaid → paid 확인. **= A-1 단절 해소 입증.**
- **F**: 셀러·어드민 정산 화면 동일 라벨·색 육안 확인(`seller-refactor-visual-verify.md`에 정산 항목 추가). e2e `seller-settlements.spec.ts`(기존 6 케이스) 회귀 통과.
- **A/B 결합**: confirm 배치 + 지급 처리 = pending→confirmed→paid 전 구간 1차 통과.

### T-기록. 결정 로그 + 메모리 (#CL-44 후보)

- `CRITICAL_LOGIC.md`에 #CL-44 등재(1000행 한도 확인).
- `settlements.md` confirm 배치·status 필터 현행화(B-4와 결합).
- `docs/memory.md` 세션 기록(200행 한도), BACKLOG에 SETTLE-REFACTOR.

---

## 4. 결정 로그 후보 (#CL-44)

**정산 confirm 마감 배치 — pending→confirmed 자동 확정** — `@Cron('0 4 * * *')`(매일 04:00 KST) 배치가 `settledAt`이 마감 경계(`지금 - SETTLEMENT_CONFIRM_DELAY_DAYS일`, 기본 1) 경과한 `pending` 정산을 트랜잭션 재확인 후 `confirmed` 전이. Why: 스펙(`settlements.md`)은 `pending→confirmed→paid`를 명시하나 confirm 전이 코드가 코드베이스 전체 부재(실측)해 전 정산이 pending 고착 → 지급 영구 불가(어드민 "지급처리" 버튼이 confirmed에서만 렌더돼 미노출). How: payments `cleanupPendingOrders` cron 패턴 재사용(신규 의존성 0 — `@nestjs/schedule` 기설치), `status==pending AND settledAt<cutoff` 쿼리 + 트랜잭션 멱등(취소 경합 시 `cancelled` 미덮어씀), `status+settledAt` 2필드 복합 인덱스 추가(+수동 배포 — CI 자동배포 부재). 서버 TZ 미설정이라 KST 보정 필수(`@Cron` timeZone 옵션 우선). 부수 정합: 상태 타입/라벨/색 3중 정의를 `packages/shared`로 통합(셀러본 "정산 대기"/yellow 채택).

## 5. 범위 외 (별건)

- CSV 대량 export 백엔드 엔드포인트 — 현 클라이언트 다운로드로 충분(YAGNI).
- 정산 알림(셀러 confirmed/paid 푸시) — notifications 도메인 별건.
- 정산 명세서 PDF·세금계산서 — 운영 단계 기능, 범위 외.
- 수수료율 스토어별 차등 — 현 단일 `PLATFORM_FEE_RATE`로 충분.

## 6. 후속 진입점 (SETTLE-REFACTOR 외 누적 후보)

- Driver Kakao Maps SDK (세션53 Outage 이후 미진행)
- 백엔드 단일 장애점 회고 (Railway Outage 교훈)
- UX-11 T14 수동 검증 2건 (운영 폴백 스크린샷·orderCounters Console — 사용자 몫)

---

## 7. 차기 세션 진입점 — 정산 탭 전수 검사 (사용자 지시, 세션73)

> **사용자 결정(세션73)**: 이번 세션 작업은 여기까지(N1~N5 기록). **다음 세션은 구현 진입 전 정산 탭 전 파일 전수 검사부터.** 세션72 플랜이 부분 분석이었음이 §2.6에서 드러났으므로, 빠진 문제·개선점을 빠짐없이 수집한 뒤 아토믹 태스크를 최종 확정한다.

### 전수 검사 대상 (§2.6 인벤토리 중 ❌ 표시 = 미검토)

미검토/부분검토 파일을 **전부 정독**하며 문제·개선점 수집:

- 백엔드: `settlements.controller.ts`(검토됨, 재확인), `dto/query-settlements.dto.ts`(status 필터 추가 지점), `settlements.module.ts`, `admin/admin.service.ts` 정산 관련 메서드 전체(markAsPaid 외 getSettlements 등).
- 셀러 화면: `settlements/page.tsx`, `_components/{SettlementListItem,DailySummaryTab,OrdersTab,PeriodTab}.tsx`, `_lib.ts` 전체.
- 어드민: `admin/settlements/page.tsx`, `_client.tsx` 전체(L50 이후 미검토).
- hooks: `hooks/useAdmin.ts`(useAdminSettlements + 공통 useAdminList 영향), `useSettlements.ts` 재확인.

### 검사 관점 (체크리스트)

- [ ] **상태 머신 정합**: pending/confirmed/paid/cancelled 4상태가 모든 경로(생성·조회·전이·취소·지급)에서 일관한가.
- [ ] **트랜잭션·경합**: read→write가 트랜잭션 밖인 곳(N1 markAsPaid류) 추가로 있는가.
- [ ] **타입 SSOT**: 정산 타입 정의처가 §2.6의 4곳 외 더 있는가(N3).
- [ ] **백/프론트 연결**: 백엔드가 추가한 필터·필드를 프론트 hook이 실제 사용하는가(N2).
- [ ] **SDD 레이어**: 비즈니스/인프라/인증 혼재(§0)가 service 외 다른 파일에도 있는가.
- [ ] **라인 한도**: 500행 초과 파일 유무(현재 최대 어드민 _client 323행 — 한도 내).
- [ ] **UX·일관성**: 셀러↔어드민 화면 구조·라벨·색·로딩/에러 처리 차이.
- [ ] **인코딩 손상**: §0 orders-lifecycle 외 한글 UTF-8 깨짐 추가 유무.

### DoD

전수 검사 결과를 §2.6에 추가 기록 → N1~N5 + 신규 발견을 §3 아토믹 태스크(B-5 등 신설 포함)로 **최종 확정** → 그 후 B-1부터 구현 진입. **여전히 미커밋 유지**(사용자 지시 — [project_settle_refactor_handoff]).

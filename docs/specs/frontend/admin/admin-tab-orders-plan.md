# 어드민 주문(orders) 탭 개선 — 아토믹 태스크 (#CL-55 §B)

> **출처:** `admin-tabs-improve-plan.md` §B (세션93 진단) + §B-8 (셀러앱 주문 화면 연계).
> SDD 분리는 세션91에 끝남(`_client`→`page`+`_client`+`_lib`+`_components/`, `83998d0`).
> 본 진단은 그 위의 **타입 안전·SSOT·기능 부재** 정리 + 셀러앱 주문 화면 연계 작업 누적.
> **현재 상태(2026-10-23, main `e4d781db` 코드 대조 — 이 절이 아래 진행 서술보다 우선):**
> - **완료:** T1 `OrderStatus` 타입(#315) · 환불 버튼을 서버 규칙에 맞춤(#318) · 조회 실패 표시 · T4 가게 이름 Select(#593, 치운 가게는 "(치움)" 표기, 토글 없음) · T6 `prompt()` → 단순 환불 확인창 `RefundConfirmModal`(#583, 사유 선택 입력) · F5 커서 "더 보기"(기본 50·상한 100, #593) · 목록 칸 보강(주문번호·주문일시·고객·상품·요청사항·가게 이름, 환불 진행·실패 배지, #593) · 회차 주문 배송 후 환불 버튼·확인창 `PostDeliveryRefundModal`(R7 #598, 사유 코드·메모 필수, 서버 R5) · 강제환불·배송 후 환불 변경 기록(#576).
> - **폐기:** T2·T3 두 단계 백엔드 가드(B-2 2026-09-28 재결정), T4 "치운 가게 포함" 토글, T6 위험 단계 분기.
> - **남은 것(IMPLEMENTATION_GAP):** T5 화면 위 새로고침·자동 폴링(지금은 조회 실패 때 "다시 조회"만) · T7 관리자 주문 e2e(`apps/e2e/tests/`에 없음, 단위 테스트만 있음 — 시나리오 재정의 필요) · F3 행 클릭 주문 상세 · F5 정렬(최신순 고정) · 환불 가능 상태 목록이 서버 목록을 손으로 복제(값은 일치, shared 일원화는 후속).
> - **사람 결정(SEMANTIC_CONFLICT):** ① 취소됐지만 환불 실패한 일반 주문의 재환불 버튼을 화면에 노출할지(서버는 허용, 화면은 배지만) ② 일반(회차 아닌) 주문의 배송 후 환불을 계속 막을지(서버·화면 모두 회차 주문만 허용).
> - 계약 정본은 [`../../api/admin.md`](../../api/admin.md) §5다. 아래 B-0~B-7은 2026-05 진단 기록이다.

## 0. 공통 정합성 검토 기준 (모든 어드민 탭 공통)

각 커밋 직전 아래를 모두 통과해야 한다(세션85~91 동일).

- **C1 tsc 0** — 어드민·셀러·소비자 3앱 전체. shared 변경 시 3앱 재검증.
- **C2 biome 0** — 신규 경고 0.
- **C3 `npm run build` 0** — ⚠️ `npx next build` 금지(Turbopack 충돌).
- **C4 500라인 한도** — 단일 파일 500라인 초과 시 즉시 분할(CLAUDE.md §1).
- **C5 SSOT 토큰** — 하드코딩 색·라벨 0, shared 재사용.
- **C6 가드 유지** — 로딩·빈결과에서도 필터·탭 UI 유지(세션86 선례).
- **C7 시각 회귀 0** — 시각 변경이 의도된 태스크는 단독 커밋·육안 격리.

---

## B-0. 대상 파일 (2026-10-23 실측)
| 파일 | 라인 | 역할 |
|------|------|------|
| `orders/page.tsx` | 8 | dynamic ssr:false 래퍼 |
| `orders/_client.tsx` | 172 | 상태·필터·환불 핸들러·더 보기·조회 실패 표시 |
| `orders/_lib.ts` | 165 | 상태 라벨·색·환불 가능 판정·배송 후 환불 판정·가게 Select 옵션 |
| `_components/OrdersFilters.tsx` | 46 | 가게 이름 Select + 상태 Select |
| `_components/OrdersTable.tsx` | 325 | 모바일 카드 / 데스크톱 테이블 |
| `_components/RefundConfirmModal.tsx` | 74 | 강제환불 확인창(#583) |
| `_components/PostDeliveryRefundModal.tsx` | 112 | 배송 후 환불 확인창(#598) |

→ 모두 500 한도 내. 타입은 `apps/seller/src/hooks/useAdmin.types.ts`.

## B-1. 정합성 진단 — order status SSOT 미사용 (stores T1과 동형) — ✅ T1로 해소

> 2026-10-23: `OrderStatus`는 `DELIVERY_HELD`를 포함해 12개다. `_lib.ts` 라벨은 `Record<OrderStatus,string>`, `AdminOrder.status`는 `OrderStatus`(`useAdmin.types.ts`). 주문 라벨 맵은 지금 5곳(소비자 주문 상세 추가)이고 어드민만 `픽업완료`로 붙여 쓴다(C-out, 별도 과제). 아래 표는 진단 당시 기록이다.

| 출처 | 정의 | 비고 |
|------|------|------|
| `@greenhub/shared` `OrderStatus` | 11개 union (PENDING…REVIEWED) | **SSOT 존재** |
| 어드민 `_lib.ts` `STATUS_LABEL` | `Record<string, string>` 11개 | 키는 일치하나 **타입 무관(string)** |
| `useAdmin.ts` `AdminOrder.status` | `string` | union 미적용 |

→ **OrderStatus는 stores의 StoreStatus와 달리 값 자체는 정합**(11개 일치, 죽은 값 없음).
문제는 **타입이 `string`이라 컴파일러가 오타·누락을 못 잡음** + shared SSOT를 안 씀.
stores의 T0(값 교정)는 **불필요**, T1(union 적용)만 해당.

### 라벨 중복·표기 흔들림 (전수 grep)
주문 상태 라벨 맵이 **4곳에 중복**:
- 어드민 `orders/_lib.ts:2` (`픽업완료`)
- 셀러 `orders/_constants.ts:49` (`픽업 완료` — 띄어쓰기 다름)
- 소비자 `mypage/_client.tsx:29`, `order/success/page.tsx:17` (`픽업 완료`)

→ 같은 enum의 한글 라벨이 앱마다 미묘하게 다름(`픽업완료` vs `픽업 완료`). **표현 SSOT 부재.**
단 이는 orders 탭 단독 범위를 넘어 4앱 표현 통일 문제 → **본 탭 진단에선 "어드민 라벨이 타 앱과 1자 다름" 기록만**, 통일은 별도 과제(C-out).

## B-2. 정합성 진단 — 강제환불 정책 프론트/백 불일치 (D1 확정)

> **2026-09-28 재결정 (이 절의 아래 표·"두 단계 정책"을 대체):** 아래 진단의 전제("백엔드는 CANCELLED만 거부")는 stale이다. 현재 백엔드는 배달 시작 이후 환불을 이미 차단한다 — 회차 주문(`schemaVersion 2`+`roundId`)은 `round-order-lifecycle.service.ts` `claimCancellation`의 PENDING·ACCEPTED·RECRUITING·CONFIRMED·PREPARING·DELIVERY_HELD, 일반 주문은 `orders.helpers.ts` `getAllowedTransitions('admin')`의 ACCEPTED·CONFIRMED·PREPARING. **사용자 결정: 새 정책(배달 후 사유 필수 환불)을 만들지 않고, 프론트 버튼 노출을 현재 서버 규칙에 맞춘다.** 구현은 `admin/orders/_lib.ts` `isRefundable`. 그룹 B(백엔드 두 단계 가드)·위험 단계 모달은 폐기. 취소 주문의 환불 재시도(서버는 `cancellation` 상태에 따라 허용)는 버튼에 포함하지 않았다 — 필요 시 별도 결정.

> **2026-10 추가:** 회차 주문의 배송 뒤(DELIVERED·PICKED_UP·REVIEWED) 환불은 별도 경로로 생겼다(R5 서버 `admin-post-delivery-refund.service.ts`, R7 화면 #598, 사유 코드·메모 필수). 일반 주문은 배송 뒤 환불 경로가 없다(사람 결정, 머리말).
>
> **현행 버튼 기준:** 회차 주문 PENDING·ACCEPTED·RECRUITING·CONFIRMED·PREPARING·DELIVERY_HELD / 일반 주문 ACCEPTED·CONFIRMED·PREPARING(`_lib.ts` `isRefundable`, 서버 `order-cancellation-state.ts`와 값 일치).

### D1 — 두 단계 정책 (세션92 grill-me, **2026-09-28 폐기** — 기록)

| 단계 | 대상 상태 | UI 동선 | 사유 입력 | 백엔드 가드 |
|------|-----------|---------|-----------|------------|
| **일반** | `ACCEPTED·RECRUITING·CONFIRMED·PREPARING` | 일반 버튼 → 단순 확인 모달 | **선택** (placeholder) | 그대로 통과 |
| **위험** | `DELIVERING·HUB_ARRIVED·PICKED_UP·DELIVERED·REVIEWED` | 빨강 경고 배너 + 모달 | **필수** (`minLength:5`) | reason 누락·길이 부족 시 400 |
| **차단** | `CANCELLED` | 버튼 미노출 | — | 이미 취소 — 400 |

- **양쪽 모두 백엔드 검증**(curl 우회 차단).
- **다른 취소 경로**(셀러·소비자 자체 `/orders/.../cancel` 등) 전수 조사 후 동일 가드 적용 (S2에서 다룸).
- **근거**: 회계 위험 차등화(배달 후 환불은 정산 영향), 어드민 우발 클릭 방지, 감사 추적.

## B-3. 기능 부재 (UX)

- **F1. 스토어 필터가 raw ID 텍스트 입력** — ✅ #593 가게 이름 Select. `OrdersFilters.tsx:21` UUID를 어드민이 외워 입력해야 함. stores 목록을 받아 **Select(이름→ID)** 로 교체 가능(useAdminStores 재사용). stores §A T6과 대칭.
- **F2. 새로고침 버튼 없음** — ⬜ T5. forceRefund 후 자동 reload만 있고 수동 reload UI 없음. 환불·상태변경이 외부에서 일어나면 수동 갱신 불가. stores T9와 동일.
- **F3. 주문 상세 드릴다운 없음** — ⬜(목록 칸은 #593으로 보강, 행 클릭 상세만 남음). 행 클릭 시 상품·수량·배달지·타임라인 없음. ID 12자·스토어 8자만 노출. (stores T7과 대칭, **백엔드 신설 → 별도 SDD**)
- **F4. native `prompt()` 사용** — ✅ #583 `RefundConfirmModal`. `_client.tsx:20` 환불 사유를 `window.prompt`로 받음. Mantine modal로 교체 시 일관성↑(취소/확인 버튼·검증). 단 시각 변화 → 별도 커밋.
- **F5. 정렬·페이지네이션 없음** — 페이지네이션 ✅ #593(커서 "더 보기", 기본 50·상한 100). 정렬은 최신순 고정(부채).

## B-4. 아토믹 태스크 (의존순·확정안)

> grill-me 결과 반영(세션92). 표의 **의존** 컬럼이 곧 커밋·세션 순서다.

### 그룹 A — 타입·표현 레이어 (저위험·런타임 무영향)
- **T1. OrderStatus union 적용**
  - `AdminOrder.status: string` → `OrderStatus`
  - `_lib.ts` `STATUS_LABEL: Record<string,string>` → `{...} satisfies Record<OrderStatus, string>` (누락 컴파일 검증)
  - 화면 렌더는 **`STATUS_LABEL[status] ?? status` 안전망 유지**(백엔드가 새 상태 추가해도 깨지지 않음)
  - `getStatusColor(status: OrderStatus)`, `REFUNDABLE: OrderStatus[]`
  - shared `OrderStatus` import (`@greenhub/shared`)
  - **의존**: 없음
  - **정합성**: 3앱 tsc 0. 값 정합이라 런타임 무영향, 컴파일 안전만 추가.

### 그룹 B — D1 정책 백엔드 가드 (안전망 선행)
- **T2. `admin.forceRefund` 두 단계 가드** — 폐기(B-2 2026-09-28)
  - `apps/api/src/admin/admin.service.ts:136` `forceRefund` 보강:
    1. `status==='CANCELLED'` → 400 "이미 취소" (현행 유지)
    2. **위험 상태**(`DELIVERING·HUB_ARRIVED·PICKED_UP·DELIVERED·REVIEWED`)이고 `reason` 누락·`length<5` → 400 "배달 후 환불은 사유(5자 이상)가 필수입니다"
    3. 일반 상태는 그대로 통과
  - `ForceRefundDto`에 단계별 검증 메시지 추가(`@MinLength(5)`는 조건부 — 컨트롤러에서 분기 또는 서비스 검증)
  - **의존**: T1 (어드민 라우트는 백엔드 응답을 그대로 받지만 union 정합이 먼저 닫혀야 컴파일 안전)
  - **정합성**: API 단위테스트 추가(상태×사유 매트릭스), 셀러앱 tsc/build 0.

- **T3. 다른 취소 경로 전수 조사·동일 가드 적용** — 폐기(B-2 2026-09-28)
  - **조사 대상**:
    - `apps/api/src/orders/*` — `/orders/cancel`, `/orders/:id/cancel`, `processCancel` 등 status를 `CANCELLED`로 전이시키는 모든 경로
    - `apps/api/src/payments/*` — 환불 콜백·웹훅 경유 취소
    - shared `Order` 모델의 `CANCELLED` 전이 helper 유무
  - **조사 산출물**: `docs/specs/frontend/admin/admin-tab-orders-cancel-paths.md`(경로·트리거·현 가드 표)
  - **가드 적용**: 위험 상태 + 사유 누락 시 동일 400. 단, 셀러·소비자 자체 취소는 도메인상 배달 전만 허용이 일반적이라 **대부분 가드 자동 충족** 예상.
  - **의존**: T2 (가드 패턴이 T2에서 확립)
  - **정합성**: 조사 결과 보강 경로 N개 = 그만큼 추가 API 단위테스트.

### 그룹 C — UX 기능 추가 (시각 변경·격리)
- **T4. 스토어 Select 필터** (F1) — ✅ #593(토글 없이 전체 표시·"(치움)" 표기)
  - `OrdersFilters.tsx` TextInput → `Select` + `Switch` "치운 스토어 포함"(기본 off)
  - `useAdminStores` 결과 → `{ value: store.id, label: store.name + (status==='archived' ? ' (치운)' : '') }`
  - 토글 off 시 `status==='active'`만, on 시 전체
  - '전체 스토어' 선택지(value 빈 문자열) 유지
  - **의존**: T1
  - **정합성**: 백엔드 무변경(`storeId` 쿼리 그대로), 시각 회귀 단독 격리.

- **T5. 새로고침 + 자동 폴링 토글** (F2) — ⬜
  - `_client.tsx`에 `useAdminOrders.reload` 노출
  - 헤더 우측에 `ActionIcon`(수동) + `Switch` "자동 새로고침(30초)"
  - 토글 on 시 `setInterval(reload, 30_000)`, off/언마운트 시 `clearInterval` (cleanup 필수)
  - 토글 상태는 `useState` (세션 간 유지 불필요)
  - **의존**: T1
  - **정합성**: Firestore 읽기 비용 옵트인. 시각 변경 적음.

### 그룹 D — 환불 모달 (시각·동선 변경·단독)
- **T6. `prompt` → Mantine modal + 두 단계 분기** (F4) — ✅ 단순 확인창으로 #583(두 단계 분기는 폐기)
  - `_client.tsx` `handleRefund`에서 `prompt` 제거
  - 새 컴포넌트 `_components/RefundModal.tsx`:
    - props: `order: AdminOrder | null`, `onConfirm(reason)`, `onClose()`
    - `isRiskStage = REFUNDABLE_RISK.includes(order.status)` 분기
    - 위험 단계: 상단 `<Alert color="red">배달 진행 후 환불입니다. 정산·고객 영향이 큽니다.</Alert>` + `<Textarea required minLength={5}>`
    - 일반 단계: placeholder만 있는 `<Textarea>` (선택)
    - 확인 버튼 disabled 조건: 위험 단계인데 `reason.trim().length<5`
  - **의존**: T1·T2 (백엔드 가드가 먼저 작동해야 우회 차단)
  - **정합성**: ⚠️ 시각·동선 변경 → **단독 커밋·육안 검증**(`pending-visual-verify.md`에 항목 추가).

### 그룹 E — e2e (해피패스·안전망)
- **T7. 어드민 orders e2e 스펙** — ⬜ 재정의 필요
  - 위치: `apps/e2e/tests/admin-orders.spec.ts`(세션90 어드민 e2e 인프라 재사용)
  - **2026-10-23 재정의 방향:** 가게 Select·상태 필터·더 보기·강제환불 확인창·배송 후 환불 확인창. 아래 2(토글)·5(폴링, T5 뒤)·7·8(두 단계 정책)은 폐기된 원안이다.
  - 스펙 8건(해피패스 6 + 안전망 2):
    1. 스토어 Select 필터 — 옵션 로드·선택·결과 좁힘
    2. 치운 스토어 토글 — off/on 시 옵션 차이
    3. 상태 Select 필터 — `PREPARING` 선택 → 다른 상태 미노출
    4. 수동 새로고침 — 버튼 클릭 시 reload 호출 확인(네트워크 인터셉트)
    5. 자동 폴링 토글 — on 후 30초 경과(타이머 mock) → 재호출
    6. 환불 모달(일반) — `PREPARING` 주문 → 모달 열림, 사유 빈 채 확인 → 성공
    7. 환불 모달(위험) — `DELIVERING` 주문 → 경고 배너 + 사유 5자 미만 시 confirm disabled → 5자 이상 입력 후 성공
    8. 안전망 — 백엔드 직접 호출(supertest): 위험 상태 + 사유 없음 → 400 검증
  - 시드: `seed-admin-orders-visual`(상태 9종 섞인 주문 시드 신설)
  - **의존**: T2·T3·T4·T5·T6 전부 머지 후
  - **정합성**: 8/8 통과 + 세션90 함정 3건(세션격리·networkidle·dotenv#) 회피.

### 선결 결정 (확정 완료)
- ✅ **D1**: 2026-09-28 재결정 — 버튼을 서버 규칙에 맞춤(B-2). 두 단계 정책은 폐기.

### 제외 (별도 SDD / 범위 밖)
- **F3 주문 상세 드릴다운** — 집계·조회 API + 라우트 신설 (stores T7과 동일 사유).
- **F5 정렬** — 페이지네이션은 #593으로 해소, 정렬만 부채.
- **C-out 라벨 4앱 통일** — 주문 라벨 표현 SSOT는 어드민 단독 범위 밖(셀러·소비자 동시 변경).

## B-5. 커밋·세션 분할 (4세션 — 세션92 확정, 2026-10 기준 역사 기록)

> 한 세션 = 그룹 단위. 세션 끝마다 push·정합성 통과 보장. 중간 종료 시 후속 세션이 단독 진입 가능하도록 각 세션 산출물을 자기완결로 설계.

### 세션α — **그룹 A·B (타입·정책 안전망)**
| 순서 | 커밋 | 내용 | 파일 |
|------|------|------|------|
| 1 | `feat(admin): #CL-55 orders T1 OrderStatus union 적용` | T1 전체 | `_lib.ts`·`useAdmin.ts`·shared import |
| 2 | `feat(api): #CL-55 forceRefund 두 단계 환불 가드 추가 (D1=C)` | T2 백엔드 가드 + 단위테스트 | `admin.service.ts`·`force-refund.dto.ts`·`admin.service.spec.ts` |

**세션α 정합성**: C1~C7 + API 단위테스트 통과. **push 후 운영 배포·1차 육안 없음**(UI 변화 0).

### 세션β — **그룹 B 확장 (다른 취소 경로 소급)**
| 순서 | 커밋 | 내용 |
|------|------|------|
| 3 | `docs(admin): #CL-55 주문 취소 경로 전수 조사 결과` | 조사 산출물 신설 |
| 4 | `feat(api): #CL-55 셀러·소비자 취소 경로 위험 단계 가드 동기화` | T3 가드 적용 + 단위테스트 |

**세션β 정합성**: C1~C7 + 신규 단위테스트. **조사 결과 가드 보강 경로 0개면 커밋 4 생략**(조사 문서만 머지).

### 세션γ — **그룹 C (필터·새로고침 UX)**
| 순서 | 커밋 | 내용 |
|------|------|------|
| 5 | `feat(admin): #CL-55 orders T4 스토어 Select 필터 + 치운 스토어 토글` | T4 |
| 6 | `feat(admin): #CL-55 orders T5 새로고침 버튼 + 자동 폴링 토글` | T5 |

**세션γ 정합성**: C1~C7. **시각 변화 발생 → `pending-visual-verify.md` §추가**(스토어 Select 동작·자동 폴링 30초).

### 세션δ — **그룹 D·E (환불 모달 + e2e 마감)**
| 순서 | 커밋 | 내용 |
|------|------|------|
| 7 | `feat(admin): #CL-55 orders T6 환불 모달 + 두 단계 분기` | T6 단독 커밋 (시각·동선 변경 격리) |
| 8 | `test(e2e): #CL-55 어드민 orders 해피패스·안전망 8스펙` | T7 |

**세션δ 정합성**: C1~C7 + e2e 8/8 + `pending-visual-verify.md` §추가(모달 두 동선 육안).

## B-6. 세션별 정합성 검토 체크리스트

각 세션의 마지막 커밋 직전 아래를 **순서대로** 통과해야 한다(세션85~91 동일).

### 공통 C1~C7 (모든 세션)
- [ ] **C1 tsc 0** — `npx tsc --noEmit` 어드민(=셀러앱) + 소비자 + 셀러(공유) 3앱
- [ ] **C2 biome 0** — `npx biome check` 신규 경고 0
- [ ] **C3 `npm run build` 0** — ⚠️ `npx next build` 금지 (Turbopack 충돌)
- [ ] **C4 500라인 한도** — 변경된 모든 단일 파일 500라인 이내
- [ ] **C5 SSOT 토큰** — 하드코딩 색·라벨 0, shared 재사용
- [ ] **C6 가드 유지** — 로딩·빈결과에서도 필터·탭·새로고침 버튼 노출 유지
- [ ] **C7 시각 회귀 0** — 의도된 시각 변경(T4·T5·T6)은 단독 커밋

### 세션별 추가 체크
- **세션α 추가**:
  - [x] T1: shared `OrderStatus` import 1곳(`_lib.ts`), `satisfies` 컴파일 검증 통과 — #315(`satisfies` 대신 `Record<OrderStatus,string>` 타입 지정)
  - [ ] T2: API 단위테스트 — 상태 11종 × (reason 있음·없음·짧음) 매트릭스 ≥ 18 케이스 — 폐기(B-2 2026-09-28 재결정)
  - [ ] T2: curl 우회 시뮬레이션 — `DELIVERING` + reason 누락 → 400 응답 — 폐기(B-2 2026-09-28 재결정)
- **세션β 추가**:
  - [ ] T3: 조사 문서에 경로 표(트리거·현 가드·필요 가드) + git grep 명령 기록 — 폐기(B-2 2026-09-28 재결정)
  - [ ] T3: 가드 보강된 경로마다 단위테스트 1건 이상 — 폐기(B-2 2026-09-28 재결정)
- **세션γ 추가**:
  - [x] T4: 가게 Select — #593(토글은 두지 않기로 함)
  - [ ] T5: 토글 off + 언마운트 → `clearInterval` 호출(메모리 누수 없음)
  - [ ] T5: 폴링 중 사용자 액션(필터 변경) → 즉시 재호출 + 폴링 유지
- **세션δ 추가**:
  - [x] T6: 단순 환불 확인창 — #583(위험 단계 분기 항목은 폐기)
  - [ ] T7 e2e: 8/8 통과 + 세션90 함정 3건 회피(세션격리·networkidle·dotenv#)

## B-7. 차기 진입점

> **2026-10-23 갱신:** 다음 = T5 새로고침(폴링은 선택) → T7 e2e(재정의 시나리오). 사람 결정 2건은 머리말. 아래는 2026-05 세션 안내 기록이다.

- **세션α 후**: T1 union·T2 백엔드 가드 머지·운영 배포. UI 변화 0이므로 육안 생략. **다음 = 세션β(취소 경로 조사).**
- **세션β 후**: 조사 문서 + 가드 동기화 머지. **다음 = 세션γ(필터·새로고침 UX).**
- **세션γ 후**: `pending-visual-verify.md`에 스토어 Select·자동 폴링 항목 추가. 운영 1차 육안. **다음 = 세션δ(환불 모달 + e2e).**
- **세션δ 후**: `pending-visual-verify.md`에 환불 모달 두 동선 추가. e2e 8/8 푸시. **#CL-55 §B 코드 종결.** A1·A2(셀러 송장 흡수 부채), F3·F5(별도 SDD) 남음.

---

## B-8. 연계 작업 — 셀러앱 주문 화면 발송·추적 보강 (`/further` 진단)

> ⚠️ **범위 주의:** 본 §B 본문은 어드민 주문 탭(`apps/seller/src/app/admin/orders/`)이지만,
> 본 부속 항은 **셀러앱 주문 화면**(`apps/seller/src/app/orders/`, 판매자 본인 화면)의
> 발송·추적 UX 보강 3건을 어드민 orders 탭 항목으로 누적 기록한다(사용자 지시).
> 같은 주문 도메인을 한 문서에서 추적하기 위해 §B 아래에 둔다.
> **세부 SDD = [`../seller-orders-improve-plan.md`](../seller-orders-improve-plan.md)** (Further 1차 종결, grill-me 대기).

### B-8.1 핵심 발견 (`/further` 2026-05-26)

셀러 주문 화면(`apps/seller/src/app/orders/`)은 "들어온 주문 처리"(준비·발송·취소) 흐름은 완비됐으나,
**발송 이후 일어나는 일**을 사장님이 화면에서 거의 못 본다:

| 결함 | 위치 | 상태 |
|------|------|------|
| 택배 발송 완료 시 송장번호 칸 부재 — `handleShipParcel`이 `PREPARING → DELIVERED` 직행 | [useOrderDetailActions.ts:54-57](../../../../apps/seller/src/app/orders/[id]/_hooks/useOrderDetailActions.ts#L54-L57) | 🔴 빈 결함 |
| 새 주문·지연 주문을 사장님에게 먼저 띄우는 알림 부재(현재는 화면 열어야 인지) | [orders/page.tsx](../../../../apps/seller/src/app/orders/page.tsx) — `groupCounts[ACTION_REQUIRED]` 배지만 | 🔴 화면 의존 |
| 여러 주문 일괄 처리(준비·발송) 불가 — 건 하나씩만 처리 | [orders/[id]/page.tsx](../../../../apps/seller/src/app/orders/[id]/page.tsx) — 상세 진입 강제 | 🔴 동선 부재 |

### B-8.2 사용자 확정 — 세 걸음 한 묶음 로드맵

| # | 걸음 | 상태 |
|---|------|------|
| ① | **택배 송장번호 저장·표시** | Further 1차 확정 (Must 4건) |
| ② | **지연·신규 주문 사장님 알림** | Further 별도 차수 필요 |
| ③ | **여러 주문 일괄 처리(준비·발송)** | Further 별도 차수 필요 |

순서 근거 — ①은 손님 문의가 매일 들어오는 가장 잦은 통증, ②는 놓치면 클레임으로 번짐, ③은 편의 개선.
**진행 방식 = 세 걸음 모두 `/grill-me`로 보완 → `seller-orders-improve-plan.md`에 누적 → 그 후 단계별 `docs/plans/PLAN_*.md`로 분리.**

### B-8.3 걸음 ① 송장번호 — Must 4건 (Further 1차 확정)

- **A-M1.** "택배 발송 완료" 버튼은 송장 입력 폼을 먼저 띄움(현 `handleShipParcel` 직행 교체).
- **A-M2.** 택배사 = 미리 정한 목록(우체국·CJ대한통운·한진·롯데 등) + '기타' 자유 입력.
- **A-M3.** 송장번호 검사 = 목록 택배사는 택배사별 자릿수 규칙, '기타'는 공백만 막음.
- **A-M4.** 택배사·송장번호 둘 다 채워야 `DELIVERED` 처리.

**잘 됐다는 기준** = 택배 주문은 송장 없이 "발송 완료" 불가 + 손님이 주문 상세에서 그 번호를 본다.

**제외(이번 차수 밖)** = 앱 내 배송조회 버튼, 택배사 API 실시간 상태 연동(별도 차수), 분할 발송(다중 송장).

### B-8.4 어드민 측 영향 (이 §B 범위 안)

- **어드민 T1~T4는 셀러 작업과 독립** — 선후 의존 없음(병렬 가능).
- 셀러 ①이 `Order` 타입에 송장 필드(`courierCompany?`·`trackingNumber?` 등) 추가하면 어드민 orders 탭 표시 후보 발생 → **B-8.5 A1**으로 부채 기록.

### B-8.5 신규 어드민 작업 후보 (이번 §B 범위 밖 · 부채 기록)

- **A1. 어드민 주문 목록·상세에 송장번호 표시** — 셀러 ① 완료(`Order`에 송장 필드 보강) 후, 어드민 `OrdersTable.tsx`·주문 상세에 송장 컬럼/행 추가. 운영자가 손님 CS 시 송장 확인 가능. ⚠️ 셀러 ① 데이터모델 안정 후 흡수(과조기 일반화 회피, 세션91 과분할 회피 전례).
- **A2. 어드민에서 송장번호 사후 수정** — 셀러 측 "한 번 저장 후 수정" 정책(Polish 후보)이 정해지면 어드민도 동일 동선 검토. 그때까지 부채.

### B-8.6 우선순위

- 셀러 ①·②·③이 먼저(이미 SDD 누적 시작, Further 1차 종결). A1·A2는 본 §B 종결과 무관한 후속이라 어드민 §B 진행을 지연시키지 않는다.

---

## 참고 문서

### 본 탭이 직접 참조하는 외부 문서
- **연계 작업 SDD (셀러앱 주문 화면 발송·추적 보강)** — [`../seller-orders-improve-plan.md`](../seller-orders-improve-plan.md)
  - B-8 부속 항이 위임하는 세부 계획서. Further 1차 종결, grill-me 대기.
- **육안 검증 (코드 완료 후 §추가)** — [`../pending-visual-verify.md`](../pending-visual-verify.md)
  - 이 문서는 이제 역사 기록이다. T6 확인창 육안은 필요할 때 새 확인 목록으로 만든다.
- **선결 결정·별도 SDD 후보 (이번 범위 제외)**
  - **D1 환불 허용 정책** — ✅ 2026-09-28 결정(B-2).
  - **F3 주문 상세 드릴다운** — 집계·조회 API+라우트 신설. SDD 미작성.
  - **F5 정렬** — 페이지네이션은 #593으로 해소, 정렬만 부채.
  - **C-out 라벨 4앱 통일** — 어드민·셀러·소비자 동시 변경. 별도 과제.

### 상위 인덱스 · 로드맵
- 통합 인덱스: [`../admin-tabs-improve-plan.md`](../admin-tabs-improve-plan.md)
- 멀티앱 리팩토링 로드맵: [`../app-refactor-roadmap.md`](../app-refactor-roadmap.md)

### 인접 어드민 탭
- [stores](./admin-tab-stores-plan.md) · [drivers](./admin-tab-drivers-plan.md) · [settlements](./admin-tab-settlements-plan.md) · [users](./admin-tab-users-plan.md) · [invite](./admin-tab-invite-plan.md) · [banner](./admin-tab-banner-plan.md)

### 선례
- 세션91 SDD 분리 — `83998d0` orders 탭 SDD 분리(309→63), 과분할 회피 전례.
- 세션88 어드민 반응형 — `OrdersTable.tsx` 모바일 카드/데스크톱 테이블 이중 렌더.
- 세션86 정산 status 필터 — C6(로딩·빈결과에서 필터 유지) 가드 패턴.

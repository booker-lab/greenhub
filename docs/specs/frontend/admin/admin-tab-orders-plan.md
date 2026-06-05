# 어드민 주문(orders) 탭 개선 — 아토믹 태스크 (#CL-55 §B)

> **출처:** `admin-tabs-improve-plan.md` §B (세션93 진단) + §B-8 (셀러앱 주문 화면 연계).
> SDD 분리는 세션91에 끝남(`_client`→`page`+`_client`+`_lib`+`_components/`, `83998d0`).
> 본 진단은 그 위의 **타입 안전·SSOT·기능 부재** 정리 + 셀러앱 주문 화면 연계 작업 누적.
> **세션α(T1·T2) 구현 완료.** 다음 진입점은 세션β(T3 취소 경로 전수 조사).

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

## B-0. 진단 대상 파일 (현 상태)
| 파일 | 라인 | 역할 |
|------|------|------|
| `orders/page.tsx` | 8 | dynamic ssr:false 래퍼 |
| `orders/_client.tsx` | 63 | 상태·핸들러(필터 2종·forceRefund) |
| `orders/_lib.ts` | 31 | STATUS_LABEL·getStatusColor·REFUNDABLE·buildStatusOptions |
| `_components/OrdersFilters.tsx` | 39 | 스토어 ID TextInput + 상태 Select |
| `_components/OrdersTable.tsx` | 200 | 모바일 카드 / 데스크톱 테이블 (반응형 세션88) |

→ 모두 500 한도 내. **분할(과분할) 불필요** — 세션91 users/banner 전례.

## B-1. 정합성 진단 — order status SSOT 미사용 (stores T1과 동형)

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

| 레이어 | 환불 허용 조건 | 위치 |
|--------|---------------|------|
| 프론트 (버튼 노출) | `REFUNDABLE = [ACCEPTED, RECRUITING, CONFIRMED, PREPARING]` 4개만 | `_lib.ts:23` |
| 백엔드 (실제 차단) | `status==='CANCELLED'`만 거부, **그 외 전부 허용** | `admin.service.ts:141` |

→ **프론트가 백엔드보다 더 좁게 막음.** DELIVERING·HUB_ARRIVED·DELIVERED 주문은 백엔드론 환불 가능하나 어드민 UI엔 버튼이 안 뜸.

### D1 확정 — **두 단계 정책 (세션92 grill-me)**

| 단계 | 대상 상태 | UI 동선 | 사유 입력 | 백엔드 가드 |
|------|-----------|---------|-----------|------------|
| **일반** | `ACCEPTED·RECRUITING·CONFIRMED·PREPARING` | 일반 버튼 → 단순 확인 모달 | **선택** (placeholder) | 그대로 통과 |
| **위험** | `DELIVERING·HUB_ARRIVED·PICKED_UP·DELIVERED·REVIEWED` | 빨강 경고 배너 + 모달 | **필수** (`minLength:5`) | reason 누락·길이 부족 시 400 |
| **차단** | `CANCELLED` | 버튼 미노출 | — | 이미 취소 — 400 |

- **양쪽 모두 백엔드 검증**(curl 우회 차단).
- **다른 취소 경로**(셀러·소비자 자체 `/orders/.../cancel` 등) 전수 조사 후 동일 가드 적용 (S2에서 다룸).
- **근거**: 회계 위험 차등화(배달 후 환불은 정산 영향), 어드민 우발 클릭 방지, 감사 추적.

## B-3. 기능 부재 (UX)

- **F1. 스토어 필터가 raw ID 텍스트 입력** — `OrdersFilters.tsx:21` UUID를 어드민이 외워 입력해야 함. stores 목록을 받아 **Select(이름→ID)** 로 교체 가능(useAdminStores 재사용). stores §A T6과 대칭.
- **F2. 새로고침 버튼 없음** — forceRefund 후 자동 reload만 있고 수동 reload UI 없음. 환불·상태변경이 외부에서 일어나면 수동 갱신 불가. stores T9와 동일.
- **F3. 주문 상세 드릴다운 없음** — 행 클릭 시 상품·수량·배달지·타임라인 없음. ID 12자·스토어 8자만 노출. (stores T7과 대칭, **백엔드 신설 → 별도 SDD**)
- **F4. native `prompt()` 사용** — `_client.tsx:20` 환불 사유를 `window.prompt`로 받음. Mantine modal로 교체 시 일관성↑(취소/확인 버튼·검증). 단 시각 변화 → 별도 커밋.
- **F5. 정렬·페이지네이션 없음** — 백엔드 `limit(200)` 고정, 프론트 정렬 불가. 200건 초과 시 누락(현 규모 미달이나 기록).

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
- **T2. `admin.forceRefund` 두 단계 가드**
  - `apps/api/src/admin/admin.service.ts:136` `forceRefund` 보강:
    1. `status==='CANCELLED'` → 400 "이미 취소" (현행 유지)
    2. **위험 상태**(`DELIVERING·HUB_ARRIVED·PICKED_UP·DELIVERED·REVIEWED`)이고 `reason` 누락·`length<5` → 400 "배달 후 환불은 사유(5자 이상)가 필수입니다"
    3. 일반 상태는 그대로 통과
  - `ForceRefundDto`에 단계별 검증 메시지 추가(`@MinLength(5)`는 조건부 — 컨트롤러에서 분기 또는 서비스 검증)
  - **의존**: T1 (어드민 라우트는 백엔드 응답을 그대로 받지만 union 정합이 먼저 닫혀야 컴파일 안전)
  - **정합성**: API 단위테스트 추가(상태×사유 매트릭스), 셀러앱 tsc/build 0.

- **T3. 다른 취소 경로 전수 조사·동일 가드 적용**
  - **조사 대상**:
    - `apps/api/src/orders/*` — `/orders/cancel`, `/orders/:id/cancel`, `processCancel` 등 status를 `CANCELLED`로 전이시키는 모든 경로
    - `apps/api/src/payments/*` — 환불 콜백·웹훅 경유 취소
    - shared `Order` 모델의 `CANCELLED` 전이 helper 유무
  - **조사 산출물**: `docs/specs/frontend/admin/admin-tab-orders-cancel-paths.md`(경로·트리거·현 가드 표)
  - **가드 적용**: 위험 상태 + 사유 누락 시 동일 400. 단, 셀러·소비자 자체 취소는 도메인상 배달 전만 허용이 일반적이라 **대부분 가드 자동 충족** 예상.
  - **의존**: T2 (가드 패턴이 T2에서 확립)
  - **정합성**: 조사 결과 보강 경로 N개 = 그만큼 추가 API 단위테스트.

### 그룹 C — UX 기능 추가 (시각 변경·격리)
- **T4. 스토어 Select 필터** (F1)
  - `OrdersFilters.tsx` TextInput → `Select` + `Switch` "치운 스토어 포함"(기본 off)
  - `useAdminStores` 결과 → `{ value: store.id, label: store.name + (status==='archived' ? ' (치운)' : '') }`
  - 토글 off 시 `status==='active'`만, on 시 전체
  - '전체 스토어' 선택지(value 빈 문자열) 유지
  - **의존**: T1
  - **정합성**: 백엔드 무변경(`storeId` 쿼리 그대로), 시각 회귀 단독 격리.

- **T5. 새로고침 + 자동 폴링 토글** (F2)
  - `_client.tsx`에 `useAdminOrders.reload` 노출
  - 헤더 우측에 `ActionIcon`(수동) + `Switch` "자동 새로고침(30초)"
  - 토글 on 시 `setInterval(reload, 30_000)`, off/언마운트 시 `clearInterval` (cleanup 필수)
  - 토글 상태는 `useState` (세션 간 유지 불필요)
  - **의존**: T1
  - **정합성**: Firestore 읽기 비용 옵트인. 시각 변경 적음.

### 그룹 D — 환불 모달 (시각·동선 변경·단독)
- **T6. `prompt` → Mantine modal + 두 단계 분기** (F4)
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
- **T7. 어드민 orders e2e 스펙**
  - 위치: `tests/e2e/admin/orders.spec.ts`(세션90 어드민 e2e 인프라 재사용)
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
- ✅ **D1**: 두 단계 정책 — B-2 표 참조 (세션92 grill-me).

### 제외 (별도 SDD / 범위 밖)
- **F3 주문 상세 드릴다운** — 집계·조회 API + 라우트 신설 (stores T7과 동일 사유).
- **F5 정렬·페이지네이션** — 백엔드 쿼리·커서 변경 (현 규모 미달, 부채 기록만).
- **C-out 라벨 4앱 통일** — 주문 라벨 표현 SSOT는 어드민 단독 범위 밖(셀러·소비자 동시 변경).

## B-5. 커밋·세션 분할 (4세션 — 세션92 확정)

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
2026-05-29 조사 결과: `admin-tab-orders-cancel-paths.md` 기준 **가드 보강 경로 0개**. 커밋 4는 생략 가능.

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
  - [x] T1: shared `OrderStatus` import 1곳(`_lib.ts`), `satisfies` 컴파일 검증 통과
  - [x] T2: API 단위테스트 — 상태 11종 × (reason 있음·없음·짧음) 매트릭스 ≥ 18 케이스
  - [x] T2: curl 우회 시뮬레이션 — `DELIVERING` + reason 누락 → 400 응답
- **세션β 추가**:
  - [x] T3: 조사 문서에 경로 표(트리거·현 가드·필요 가드) + git grep 명령 기록
  - [x] T3: 가드 보강 경로 0개 확인으로 단위테스트 추가 없음
- **세션γ 추가**:
  - [x] T4: `useAdminStores` reload 호출은 최초 1회만(렌더 루프 없음)
  - [x] T4: 치운 스토어 토글 off → 라벨 `(치운)` 미노출
  - [x] T5: 토글 off + 언마운트 → `clearInterval` 호출(메모리 누수 없음)
  - [x] T5: 폴링 중 사용자 액션(필터 변경) → 즉시 재호출 + 폴링 유지
- **세션δ 추가**:
  - [x] T6: 위험 단계 모달에 빨강 경고 배너 노출, 사유 5자 미만 confirm disabled
  - [x] T6: 일반 단계 모달은 경고 없음, 사유 빈 채 confirm 가능
  - [x] T6: 모달 ESC·외부 클릭으로 닫기 → 환불 미실행(processingId 정리)
  - [x] T7 e2e: 8스펙 작성·실행 완료(2프로젝트 16건), 로컬 seller fixture 환경에서 16/16 통과

## B-7. 차기 진입점 (세션 종료 시 다음 세션 안내)

- **세션α 후**: T1 union·T2 백엔드 가드 구현 완료. UI 변화는 의도하지 않았으나 운영 반영 후 회귀 확인 항목을 `pending-visual-verify.md` §10에 등록. **다음 = 세션β(취소 경로 조사).**
- **세션β 후**: 조사 문서 머지. 가드 동기화 대상 0개라 구현 커밋은 생략. **다음 = 세션γ(필터·새로고침 UX).**
- **세션γ 후**: `pending-visual-verify.md`에 스토어 Select·자동 폴링 항목 추가 완료(2026-05-29). 운영 1차 육안. **다음 = 세션δ(환불 모달 + e2e).**
- **세션δ 완료**: T6 환불 모달 구현 및 `pending-visual-verify.md` 환불 모달 두 동선 추가 완료(2026-05-29). T7 `admin-orders.spec.ts` 8스펙은 로컬 seller fixture 환경에서 chromium·mobile 16/16 통과.
- **세션δ 후**: e2e 8/8 푸시. **#CL-55 §B 코드 종결.** A1·A2(셀러 송장 흡수 부채), F3·F5(별도 SDD) 남음.

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

### B-8.7 A1 진행 — 어드민 주문 목록 송장 표시 (2026-05-29)

- **결정**: 셀러 ①에서 `Order`의 `courierCompany`·`trackingNumber`가 안정화됐으므로, 어드민 주문 목록에 읽기 전용 `송장` 컬럼/행을 추가한다.
- **표시 범위**: 데스크톱 테이블은 `상태`와 `금액` 사이에 `송장` 컬럼을 둔다. 모바일 카드는 스토어 ID 아래에 `송장` 행을 둔다.
- **빈 값**: 기존 주문·직접배송·거점배송처럼 송장 정보가 없으면 `-`로 표시한다.
- **제외**: 어드민 상세 라우트 신설, 송장 사후 수정, 배송조회 링크는 이번 차수에서 제외한다.
- **검증**: e2e fixture에 송장 보유 주문을 추가해 데스크톱 노출을 자동 확인했다. `SELLER_BASE=http://localhost:3011 pnpm --filter e2e test -- admin-orders.spec.ts` 18/18 통과. 모바일 배치와 빈 값 표시는 `pending-visual-verify.md`에 등록한다.

### B-8.8 셀러 ③ 진행 — 일괄 택배 발송 1차 (2026-05-29)

- **결정**: `seller-orders-improve-plan.md` §C 2차에서 `PREPARING`·택배 주문만 여러 건 선택하고, 주문별 택배사·운송장번호를 입력해 기존 단건 상태 변경 API를 반복 호출하는 흐름으로 확정했다.
- **어드민 영향**: 주문 타입의 송장 필드는 이미 A1에서 어드민 목록 표시까지 반영됐으므로 추가 API 계약 변경은 없다.
- **육안검증**: `pending-visual-verify.md` §18 #168~#174에 운영/프리뷰 확인 항목을 등록했다.
- **검증**: seller tsc, 주문 순수함수 테스트 6/6, 변경 파일 Biome, seller build 통과. 로컬 브라우저는 `/orders` 진입 시 `/login` 리다이렉트까지 확인했고 인증 후 실데이터 화면은 육안검증에 남긴다.

### B-8.6 우선순위

- 셀러 ①·②·③이 먼저(이미 SDD 누적 시작, Further 1차 종결). A1·A2는 본 §B 종결과 무관한 후속이라 어드민 §B 진행을 지연시키지 않는다.

---

## B-9. F3 1차 진행 — 어드민 주문 상세 읽기 전용 모달 (2026-05-29)

> F3 원안은 집계·조회 API와 상세 라우트 신설까지 포함하는 큰 작업이다. 이번 차수는 과분할과 API 확장을 피하고, 현재 `/admin/orders` 목록 응답에 이미 포함된 주문 필드만 읽기 전용으로 펼쳐 보여주는 1차 드릴다운으로 한정한다.

### 결정

- **범위**: `/admin/orders` 데스크톱 테이블과 모바일 카드에 `상세 보기` 액션을 추가하고, Mantine 모달에서 주문번호·상태·상품명·수량·판매방식·금액·구매자·연락처·배송방식·배송지·희망배송일·준비예정·송장·취소사유·스토어ID·사용자ID·생성일·수정일을 표시한다.
- **데이터 계약**: 새 API를 만들지 않는다. `AdminOrder` 타입만 shared `Order`에 이미 있는 denormalized 필드를 수용하도록 넓히고, 값이 없는 필드는 `-`로 표시한다.
- **제외**: 상품 라인별 상세, 결제 타임라인, 상태 변경 이력, 별도 상세 라우트, 주문 상세 조회 API, 송장 사후 수정은 이번 차수에서 제외한다.
- **이유**: 운영자가 CS 중 목록의 12자 ID·스토어 8자만으로 판단해야 하는 결함을 먼저 줄이되, 백엔드 조회 계약과 페이지네이션 설계를 동시에 흔들지 않기 위함이다.

### 정합성 체크

- [x] SDD 선반영: 본 섹션에 F3 1차 범위·제외·검증 경계를 기록했다.
- [x] UI 격리: `OrderDetailModal`을 별도 컴포넌트로 분리해 `OrdersTable`은 액션 호출만 담당한다.
- [x] 육안검증 등록: `pending-visual-verify.md` §19 #175~#181에 데스크톱·모바일 확인 항목을 추가했다.

---

## B-10. F5 1차 진행 — 어드민 주문 정렬·커서 페이지네이션 (2026-05-29)

> F5 원안은 정렬·페이지네이션 부재와 `limit(200)` 고정 누락 위험을 해소하는 작업이다. 이번 차수는 백엔드 색인 부담과 UI 변동을 줄이기 위해 `createdAt` 기준 정렬 방향과 커서 기반 `더 보기`만 추가한다.

### 결정

- **범위**: `/admin/orders`에 `sort=createdAt_desc|createdAt_asc`, `limit`, `cursor` 쿼리를 추가하고, 프론트에는 `최신순/오래된순` Select와 `더 보기` 버튼을 둔다.
- **커서**: 응답의 `nextCursor`는 마지막 주문의 `createdAt` ISO 문자열이다. 다음 요청은 같은 필터·정렬·limit과 함께 `cursor`를 전달한다.
- **초기 limit**: 기본 50건, 선택지는 25·50·100건으로 제한한다. 기존 200건 고정 조회보다 첫 로딩 비용을 낮추되, `더 보기`로 누락 없이 이어 본다.
- **필터 연동**: 스토어·상태·정렬·limit 변경 시 목록을 첫 페이지부터 다시 조회한다. 수동·자동 새로고침은 현재 필터 조건의 첫 페이지를 다시 로드한다.
- **제외**: 총 건수 정확 계산, 이전 페이지 이동, 임의 페이지 번호, `createdAt` 외 컬럼 정렬은 이번 차수에서 제외한다.
- **이유**: Firestore 전체 카운트와 offset 페이지는 비용·일관성 리스크가 크다. 운영자가 최신 주문을 우선 확인하고 필요 시 연속 탐색하는 현재 업무에는 cursor `더 보기`가 작고 안정적이다.

### 정합성 체크

- [x] SDD 선반영: 본 섹션에 F5 1차 범위·커서 계약·제외 범위를 기록했다.
- [x] API 검증: DTO가 `sort`·`limit`·`cursor`를 검증하고 `getOrders`가 `nextCursor`를 반환한다.
- [x] UI 검증: 정렬·페이지 크기 Select와 `더 보기` 버튼이 필터·자동 새로고침과 함께 동작한다.
- [x] 육안검증 등록: `pending-visual-verify.md` §20 #182~#188에 데스크톱·모바일 확인 항목을 추가한다.

## B-11. F3-FULL 진행 — 어드민 주문 정식 상세 (2026-06-03)

> 별도 SDD: [`admin-orders-detail-full-plan.md`](./admin-orders-detail-full-plan.md), 결정 로그: `#CL-93`.

### 결정

- **범위**: `GET /admin/orders/:orderId`와 `/admin/orders/[id]` 읽기 전용 상세를 추가한다.
- **응답 구조**: `order`, `store`, `buyer`, `payment`, `items`, `timeline`으로 나눈다.
- **상품 라인**: 현재 주문 스키마가 단일 상품 주문이므로 `productId/productName/quantity/totalAmount` 기반 단일 라인으로 표시한다.
- **상태 타임라인**: 별도 이력 저장소를 추정하지 않고 `createdAt`, `preparedAt`, `updatedAt`, `cancelReason`, `status`처럼 주문 문서에 있는 관측 가능한 값만 표시한다.
- **기존 모달**: 목록 응답 기반 모달은 유지하고, 모달에서 정식 상세 화면으로 이동할 수 있게 한다.

### 제외

- 송장번호 사후 수정
- 상태 변경 이력 컬렉션 신설
- 결제 환불 재처리 또는 상태 변경 쓰기
- 다중 상품 라인 스키마 변경
- 고급 페이지네이션

### 정합성 체크

- [x] SDD 선반영: 별도 SDD와 `#CL-93` 기록 후 구현했다.
- [x] API 검증: 상세 응답 조립과 404 단위 테스트를 추가했다.
- [x] 500라인 한도: `admin.service.ts`가 500라인에 가까워 주문 목록·상세 조회를 `admin-orders.helpers.ts`로 분리했다.
- [x] 검증: API 상세/기존 단위 테스트 50/50, API·seller 타입체크, API·seller 빌드, 변경 파일 Biome, `git diff --check`를 통과했다.

## 참고 문서

### 본 탭이 직접 참조하는 외부 문서
- **연계 작업 SDD (셀러앱 주문 화면 발송·추적 보강)** — [`../seller-orders-improve-plan.md`](../seller-orders-improve-plan.md)
  - B-8 부속 항이 위임하는 세부 계획서. Further 1차 종결, grill-me 대기.
- **육안 검증 (코드 완료 후 §추가)** — [`../pending-visual-verify.md`](../pending-visual-verify.md)
  - T4(prompt → Mantine modal) 시각 회귀 별도 육안.
- **향후 작업 과제** — [`../../../BACKLOG.md`](../../../BACKLOG.md)
  - `ADMIN-ORDERS-A2`, `ADMIN-ORDERS-F3-FULL`, `ADMIN-ORDERS-F5-ADV`, `ORDER-STATUS-LABEL-SSOT`로 승격 기록.
- **선결 결정·별도 SDD 후보 (이번 범위 제외)**
  - **D1 환불 허용 정책** — 프론트/백엔드 불일치 SSOT 일원화 결정. grill-me 대기.
  - **F3 주문 상세 드릴다운** — 집계·조회 API+라우트 신설. SDD 미작성.
  - **F5 정렬·페이지네이션** — B-10에서 1차 커서 `더 보기`로 진행.
  - **C-out 라벨 4앱 통일** — 어드민·셀러·소비자 동시 변경. 별도 과제.

## B-12. F5-ADV 진행 — 어드민 주문 고급 페이지네이션 (2026-06-03)

> 상세 SDD: `admin-orders-advanced-pagination-plan.md`

### 결정

- `GET /admin/orders`는 `page`가 지정되면 `count()`와 `offset` 기반으로 `total`, `page`, `pageSize`, `totalPages`, `hasPrevious`, `hasNext`를 반환한다.
- 기존 `cursor`/`nextCursor` 계약은 호환용으로 유지한다. `page`와 `cursor`가 동시에 오면 `page`가 우선한다.
- 프론트는 `더 보기` 대신 페이지 번호 UI를 사용하고, 스토어·상태·정렬·페이지 크기 변경 시 1페이지로 복귀한다.
- `createdAt` 외 컬럼 정렬은 제외한다. 깊은 `offset` 탐색 비용이 문제가 되면 별도 서버 검색 SDD로 승격한다.

### 정합성 체크

- [x] SDD 선반영: `admin-orders-advanced-pagination-plan.md`, `CRITICAL_LOGIC.md` `#CL-94`.
- [x] API 계약: `QueryAdminOrdersDto.page`, `getOrdersPage()` page 메타 반환.
- [x] UI 계약: `/admin/orders` 총 건수·페이지 번호 표시, 필터 변경 시 1페이지 복귀.
- [x] 검증: API 단위, 전용 E2E fixture, 변경 파일 Biome, 타입체크·빌드.

## B-13. C-out 진행 — 주문 상태 라벨 SSOT 통합 (2026-06-03)

> 결정 로그: `#CL-95`.

### 결정

- `@greenhub/shared`에 `ORDER_STATUSES`, `ORDER_STATUS_LABEL`, `ORDER_STATUS_COLOR`를 둔다.
- 라벨은 `docs/specs/api/orders.md` FSM 표의 사용자 문구를 기준으로 한다.
- 어드민 주문 목록·상세·모달, 셀러 주문 목록·상세, 소비자 마이페이지 목록·상세, 주문 성공 화면은 모두 `ORDER_STATUS_LABEL`을 사용한다.
- 기존 정산 `STATUS_LABEL` export와 충돌하지 않도록 주문 상수는 `ORDER_` 접두사를 쓴다.

### 제외

- 주문 상태 FSM 전이 정책 변경
- 환불 허용 정책 변경
- 소비자 화면의 CSS 토큰 기반 색상 구조 통합

### 정합성 체크

- [x] SDD 선반영: 본 섹션과 `#CL-95`에 라벨 SSOT 계약을 기록했다.
- [x] 공유 계약: shared 주문 상태 전체에 라벨·색이 존재하는 단위 테스트를 추가했다.
- [x] UI 연결: 어드민·셀러·소비자 라벨 맵을 shared 참조로 전환했다.
- [x] 회귀 가드: 기존 어드민 E2E 기대 라벨을 새 SSOT 문구로 갱신했다.

## B-14. A2 진행 — 어드민 송장번호 사후 정정 (2026-06-03)

> 상세 SDD: `admin-orders-tracking-edit-plan.md`, 결정 로그: `#CL-96`.

### 결정

- `/admin/orders/[id]` 정식 상세에 송장 정정 액션을 추가한다.
- 정정은 택배 주문에만 허용한다.
- 아직 송장이 없는 `PREPARING` 주문은 어드민에서 발송 처리하지 않고 기존 셀러 발송 플로우로 남긴다.
- API는 `PATCH /admin/orders/:orderId/tracking` 으로 두고, `trackingUpdatedAt`, `trackingUpdatedBy`, `updatedAt`을 함께 기록한다.

### 제외

- 발송 상태 전환
- 분할 발송과 다중 송장
- 택배사별 자릿수 검증
- 배송조회 링크와 택배사 API 연동

### 정합성 체크

- [x] SDD 선반영: `admin-orders-tracking-edit-plan.md`, `#CL-96`.
- [x] API 검증: 정상 정정, 비택배 차단, 미발송 무송장 주문 차단, 운송장번호 길이 검증.
- [x] UI 검증: 정식 상세에서 정정 후 새 송장 표시.
- [x] 변경 파일 500라인 이하, 타입체크·빌드·Biome.

### 상위 인덱스 · 로드맵
- 통합 인덱스: [`../admin-tabs-improve-plan.md`](../admin-tabs-improve-plan.md)
- 멀티앱 리팩토링 로드맵: [`../app-refactor-roadmap.md`](../app-refactor-roadmap.md)

### 인접 어드민 탭
- [stores](./admin-tab-stores-plan.md) · [drivers](./admin-tab-drivers-plan.md) · [settlements](./admin-tab-settlements-plan.md) · [users](./admin-tab-users-plan.md) · [invite](./admin-tab-invite-plan.md) · [banner](./admin-tab-banner-plan.md)

### 선례
- 세션91 SDD 분리 — `83998d0` orders 탭 SDD 분리(309→63), 과분할 회피 전례.
- 세션88 어드민 반응형 — `OrdersTable.tsx` 모바일 카드/데스크톱 테이블 이중 렌더.
- 세션86 정산 status 필터 — C6(로딩·빈결과에서 필터 유지) 가드 패턴.

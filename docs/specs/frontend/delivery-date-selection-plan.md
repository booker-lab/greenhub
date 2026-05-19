# 배송일 선택 기능 + 셀러 주문 IA 재구성 — 아토믹 태스크 플랜

> 작성: 2026-05-19 (세션46)
> 근거: 세션45 후 실서비스 검증에서 발견된 데이터 공백 + 사용자 논의
> 원칙: **선(先) 설계 후(後) 구현** — 본 문서 확정 후 세션별 순차 구현. 한 태스크 = 한 커밋.
> 진행: 각 태스크 끝에 타입체크 통과 후 다음. 설계 변경 시 `docs/CRITICAL_LOGIC.md` #CL 등재.

---

## 배경

세션40~45 셀러 주문 탭 리팩토링은 `requestedDeliveryDate`(배송 예정일) 기반
날짜 필터(T5)·날짜 그룹 헤더(T6)를 구현했다. 그러나 세션46 실서비스 검증에서
**주문이 전부 "날짜 미정" 그룹으로 떨어지는** 현상이 발견됐다.

### 진단 결과 (세션46)

Firestore 실데이터 진단(`scripts/diag-order-dates.mjs`):

| 항목 | 결과 |
|------|------|
| 일반 주문 `requestedDeliveryDate` | **23건 전부 `null`** |
| 공동구매 주문 `requestedDeliveryDate` | 6건 전부 `null` |
| 공동구매 `groupProductConfig.groupDeliveryDate` | **전부 채워져 있음** ✅ |

근본 원인 — **소비자 앱에 일반 상품 배송일 선택 기능이 처음부터 없었다.**

1. 소비자 체크아웃(`checkout/page.tsx`)·상품 상세(`ProductActions.tsx`)에
   배송일 선택 UI가 없고, `CreateOrderRequest`에 `requestedDeliveryDate`를
   포함하지 않는다.
2. API(`orders-create.service.ts`)는 `dto.requestedDeliveryDate ?? null` →
   항상 `null` 저장. `dailyCaps` 검증도 `capId`를 **주문 당일**로 고정
   (`new Date()...split('T')[0]`) — 미래 날짜 선택 불가.
3. 따라서 셀러 주문 탭 T5·T6는 채워질 수 없는 필드를 전제로 설계됐다.

> 부수 수정 (세션46, 커밋 `5a2b993`): `useOrders`가 Firestore Timestamp를
> 변환 없이 내보내 `localeCompare` 크래시 발생 → ISO 문자열 정규화로 해결.
> 본 플랜과 독립된 별건이며 이미 배포 완료.

### 일반 vs 공동구매 — 배송일 구조의 본질적 차이

| | 일반 상품 (`saleType: normal`) | 공동구매 상품 (`saleType: group`) |
|---|---|---|
| 배송일 출처 | `order.requestedDeliveryDate` | `groupProductConfig.groupDeliveryDate` |
| 정하는 주체 | **소비자** (주문 시 선택) | **셀러** (상품 등록 시 지정) |
| 단위 | 주문 1건마다 | 공구(productId) 1개 — 모든 참여 주문 공유 |
| 입력 UI 현황 | ❌ 없음 — 신규 구축 대상 | ✅ 완성 (`GroupConfigSection`) |

### 이미 완성된 인프라 (재사용)

- **셀러 배송 슬롯 캘린더** (`settings/daily-caps/page.tsx`) — 셀러가 미래
  날짜별 `totalCap`을 설정. 과거만 disabled, 오늘·미래 편집 가능. 데이터는
  `GET/PATCH /stores/{id}/daily-caps?from=&to=`. **소비자 배송일 picker는
  이 API를 그대로 호출**해 `totalCap > usedSlots`인 날짜만 선택 가능하게 한다.
- **공동구매 배송일 등록** (`GroupConfigSection.tsx`) — 셀러 상품 등록 시
  `groupDeliveryDate` `<input type="date">` 이미 존재. **추가 작업 없음.**

---

## 설계 결정

### D1. 일반 상품 배송일 — 소비자가 슬롯 열린 날짜에서 선택

상품 상세 페이지(`ProductActions.tsx`)에 배송일 선택 UI를 신설한다.
사용자 결정: **선택 시점 = 상품 상세** (체크아웃 아님 — `useDailyCap`이 이미
`ProductActions`에 연결돼 있어 자연스러움).

- 셀러 슬롯 캘린더의 거울상 — `GET /stores/{id}/daily-caps?from=&to=`로
  월 범위 슬롯 조회, **`totalCap - usedSlots > 0`인 날짜만 선택 가능**.
- 과거 날짜·슬롯 미설정 날짜·마감(잔여 0) 날짜는 disabled.
- 선택값을 `handleBuyNow`의 `URLSearchParams`와 `handleAddToCart`의
  `addItem` 양쪽에 `requestedDeliveryDate`로 전달.
- 공동구매(`saleType: group`)일 때는 이 UI 미노출 — 배송일이 이미
  `groupConfig.groupDeliveryDate`로 고정(현재 카드에 표시 중).

### D2. 공동구매 배송일 — 현행 유지

`groupProductConfig.groupDeliveryDate`(셀러가 등록 시 지정) 구조를 그대로 둔다.
소비자는 공구 배송일을 고르지 않는다 — 공구의 본질(한날 일괄 배송).
셀러 주문 탭이 공구 주문의 배송일을 읽으려면 `groupProductConfig`를
productId별로 fetch·조인해야 한다(D4 참조).

### D3. API — 선택 배송일 기준 슬롯 검증

`orders-create.service.ts`의 `capId` 산출을 **주문 당일 고정 → 선택
배송일 기준**으로 변경한다.

- `CreateOrderDto`에 `requestedDeliveryDate`(`YYYY-MM-DD`) — 이미 옵셔널
  필드로 존재(`create-order.dto.ts:55`). 일반 주문에서 **필수화**.
- `capId = ${storeId}_${dto.requestedDeliveryDate}` (일반 주문).
- 공동구매·택배(`parcel`)는 기존대로 슬롯 미검증 — 분기 유지.
- 슬롯 미설정/마감 시 기존 `ConflictException` 메시지 재사용.
- **로직 변경 주의**: 슬롯 차감 날짜가 바뀌므로 `dailyCaps` 트랜잭션
  영향. 기존 "당일 슬롯" 가정 코드 전수 점검.

### D4. 셀러 주문 탭 — 일반/공구 대칭 토글 IA

세션40~45가 만든 상태 탭(처리필요·대기·배송·완료·취소) **위에**
일반/공구 구분 토글을 신설한다. 사용자 결정: **대칭형** — 두 판매 유형의
주력 비중이 미정이므로 어느 쪽도 보조로 밀지 않는다.

```
┌─────────────────────────────────┐
│ 주문 관리              [🏠]      │  PageHeader
├─────────────────────────────────┤
│  [ 일반 주문 ] [ 공동구매 ]       │  ← D4 신규: saleType 토글
├─────────────────────────────────┤
│  [오늘][이번 주][이번 달][직접]   │  ← T5 날짜 필터 (일반 탭에서만)
├─────────────────────────────────┤
│  처리 필요 · 대기 중 · 배송 중 …  │  ← 기존 상태 탭
└─────────────────────────────────┘
```

- 토글로 `filteredOrders`를 `saleType`으로 1차 분기.
- **일반 주문 토글**: 날짜 필터·그룹 기준 = `order.requestedDeliveryDate`
  (D1로 채워짐). T5·T6 기존 로직 그대로 의미를 가짐.
- **공동구매 토글**: 날짜 기준 = `groupProductConfig.groupDeliveryDate`.
  `page.tsx`가 공구 주문의 productId 집합에 대해 `groupProductConfig`를
  fetch·조인. 날짜 필터 UI는 공구 맥락에 맞게 조정(또는 1차 미노출).
- BottomNav는 5탭(주문·상품·정산·준비·설정) 그대로 — IA #CL-33 불변.

> **정합성 주의**: `getOrderDate(order, tab)`는 현재 활성/아카이브 탭만
> 분기. saleType 분기가 추가되면 시그니처가 `getOrderDate(order, tab,
> groupConfigMap)` 형태로 확장된다. T6 `groupOrdersByDate`도 동반 수정.

---

## 데이터 소스

| 기능 | 데이터 | 호출 |
|------|--------|------|
| 소비자 배송일 picker | `GET /stores/{id}/daily-caps?from=&to=` | 기존 API 재사용 |
| API 슬롯 검증 | `dailyCaps/{storeId}_{날짜}` 트랜잭션 | 기존 (capId만 변경) |
| 셀러 주문 — 일반 배송일 | `order.requestedDeliveryDate` | 기존 (D1로 채워짐) |
| 셀러 주문 — 공구 배송일 | `groupProductConfig.groupDeliveryDate` | 신규 조인 fetch |

백엔드 신규 엔드포인트 없음 — 기존 `daily-caps` API 재사용 + `orders-create`
내부 로직 변경.

---

## 아토믹 태스크 목록

태스크는 **소비자 → API → 셀러** 순서로 의존. 앞 태스크가 데이터를
채워야 뒤 태스크가 검증 가능하므로 순서 고정.

### [ ] T1 — 소비자 배송일 선택 UI (상품 상세)

**변경 파일:** `consumer/.../ProductActions.tsx`, `hooks/useDailyCap.ts`(확장),
신규 `_components/DeliveryDatePicker.tsx`

- `useDailyCap`을 단일 날짜 → **월 범위 조회**로 확장 (또는 신규 훅
  `useDeliverySlots(storeId, year, month)`). `daily-caps?from=&to=` 사용.
- `DeliveryDatePicker` 신규 — 셀러 `daily-caps` 캘린더의 소비자용 거울상.
  `totalCap - usedSlots > 0`인 날짜만 활성, 과거·미설정·마감 disabled.
- `ProductActions`에 picker 배치 — `saleType: normal`일 때만 노출.
- 미선택 시 `canBuy = false` (일반 주문 한정).

**정합성 확인:**
- [ ] 공동구매 상품에서는 picker 미노출 (배송일은 `groupConfig` 고정)
- [ ] 슬롯 0인 날짜·과거 날짜 선택 불가
- [ ] 기존 "오늘 잔여 배송 가능 N건" 표시(218줄)와 충돌·중복 없음
- [ ] 타입체크 통과

### [ ] T2 — 배송일을 체크아웃·장바구니로 전달

**변경 파일:** `ProductActions.tsx`, `checkout/page.tsx`,
`hooks/useCart.ts`, `cart` 관련 컴포넌트

- `handleBuyNow` — `URLSearchParams`에 `requestedDeliveryDate` 추가.
- `handleAddToCart` — `addItem`에 `requestedDeliveryDate` 추가
  (`useCart` 아이템 타입 확장).
- `checkout/page.tsx` — URL 파라미터에서 `requestedDeliveryDate`를 읽어
  `orderRequest`(`CreateOrderRequest`)에 포함.
- 장바구니 경유 시 아이템별 배송일 유지·표시.

**정합성 확인:**
- [ ] 바로구매·장바구니 경유 모두 배송일이 `orderRequest`까지 도달
- [ ] 장바구니에 여러 상품 시 각 아이템 배송일 독립 유지
- [ ] `CreateOrderRequest` 타입과 일치 (`requestedDeliveryDate?: string`)
- [ ] 타입체크 통과

### [ ] T3 — API 슬롯 검증을 선택 배송일 기준으로

**변경 파일:** `api/.../orders-create.service.ts`,
`api/.../dto/create-order.dto.ts`

- `CreateOrderDto.requestedDeliveryDate` — 일반 주문 시 필수 검증
  (`@ValidateIf(saleType === 'normal')` 등).
- `capId` 산출: `${storeId}_${dateStr}` → `${storeId}_${dto.requestedDeliveryDate}`
  (일반 주문). 공동구매·`parcel`은 기존 분기 유지.
- `requestedDeliveryDate` 저장값을 `dto` 값으로 (`?? null` 제거 — 일반은 필수).
- 기존 "당일 슬롯" 가정 코드 전수 점검 (`dateStr` 사용처).

**정합성 확인:**
- [ ] 일반 주문 — 선택 배송일의 `dailyCaps` 문서로 슬롯 검증·차감
- [ ] 공동구매·택배 주문 — 슬롯 미검증 분기 유지 (회귀 없음)
- [ ] 슬롯 미설정/마감 날짜 주문 시 `ConflictException`
- [ ] 배송일 누락된 일반 주문 요청 거부 (400)
- [ ] API 타입체크·기존 테스트 통과

### [ ] T4 — 셀러 주문 탭 일반/공구 대칭 토글

**변경 파일:** `seller/.../orders/page.tsx`, `orders/_constants.ts`,
신규 `orders/_components/SaleTypeToggle.tsx`

- `saleType` 상태(`'normal' | 'group'`, 기본 `'normal'`) + `SaleTypeToggle`
  컴포넌트 — PageHeader 아래, 날짜 필터 칩 위.
- `filteredOrders`에 `saleType` 1차 분기 추가.
- 날짜 필터 칩(T5)은 일반 토글에서만 노출 (공구는 T5 도입).
- 상태 탭·날짜 그룹은 토글 하위에서 기존대로 동작.

**정합성 확인:**
- [ ] 토글 전환 시 `filteredOrders` 즉시 갱신
- [ ] 일반 토글 — 기존 T5·T6 동작 회귀 없음
- [ ] 탭/날짜 필터 상태가 토글 전환 시 합리적으로 유지·초기화
- [ ] 타입체크·biome 신규 에러 0건

### [ ] T5 — 공동구매 배송일 조인 (셀러 주문 탭)

**변경 파일:** `seller/.../orders/page.tsx`, `orders/_constants.ts`,
`hooks/useOrders.ts` 또는 신규 조인 훅

- 공구 토글 활성 시 — 표시 중인 공구 주문들의 `productId` 집합에 대해
  `groupProductConfig` 문서 fetch (productId별 `groupDeliveryDate`).
- `getOrderDate(order, tab, groupConfigMap)` — 시그니처 확장:
  `saleType: group`이면 `groupConfigMap[productId].groupDeliveryDate` 사용.
- `groupOrdersByDate`도 동반 수정 — 공구 주문이 실제 배송일로 그룹핑.
- 공구 토글의 날짜 필터 UI 적용 여부 결정 (1차 미노출 가능).

**정합성 확인:**
- [ ] 공구 주문이 `groupDeliveryDate` 기준 날짜 그룹으로 묶임
- [ ] `groupProductConfig` 미존재 productId는 "날짜 미정"으로 안전 처리
- [ ] fetch 횟수 과다 없음 (productId 중복 제거 후 조회)
- [ ] 일반 토글 동작에 영향 없음 (`getOrderDate` 분기 격리)
- [ ] 타입체크 통과

### [ ] T6 — 타입체크 + e2e + 정합성 최종 검토

**실행:**
```bash
pnpm --filter consumer tsc --noEmit
pnpm --filter api tsc --noEmit
pnpm --filter seller tsc --noEmit
pnpm --filter e2e exec playwright test --project=chromium
```

**코드 정합성 체크리스트:**
- [ ] `requestedDeliveryDate` — 일반 주문 신규 생성 시 항상 채워짐
      (Firestore 신규 문서 진단으로 확인)
- [ ] `capId` 산출에 `new Date()` 당일 고정 잔재 없음
- [ ] `getOrderDate` saleType 분기가 일반/공구 모두 정확
- [ ] e2e — 주문 생성 플로우에 배송일 선택 단계 반영
      (기존 spec 회귀 + 신규 단계 추가)

**e2e 영향 예측:**
- 소비자 주문 생성 spec — 배송일 선택 단계 추가로 셀렉터 보강 필요.
- 셀러 주문 탭 spec — saleType 토글 신설로 셀렉터 영향 가능.
- 베이스라인: 169 passed (세션45 기준). 신규 단계분 가감 후 재산정.

---

## 세션 분배 계획

| 세션 | 태스크 | 규모 | 비고 |
|------|--------|------|------|
| **세션47 (검토)** | 본 플랜 정합성 검토 | 소 | 구현 전 플랜↔코드 검토. 코드 변경 없음 |
| **세션48 (A)** | T1 + T2 | 중 | 소비자 배송일 선택 UI + 전달. 소비자 앱 한정 |
| **세션49 (B)** | T3 | 중 | API 슬롯 검증 변경. 백엔드 한정 — 회귀 리스크 |
| **세션50 (C)** | T4 + T5 | 대 | 셀러 주문 IA 토글 + 공구 조인. 규모 크면 분리 |
| **세션51 (D)** | T6 | 소 | 타입체크 3종 + e2e + 정합성 검토 |

> T3(API)는 슬롯 차감 로직 변경이라 회귀 리스크가 가장 크다 — 단독 세션.
> 세션50은 규모가 크면 T4 단독 / T5 단독으로 분리.
> 세션47 검토는 **구현 전** 플랜 점검, 세션51(T6)은 **구현 후** 결과 검증.

---

## 진행 규칙

1. T1~T5는 순차 진행 — 각 태스크 = 한 커밋, 끝에 해당 앱 타입체크 통과.
2. 태스크 간 의존: T2는 T1, T3는 T2, T5는 T4에 의존 — 순서 고정.
3. 하드코딩 색·폰트 크기는 작업 중 만나는 범위에서 토큰(`var(--*)`)으로 교체.
4. 설계 변경 시 `docs/CRITICAL_LOGIC.md`에 #CL 기록 — 특히 D3 슬롯 검증
   변경, D4 주문 탭 IA는 정본 기록 권장.
5. 각 태스크의 **정합성 확인 체크리스트**를 커밋 전 수동 점검.
6. 검증은 `docs/specs/frontend/seller-refactor-visual-verify.md`에 섹션
   추가 — 본 기능 완료 시 육안 검증 항목 등재.

---

## 미해결 — 착수 전 확정 필요 항목

세션47 검토 또는 각 태스크 착수 시 확정:

- **T1**: 배송일 선택 가능 범위 상한 — 며칠 앞까지? (셀러가 슬롯을 연
  날짜까지만 자동 제한되나, 캘린더 월 이동 범위 정책 필요)
- **T3**: 기존 `null` 배송일 주문(레거시 23건) 처리 — 마이그레이션 불필요
  (셀러 주문 탭에서 "날짜 미정"으로 안전 처리). 단 명시 확인.
- **T5**: 공구 토글의 날짜 필터(T5 칩) 노출 여부 — 공구는 배송일이
  공구 단위라 필터 효용이 낮을 수 있음. 1차 미노출 후보.
- **e2e**: 테스트 시드 데이터에 미래 `dailyCaps` 슬롯 추가 필요
  (배송일 선택 단계 테스트용).

# 셀러 주문 화면 — 손님 정보·검색·전화 한 묶음 아토믹 플랜

> 작성: 2026-05-26 (세션92) · 출처: `/further` 세션(셀러앱 "손님 관련 화면" 발전 가능성 진단)
> 성격: **독립 세션 1~2건**으로 완결 가능한 소~중 규모. 데이터 SSOT 불변(주문 문서에 이미 손님 이름·전화 존재), UI 표시 + 한 칸 검색 + `tel:` 링크 추가.
> 코드 변경: 미착수(이 문서로 진단·계획 단계 종결)

---

## 1. 문제 정의 (실측)

판매자 앱 주문 화면(`/orders` 목록 + `/orders/[id]` 상세)에 **받는 사람 이름·전화가 한 곳도 노출되지 않는다.** 데이터는 이미 주문 문서에 들어 있어, **표시 한 겹과 검색·전화 동선만 비어 있는 상태**다.

### 실측 근거 (세션92)

| 레이어 | 상태 | 근거 |
|--------|------|------|
| 데이터 모델 | ✅ 존재 | [order.types.ts:54-56](../../../packages/shared/src/order.types.ts#L54-L56) — `buyerName?`/`buyerPhone?` denormalized 필드 |
| 백엔드 저장 | ✅ 저장 중 | [orders-create.service.ts:55-59,162,166](../../../apps/api/src/orders/orders-create.service.ts#L55-L59) — 주문 생성 시 user 문서의 `name`/`phone`을 주문 문서에 복사 |
| 셀러 hook | ✅ 그대로 수신 | [useOrders.ts:42-59](../../../apps/seller/src/hooks/useOrders.ts#L42-L59) — `orders` 컬렉션 전체 구독, 모든 필드 수신 |
| 셀러 카드 | 🔴 **이름·전화 미표시** | [OrderCard.tsx](../../../apps/seller/src/app/orders/_components/OrderCard.tsx) — 상태·시간·주문번호·상품명·배송수단·금액·픽업코드만 |
| 셀러 상세 | 🔴 **이름·전화·연락 버튼 미표시** | [OrderInfoSection.tsx](../../../apps/seller/src/app/orders/[id]/_components/OrderInfoSection.tsx) — 상품·금액·배송 주소·픽업코드만, 손님 섹션 없음 |
| 주문 목록 검색 | 🔴 **없음** | [orders/page.tsx](../../../apps/seller/src/app/orders/page.tsx) — 판매 유형 토글 + 날짜 칩 + 상태 탭 + IN_DELIVERY subfilter만, 텍스트 검색창 없음 |
| 드라이버 앱 비교 | ✅ 4곳에서 사용 | `apps/driver/src/app/board/_client.tsx` · `board/[orderId]/page.tsx` · `map/page.tsx` · `components/OrderCard.tsx` |

### 핵심 발견

**같은 Firestore 주문 문서를 드라이버 앱은 손님 이름·전화로 활용하고, 판매자 앱은 한 곳도 안 쓴다.** 새 데이터 수집·새 인덱스·새 API 없이 표시·검색·`tel:` 링크만 붙이면 동일 데이터로 세 개선이 동시 가능.

---

## 2. 사용자 확정 (further 세션 산출)

| 항목 | 확정 |
|------|------|
| **대상 화면** | 판매자 앱 주문 목록(`/orders`) + 주문 상세(`/orders/[id]`) |
| **이번에 하는 것** | ① 카드·상세에 손님 이름·전화 노출 ② 주문 목록 한 칸짜리 통합 검색(이름·전화·주문번호) ③ 상세에서 바로 전화 걸기 |
| **하지 않는 것** | 손님에게 SMS/푸시 보내기 · 검색 종류 토글(이름만/전화만 등) · 손님별 묶음 화면(이력·메모 등) · 손님 정보 편집 |
| **잘 됐다는 기준** | 판매자가 주문 상세를 열어 받는 사람 이름·전화를 보고, 그 자리에서 바로 전화를 걸기까지 한 화면에서 끝난다 |
| **꼭 넣을 것** | 한 칸짜리 통합 검색(이름·전화·주문번호 모두 일치 시 노출) |
| **출시 시점** | 세 가지가 다 끝나면 한 번에 열기 (정보→검색→전화 동선이 같이 맞물려야 성공 기준 충족) |

---

## 3. 아토믹 태스크

### T0 — 데이터 가드(선결)

- `buyerName`/`buyerPhone`은 **`?` optional**. 과거 주문(필드 누락) 대응 폴백 SSOT를 `_lib.ts`에 추가.
  - `displayBuyerName(order): string` — `order.buyerName?.trim() || '이름 없음'`
  - `displayBuyerPhone(order): string | null` — `order.buyerPhone?.trim() || null`
- 이후 T1·T2·T4가 이 두 함수만 호출하도록 강제(직접 접근 금지).

### T1 — 카드에 손님 이름 노출

- [OrderCard.tsx](../../../apps/seller/src/app/orders/_components/OrderCard.tsx) 상품명 행과 배송 정보 행 사이에 한 줄 추가.
  - 텍스트: `displayBuyerName(order)` — 폰트 사이즈 `--font-size-sm`, 색 `--color-text-secondary`.
- 전화는 카드에 미노출(공간·시선 우선순위), 검색 대상에만 포함.
- 라인 수 영향 최소화 — 인라인 스타일 신규 토큰 도입 0.

### T2 — 상세에 손님 정보 섹션 추가

- [OrderInfoSection.tsx](../../../apps/seller/src/app/orders/[id]/_components/OrderInfoSection.tsx) 상품 정보 Paper와 배송 정보 Paper 사이에 **손님 정보 Paper** 신설.
- 두 행: `받는 사람 = displayBuyerName(order)` · `연락처 = displayBuyerPhone(order) ?? '연락처 없음'`.
- 헤더 스타일은 기존 두 Paper와 동일 (`fw-medium`·`fs-sm`·`text-secondary`).
- 라인 수: 상세 페이지가 이미 길어 `_components/CustomerInfoSection.tsx`로 분리 검토(500라인 한도 확인 후 결정).

### T3 — 상세에서 전화 걸기

- T2의 연락처 행에서 `displayBuyerPhone(order)`가 있으면 `<a href={\`tel:${phone}\`}>` 링크화 + `Button variant="light"`로 강조.
- 색·radius는 기존 픽업 코드 Paper 톤 재사용(`--color-primary-surface` 계열).
- `tel:` 미지원 데스크톱 — 링크는 떠 있되 클릭 시 OS가 처리(별도 가드 불필요).

### T4 — 주문 목록 통합 검색

- [orders/page.tsx](../../../apps/seller/src/app/orders/page.tsx) 상태 탭 위(또는 판매 유형 토글 아래)에 `TextInput placeholder="이름·전화·주문번호 검색"` 한 칸.
- 매칭 SSOT를 `_lib.ts`에 추가:
  - `matchesOrderSearch(order, q): boolean` — `q` trim·소문자화 후 `buyerName`/`buyerPhone`/`orderNumber` 어느 하나라도 `includes` 일치.
  - `q` 공백 → 항상 `true`(전체 통과).
- `filteredOrders` 체인의 마지막 단계로 합산 — 기존 탭·날짜·subfilter 필터와 직교.
- 검색 상태 reset 동선: 판매 유형 토글 변경 시 `setSearchQuery('')` (날짜 reset과 동일 위치).

### T5 — 정합성 검토 + 빌드

- `npm run build`(seller) exit0 — Turbopack 충돌 회피, `--webpack` 기본.
- `pnpm tsc --noEmit`(seller) exit0.
- `biome` 신규 0건(baseline 유지).
- 500라인 한도: T2 결과 `OrderInfoSection.tsx` 또는 신규 `CustomerInfoSection.tsx` 모두 ≤500 확인.

### T6 — 육안 검증(통합 문서 §)

- `docs/specs/frontend/pending-visual-verify.md`에 항목 5개 추가:
  1. 주문 카드에 받는 사람 이름이 한 줄로 노출되는가
  2. 주문 상세에 손님 정보 섹션이 상품·배송 사이에 보이는가
  3. 연락처 버튼을 누르면 OS 전화 앱이 열리는가(모바일)
  4. 목록 검색창에 이름 일부·전화 끝자리·주문번호 끝자리 어느 것을 넣어도 해당 주문만 남는가
  5. 검색어 비우면 전체 복귀하는가 · 판매 유형 토글 시 검색어가 초기화되는가

---

## 4. 비기능 기준

| 기준 | 규정 |
|------|------|
| 데이터 변경 | **없음** — 주문 생성 시 백엔드가 이미 채움 |
| 인덱스 | **추가 없음** — 검색은 클라이언트 측 `includes`(현재 `useOrders`가 전체 구독이므로 동일 메모리에서 처리) |
| 권한 | 변경 없음 — `storeId == session.user.storeId` 전제 그대로 |
| 개인정보 | 셀러는 자기 store 주문의 손님 이름·전화를 **이미 권한상 볼 수 있음** (드라이버 앱이 동일 데이터로 콜·SMS 이미 사용 중). 표시 정책은 기존 노출 범위와 동등 |
| 회귀 | 카드·상세 기존 행은 위치·스타일 불변. T1은 행 한 줄 추가, T2는 Paper 한 개 추가, T4는 필터 체인 마지막 단 1개 추가 |
| 라인 수 | 모든 수정 파일 ≤500라인 |

---

## 5. 진행 표

| Task | 상태 | 커밋 | 비고 |
|------|------|------|------|
| T0 폴백 헬퍼 | ☐ | - | `_lib.ts` 2함수 |
| T1 카드 이름 | ☐ | - | OrderCard 한 줄 |
| T2 상세 손님 섹션 | ☐ | - | Paper 신설 / 분리 검토 |
| T3 전화 걸기 | ☐ | - | `tel:` 링크 |
| T4 통합 검색 | ☐ | - | TextInput + matchesOrderSearch |
| T5 정합성·빌드 | ☐ | - | tsc·build·biome·500라인 |
| T6 육안 항목 추가 | ☐ | - | pending-visual-verify.md |

---

## 6. Handoff

- **다음 한 걸음:** T0 폴백 헬퍼부터 착수. 한 세션에 T0~T5까지 가능 추정(소~중 규모).
- **검증 종료 조건:** 진행 표 T1~T6 모두 ✅ · `pending-visual-verify.md` 5개 항목 사용자 통과.
- **남은 후속:**
  - 손님별 묶음 화면(이력·메모) — 별도 SDD
  - 검색 종류 토글 — 사용 데이터 보고 필요시 별도 SDD
  - 손님에게 SMS/푸시 — 별도 권한·요금 검토 필요

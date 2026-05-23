# 프론트 리팩토링 — 육안 검증 체크리스트

> 작성: 2026-05-19 (세션45 종료 후) · 최종 갱신: 2026-05-20 (세션51 — T6 시드 + 신규 e2e spec)
> 목적: 완료된 셀러앱·소비자앱 프론트 리팩토링 결과를 **브라우저에서 사람이 직접 눈으로** 확인.
> 범위: 코드/타입체크/e2e가 아닌 **실사용 화면 검증** 전용. 리팩토링 세션이 끝날 때마다 이 문서에 섹션을 추가한다.

---

## 검증 환경

| 항목 | 값 |
|------|-----|
| 셀러 계정 | `seller@test.com` / `test1234` |
| 소비자 계정 | `consumer@test.com` / (세션34 강한비번 — `test_accounts` 메모리 참조) |
| 진입 | 로그인 후 하단 BottomNav로 각 탭 이동 |
| 권장 뷰포트 | 모바일 PWA 폭 (≤480px) — 데스크톱 브라우저는 모바일 모드로 |
| e2e 시드 (T6) | `node scripts/seed-e2e-orders.mjs` — 셀러 store에 `e2e-normal-order-001` + `e2e-group-order-001` + `groupProductConfig`, 소비자 활성 상품 store에 14일치 `dailyCaps` 시드 |

검증 표기: 통과 `[x]` · 실패 `[ ]`(메모란에 현상 기재) · 해당없음 `[-]`

---

## A. 홈 대시보드 재구성 (세션39 · #CL-33 · `7a01168`~`da99954`)

> 플랜 SSOT: `docs/specs/frontend/seller-home-dashboard-plan.md`
> 진입: 로그인 직후 홈(`/`), 또는 임의 페이지에서 헤더 중앙 🏠 아이콘 탭.

### A-T1 — PageHeader 중앙 홈 아이콘

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 1 | 홈이 아닌 페이지(주문/상품 등)의 헤더 | 헤더 **정중앙**에 🏠 홈 아이콘 노출 | [ ] | |
| 2 | 좌측 뒤로가기 버튼·제목 길이가 길 때 | 홈 아이콘 위치 변하지 않음 (정중앙 고정) | [ ] | |
| 3 | 홈 아이콘 탭 | 홈(`/`)으로 이동 | [ ] | |
| 4 | 홈 페이지(`/`) 자체의 헤더 | 홈 아이콘 **숨김** (자기 페이지엔 미표시) | [ ] | |

### A-T2 — 홈 셸 + DashboardCard

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 5 | 홈 화면 전체 구조 | PageShell + PageHeader(제목 "홈") 적용 | [ ] | |
| 6 | 각 현황 카드 우상단 | "더보기 >" 링크 노출 | [ ] | |

### A-T3 — 오늘 할 일 카드

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 7 | 홈 최상단 카드 | "오늘 할 일" 카드가 제일 위 | [ ] | |
| 8 | 처리할 항목이 있을 때 | `신규 주문 N건` / `발송 지연 N건` / `비활성 상품 N건` 명령형 줄 | [ ] | |
| 9 | 건수 0인 항목 | 해당 줄 **숨김** (0건 줄은 안 보임) | [ ] | |
| 10 | 할 일 줄 탭 | 신규주문→`/orders?tab=ACTION_REQUIRED`, 발송지연→`/prep`, 비활성상품→`/products` | [ ] | |
| 11 | 모든 할 일이 0건일 때 | "오늘 할 일을 모두 마쳤어요 🎉" 메시지 | [ ] | |

### A-T4 — 주문·정산·상품 현황 카드

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 12 | 주문 처리 현황 카드 | 파이프라인 4칸(처리필요→대기중→배송중→완료) + 건수 + "취소 N건" | [ ] | |
| 13 | 파이프라인 칸 탭 | 해당 주문 탭(`/orders?tab=X`)으로 이동 | [ ] | |
| 14 | 정산 현황 카드 | "오늘 정산 예정 · 금액(원)" 표시 | [ ] | |
| 15 | 상품 현황 카드 | "판매 중 N · 비활성 N" 표시 | [ ] | |
| 16 | 각 카드 "더보기 >" | 주문/정산/상품 페이지로 이동 | [ ] | |

### A-T5 — BottomNav 재구성 + 거점 관리 이동

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 17 | 하단 BottomNav 탭 구성 | `주문 · 상품 · 정산 · 준비 · 설정` (거점 탭 없음) | [ ] | |
| 18 | "준비" 탭 아이콘 | 신규 아이콘 노출, 탭 시 `/prep` 이동 | [ ] | |
| 19 | 설정 페이지 | "거점 관리" 진입 항목 존재 → `/hubs` 이동 | [ ] | |
| 20 | 거점 관리 페이지 자체 | 기존 기능 그대로 동작 (진입 경로만 변경) | [ ] | |

### A-T6 — 준비 물량 탭 (`/prep`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 21 | 준비 탭 화면 | "오늘 준비 물량 (날짜)" 헤더 + 상품별 집계표 | [ ] | |
| 22 | 집계 방식 | 미발송 주문이 상품별로 합산 (`상품명 · N개`) | [ ] | |
| 23 | 집계표 하단 | "N개 상품 · 총 N개" 요약 | [ ] | |
| 24 | 발송 지연분 존재 시 | "🔴 발송 지연" 섹션 별도 노출 + "주문 보기" 링크 | [ ] | |
| 25 | 준비할 물량 없을 때 | "오늘 준비할 물량이 없습니다" 빈 상태 | [ ] | |
| 26 | 공동구매 주문 | 1차 범위 제외 — 집계표에 미포함 (정상, 결함 아님) | [-] | 후속 BACKLOG |

### A-T7 — 연결 인디케이터 공통화

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 27 | 홈·주문 페이지 우상단 연결 상태 | 동일한 dot + 텍스트 인디케이터 (일관된 모양) | [ ] | |

---

## B. 주문 탭 리팩토링 (세션42~45 · `2c4de86`~`36103a6`)

> 플랜 SSOT: `docs/specs/frontend/seller-orders-refactor-plan.md`
> 진입: BottomNav **[주문]** 탭.

### B-T1 — 상태 뱃지 색상 통일 + 주문번호 길이 (`2c4de86`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 28 | 목록 카드 상태 뱃지 색 | 접수=주황, 준비중=파랑, 배송중=보라, 완료=초록, 취소=빨강 | [ ] | |
| 29 | 같은 주문 카드↔상세 뱃지 색 | 동일 상태에서 색 일치 | [ ] | |
| 30 | 카드 좌측 4px 세로 보더 색 | 같은 카드의 상태 뱃지와 같은 계열 색 | [ ] | |
| 31 | 주문번호 표시 길이 | 목록·상세 모두 끝 8자리 동일 | [ ] | |

### B-T2 — 요약바 제거 + sticky 단일화 (`20345eb`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 32 | 헤더 아래 가로 "요약바"(건수 3칸) | 사라짐 — 더 이상 안 보임 | [ ] | |
| 33 | 목록 스크롤 시 고정 영역 | 헤더 + 탭 줄만 sticky (요약바 없음) | [ ] | |
| 34 | 고정 탭 줄 위치 | 헤더 바로 아래 밀착 — 빈 공간/겹침 없음 | [ ] | |
| 35 | 탭 건수 뱃지 | 탭 이름 옆 뱃지에 건수, 0건이면 뱃지 미표시 | [ ] | |

### B-T3 — OrderCard 경량화 (`session43`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 36 | 카드 "준비 시작" 버튼 탭 | 카드 안 폼이 아니라 **상세 페이지로 이동** | [ ] | |
| 37 | 카드 안 날짜 입력칸(datetime) | 없음 (인라인 준비 폼 제거됨) | [ ] | |
| 38 | 카드 "강제 취소" 버튼 | 없음 (카드에서 제거) | [ ] | |
| 39 | 카드 본문(버튼 외) 탭 | 주문 상세로 이동 | [ ] | |
| 40 | 거점 도착(HUB_ARRIVED) 카드 | 픽업 코드 표시 그대로 유지 | [ ] | |

### B-T4 — 주문 상세 개선 (`session43`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 41 | 상세의 "준비 시작"/"강제 취소" 버튼 | 화면 하단 고정 footer에 위치 (스크롤해도 따라옴) | [ ] | |
| 42 | sticky footer ↔ BottomNav | 겹치지 않음 — footer가 BottomNav 위에 뜸 | [ ] | |
| 43 | 완료/취소 등 읽기 전용 주문 상세 | 하단 액션 footer 미노출 | [ ] | |
| 44 | 강제 취소 → 취소 모달 | 모달이 footer와 레이아웃 충돌 없음 | [ ] | |
| 45 | 없는 주문 ID로 접근 | "주문을 찾을 수 없습니다" EmptyState + "돌아가기" 동작 | [ ] | |

### B-T5 — 날짜 범위 필터 (`92886d7`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 46 | 헤더 아래 필터 칩 | `[오늘][이번 주][이번 달][직접 입력]`, 기본 = 이번 주 | [ ] | |
| 47 | 칩 전환 | 목록 즉시 갱신 | [ ] | |
| 48 | 탭 전환 후 선택 기간 | 유지됨 (초기화 안 됨) | [ ] | |
| 49 | "직접 입력" 선택 | from·to 날짜 입력칸 2개 노출 | [ ] | |
| 50 | 직접 입력 from > to | 경고/잘못된 범위 방지 | [ ] | |

### B-T6 — 날짜 그룹 헤더 + 임박 강조 (`72b93d0`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 51 | 목록 그룹핑 | 날짜 단위 섹션 헤더 (`5월 20일 (화) · N건`) | [ ] | |
| 52 | "지연" 섹션 | 최상단 고정, 빨간 텍스트 + 배경 틴트 | [ ] | |
| 53 | "오늘 배송" 섹션 | 빨간색 강조 헤더 | [ ] | |
| 54 | "날짜 미정" 섹션 | 최하단 위치 | [ ] | |
| 55 | 일반(미래) 섹션 헤더 | 회색 텍스트 | [ ] | |
| 56 | 완료/취소(아카이브) 탭 | 그룹 기준이 생성일 — `오늘 / 어제 / 5월 17일…` | [ ] | |
| 57 | 필터 결과 없는 탭 | EmptyState 표시 | [ ] | |

---

## 알려진 잔여 항목 (검증 시 정상 — 결함 아님)

- 주문 도메인에 `fontSize: 24` 인라인 2건 잔존 (픽업 코드 표시용, 24px 토큰 부재 → `BACKLOG` §1-3 P4 등재).
- 준비 물량 탭 공동구매 주문 미포함 (1차 범위 확정 — 후속 BACKLOG).

---

## C. 소비자 배송일 선택 풀스택 (세션46~49 · #CL-34 · `5281188`~`57c0dd1`)

> 플랜 SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (T1·T2·T3 ✅)
> 진입: 소비자앱(`consumer@test.com` / 세션34 강한비번) → 상품 상세 → 장바구니/체크아웃.

### C-T1 — 상품 상세 배송일 선택 캘린더 (`5281188`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 58 | 일반 상품 상세 — `ProductActions` 영역 | `DeliveryDatePicker`(당월 + 익월 2개월) 노출 | [ ] | |
| 59 | 캘린더 각 날짜 셀 | 잔여 `totalCap - (usedSlots ?? 0) > 0`인 날만 활성 | [ ] | |
| 60 | 잔여 0인 날 셀 | 비활성(클릭 불가) + 시각적으로 흐릿 | [ ] | |
| 61 | 캘린더 미선택 상태 | "구매하기"/"장바구니" 버튼 비활성(`canBuy=false`) | [ ] | |
| 62 | 날짜 선택 후 | 두 버튼 활성화, 선택 날짜 강조 표시 | [ ] | |
| 63 | 택배(`parcel`) 상품 상세 | 캘린더 미노출(슬롯 검증 대상 외) | [ ] | |
| 64 | 공동구매 상품 상세 | 캘린더 미노출(`groupDeliveryDate` 별도 관리) | [ ] | |

### C-T2 — 장바구니·체크아웃 배송일 전달 (`35cf229`, `e4c376c`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 65 | 상품 상세에서 "장바구니 담기" | localStorage `CartItem`에 `requestedDeliveryDate` 포함 저장 | [ ] | |
| 66 | 장바구니 페이지 각 아이템 | 선택한 배송일이 ko-KR 포맷(예: `5월 22일 (목)`)으로 표시 | [ ] | |
| 67 | 장바구니 → 체크아웃 진입 | 선택 배송일이 그대로 전달되어 상단/요약에 표시 | [ ] | |
| 68 | 상품 상세 "바로 구매" | 체크아웃 화면에 선택 배송일이 즉시 반영 | [ ] | |
| 69 | 체크아웃 결제 완료 후 주문 데이터 | `orders` 문서 `requestedDeliveryDate=선택 ISO 일자`(셀러 주문 탭에서 확인 가능) | [ ] | |
| 70 | (하위호환) 배송일 없는 구버전 cart 아이템 | localStorage에 옛 항목 잔존 시 오류 없이 로드 — `requestedDeliveryDate?` 옵셔널 동작 | [-] | 신규 테스터는 해당 없음 |

### C-T3 — API 슬롯 검증 정합성 (`4e1576a`, `57c0dd1`)

> UI가 아닌 백엔드 검증이지만 사용자 경험에 직접 노출되는 부분 — 의도 동작 확인.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 71 | 잔여 0인 슬롯 직접 호출(개발자 도구로 강제) | API 400/409 — "해당 일자 잔여 없음" 류 에러, 주문 생성 거부 | [-] | 개발자 시나리오 |
| 72 | 정상 슬롯 선택 후 결제 | 셀러 `dailyCaps` 문서의 `usedSlots`가 1 증가 | [ ] | 셀러앱 거점/슬롯 화면에서 확인 |
| 73 | 슬롯 차감은 선택 배송일 기준 | 주문일(`createdAt`)이 아닌 `requestedDeliveryDate` 일자의 슬롯이 차감됨 | [ ] | |

---

## D. 셀러 주문 탭 IA 재구성 (세션50 · #CL-35 · `2c6c89d`~`bffce2a`)

> 플랜 SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (T4·T5 ✅)
> 진입: 셀러 BottomNav **[주문]** 탭.

### D-T4 — 일반/공구 대칭 토글 (`2c6c89d`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 74 | 주문 탭 진입 시 토글 위치 | `PageHeader` 바로 아래, 두 옵션 `일반 주문`·`공동구매` 노출 | [ ] | |
| 75 | 기본 활성 옵션 | "일반 주문"이 활성 강조(굵게 + 하단 보더) | [ ] | |
| 76 | "일반 주문" 활성 시 목록 | `saleType !== 'group'`인 주문만 보임 | [ ] | |
| 77 | "공동구매" 토글 클릭 | `saleType === 'group'`인 주문만 보임 | [ ] | |
| 78 | 일반 토글 — 날짜 필터 칩 | 칩 영역(`[오늘][이번 주]…`) 노출 | [ ] | |
| 79 | 공구 토글 — 날짜 필터 칩 | **칩 영역 미노출**(1차 미노출 결정) | [ ] | |
| 80 | 토글 전환 시 날짜 필터 | `이번 주`로 초기화 + 직접 입력 from/to 비움 | [ ] | |
| 81 | 토글 전환 시 상태 탭 | 유지됨(예: "처리 필요"였다면 그대로) | [ ] | |
| 82 | 토글 전환 시 IN_DELIVERY 서브필터 | 유지 또는 합리적 처리(이상 동작 없음) | [ ] | |

### D-T5 — 공동구매 배송일 조인 (`bffce2a`)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 83 | 공구 토글 활성 — 날짜 그룹 헤더 | 각 공구 상품의 `groupProductConfig.groupDeliveryDate` 기준 일자로 묶임 | [ ] | |
| 84 | 공구 주문이 `groupDeliveryDate` 미설정 상품 | 해당 주문은 "날짜 미정" 그룹(최하단)으로 떨어짐 | [ ] | |
| 85 | 공구 주문 다수의 다른 상품 동시 표시 | productId별로 다른 날짜 그룹에 정상 분산 | [ ] | |
| 86 | 일반 토글로 전환 후 다시 공구 | 그룹 헤더가 정상 재계산(stale 데이터 없음) | [ ] | |
| 87 | 공구 상품 셀러가 `groupDeliveryDate` 변경 후 페이지 재진입 | 변경된 날짜로 그룹 헤더 갱신됨 | [ ] | onSnapshot이 아닌 getDoc — 새 진입 필요 |
| 88 | 공구 토글 활성 시 콘솔/네트워크 | `groupProductConfig` fetch가 표시 후보 productId 개수만큼만(중복 제거) 발생 | [-] | 개발자 도구 검증 |

### D-T6 — e2e 회귀 가드 (세션51 시드 + 신규 spec)

> 선행: 위 검증 환경의 `seed-e2e-orders.mjs` 1회 실행.
> 신규 e2e: `apps/e2e/tests/consumer-delivery-date.spec.ts`, `seller-orders.spec.ts`(T6 섹션 추가).
> 로컬 풀런이 #CL-23 set-cookie race로 막힐 수 있어 수동 검증 보조.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 89 | 시드 스크립트 실행 결과 콘솔 | `dailyCaps 14건`, `e2e-normal-order-001`, `e2e-group-order-001`, `groupProductConfig/e2e-group-product-001` 모두 OK | [ ] | |
| 90 | 셀러 주문 탭 일반 토글 (시드 후) | "E2E 일반 상품" 카드가 처리 필요 그룹 + `requestedDeliveryDate` 일자 헤더에 노출 | [ ] | |
| 91 | 셀러 주문 탭 공구 토글 (시드 후) | "E2E 공구 상품" 카드가 처리 필요 그룹 + `2026-05-26` 류 `groupDeliveryDate` 헤더에 노출 | [ ] | |
| 92 | DevTools — `getByTestId('sale-type-toggle-normal')` 쿼리 | 콘솔에서 1개 매칭 | [ ] | 개발자 도구 |
| 93 | DevTools — `getByTestId('sale-type-toggle-group')` 쿼리 | 콘솔에서 1개 매칭 | [ ] | 개발자 도구 |
| 94 | 소비자 일반 상품 상세 (시드 후) | `DeliveryDatePicker`에 `N석` 표기된 활성 일자가 14일 범위 내 다수 노출 | [ ] | |
| 95 | 소비자 택배 배송 토글 | 캘린더 즉시 미노출(슬롯 미검증 분기) | [ ] | |
| 96 | 신규 spec preview 동기화 후 CI 풀런 | `consumer-delivery-date.spec.ts` + `seller-orders.spec.ts` 신규 5건 모두 passed | [-] | `sync-preview` 후 e2e workflow |

---

## E. 정산 탭 리팩토링 (SETTLE-REFACTOR S1~S6 · #CL-44/45)

> 작성: 2026-05-23 (세션82 — S6 통합 검증) · 연번 211부터.
> 플랜 SSOT: [settlement-refactor-plan.md](../api/settlement-refactor-plan.md) (T-검증)
> 결정: #CL-44(confirm 배치)·#CL-45(정합 갭 일괄) — [CRITICAL_LOGIC.md](../../CRITICAL_LOGIC.md)
> 진입: 셀러 BottomNav **[정산]** 탭 / 어드민 `/admin/settlements`.
> **핵심 입증 목표**: A-1 단절 해소 = `pending → confirmed → paid` 전 구간이 실제로 흐른다.
> 검증 표기: 통과 `[x]` · 실패 `[ ]`(메모 기재) · 해당없음 `[-]`

### E-T1 — 셀러 정산 화면 (S3·S4·S5)

진입: 셀러 BottomNav **[정산]** 탭.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 211 | 정산 목록 정렬 (선결②) | 정산일시(`settledAt`) 기준 **최신순(desc)** 노출. 위→아래로 날짜가 내림차순 | [ ] | S5 N10, asc→desc 변경 회귀 |
| 212 | 상태 라벨 | pending="**정산 대기**" 등 shared SSOT 라벨로 표시 | [ ] | S4 SSOT(packages/shared) |
| 213 | 상태 색상 | pending=**노랑(yellow)** 계열. 셀러본 색 정책 일관 | [ ] | S4 STATUS_COLOR |
| 214 | status 필터 동작 | 상태 필터 변경 시 목록이 해당 status만으로 즉시 갱신(백엔드까지 연결) | [ ] | S3 N2 hook→service |

### E-T2 — 어드민 정산 화면 (S5/F-2)

진입: `/admin/settlements` (셀러 계정이 admin 권한일 때).

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 215 | 정산일시 컬럼 | 표에 **정산일시** 컬럼 노출, `settledAt` 값 정상 포맷 | [ ] | S5 N10 |
| 216 | 정렬 desc | 어드민도 정산일시 **최신순(desc)** — 셀러와 방향 통일 | [ ] | S5 N10 |
| 217 | 라벨·색 셀러 일치 | 동일 status의 라벨·색이 셀러 화면과 **동일**(shared SSOT 공유) | [ ] | S4/F-2 |
| 218 | 합계 카드(sumPayable) | 지급 대상 합계가 **confirmed + paid** 한정으로 집계(pending 미포함) | [ ] | S5 N11 |

### E-T3 — 전이 입증: pending → confirmed → paid (T-검증 B, A-1 해소)

> 전이 검증 방식(세션82 사용자 결정): **라이브 배치 자연 대기**. `@Cron('0 4 * * *', { timeZone: 'Asia/Seoul' })` `confirmDueSettlements` 배치가 다음 04:00 KST에 마감 경과 pending을 confirmed로 전이하는 것을 확인. 별도 수동 시드 없음.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 219 | 마감 경과 pending 존재 | `settledAt`이 (지금 − SETTLEMENT_CONFIRM_DELAY_DAYS일) 이전인 pending 정산이 1건 이상 | [ ] | 배치 대상 전제 |
| 220 | 배치 후 confirmed 전이 | 다음 04:00 KST 경과 후 위 정산이 **confirmed**로 전이 (어드민/셀러 화면에서 확인) | [ ] | #CL-44 입증·인덱스 무에러 |
| 221 | 어드민 "지급처리" 버튼 노출 | confirmed 정산 행에 **"지급처리"** 버튼 노출(pending에선 미노출) | [ ] | N5 — confirmed 전제 |
| 222 | markAsPaid → paid | "지급처리" → ConfirmModal(blue) 확인 → 상태 **paid**로 갱신 | [ ] | F-T-UX3 #113 재확인 |
| 223 | A-1 단절 해소 종합 | 위 전이가 끊김 없이 흐름 = 전 정산 pending 고착 문제 해소 입증 | [ ] | **S6 핵심 DoD** |

> **참고 — 배치 로그/모니터링**: 라이브 배치가 도는지 운영 로그에서 `confirmDueSettlements` 실행·전이 건수 확인 가능. FAILED_PRECONDITION(인덱스 미배포)은 선결①(세션80 배포)로 해소됨.

---

## F. 셀러 UX 잔여 정합 (세션54~ · #CL-36 · `seller-ux-residual-plan.md`)

### F-T-UX1 — 탭 스타일 단일화 `SegmentedTabs` (세션54)

플랜: [seller-ux-residual-plan.md](seller-ux-residual-plan.md) T-UX1. 신설 컴포넌트 `apps/seller/src/components/SegmentedTabs.tsx` + 3페이지 치환.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 97 | 주문 페이지 상태 탭 색상 | active=초록(`--color-primary`)·inactive=secondary 회색. 검정 잔재 없음 | | |
| 98 | 주문 탭 active 강조 | active 폰트 굵기 700, inactive medium | | |
| 99 | 주문 탭 sticky 동작 | 스크롤 시 헤더 바로 아래(`var(--header-height)`)에 고정 | | |
| 100 | 주문 탭 카운트 Badge | count>0인 탭만 Badge. ACTION_REQUIRED는 빨강, 나머지 회색 | | |
| 101 | 주문 탭 모바일 스크롤 | 탭 5+가 가로 스크롤 가능, 스크롤바 미노출 | | |
| 102 | 상품 페이지 필터 탭 시각 | 주문 탭과 동일 패턴(초록·active 700) | | |
| 103 | 상품 탭 카운트 인라인 | 라벨에 `전체 N` 형태로 표시(0건 포함) | | |
| 104 | 상품 탭 non-sticky | 스크롤 시 상단 고정 안 됨(원래 정책 유지) | | |
| 105 | 정산 페이지 탭 시각 | 주문·상품 탭과 동일 패턴 | | |
| 106 | 정산 탭 sticky 위치 | `top:57` 매직넘버 제거되고 `var(--header-height)`로 고정 | | |
| 107 | 회귀 — 3페이지 클릭 동작 | 탭 클릭 시 활성 전환·콘텐츠 변경 정상 | | |

### F-T-UX3 — 공통 `ConfirmModal` + native confirm 6곳 교체 (세션55)

플랜: [seller-ux-residual-plan.md](seller-ux-residual-plan.md) T-UX3 · 결정: [#CL-37](../../CRITICAL_LOGIC.md). 신설 `apps/seller/src/components/ConfirmModal.tsx` + 6건 교체.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 108 | 거점 삭제 모달 | `/hubs` 거점 카드 "삭제" 클릭 → ConfirmModal 열림, 제목 "거점 삭제", confirm 라벨 "삭제"(red) | | |
| 109 | 거점 삭제 처리 | 확인 시 "처리 중..." 표시 후 카드 제거, 모달 닫힘. 취소/외부 클릭 시 무변화 | | |
| 110 | 상품 삭제 모달 | `/products` 카드 "삭제" Badge 클릭 → 모달 메시지에 상품명 동적 표시 + `\n` 다행 처리 | | |
| 111 | 상품 삭제 동시성 | 처리 중 외부 클릭/ESC로 닫히지 않음(loading 가드), 완료 시 자동 닫힘 | | |
| 112 | 드라이버 3액션 분기 | `/admin/drivers` 승인=초록·정지=빨강·해제=회색으로 confirmColor·라벨 변경, 1개 모달로 통합 | | |
| 113 | 정산 지급 모달 | `/admin/settlements` "지급처리" → ConfirmModal(blue) 표시, 확인 시 상태 paid로 갱신 | | |
| 114 | 사용자 정지/해제 모달 | `/admin/users` 정상 계정 → "계정 정지"(red), 정지된 계정 → "계정 정지 해제"(green) | | |
| 115 | 회귀 — native confirm 잔존 | `apps/seller/src` 전역 `confirm(` 호출 0건(grep 검증) | | |

### F-T-UX2 — 상품 카드 Switch + Button 분리 (세션56)

플랜: [seller-ux-residual-plan.md](seller-ux-residual-plan.md) T-UX2. `apps/seller/src/app/products/page.tsx` ProductCard에서 Badge×3 → `Switch`(활성 토글) + `Button subtle`×2(수정·삭제) 분리.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 116 | 활성 토글 — 외관 | `/products` 카드의 상품명 우측에 Mantine Switch(초록, sm) 표시. 활성 상품 = 켜짐, 비활성 = 꺼짐 | | |
| 117 | 활성 토글 — 동작 | Switch 클릭 시 즉시 PATCH 호출(`/active`), 처리 중 disabled, 성공 시 상태 반영. 에러 시 카드 내부 인라인 메시지 | | |
| 118 | 활성 토글 — 접근성 | Switch에 aria-label("판매 중 — 클릭하여 비활성" 또는 "비활성 — 클릭하여 판매 중으로") 부여 | | |
| 119 | 수정 버튼 | 액션 row의 "수정" Button(xs subtle gray) 클릭 시 `/products/[id]/edit` 이동 | | |
| 120 | 삭제 버튼 — 외관 | 액션 row의 "삭제" Button(xs subtle red) 클릭 시 ConfirmModal(세션55) 열림 | | |
| 121 | 삭제 버튼 — 로딩 | 확인 시 Button `loading` prop으로 스피너 표시, ConfirmModal `loading` 가드 동작 | | |
| 122 | 레이아웃 회귀 | 카드 높이·정렬 자연스러움, 상품명 truncate 정상, 액션 row는 수정·삭제 2개만 | | |
| 123 | 회귀 — Badge 잔존 | `apps/seller/src/app/products/page.tsx`에 `<Badge` 사용 0건(grep 검증) | | |

### F-T-UX4a — admin fontSize 토큰화 17건 (세션57)

플랜: [seller-ux-residual-plan.md](seller-ux-residual-plan.md) T-UX4a. `apps/seller/src/app/admin/**` 의 하드코딩 `fontSize: 숫자` 17건(`layout.tsx`·`banner/_client.tsx`·`drivers/_client.tsx`·`invite/_client.tsx`×2·`settlements/_client.tsx`×4·`orders/_client.tsx`×3·`stores/_client.tsx`×3·`users/_client.tsx`×2) → `fontSize: 'var(--font-size-sm)'`. 매핑은 12·14 모두 sm(15px)로 통일(현 토큰 정의에 xs 미정의·미사용 — 5단계 sm/md/lg/xl/2xl만 운용 중). 시각 검증은 정적 검증으로 갈음(사용자 합의).

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 124 | admin 레이아웃 메뉴 | `/admin` 탭 라벨(`layout.tsx:53`) 폰트 자연스러움 | ⏹️ 생략 | 정적 검증으로 갈음 |
| 125 | 배너 업로드 폼 | `/admin/banner` 업로드 버튼 폰트 | ⏹️ 생략 | 정적 검증으로 갈음 |
| 126 | 드라이버 카드 | `/admin/drivers` 탭 라벨 폰트 | ⏹️ 생략 | 정적 검증으로 갈음 |
| 127 | 초대 코드 표 | `/admin/invite` 표 셀·만료일 폰트 | ⏹️ 생략 | 정적 검증으로 갈음 |
| 128 | 정산 필터·표 | `/admin/settlements` 날짜 입력·표·storeId 폰트 | ⏹️ 생략 | 정적 검증으로 갈음 |
| 129 | 주문 표 | `/admin/orders` 표·orderId/storeId 폰트 | ⏹️ 생략 | 정적 검증으로 갈음 |
| 130 | 스토어 표 | `/admin/stores` 표·storeId·수수료 입력 폰트 | ⏹️ 생략 | 정적 검증으로 갈음 |
| 131 | 사용자 표 | `/admin/users` 표·userId 폰트 | ⏹️ 생략 | 정적 검증으로 갈음 |
| 132 | 회귀 — admin 숫자 리터럴 잔존 | `grep -rn "fontSize:\s*[0-9]" apps/seller/src/app/admin` 0건 | ✅ | 세션57 검증 |
| 133 | 회귀 — 빌드 | `pnpm --filter seller build` 23라우트 + 타입체크 exit 0 | ✅ | 세션57 검증 |
| 134 | 회귀 — biome 베이스라인 | `pnpm -w biome check apps/seller` errors 64→63(자동 포맷 부수효과) 신규 0건 | ✅ | 세션57 검증 |

### F-T-UX4b — 셀러 본 화면 fontSize 토큰화 10건 + `--font-size-xs` 신설 (세션58 · #CL-38)

플랜: [seller-ux-residual-plan.md](seller-ux-residual-plan.md) T-UX4b. settlements 3파일·hubs/pickup·settings 2파일의 하드코딩 `fontSize: 숫자` 10건 → `var(--font-size-*)`. 위험 케이스 2건은 사용자 결정으로 처리: `daily-caps:277` `fontSize:10`(셀 내부 보조) → **`--font-size-xs: 12px` 신설**(#CL-38) 후 xs(+2px) 적용 · `hubs/pickup:180` `fontSize:20`(OTP 입력 박스) → xl(변동 0). 시각 검증은 정적 검증으로 갈음(사용자 합의).

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 135 | settlements 일별 탭 | `/settlements` 일별 폼 날짜 input 폰트(`DailySummaryTab.tsx:42` 13→sm) | ⏹️ 생략 | 정적 검증으로 갈음 |
| 136 | settlements 주문 탭 | `/settlements` 주문 탭 CSV 다운로드 라벨(`OrdersTab.tsx:46` 12→sm) | ⏹️ 생략 | 정적 검증으로 갈음 |
| 137 | settlements 기간 탭 | `/settlements` 기간 탭 from·to date input·CSV 라벨(`PeriodTab.tsx:48,61,91`) | ⏹️ 생략 | 정적 검증으로 갈음 |
| 138 | 거점 픽업 OTP | `/hubs/[id]/pickup` 6자리 OTP 입력 박스 강조 폰트(`pickup/page.tsx:180` 20→xl, 변동 0) | ⏹️ 생략 | 정적 검증으로 갈음 |
| 139 | daily-caps 셀 카운트 | `/settings/daily-caps` 그리드 셀 내부 usedSlots `↑` 카운트(`daily-caps:277` 10→**xs(12px)**, +2px) | ⏹️ 생략 | 의도적 작은 보조 인디케이터 — 정적 검증으로 갈음 |
| 140 | daily-caps 편집 입력 | `/settings/daily-caps` 편집 패널 totalCap 입력(`daily-caps:313` 14→sm) | ⏹️ 생략 | 정적 검증으로 갈음 |
| 141 | delivery 옵션 입력 | `/settings/delivery` 직배송/거점/택배 비용 입력(`delivery:181`) · 무료 배송 기준 입력(`delivery:244`) 14→sm | ⏹️ 생략 | 정적 검증으로 갈음 |
| 142 | 회귀 — 토큰 신설 확인 | `packages/ui/src/style.css` `--font-size-xs: 12px` 존재 | ✅ | 세션58 검증 |
| 143 | 회귀 — settlements/hubs/settings 숫자 리터럴 잔존 | `grep -rnE "fontSize:\s*[0-9]+" apps/seller/src/app/{settlements,hubs,settings}` 0건 | ✅ | 세션58 검증(잔여 7건은 모두 products `_components` — T-UX4c 범위) |
| 144 | 회귀 — 빌드 | `pnpm --filter seller build` 23라우트 + 타입체크 exit 0 | ✅ | 세션58 검증 |
| 145 | 회귀 — biome 대상 폴더 | `pnpm -w biome check apps/seller/src/app/{settlements,hubs,settings}` errors 0건 | ✅ | warnings 3건(기존), 신규 0건 |
| 146 | 회귀 — biome 전체 베이스라인 | `pnpm -w biome check apps/seller/src` errors 63→50(자동 포맷 부수효과) 신규 0건 | ✅ | 세션58 검증 |

### F-T-UX4c — products `_components` fontSize 토큰화 7건 (세션59)

플랜: [seller-ux-residual-plan.md](seller-ux-residual-plan.md) T-UX4c. products `_components` 3파일의 하드코딩 `fontSize: 숫자` 7건 → `var(--font-size-*)`. **9·11·12px 5건은 모두 xs로 흡수**(#CL-38 "의도적 작은 보조 인디케이터" 정책 일관 적용 — 80×80 썸네일 오버레이 라벨·✕ 삭제 버튼·"사진 추가" 빈 박스 라벨, 9→12px·11→12px·12→12px). **Mantine `styles.input.fontSize` 2건**(AIPreviewPanel 15→sm·SellerNoteInput 16→md)도 토큰 인젝션 — emotion이 CSS 변수 통과 처리, 타입체크 exit 0으로 검증 완료(T-UX5 정합성 검토에서 "Mantine API 경로 예외" 명시 회피). 시각 검증은 정적 검증으로 갈음(사용자 합의).

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 147 | 이미지 업로드 — 대표 배지 | `/products/new` 이미지 첫 칸 좌하단 "대표" 라벨(`ImageUpload.tsx:102` 9→xs, +3px) | ⏹️ 생략 | 80×80 썸네일 오버레이 — 정적 검증으로 갈음 |
| 148 | 이미지 업로드 — 대표 설정 버튼 | 이미지 2번째 이후 좌하단 "대표 설정" 라벨(`ImageUpload.tsx:121` 9→xs) | ⏹️ 생략 | 동일 |
| 149 | 이미지 업로드 — 순번 인디케이터 | 좌상단 1·2·3·4·5 순번 원형 배지(`ImageUpload.tsx:140` 9→xs) | ⏹️ 생략 | 16×16 원 안 글리프 — 정적 검증으로 갈음 |
| 150 | 이미지 업로드 — ✕ 삭제 버튼 | 우상단 20×20 ✕ 버튼 글리프(`ImageUpload.tsx:168` 11→xs, +1px) | ⏹️ 생략 | 정적 검증으로 갈음 |
| 151 | 이미지 업로드 — "사진 추가" 빈 박스 | 80×80 점선 박스 안 "사진 추가" 라벨(`ImageUpload.tsx:194` 12→xs, 변동 0) | ⏹️ 생략 | 정의값 일치 — 정적 검증으로 갈음 |
| 152 | AI 프리뷰 — 상세 설명 Textarea | `/products/new` AI 생성 후 상세 설명 Mantine Textarea 입력 폰트(`AIPreviewPanel.tsx:147` styles.input 15→sm, 변동 0) | ⏹️ 생략 | Mantine emotion CSS 변수 통과 — 정적 검증으로 갈음 |
| 153 | 셀러 노트 입력 Textarea | `/products/new` 셀러 노트 Mantine Textarea 입력 폰트(`SellerNoteInput.tsx:38` styles.input 16→md, 변동 0) | ⏹️ 생략 | 동일 |
| 154 | 회귀 — products 숫자 리터럴 잔존 | `grep -rnE "fontSize:\s*[0-9]+" apps/seller/src/app/products` 0건 | ✅ | 세션59 검증 |
| 155 | 회귀 — seller 전역 숫자 리터럴 잔존 | `grep -rnE "fontSize:\s*[0-9]+" apps/seller/src --include="*.tsx"` 0건 (T-UX4 시리즈 종결) | ✅ | 세션59 검증 |
| 156 | 회귀 — 빌드 | `pnpm --filter seller build` 23라우트 + 타입체크 exit 0 | ✅ | 세션59 검증 |
| 157 | 회귀 — biome 전체 베이스라인 | `pnpm -w biome check apps/seller/src` errors 63→1(자동 포맷 부수효과 -62, 잔여 1건은 `VarietySelector.tsx:54` 기존 코드) 신규 0건 | ✅ | 세션59 검증 |

---

## F-VISUAL-PATH — 셀러앱 UX 잔여(T-UX1~4) 통합 시각 검증 경로 (세션60 합본)

> 작성: 2026-05-21 (세션59 종료 후) · 통합 대상: F-T-UX1(세션54, 탭 단일화)·F-T-UX2(세션56, 상품 카드 분리)·F-T-UX3(세션55, ConfirmModal)·F-T-UX4a/b/c(세션57·58·59, fontSize 토큰화).
> **목적**: 세션57~59에서 사용자 합의로 "정적 검증으로 갈음"한 22개 항목 + F-T-UX1~3 미체크 27개 항목을 **한 번의 로그인 세션 동선으로** 사람이 직접 확인. 화면 이동 최소화.
> **사용법**: 위에서 아래로 순서대로 진행. 각 화면 진입 시 상단에 적힌 행을 모두 본 뒤 다음 화면으로. 결과는 `[x]` 통과 / `[ ]` 실패(메모 기재) / `[-]` 해당없음.
> **사전 준비**: 모바일 PWA 폭(≤480px) · 셀러 계정 `seller@test.com / test1234` · e2e 시드 적용(`node scripts/seed-e2e-orders.mjs`) · DevTools Elements 패널(폰트 토큰 계산값 검증용) 준비.

### V0 — 사전 점검 (DevTools 콘솔 1회)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 158 | 토큰 정의 확인 | DevTools console: `getComputedStyle(document.documentElement).getPropertyValue('--font-size-xs').trim()` → `12px`. `--font-size-sm` → `15px`, `--font-size-md` → `16px`, `--font-size-xl` → `20px` | [ ] | 모든 화면에서 유효 |

### V1 — 주문 탭 (`/orders`) — F-T-UX1 sticky·count Badge

진입: BottomNav **[주문]** 탭.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 159 | 상태 탭 색상 | active=**초록(`--color-primary`)** · inactive=secondary 회색. 검정 잔재 없음 | [ ] | F-T-UX1 #97 재확인 |
| 160 | 상태 탭 강조 | active 폰트 굵기 **700**, inactive medium | [ ] | F-T-UX1 #98 |
| 161 | 상태 탭 sticky | 카드 목록 스크롤 시 탭이 헤더 바로 아래에 고정. DevTools 측정값 `top = var(--header-height)` (≈56~57px) | [ ] | F-T-UX1 #99·#106 |
| 162 | 카운트 Badge | `ACTION_REQUIRED` 탭에 빨강 점 Badge, 나머지는 회색 점(count>0 탭만 노출) | [ ] | F-T-UX1 #100 |
| 163 | 모바일 가로 스크롤 | 탭 5개 이상일 때 가로 스크롤 가능, 스크롤바 미노출 | [ ] | F-T-UX1 #101 |
| 164 | 탭 클릭 전환 | 클릭 시 즉시 active 전환 + 카드 목록 변경(라우팅 없음) | [ ] | F-T-UX1 #107 |

### V2 — 상품 탭 (`/products`) — F-T-UX1·F-T-UX2·F-T-UX3 통합

진입: BottomNav **[상품]** 탭. 상품 1건 이상 존재 가정.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 165 | 필터 탭 시각 | 주문 탭과 **동일 패턴**(초록·active 700·medium) | [ ] | F-T-UX1 #102 |
| 166 | 카운트 인라인 | 라벨에 `전체 N` 형태 인라인 표시(0건 포함) | [ ] | F-T-UX1 #103 |
| 167 | 필터 탭 non-sticky | 스크롤 시 상단 고정 **안 됨** | [ ] | F-T-UX1 #104 |
| 168 | 카드 — 활성 Switch 외관 | 상품명 우측에 Mantine **Switch**(초록, sm) — 활성 상품은 켜짐, 비활성은 꺼짐 | [ ] | F-T-UX2 #116 |
| 169 | 활성 Switch 동작 | Switch 토글 시 즉시 PATCH 호출, 처리 중 disabled, 성공 시 즉시 반영. 실패 시 카드 내부 인라인 에러 | [ ] | F-T-UX2 #117 |
| 170 | 활성 Switch 접근성 | DevTools에서 Switch 요소 선택 → `aria-label`이 "판매 중 — 클릭하여 비활성" 또는 그 반대 문구 | [ ] | F-T-UX2 #118 |
| 171 | 액션 row 수정 | "수정" Button (xs subtle **gray**) 탭 → `/products/[id]/edit` 이동 | [ ] | F-T-UX2 #119 |
| 172 | 액션 row 삭제 외관 | "삭제" Button (xs subtle **red**) 탭 → ConfirmModal 열림 | [ ] | F-T-UX2 #120 |
| 173 | Badge 잔존 회귀 | DevTools Elements에서 상품 카드에 `<span class="*Badge*">` 없음(Switch + Button 2개만) | [ ] | F-T-UX2 #123 |
| 174 | 상품 삭제 모달 메시지 | ConfirmModal 본문에 **상품명 동적** 표시 + `\n` 다행 처리 정상 | [ ] | F-T-UX3 #110 |
| 175 | 상품 삭제 로딩·동시성 | 확인 누른 후 Button + 모달 모두 loading 표시, 처리 중 외부 클릭/ESC로 닫히지 않음. 완료 시 자동 닫힘 + 카드 제거 | [ ] | F-T-UX3 #111 + F-T-UX2 #121 |

### V3 — 상품 등록/편집 (`/products/new`) — F-T-UX4c products `_components`

진입: 상품 페이지에서 "**+ 새 상품 등록**" 또는 `/products/new` 직접 진입. 이미지 1장 이상 업로드 후 진행.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 176 | 이미지 — "대표" 배지 | 첫 칸(80×80) 좌하단 "대표" 라벨이 보임. DevTools에서 해당 요소 `font-size: 12px` (computed) | [ ] | F-T-UX4c #147, 9→xs(+3px) |
| 177 | 이미지 — "대표 설정" 버튼 | 2번째~5번째 칸 좌하단 "대표 설정" 라벨, `font-size: 12px`, 잘림 없음·줄바꿈 없음 | [ ] | F-T-UX4c #148, 9→xs(+3px), 줄바꿈 발생 시 메모 |
| 178 | 이미지 — 순번 1·2·3·4·5 | 좌상단 16×16 원형 인디케이터 안 숫자, `font-size: 12px`, 원형 컨테이너 넘침 없음 | [ ] | F-T-UX4c #149, 9→xs(+3px), 넘침 발생 시 메모 |
| 179 | 이미지 — ✕ 삭제 버튼 | 우상단 20×20 원형 ✕ 버튼, `font-size: 12px`, 글리프가 버튼 안에 자연스럽게 위치 | [ ] | F-T-UX4c #150, 11→xs(+1px) |
| 180 | 이미지 — "사진 추가" 빈 박스 | 마지막 점선 80×80 박스 안 "사진 추가" 라벨, `font-size: 12px`, + 아이콘과 정렬 자연스러움 | [ ] | F-T-UX4c #151, 12→xs(변동 0) |
| 181 | AI 프리뷰 Textarea | AI 생성 후 "상세 설명" Mantine Textarea 입력 영역, `font-size: 15px` (computed) | [ ] | F-T-UX4c #152, 15→sm(변동 0) |
| 182 | 셀러 노트 Textarea | "셀러 노트" Mantine Textarea 입력 영역, `font-size: 16px` (computed) | [ ] | F-T-UX4c #153, 16→md(변동 0) |
| 183 | products/[id]/edit 동일 확인 | 기존 상품 1건 편집 진입 → 이미지 영역 라벨군 동일하게 표시(176~180 재확인 불필요, 회귀만 체크) | [ ] | F-T-UX4c 보강 |

### V4 — 정산 탭 (`/settlements`) — F-T-UX1·F-T-UX4b settlements

진입: BottomNav **[정산]** 탭.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 184 | 정산 페이지 탭 시각 | 주문·상품 탭과 **동일 패턴**(초록·active 700) | [ ] | F-T-UX1 #105 |
| 185 | 정산 탭 sticky 위치 | DevTools에서 탭 컨테이너 측정값 `top = var(--header-height)` (≈56~57px). 매직넘버 `57` 없음 | [ ] | F-T-UX1 #106 |
| 186 | 일별 탭 — 날짜 input | "일별" 탭 진입 시 날짜 input 폰트 `font-size: 15px` (computed) | [ ] | F-T-UX4b #135, DailySummaryTab 13→sm |
| 187 | 주문 탭 — CSV 라벨 | "주문" 탭 CSV 다운로드 버튼 라벨 폰트 `font-size: 15px` | [ ] | F-T-UX4b #136, OrdersTab 12→sm |
| 188 | 기간 탭 — from/to + CSV | "기간" 탭 from·to date input 폰트와 CSV 라벨 모두 `font-size: 15px` | [ ] | F-T-UX4b #137, PeriodTab 3건 |

### V5 — 거점 픽업 (`/hubs/[id]/pickup`) — F-T-UX4b OTP xl

진입: BottomNav **[설정]** → **거점 관리** → 거점 1건 진입 → **픽업** 또는 `/hubs/{id}/pickup` 직접 진입.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 189 | OTP 6자리 입력 박스 | 48×56 입력 박스 6칸의 입력 글자 폰트 `font-size: 20px` (computed) — 변동 0, 강조 폰트 의도 보존 | [ ] | F-T-UX4b #138, 20→xl |

### V6 — 설정/일일 캡 (`/settings/daily-caps`) — F-T-UX4b xs·sm

진입: BottomNav **[설정]** → **일일 발송 캡 관리**.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 190 | 캘린더 셀 카운트 (xs) | 그리드 셀 내부 usedSlots `↑` 카운트, `font-size: 12px` (computed). 셀(약 60×60) 안에서 위치·정렬 자연스러움 | [ ] | F-T-UX4b #139, 10→**xs**(+2px), 의도적 작은 보조 인디케이터 |
| 191 | 편집 패널 totalCap 입력 | 셀 클릭 → 편집 패널 totalCap 입력 폰트 `font-size: 15px` | [ ] | F-T-UX4b #140, 14→sm |

### V7 — 설정/배송 옵션 (`/settings/delivery`) — F-T-UX4b sm

진입: BottomNav **[설정]** → **배송 설정**.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 192 | 직배송/거점/택배 비용 입력 | 3개 비용 input의 폰트 `font-size: 15px` (computed) | [ ] | F-T-UX4b #141a, delivery:181 14→sm |
| 193 | 무료 배송 기준 입력 | 무료 배송 기준 input 폰트 `font-size: 15px` | [ ] | F-T-UX4b #141b, delivery:244 14→sm |

### V8 — 거점 삭제 모달 (`/hubs`) — F-T-UX3 ConfirmModal

진입: BottomNav **[설정]** → **거점 관리** (`/hubs`).

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 194 | 거점 삭제 모달 외관 | 거점 카드 "삭제" 클릭 → ConfirmModal 열림. 제목 "거점 삭제", confirm 라벨 "삭제"(**red**) | [ ] | F-T-UX3 #108 |
| 195 | 거점 삭제 처리 | 확인 시 "처리 중..." → 카드 제거, 모달 자동 닫힘. 취소/외부 클릭/ESC 시 무변화 | [ ] | F-T-UX3 #109 |

### V9 — 관리자(`/admin/**`) — F-T-UX3·F-T-UX4a

진입: 셀러 계정이 admin 권한이라는 가정(없으면 V9 전체 [-]). admin BottomNav 또는 `/admin` 직접 진입.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 196 | admin 레이아웃 탭 (`/admin`) | 상단 admin 탭 라벨군 폰트 `font-size: 15px` (computed) | [ ] | F-T-UX4a #124, layout:53 |
| 197 | 배너 업로드 (`/admin/banner`) | 업로드 영역 라벨/버튼 폰트 `15px` | [ ] | F-T-UX4a #125 |
| 198 | 드라이버 목록 (`/admin/drivers`) | 탭 라벨·표 셀 폰트 `15px` | [ ] | F-T-UX4a #126 |
| 199 | 드라이버 3액션 모달 | 드라이버 카드 "승인"=**초록**·"정지"=**빨강**·"해제"=**회색** ConfirmModal. 1개 모달로 색상·라벨만 변경 | [ ] | F-T-UX3 #112 |
| 200 | 초대 (`/admin/invite`) | 표 셀(`#144,224`) 폰트 `15px` | [ ] | F-T-UX4a #127 |
| 201 | 정산 (`/admin/settlements`) | 날짜 input·storeId·표 셀 폰트 `15px`(4건) | [ ] | F-T-UX4a #128 |
| 202 | 정산 지급 모달 | "지급처리" 클릭 → ConfirmModal(**blue**). 확인 시 상태 paid. 실패 시 기존 alert 유지 | [ ] | F-T-UX3 #113 |
| 203 | 주문 (`/admin/orders`) | 표·orderId·storeId 폰트 `15px`(3건) | [ ] | F-T-UX4a #129 |
| 204 | 스토어 (`/admin/stores`) | 표·storeId·수수료 입력 폰트 `15px`(3건) | [ ] | F-T-UX4a #130 |
| 205 | 사용자 (`/admin/users`) | 표·userId 폰트 `15px`(2건) | [ ] | F-T-UX4a #131 |
| 206 | 사용자 정지/해제 모달 | 정상 계정 → "계정 정지"(**red**), 정지된 계정 → "계정 정지 해제"(**green**). confirmColor·라벨이 상태별로 가변 | [ ] | F-T-UX3 #114 |

### V10 — 회귀 가드 (코드/콘솔, 화면 무관)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 207 | 셀러 전역 인라인 fontSize 잔존 | `grep -rnE "fontSize:\s*[0-9]+" apps/seller/src --include="*.tsx"` → **0건** | ✅ | 세션59 검증 |
| 208 | 셀러 전역 native confirm 잔존 | `grep -rn "confirm(" apps/seller/src --include="*.ts" --include="*.tsx"` → **0건** | ✅ | 세션55 검증 |
| 209 | 콘솔 에러 — 전 화면 통과 후 | DevTools Console에 V1~V9 동선 진행 중 누적된 빨강 에러 0건 (Firebase·Mantine·Next 정상 로그 제외) | [ ] | 전 동선 종합 |
| 210 | 시각 회귀 발견 시 처리 정책 | (메모 전용) 라벨 잘림·줄바꿈·정렬 깨짐 등 발생 시 — 한 단계 위 토큰으로 조정(xs→sm 등), **토큰 자체 값 변경 금지**. 발견 즉시 메모란에 라우트·요소·현상 기재 | [-] | 세션57~59 정책 |

---

### 진행 도움말 — DevTools로 폰트 빠르게 검증

1. 모바일 폭(≤480px)으로 줄인 Chrome 창에서 진입.
2. DevTools 열고(F12) **Elements** 패널에서 확인하고자 하는 텍스트 요소 클릭.
3. 우측 **Computed** 탭 검색창에 `font-size` 입력 → 계산된 px값 확인.
4. 화면 일괄 검증 시 console에 다음 한 줄 — V0 #158의 토큰 정의 재확인 또는 임의 셀렉터 폰트 일괄 측정:

```js
// 페이지 내 모든 텍스트 요소 fontSize 계산값 추출 (인라인 숫자 잔존 확인용)
[...document.querySelectorAll('*')].filter(e=>e.textContent.trim()&&!e.children.length).slice(0,200).map(e=>({el:e.tagName,text:e.textContent.trim().slice(0,20),fs:getComputedStyle(e).fontSize})).filter(o=>parseInt(o.fs)<12||(parseInt(o.fs)>0&&![12,15,16,18,20,24].includes(parseInt(o.fs))))
```
   → **빈 배열이면 토큰 6단계 외 폰트 없음 = 통과**. (Mantine 내부 기본값에 따라 14px가 일부 나타날 수 있음 — 그 경우는 우리 인라인 잔존이 아닌 라이브러리 기본값이므로 회귀로 보지 않음.)

5. **V3 이미지 라벨 시각 회귀(176~180)** 가 가장 위험 — 80×80 컨테이너에서 라벨 잘림/줄바꿈 발생 시 메모 후 사용자 결정(literal 9 복귀 또는 xs 유지) 진행.

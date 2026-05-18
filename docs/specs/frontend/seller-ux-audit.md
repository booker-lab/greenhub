# 셀러앱 UX 감사 — 화면별 진단

> 작성: 2026-05-18 (세션38) · 방법: 핵심 페이지 7개 + 공통 컴포넌트 직접 읽기
> 상태: **홈 화면은 [seller-home-dashboard-plan.md](seller-home-dashboard-plan.md)로 분리·해소 진행 중.**
> 나머지 화면(상품·주문·거점·설정)은 차기 세션 논의 대상.

---

## 감사 범위

| 감사 완료 | 미감사 (차기) |
|-----------|--------------|
| 홈·주문 관리·주문 상세·상품 관리·거점 관리·설정 + 공통 컴포넌트 | 온보딩·로그인·상품 등록 폼·admin 8개 페이지 |

---

## 화면별 진단

### 🏠 홈 대시보드 `app/page.tsx`
- 공통 컴포넌트 미적용 — 세션36에서 9개 페이지는 `PageShell`/`PageHeader`로 치환됐는데
  홈은 헤더를 손으로 짬. `Loader`도 인라인.
- 정보 밀도가 얕음 — 메트릭 카드 4개(신규/전체/취소/재고부족)뿐. "오늘 셀러가 할 일"이
  안 보임. 빠른 작업 바로가기 없음.
- `fontSize: 28` 하드코딩.
- → **해소 진행 중**: `seller-home-dashboard-plan.md` T2·T3·T4.

### 📋 주문 관리 `orders/page.tsx`
- 3중 sticky 스택 — 헤더 + 요약바 + 탭이 모두 고정. 모바일 주문 목록 가시 영역 축소.
- 요약바와 상태 탭이 기능 중복 — 둘 다 탭 전환 트리거이고 숫자도 동일.
- sticky 좌표 매직넘버 — `top: 57`·`top: 114`로 헤더 높이에 하드코딩 의존.
- `fontSize: 14/20/13` 하드코딩 다수.

### 📄 주문 상세 `orders/[id]/page.tsx`
- not-found 화면을 손으로 짬 — 공통 `EmptyState` 미사용.
- 액션 버튼이 페이지 하단 inline — sticky bottom action bar 아님, 긴 주문은 스크롤 필요.
- `fontSize: 14` 하드코딩.

### 🛍 상품 관리 `products/page.tsx`
- Badge를 버튼으로 사용 — `판매 중`(상태 표시)·`수정`·`삭제`가 전부 같은 pill 모양.
  상태 표시인지 액션인지 구별 불가.
- 삭제가 네이티브 `confirm()` — 주문 취소는 Modal을 쓰는데 불일치.
- 토글/삭제 에러를 카드 내부 텍스트로 표시 (notification 미사용).

### 🏢 거점 관리 `hubs/page.tsx`
- 데이터 패턴 불일치 — raw `apiFetch` 사용 (#CL-32 기준은 `apiJson`). 삭제도 `confirm()`.
- 카드 제목 `hub.name`이 `fw-medium` — 상품/주문 카드 제목은 `fw-bold`. 위계 불일치.

### ⚙️ 설정 `settings/page.tsx`
- 하드코딩 hex — chevron SVG `stroke="#9CA3AF"`가 3곳 반복 (토큰 위반). 같은 SVG 3회 복붙.

---

## 앱 전반 패턴 (cross-cutting)

| # | 패턴 | 영향 |
|---|------|------|
| A | 공통 컴포넌트 미적용 잔여 — 홈, 주문상세 not-found | 일관성·유지보수 |
| B | 탭 스타일 2종 혼재 — 주문(검정 underline) vs 상품·정산(초록 underline) | 앱 정체성 불일치 |
| C | 하드코딩 잔여 — `fontSize` 숫자·hex·sticky 매직넘버 | 디자인 시스템 위반 |
| D | 액션 어포던스 약함 — Badge-as-button, `confirm()` vs Modal 혼재 | 셀러 오조작 위험 |
| E | 정보 구조 — 홈 대시보드 얕음, 주문 3중 sticky 중복 | 핵심 동선 비효율 |

> A·E의 "홈" 부분은 `seller-home-dashboard-plan.md`로 흡수됨. 잔여는 B·C·D +
> A(주문상세) + E(주문 sticky).

---

## 제안 우선순위 (차기 세션 논의용)

1. **1순위 — 일관성 기반 정비 (B·A·C)**: 탭 스타일 단일화, 주문상세 공통 컴포넌트
   치환, 하드코딩 토큰화.
2. **2순위 — 액션 어포던스 (D)**: 상품 카드 Badge→버튼 분리, `confirm()`→Modal 통일.
3. **3순위 — 정보 구조 (E)**: 주문 페이지 3중 sticky 정리.

---

## 홈 플랜과의 정합성 메모

홈 대시보드 플랜(T1~T8)과 본 감사의 차기 항목은 대부분 다른 파일이라 순서 무관.
파일 2개만 양쪽이 접촉(충돌 아님):

- `settings/page.tsx` — 홈 플랜 T5가 "거점 관리" 항목 추가. T5에서 chevron SVG
  (C항목)를 함께 컴포넌트화·토큰화할 것 (안 하면 차기 세션이 3개 대신 4개 정리).
- `orders/page.tsx` — 홈 플랜 T7(연결 인디케이터)과 E항목(3중 sticky)이 같은 파일.
  순차 편집이라 무충돌.

> SSOT 추적: `docs/BACKLOG.md` §11-3 UX-07~10.

# 세션39 진입 가이드 — 셀러 홈 대시보드 재구성 구현

> 작성: 2026-05-18 (세션38 종료 시) · SSOT: `docs/specs/frontend/seller-home-dashboard-plan.md`
> 선행: 세션38 — 셀러 홈 대시보드 + 준비 물량 재구성 **플랜 수립**(코드 변경 없음).
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝 타입체크 통과 후 다음.

---

## 배경

세션38은 사용자와의 논의로 셀러앱 UX 재구성 플랜을 확정했다(코드 미착수):

- 셀러앱 전체 페이지 UX 감사 → **3대 문제** 도출: 홈 고아 페이지, 정보 밀도 부족,
  준비 물량 파편화(주문 건별로 흩어져 한눈에 안 보임).
- 네이버 스마트스토어센터 대시보드 벤치마크.
- **설계 결정 6가지(D1~D6)** + **아토믹 태스크 8개(T1~T8)** 확정.

본 세션은 이 플랜의 **T1부터 순차 구현**한다. 플랜 SSOT는
`docs/specs/frontend/seller-home-dashboard-plan.md` — 모든 결정·근거·집계 로직 수록.

---

## 핸드오프 — 잔여 P3 작업 2건

| 우선 | 항목 | 비고 |
|------|------|------|
| 🟢 P3 | **셀러 홈 대시보드 재구성** (세션38 플랜) | 8 아토믹 태스크. 본 세션 우선 |
| 🟢 P3 | Driver Kakao Maps SDK 연동 | 세션37·38 연속 이월. 신규 SDK — 키 발급·표시 범위 선결 |

---

## 셀러 홈 대시보드 — 핵심 결정 요약

| | 결정 |
|---|------|
| D1 | 홈 진입점 — PageHeader 중앙 홈 아이콘 (좌측 뒤로가기와 분리) |
| D2 | 홈 = 오늘 할 일 카드 + 현황 카드 3개(주문/정산/상품) |
| D3 | 홈 카드 기준 = "변하는 현황이 있는 영역만" — 설정·거점 제외 |
| D4 | BottomNav 재구성 — 거점 탭→설정 하위, 준비 탭(`/prep`) 신설 |
| D5 | 준비 물량 탭 — 주문을 `productId`별 집계. 오늘분/지연분 분리 |
| D6 | 상단 아이콘 그리드 폐기 |

태스크: T1 헤더 홈 아이콘 → T2 DashboardCard+홈 셸 → T3 오늘 할 일 →
T4 현황 카드 3개+`useDashboardSummary` → T5 BottomNav 재구성+거점 이동 →
T6 준비 물량 탭 → T7 연결 인디케이터 정리 → T8 타입체크+e2e. (상세는 spec 참조)

---

## T0. 착수 전 확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 167/0 유지 확인 — `gh run list --workflow=e2e.yml`.
  - gh CLI: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출).
  - 베이스라인: run 25970814882 (167 passed / 0 failed / 11 skipped).
- [ ] `docs/memory.md`(51라인)·`CRITICAL_LOGIC.md`(311라인) 한도 여유 확인.
- [ ] **T5 주의**: BottomNav 거점 탭 제거는 e2e 셀렉터에 영향 가능 — 거점 관련
  spec 사전 점검. 또한 T5가 `settings/page.tsx`를 건드리므로 chevron SVG
  하드코딩(`#9CA3AF` 3곳)을 함께 컴포넌트화·토큰화할 것 (감사 C항목).
- [ ] **T6 주의**: 준비 물량 집계의 공동구매 포함 여부는 착수 시 확정
  (spec D5 "구현 확인" 메모 — 공동구매 배송일은 `groupProductConfig` 별도 fetch 필요).

---

## 세션 종료 시

- [ ] `docs/specs/frontend/seller-home-dashboard-plan.md` — 처리한 T 체크박스 갱신.
- [ ] **D4 네비게이션 IA 재구성 구현 시 `CRITICAL_LOGIC.md` #CL-33 등재**
  (현재 #CL-32까지 — IA 결정이라 정본 기록 필요).
- [ ] `docs/BACKLOG.md` §12 처리 항목 체크 + §12 헤더 갱신.
- [ ] `docs/memory.md` 세션39 갱신 + `session40-prep.md` 작성.

## 참조

- 플랜 SSOT: `docs/specs/frontend/seller-home-dashboard-plan.md`
- 후속 BACKLOG: 당일 배송 컷오프(§12-1 P4), UX 감사 후속(§11-3 UX-07~10)
- 셀러앱 UX 감사 전문(상품·주문·거점·설정 화면별 진단·우선순위): `docs/specs/frontend/seller-ux-audit.md`
- seller 프론트 구조(#CL-32): `apiJson`·공통 UI 컴포넌트·`useAdminList`·`useOrderStatusUpdate`
- 베이스라인 풀런: run 25970814882 (167 passed / 0 failed / 11 skipped)

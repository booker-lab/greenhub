# 다음 세션 작업 목록

> 최종 수정: 2026-05-08 (세션18 종료)
> e2e: 169 passed / 1 flaky(retry pass) / 8 skipped — 전체 통과

---

## ⚡ 세션19 시작 시 즉시 할 일

### 1. 실 검증 (눈으로 직접 확인)

> 상세 가이드: `docs/specs/session18-visual-verify.md`

`https://seller.greenlove.co.kr` 에서 아래 6개 기능을 브라우저로 직접 확인:

| 기능 | 확인 위치 | 핵심 체크 |
|------|-----------|-----------|
| ① Firebase 429 fix | 로그인 → Console | 에러 없음 |
| ② G2 상품명 | `/orders/[id]` | "상품명" 라벨 + 실제 이름 |
| ③ preparedAt UI | 주문 상세 → 준비 시작 | 버튼 3개 출현 |
| ④ B1 온보딩 pre-fill | `/onboarding` | 기존 데이터 자동 채워짐 |
| ⑤ B2 에러 피드백 | `/products` | 뱃지·버튼 정상 |
| ⑥ G3 날짜 선택기 | `/settlements` 일별 탭 | date input 존재·max 오늘 이하 |

---

## 🔜 다음 개발 작업 (우선순위 순)

### 🔵 G1 — 거점 수정 페이지
- `seller/app/hubs/[id]/page.tsx` 신규
- 거점 상세 조회 + 수정 폼 (이름·주소·운영시간·슬롯 cap)
- `PATCH /hubs/:hubId` API 연동

### 🔵 Driver — Kakao Maps SDK 연동
- `/map` 페이지에 카카오 지도 렌더링
- 배송 경로 표시 + 현재 위치 마커

### 🔵 기간별·주문별 정산 탭 필터
- `settlements/page.tsx` 기간별 탭: 시작~종료 date range picker
- 주문별 탭: 날짜 필터 + 주문 ID 검색

### 🟡 외부 대기 항목 (승인 후 착수)
- 네이버페이 채널키 발급 → Vercel 환경변수 연결
- 알리고↔카카오 알림톡 연동 → 사업자등록증 발급 후

---

## ✅ 세션18 완료 항목 (참고)

| 항목 | 커밋 |
|------|------|
| Firebase 429 fix — FirebaseReadyContext 도입 | `3a8f6fc` |
| G2: 주문 상세 상품명 표시 | `3a8f6fc` |
| preparedAt 빠른 선택 UI (KST-aware UTC) | `3a8f6fc` |
| B1: 온보딩 pre-fill + GET /stores/:storeId API | `3a8f6fc` |
| B2: 상품 토글·삭제 에러 피드백 | `3a8f6fc` |
| G3: 일별 정산 날짜 선택기 (SSR-safe) | `3a8f6fc` |
| e2e 스펙 4종 신규 (31 tests) | `3a8f6fc` |
| e2e beforeEach 타임아웃 25s + /home 패턴 수정 | `11d99c2` |

# 다음 세션 작업 목록

> 최종 수정: 2026-05-09 (세션19 종료)
> e2e: 169 passed / 1 flaky(retry pass) / 8 skipped (세션18 기준, 세션19 보안 패치 후 미검증)

---

## ⚡ 세션20 시작 시 즉시 할 일

### 1. 보안 패치 e2e 회귀 검증

세션19에서 Next.js 16.2.5 + React 19.2.6 + login 리팩토링이 이루어졌으므로
기존 e2e 전체가 정상 통과하는지 확인이 필요합니다.

```bash
pnpm --filter e2e test
```

핵심 확인 항목:

| 스펙 파일 | 확인 포인트 |
|-----------|-------------|
| seller-auth-invite | credentials 로그인 폼 정상 동작 (login/_form.tsx 분리 후) |
| consumer-auth | credentials 로그인 + Open Redirect 방지 |
| consumer-cart / seller-orders | proxy.ts 인증 보호 경상 유지 |

### 2. 보안 헤더 시각 확인

배포된 사이트에서 DevTools → Network → 응답 헤더 확인:
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=63072000; ...`

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

## ✅ 세션19 완료 항목 (보안 패치)

| 항목 | 내용 |
|------|------|
| Next.js 16.2.1 → 16.2.5 | CVE 6건(High) 포함 12건 패치 |
| React 19.2.4 → 19.2.6 | react-server-dom-* 취약점 패치 |
| HTTP 보안 헤더 | 3앱 next.config.ts — X-Frame-Options, HSTS 등 5종 추가 |
| auth.ts 강화 | `secret: process.env.AUTH_SECRET` + `trustHost: true` (3앱) |
| login 서버 컴포넌트 분리 | consumer·seller — NEXT_PUBLIC_E2E_TEST 제거, E2E_TEST 단일화 |
| API CORS 강화 | production 환경에서 origin:null 요청 차단 |
| Vercel 환경변수 | AUTH_SECRET 3앱 추가, E2E_TEST Preview 전용, NEXT_PUBLIC_E2E_TEST 삭제 |
| Railway 확인 | NODE_ENV=production 기설정 확인 |

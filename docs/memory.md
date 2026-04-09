# Green Hub — 프로젝트 메모리 (2026-04-09)

## 완료 현황

| 단계 | 상태 |
|------|------|
| 모노레포 + API + Consumer + Seller + Driver 앱 | ✅ |
| 카카오페이 결제 E2E (웹훅 → 주문 확정) | ✅ 2026-04-09 |
| 보안 취약점 11건 + 부작용 버그 5건 + RT 버그 3건 수정 | ✅ 2026-04-09 |

## 배포 URL

- Consumer: https://greenlove.co.kr
- Seller: https://seller.greenlove.co.kr
- Driver: https://driver.greenlove.co.kr
- API: https://api-production-13e7.up.railway.app

## 다음 할 일

1. **Seller 주문 목록** — 재로그인 후 실시간 노출 확인
2. **순수 consumer 계정** — 다른 카카오 계정으로 greenlove.co.kr 로그인
3. **Driver E2E** — 별도 카카오 계정 필요
4. **네이버페이** — 승인 이메일 후 채널키 연결

## 핵심 기술 결정

| 항목 | 내용 |
|------|------|
| Webhook 서명 | 헤더 없으면 스킵(WARN), 있으면 HMAC-SHA256 검증 |
| Firebase Auth | seller 앱만 Custom Token — onAuthStateChanged로 race condition 방지 |
| Refresh Token | Firestore `refreshTokens/{userId}` rotation — DB에 없으면 허용(구버전 호환) |
| PENDING 타임아웃 | 15분 크론잡 → CANCELLED + 자동 환불 |
| admin storeId | seller 앱에서 `dear-orchid` 폴백 |

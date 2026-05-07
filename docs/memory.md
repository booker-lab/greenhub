# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/memory_archive_20260425.md`

최종 수정: 2026-05-08 (세션17 — G4 셀러앱 홈 대시보드 구현 + e2e 검증)

---

## ✅ 완료된 작업 (세션17까지)

| 항목 | 완료일 |
|------|--------|
| Consumer/Seller/Driver 디자인 시스템 + 성능 최적화(53→99) | 2026-04-25~28 |
| PWA RSC CORS 수정 + 상품등록 버그 4건 | 2026-04-28~05-01 |
| DS 리팩토링(18건) + 툴체인(TruffleHog·Just·Biome) + a11y(38건) | 2026-05-02~03 |
| e2e 전체 스펙 구축 (consumer 60pass · seller 54pass · driver 25pass) | 2026-05-03~05 |
| OrderGroup 리팩토링 + seller-orders e2e 22개 스펙 확장 | 2026-05-06 |
| 그릴 세션(11·12) — e2e 전략·배포인프라·대시보드+주문 플로우 UX 확정 | 2026-05-07 |
| **BUG-SEC: 초대 토큰 검증** + next-auth beta.31 업데이트 | 2026-05-08 |
| **E2E_TEST 게이팅** + consumer 인증 e2e 10케이스 + Vercel 검증 | 2026-05-08 |
| **G4: 셀러앱 홈 대시보드** — 지표카드 4개 + 딥링크 + e2e 10케이스 | 2026-05-08 |

---

## 🔜 다음 세션 작업 순서 (즉시 착수)

### 🟢 1순위 — 셀러앱 주문 플로우 UX (그릴 확정)
- **G2** `seller/app/orders/[id]/page.tsx:286` — raw Firebase ID → 상품명 교체
- 주문 상세 preparedAt 빠른 선택지 UI (오늘 2시/4시/내일 오전)
- **B1** `seller/app/onboarding/page.tsx` — 사업자 프로필 빈 폼 수정 (기존 데이터 pre-fill)

### 🟢 2순위 — 셀러앱 나머지 버그·기능
- **B2** `seller/app/products/page.tsx:169` — 토글·삭제 에러 피드백
- **G3** `seller/app/settlements/page.tsx:122` — 일별 정산 날짜 선택기

### 🔵 향후 과제
- G1: `seller/app/hubs/[id]` 거점 수정 페이지
- Driver Kakao Maps SDK 연동
- 택배 API 연동 (규모 확장 시)
- 셀러앱 UX 방향 확정 후 구현

### 외부 대기
- 네이버페이 채널키 승인 → Vercel 환경변수
- 알리고↔카카오 연동 → 사업자등록증 발급 후

---

## e2e 커버리지 (2026-05-08 세션17 기준)

| 파일 | 상태 |
|------|------|
| consumer-home·groupbuy·auth·product-detail·search | ✅ |
| consumer-design-system | ✅ 28/28 |
| consumer-cart·mypage·checkout | ✅ 비인증 + 인증 (44/44) |
| seller-design-system | ✅ 26/26 |
| seller-orders | ✅ 24/24 |
| seller-product-create | ✅ 16/16 |
| seller-auth-invite | ✅ 8/8 |
| **seller-home-dashboard** | ✅ 10케이스 (17 clean + 3 flaky retry pass) |
| driver-design-system·driver | ✅ |

---

## 툴체인·성능·배포

| 항목 | 값 |
|------|-----|
| TruffleHog 3.95.2 / Just 1.50.0 / Biome 2.4.14 | ✅ |
| next-auth | 5.0.0-beta.31 (consumer·seller·driver) |
| Lighthouse Performance | 99 (기준선 53) |
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` |
| Vercel Seller | `https://seller.greenlove.co.kr` |

---

## 핵심 기술 특이사항

- **gemini-3-flash-preview**: 유효한 모델명, 변경 금지
- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수
- **useStoreProducts firebaseReady 가드 금지**: 이중 인스턴스 버그
- **aggressiveFrontEndNavCaching: false**: 변경 금지 (RSC CORS 재발)
- **DS 폰트 예외**: BottomNav/ProductTopBar(10px), 주문상태뱃지(12px), 카운트다운(13px)
- **공동구매 CONFIRMED**: 시스템 자동 (선착순 + 매 1분 크론) — 셀러 수동 확정 없음
- **preparedAt**: 분단위 피커 폐기 → 빠른 선택지 UI (오늘 2시/4시/내일 오전) 확정
- **카카오 이메일**: scope 미포함 시 null → `token.email ?? session.user.email`
- **seller register inviteToken**: seller role 가입 시 필수, consumer·driver는 불필요
- **Portone V2**: `PORTONE_V2_SECRET`·`PORTONE_WEBHOOK_SECRET(whsec_...)` `apps/api/.env` 반영 완료
- **orders ?tab= 딥링크**: `useSearchParams` 대신 `window.location.search` 사용 (Next.js Suspense 빌드 에러 방지)
- **seller/app/page.tsx**: 서버→클라이언트 컴포넌트 전환 완료, `useOrders`+`useStoreProducts` 실시간 연동

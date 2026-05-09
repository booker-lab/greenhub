# apps/consumer 빌드 플랜
> 작성일: 2026-03-26 | 최종 수정: 2026-03-27 (안티그래비티 세션) | **상태: 인프라 완료 / UI 구현 중**

> [!IMPORTANT]
> VSCode Claude 세션 복귀 시 이 파일을 먼저 확인하세요.
> **다음 착수 작업: Phase A-1 — `src/components/BottomNav.tsx` 생성**

---

## 현재 확정된 키 & 환경변수

### 포트원 (준비 완료)
```env
# apps/api/.env
PORTONE_API_KEY=imp56354122
PORTONE_API_SECRET=qF2Y80J76TPZaj1SmKQdpdp2bmQT0hdzm3kKimwtwdVRYkxhffJuSQ7eqhufRqDTleV1G4uVru5qVpeb

# apps/consumer/.env.local
NEXT_PUBLIC_PORTONE_STORE_ID=store-0ab5cf00-f559-43af-a914-cc14bcdf3897
NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY=channel-key-ae182d30-7754-4d66-9d49-99c849f2b4ad
NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY=   ← 네이버페이 파트너 가입 후 등록
```

### 미발급 (Step별 시점에 등록)
```env
# apps/consumer/.env.local
NEXTAUTH_SECRET=          ← openssl rand -base64 32 으로 생성
NEXTAUTH_URL=http://localhost:3000

KAKAO_CLIENT_ID=          ← Kakao Developers 앱 등록 후
KAKAO_CLIENT_SECRET=      ← 동일

NAVER_CLIENT_ID=          ← Naver Developers 앱 등록 후
NAVER_CLIENT_SECRET=      ← 동일

NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=green-e4fe3
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

---

## 화면 구조 (IA 기반)

### 하단 탭 5개
| 탭 | 경로 | 주요 컴포넌트 |
|----|------|--------------|
| 홈 | `/` | 큐레이션 배너, 인기상품, 이벤트 배너 |
| 카테고리 | `/category` | 대/중/소분류, 색상 필터 |
| 검색 | `/search` | 키워드 검색 |
| 장바구니 | `/cart` | 상품 목록, 수량 조절 |
| 마이페이지 | `/mypage` | 내 정보, 주문내역, A2HS 버튼 |

### 서브 화면
| 화면 | 경로 |
|------|------|
| 로그인 | `/login` |
| 상품 상세 | `/products/[id]` |
| 결제 | `/checkout` |
| 주문 완료 | `/order/success` |
| 주문 현황 | `/mypage/orders/[id]` |
| 배송지 관리 | `/mypage/addresses` |
| 환불 계좌 | `/mypage/refund-account` |

---

## 작업 순서

### ✅ Step 0 — 사전 준비 (완료)
- [x] Firebase 클라이언트 SDK 키 → `.env.local` 등록 (Vercel 환경변수 10개 등록)
- [x] `apps/consumer/.env.local` 파일 생성

### ✅ Step 1 — Next.js 스캐폴딩 (완료)
- [x] `src/app/`, `src/components/`, `src/hooks/`, `src/lib/` 구조 생성
- [x] `next-auth@beta`, `firebase`, `@portone/browser-sdk`, `@greenhub/shared` 설치

### ✅ Step 2 — PWA 기반 구성 (완료)
- [x] `@ducanh2912/next-pwa` 설치
- [x] `public/manifest.json`, `public/icons/icon-192x192.png`, `icon-512x512.png`
- [x] `src/components/A2HSButton.tsx` 구현
- ⚠️ **주의**: Turbopack 충돌 → `--webpack` 플래그 필수 (`dev-consumer.bat` 적용 완료)

### ✅ Step 3 — NextAuth.js v5 인증 (완료)
- [x] `src/auth.ts` — Credentials Provider (이메일/비밀번호 → `POST /auth/login`)
- [x] `src/app/api/auth/[...nextauth]/route.ts`
- [x] `src/proxy.ts` (구 middleware.ts — Next.js 16 파일명 변경)
- ⏸ 카카오·네이버 OAuth — 클라이언트 키 발급 후 주석 해제 예정

### ✅ Step 4 — Firestore 실시간 리스너 (완료)
- [x] `src/lib/firebase.ts` — 클라이언트 SDK 초기화
- [x] `src/hooks/useGroupProduct.ts` — 공동구매 참여 인원 리스너
- [x] `src/hooks/useDailyCap.ts` — Daily Cap 잔여량 리스너
- [x] `src/hooks/useOrderStatus.ts` — **REST API 폴링 3초** (PWA SW 충돌로 onSnapshot 대체)

### ✅ Step 5 — 결제 플로우 Portone V2 (완료)
- [x] `src/hooks/usePayment.ts` — `PortOne.requestPayment()` 래퍼
- [x] `src/app/checkout/page.tsx` — 결제 화면
- [x] `src/app/order/success/page.tsx` — 주문 완료 화면
- [x] `src/app/login/page.tsx` — 로그인 화면
- [x] KakaoPay 3,100원 실결제 E2E 테스트 통과 (2026-03-27)

---

## ✅ Phase A — 구매 퍼널 UI (완료)

### A-1. 공통 레이아웃
- [x] `src/components/BottomNav.tsx` — 5탭 하단 탭바 (홈·카테고리·검색·장바구니·마이페이지)
- [x] `src/app/layout.tsx` — BottomNav 삽입

### A-2. 홈 화면 `/`
- [x] 공동구매 상품 목록 (Firestore `groupProducts` 컬렉션)
- [x] 큐레이션 배너
- [x] 인기상품 섹션

### A-3. 상품 상세 `/products/[id]`
- [x] 상품 이미지 / 이름 / 가격
- [x] 공동구매 참여 인원 실시간 (`useGroupProduct` 재활용)
- [x] Daily Cap 잔여량 실시간 (`useDailyCap` 재활용)
- [x] `GroupBuyOptionSheet` — 수량·동의 체크박스
- [x] 장바구니 담기 / 바로 결제

### A-4. 장바구니 `/cart`
- [x] 담긴 상품 목록 (localStorage useCart 연동)
- [x] 수량 조절 / 삭제 / 합계
- [x] 결제 버튼 → `/checkout`

---

## ✅ Phase B — 마이페이지 서브 화면

- [x] `/mypage` — 주문 목록 + 프로필 + 로그아웃 (2026-03-29)
- [x] `/mypage/orders/[id]` — 상태 타임라인 + 픽업 코드 + 구매 확정 버튼 (2026-03-29)
- [x] `/mypage/addresses` — 배송지 관리 (`PATCH /auth/me/addresses/:id/default` 포함) ✅ 2026-04-01
- [x] `/mypage/notifications` — 알림 내역 (`GET /notifications/me`) ✅ 2026-04-01

---

## 🔲 Phase C — 카테고리·검색

- [ ] `/category` — 대/중/소분류 필터
- [ ] `/search` — 키워드 검색

---

## API 베이스 URL

```env
NEXT_PUBLIC_API_URL=http://localhost:3001   # 개발
# NEXT_PUBLIC_API_URL=https://api-production-13e7.up.railway.app  # 배포
```

## 미결 사항 (블로커)

| 항목 | 상태 |
|------|------|
| 카카오 OAuth Client ID/Secret | ⏸ Kakao Developers 앱 등록 필요 |
| 네이버 OAuth Client ID/Secret | ⏸ Naver Developers 앱 등록 필요 |
| 포트원 네이버페이 채널 키 | ⏸ 파트너 가입 후 |


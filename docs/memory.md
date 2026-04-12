# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-12 (색상 필터 + 정렬 + 드라이버 레이아웃 통일)

## ⚡ 다음 세션 즉시 착수 포인트

### 1순위 — 네이버페이 채널키 연결 (승인 이메일 수신 후)
- Portone 콘솔 → `NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY` Vercel consumer 환경변수 추가

### 2순위 — 네이버페이 재심사
- footer 사업자 정보 추가 (상호/대표자/사업자번호/통신판매업번호)

### 3순위 — 테스트 상품 정리
- Seller에서 등록한 테스트 상품("필터테스트", "asdf") 삭제 또는 비활성화

---

## 전체 진행 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| 1~82 | 이전 세션 전체 완료 | ✅ |
| 83 | **Consumer 색상 필터** (category/page.tsx 색상 칩 13종 + API colors 파라미터) | ✅ 2026-04-12 |
| 84 | **Consumer/Consumer 상품 최신순 정렬** (createdAt desc) | ✅ 2026-04-12 |
| 85 | **Seller useStoreProducts Timestamp 변환** (Firestore → ISO string) | ✅ 2026-04-12 |
| 86 | **Seller BottomNav max-width 768** | ✅ 2026-04-12 |
| 87 | **Driver 레이아웃 max-width 768 통일** (layout + BottomNav) | ✅ 2026-04-12 |
| 88 | **Driver 브랜드명 수정** (Green Hub → Green Love) | ✅ 2026-04-12 |

---

## 배포 현황

| 항목 | 값 |
|------|-----|
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` (www 리다이렉트) |
| Vercel Seller | `https://seller.greenlove.co.kr` |
| Vercel Driver | `https://driver.greenlove.co.kr` |
| Firebase | `green-e4fe3` · asia-northeast3 |
| GitHub | `booker-lab/greenhub` |

---

## storeId 구조 (최종)

| 항목 | 값 |
|------|-----|
| 운영 storeId (난플렉스) | `80189070-2c3d-45f2-bc11-68a870b13951` |
| admin 유저 uid | `6c176cb5-40e1-4d86-8764-6bc87035503a` |
| 셀러 로그인 | admin 카카오 계정 1개로 seller 앱 운영 |
| 드라이버 로그인 | 미등록 카카오 계정 → role=driver 자동 생성 (MVP 정책) |
| 테스트 계정 | 전체 삭제 완료 |

---

## 기술 특이사항 (누적)

- **브랜드명**: Green Love (UI) / greenlove (도메인·기술) / 그린러브 (한글)
- **Firebase Custom Token**: NestJS string → `res.text()` 사용 (res.json() 불가)
- **Firebase authorized domains**: greenlove.co.kr / seller / driver 모두 등록
- **firebaseReady 패턴**: onSnapshot은 firebaseReady=true 이후에만 시작 (race condition 방지)
- **Firestore SW 충돌**: seller/driver 앱 `worker/index.ts`에 `firestore.googleapis.com` NetworkOnly 등록
- **admin role**: `assertSellerOwnsStore`, `settlements.verifyOwnership` 모두 admin bypass 적용
- **getAllowedTransitions**: admin = seller + driver 전환 모두 허용
- **상품 삭제**: 하드 삭제 (doc.delete())
- **orders.service.ts**: create/query/lifecycle 3개 서비스로 분리
- **네이버페이 코드**: NAVERPAY_CHANNEL_KEY 환경변수 유무로 버튼 자동 노출/숨김
- **Portone v2**: NEXT_PUBLIC_PORTONE_STORE_ID + KAKAOPAY_CHANNEL_KEY
- **PENDING 15분 타임아웃**: 크론잡 매 분 실행 → 자동 CANCELLED + 환불
- **CORS_ORIGIN**: Railway — greenlove.co.kr + www + seller + driver 모두 등록
- **드라이버 MVP 정책**: 카카오 로그인 시 미등록 kakaoId → role=driver + driverApproved:true 자동 생성
- **useStoreProducts**: Firestore Timestamp → ISO string 변환 후 클라이언트 정렬 (복합 인덱스 불필요)
- **colors 필터 파라미터**: `colors[]=` 아님, `colors=` 반복 append (NestJS 배열 파싱)
- **Driver layout**: `apps/driver/src/app/layout.tsx` div maxWidth 768 래퍼 — 각 페이지 수정 불필요
- **driver board/page.tsx**: `'use client'` 필수 — Next.js에서 `dynamic({ssr:false})`는 Server Component 불가

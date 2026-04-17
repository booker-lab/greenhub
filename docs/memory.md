# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-17 (디자인 개편 레이어3 완료)

## ⚡ 다음 세션 즉시 착수 포인트

### 1순위 — Firebase Storage CORS 적용 (seller 이미지 업로드 차단 중)
- cors.json 커밋 완료: `/c/Develop/greenhub/cors.json`
- `winget install Google.CloudSDK` → `gcloud auth login`
- `gcloud storage buckets update gs://green-e4fe3.firebasestorage.app --cors-file=/c/Develop/greenhub/cors.json`

### 2순위 — 네이버페이 채널키 연결 (승인 이메일 수신 후)

### 3순위 — 공동구매 수량 기반 모델 전환 (Phase 2)

---

## 전체 진행 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| 1~94 | 기능 개발 전체 완료 | ✅ |
| 95 | Firebase Storage CORS | ⬜ |
| 96 | Vercel 자동배포 확인 | ✅ 2026-04-16 |
| 97 | 디자인 개편 레이어1 | ✅ 2026-04-17 |
| 98 | 디자인 개편 레이어2 | ✅ 2026-04-17 |
| 99 | 디자인 개편 레이어3 | ✅ 2026-04-17 |

---

## 디자인 개편 완료 현황 (2026-04-17 기준)

**목표 감성**: 마켓컬리 계열 — 프리미엄, 클린, 뉴트럴

### ✅ 레이어 1 (전역 테마)
- 폰트: Pretendard Variable (CDN)
- 배경: body #F5F5F5 / 콘텐츠 #FFFFFF
- Radius: md 절제형, 카드 shadow 위주
- 콘텐츠 폭: consumer/driver 430px / seller 480px

### ✅ 레이어 2 (컴포넌트 마크업)
- BrandHeader: 로고 56px 중앙정렬, 그레이지 배경 #F5F2EE
- ProductCard: 이미지 4:5, shadow 카드, 상품명 md/fw600 > 가격 sm/fw700
- BottomNav (3앱): shadow-top, active fw600, strokeWidth 2.2
- Badge 한글 클리핑: `.m_5add502a { text-box-trim: none }` (Mantine v9)

### ✅ 레이어 3 (페이지 레이아웃)
- **홈**: 배너 accent-bar 카드(brand 좌측 라인), 섹션 Title+Divider
- **상품 상세**: 이미지 4:5, CTA size=lg(바로결제 flex=2), 섹션 Paper bg=gray.0
- **카테고리**: 탭 underline 스타일, 색상 칩 outline ring 30px
- **장바구니**: 합계 dark.8 반전 배경, ActionIcon size=lg
- **마이페이지**: 주문 카드 상태별 accent-bar, STATUS_COLORS Mantine 토큰화
- **주문 상세**: Alert 컴포넌트(blue/red), Mantine Stepper 타임라인
- **셀러 주문 목록**: 주문 카드 accent-bar, 상태 뱃지 색상 정교화(blue/orange/violet/green/red)

---

## 배포 현황

| 항목 | 값 |
|------|-----|
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` |
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

---

## 기술 특이사항 (누적)

- **브랜드명**: Green Love (UI) / greenlove (도메인·기술) / 그린러브 (한글)
- **Firebase Custom Token**: NestJS string → `res.text()` 사용 (res.json() 불가)
- **Firestore SW 충돌**: seller/driver 앱 `worker/index.ts`에 `firestore.googleapis.com` NetworkOnly 등록
- **admin role**: `assertSellerOwnsStore`, `settlements.verifyOwnership` 모두 admin bypass 적용
- **PENDING 15분 타임아웃**: 크론잡 매 분 실행 — 자동 CANCELLED + 환불
- **공동구매 DailyCap 비연계**: `orders-create.service.ts` — saleType=group 시 dailyCap 검증 스킵
- **공동구매 groupBuyConsent**: checkout에서 saleType=group이면 자동 전송
- **공동구매 중복 참여 방지**: 비취소 주문 존재 시 409 / 1인 1개 제한
- **공동구매 isProcessed**: groupProductConfig 생성 시 반드시 false 포함 (크론잡 쿼리 조건)
- **공동구매 cancelOrder**: Firestore 트랜잭션 read 먼저 후 write (순서 위반 시 500)
- **공동구매 마감일시 timezone**: seller 폼에서 `.toISOString()` 변환 후 전송 (KST→UTC)
- **useGroupProduct**: Firestore onSnapshot → Timestamp → ISO string 변환 필수
- **useOrderStatus**: terminal 상태(CANCELLED/DELIVERED/REVIEWED) 도달 시 폴링 중단
- **Firebase Storage CORS**: seller 이미지 업로드 차단 중 — gcloud SDK 설치 후 cors.json 적용 필요
- **Pretendard 폰트**: globals.css CDN import — PWA 오프라인 시 시스템 폰트 fallback
- **콘텐츠 폭 래퍼**: layout.tsx div(maxWidth+backgroundColor) — 각 페이지 Container는 그대로 유지
- **Mantine v9 Badge**: `.m_5add502a`(label 해시)에 `text-box-trim:none` 오버라이드 — 한글 클리핑 방지
- **Mantine v9 클래스명**: `.mantine-*` 정적 셀렉터 없음, 해시 클래스 사용 (`Badge.module.mjs` 참조)
- **SW 캐시 충돌**: 새 배포 후 구 SW가 swe-worker-{hash}.js 못 찾아 SyntaxError → DevTools > SW Unregister + 강력 새로고침
- **레이어3 상태 색상**: STATUS_COLORS 하드코딩 제거, Mantine CSS 변수 토큰 사용
- **레이어3 타임라인**: 커스텀 TimelineStep 제거 → Mantine Stepper 컴포넌트 (consumer 주문 상세)
- **레이어3 accent-bar**: 주문 카드 좌측 `borderLeft: 4px solid {상태별 색상}` 패턴 (consumer + seller)

# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-23 심야 (히어로 배너 관리 기능 구현 + 공구 하이라이트 카드 3등분 고정)

## 이번 세션 완료 내역 (2026-04-23 심야)

| # | 작업 | 결과 |
|---|------|------|
| 1 | Firebase Storage rules `banners/` 경로 추가 + `firebase deploy --only storage` | ✅ |
| 2 | API: `UpsertBannerDto` + `BannerCtaDto` DTO 신규 추가 (중첩 검증 포함) | ✅ |
| 3 | API: `admin.service.ts` `getBanner` / `upsertBanner` 구현 (updatedAt 스트립 패턴) | ✅ |
| 4 | API: `GET /admin/banner`, `PUT /admin/banner` 엔드포인트 (admin 전용) | ✅ |
| 5 | API: `GET /banner` 공개 엔드포인트 (`app.controller.ts` — 인증 없음) | ✅ |
| 6 | Seller: `useAdminBanner` 훅 + `AdminBanner` 인터페이스 (`useAdmin.ts`) | ✅ |
| 7 | Seller: `/admin/banner` 페이지 + 이미지 업로드 UI + 텍스트/CTA 편집 | ✅ |
| 8 | Seller: admin layout 배너 탭 추가 | ✅ |
| 9 | Consumer: `HeroBanner` 컴포넌트 신규 (`isActive === true`일 때만 렌더) | ✅ |
| 10 | Consumer: 홈 공구 하이라이트 카드 — ScrollArea 제거 → `Group grow` 3등분 고정 | ✅ |
| 11 | E2E 검증: 배너 저장·표시·이미지 업로드 전 화면 통과 | ✅ |

---

## 이번 세션 완료 내역 (2026-04-23 야간)

| # | 작업 | 결과 |
|---|------|------|
| 1 | Firestore 마이그레이션 검증 (65건 전 통과, 이미 완료 확인) | ✅ |
| 2 | ProductCard groupSummary 버그 수정 (minQuantity → targetQuantity) | ✅ |
| 3 | useProducts saleType 파라미터 추가 (group/direct + dep array 포함) | ✅ |
| 4 | BottomNav: 검색 탭 → 공구 탭 교체 (5탭 유지, GroupBuyIcon 추가) | ✅ |
| 5 | /groupbuy 전용 페이지 신규 생성 (히어로 배너 + 모집 중/완료 분리 그리드) | ✅ |
| 6 | 홈: 공동구매란 배너 → 공구 하이라이트 가로 스크롤 섹션 교체 | ✅ |
| 7 | 카테고리: 공동구매 탭 추가 + saleType 필터 연동 | ✅ |
| 8 | 타입 체크 통과 + 배포 + greenlove.co.kr 전 화면 검증 | ✅ |

---

## ⚡ 다음 세션 착수 순서

| 순위 | 작업 | 조건 |
|------|------|------|
| 1 | **네이버페이 채널키 연결** | 승인 이메일 수신 후 |
| 2 | **알리고 ↔ 카카오 채널 연동 + 템플릿 심사** | 그린러브 사업자등록증 발급 후 |
| 3 | **SELLER_ORDER_BATCH 스케줄러** | 알림톡 연동 후 |
| 4 | **GreenLoveBrandSection 브랜드 이미지** | 디자이너 이미지 수령 후 |

---

## 이번 세션 완료 내역 (2026-04-23)

| # | 작업 | 결과 |
|---|------|------|
| 1 | ai_product_content.md A2 체크박스 완료 처리 | ✅ varieties 30종 완료 반영 |
| 2 | 알리고 가입 (디어오키드 사업자) | ✅ tazan1988 계정 |
| 3 | 카카오 비즈니스 채널 개설 | ✅ 채널명: 그린러브, ID: greenlove |
| 4 | 알리고 ↔ 카카오 채널 연동 시도 → 사업자인증 필요로 보류 | ⏸ 그린러브 사업자등록증 후 재시도 |
| 5 | **공동구매 수량 기반 전환 구현 완료** | ✅ Phase 0~6 전체 완료, Railway push |
| 6 | Firestore 마이그레이션 실행 (5건) + E2E 검증 6/6 통과 | ✅ 2026-04-23 |
| 7 | 잔존 구 필드명(currentParticipants 등) 코드 3곳 제거 | ✅ |
| 8 | useStoreProducts SW 400 에러 원인 분석 + worker NetworkOnly 확인 | ✅ 브라우저 재시작 시 해소 |

---

## 전체 진행 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| 1~117 | 기능 개발 + AI Phase A~F + 버그수정 다수 | ✅ |
| 118 | 네이버페이 채널키 연결 | ⏳ 승인 이메일 대기 |
| 119 | 카카오 채널 개설 | ✅ 2026-04-23 |
| 120 | 알리고 ↔ 카카오 연동 | ⏸ 사업자등록증 후 |
| 121 | 공동구매 수량 기반 전환 | ✅ 2026-04-23 구현 완료 |
| 122 | Firestore 마이그레이션 적용 + E2E 검증 | ✅ 2026-04-23 완료 (6/6 통과) |
| 123 | 소비자앱 UX 2차 (케어 아이콘 카드 + 썸네일 스트립) | ✅ 2026-04-23 완료 |
| 124 | 공동구매 전용 페이지 분리 (/groupbuy + 홈 하이라이트 + 카테고리 탭) | ✅ 2026-04-23 완료 |
| 125 | 히어로 배너 관리 기능 (admin 편집 + consumer 표시 + Storage rules) | ✅ 2026-04-23 완료 |

---

## 실서비스 오픈 전 체크리스트

| 항목 | 내용 |
|------|------|
| 알리고 선불 충전 | 건당 8~15원, 충전 없이 발송 불가 |
| 카카오비즈니스 사업자 등록 | 그린러브 사업자등록증 발급 후 채널에 등록 |
| 알리고 ↔ 카카오 연동 | `smartsms.aligo.in` → 카카오톡 → 발신프로필 등록 (채널 ID: greenlove) |
| 알림톡 템플릿 심사 | 25개 템플릿, 3~5 영업일 소요 |
| 네이버페이 채널키 | PORTONE_WEBHOOK_SECRET + NAVERPAY_CHANNEL_KEY Railway 설정 |

---

## 배포 현황

| 항목 | 값 |
|------|-----|
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` |
| Vercel Seller | `https://seller.greenlove.co.kr` |
| Firebase | `green-e4fe3` · asia-northeast3 |
| GitHub | `booker-lab/greenhub` |

---

## 기술 특이사항 (누적)

- **브랜드명**: Green Love (UI) / greenlove (도메인·기술)
- **카카오 채널**: ID `greenlove`, URL `http://pf.kakao.com/_vGfjX`
- **알리고 계정**: tazan1988, 디어오키드 사업자 등록 — 그린러브 채널 연동 시 사용 가능
- **Firebase Custom Token**: NestJS string → `res.text()` 사용
- **Firestore SW 충돌**: seller/driver `worker/index.ts`에 `firestore.googleapis.com` NetworkOnly 등록
- **shared/dist**: gitignore 예외(`!packages/shared/dist/`) — **타입 변경 시 반드시 `pnpm --filter @greenhub/shared build` 후 커밋**
- **Railway 자동배포**: GitHub push 시 자동 트리거
- **AI 모델**: `gemini-3-flash-preview` — 정상 작동 확인
- **AI 프롬프트**: `apps/api/src/ai/prompts/product-content.prompt.ts`
- **Gemini JSON 파싱**: 줄바꿈 이스케이프 처리 완료
- **varieties**: availableStemTypes 전 품종 4가지 통일. 30종 Firestore 시드 완료
- **ImageUpload**: 버튼 `type="button"` 필수 / `key={idx}` (position 기반)
- **ProductForm localStorage**: `useState` 초기화가 아닌 `useEffect`에서 복원 (hydration 방지)
- **가격 입력**: Mantine `NumberInput` + `thousandSeparator=","` + `hideControls`
- **공동구매**: 수량 기반 전환 완료 — minQuantity/targetQuantity/maxPerPerson/currentQuantity. Firestore 마이그레이션 스크립트: `scripts/migrate-groupbuy-quantity.mjs`
- **E2E 검증 스크립트**: `scripts/verify-groupbuy-migration.mjs` — Firestore+API 자동 검증 (65건 통과)
- **공동구매 전용 페이지**: `/groupbuy` (모집 중/완료 분리), BottomNav 공구 탭, 홈 가로 스크롤 하이라이트, 카테고리 공동구매 탭 — 모두 `useProducts(category, colors, saleType)` 공통 기반 사용
- **히어로 배너**: Firestore `banners/main_hero` 단일 문서. `GET /banner` 공개 엔드포인트. `isActive: true`일 때만 consumer 앱에 표시. 이미지는 Firebase Storage `banners/main_hero/` 경로에 저장. updatedAt은 서버 관리 — 클라이언트에서 PUT 시 반드시 제거 후 전송 (양방향 방어 패턴).
- **Mantine Group grow**: `ScrollArea` 대신 사용 시 자식 요소 균등 분할. `minWidth: 0` 필수 (flex 자식 shrink). `slice(0, N)`으로 개수 제한.
- **Storage rules**: 상품 이미지 `products/{storeId}/`, 배너 이미지 `banners/` — 둘 다 인증된 사용자 쓰기 허용, 누구나 읽기. 규칙 변경 후 반드시 `firebase deploy --only storage`.
- **ProductCard groupSummary 수량 표시**: `targetQuantity` 기준 (minQuantity 아님)
- **useStoreProducts firebaseReady 가드 금지**: 가드 추가 시 상품 목록 미표시 버그 발생. 원인: 이중 인스턴스. 절대 추가하지 말 것.
- **Vercel SW 400 에러**: `worker/index.ts` NetworkOnly로 수정 완료. 브라우저 재시작 또는 DevTools → "Update on reload" 시 해소.
- **CareLevel 타입 위치**: `product.types.ts`에 정의 (variety.types.ts → 이동). variety.types.ts가 product.types.ts를 import하므로 역방향 시 순환의존 발생.
- **Selection.careLevel 하위 호환**: optional 필드 — 기존 상품은 undefined → 아이콘 카드 미표시. 셀러 수정 저장 시 Firestore에 기록됨.
- **shared 타입 변경 시 필수**: `pnpm --filter @greenhub/shared build` 후 dist 커밋.

# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-25 (디자인 시스템 1~3단계 완료)

## 이번 세션 완료 내역 (2026-04-25)

| # | 작업 | 결과 |
|---|------|------|
| 1 | e2e 전체 검증 — 28개 통과, 4개 스킵(인증 미설정) | ✅ |
| 2 | 프론트엔드 디자인 시스템 방향 확정 (4단계 리팩토링 계획) | ✅ |
| 3 | `docs/specs/design-system.md` 신규 생성 — 지침 전체 문서화 | ✅ |
| 4 | **디자인 시스템 2단계**: `packages/ui/src/style.css` 공통 토큰 생성, `theme.ts` radius 16px·카드 보더 적용, 3개 앱 globals.css 단일화, consumer Geist 폰트 제거 | ✅ |
| 5 | **디자인 시스템 3단계**: consumer 앱 전체 컴포넌트 var() 리팩토링 — BottomNav SVG→Lucide, 그라디언트 제거, 최소폰트 15px 적용, e2e 28개 재검증 통과 | ✅ |

### 확정된 디자인 지침 요약

- **컬러**: 프라이머리 1색 `#2D6A4F` + 화이트 베이스 `#FFFFFF`
- **카드**: 보더(border) 방식, 그림자 금지
- **폰트**: Pretendard 300/500/700 3weight만, 최소 15px
- **아이콘**: Lucide 전용
- **라디우스**: 16px 고정
- **스타일**: `packages/ui/src/style.css` CSS var() 단일 출처, 하드코딩 금지
- **로직 불변**: 디자인 리팩토링 중 비즈니스 로직·훅·API 코드 수정 금지
- **세부 지침**: `docs/specs/design-system.md` 참조

### 리팩토링 4단계 진행 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| 1 | 비주얼 방향 결정 | ✅ |
| 2 | 디자인 시스템 정비 (`style.css` + `theme.ts`) | ✅ |
| 3 | 컴포넌트 구조 개선 (consumer 앱) | ✅ |
| 4 | 모바일 UX 개선 | ⏳ 다음 세션 착수 |

---

## 이번 세션 완료 내역 (2026-04-24)

| # | 작업 | 결과 |
|---|------|------|

| 1 | Seller: 배너 활성화 Switch `e.currentTarget` null 오류 수정 (`setForm({...form, isActive})` 패턴) | ✅ |
| 2 | Seller: `favicon.ico` 404 에러 해결 — consumer 파비콘 복사 | ✅ |
| 3 | Consumer: `ProductCard` 공구 상품 진행률 바 추가 (Mantine Progress, green, sm) | ✅ |
| 4 | Consumer: 홈 `DeadlineSection` 신규 — 마감 24h 이내 공구 가로 스크롤 + 카운트다운 타이머 | ✅ |
| 5 | E2E: Playwright `apps/e2e` 셋업 — consumer·seller·driver 28개 테스트 전 통과 | ✅ |
| 6 | Vercel 빌드 오류 연쇄 수정 — lockfile 미커밋, 잘못된 `.npmrc` 제거 | ✅ |
| 7 | Consumer SW 캐시 문제 진단 — Workbox `bad-precaching-response` 원인 파악, SW Unregister로 해소 | ✅ |
| 8 | Consumer: 공동구매 현황 카드 UI 강화 — 수량 36px 대형 표시, Progress xl, 카운트다운 배지 | ✅ |
| 9 | [향후과제] 공동구매 현황 카드 디자인 재설계 — 벤치마킹 후 착수 예정으로 기록 | 📝 |

---

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
| 126 | Seller 배너 토글 버그 수정 + 파비콘 추가 | ✅ 2026-04-24 완료 |
| 127 | Consumer 공구 카드 진행률 바 + 마감 임박 가로 스크롤 섹션 | ✅ 2026-04-24 완료 |
| 128 | Playwright e2e 테스트 셋업 (28개 통과) | ✅ 2026-04-24 완료 |
| 129 | Consumer 공동구매 현황 카드 UI 강화 (임시) | ✅ 2026-04-24 완료 (재설계 예정) |

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
- **Playwright e2e**: `apps/e2e/` — `pnpm test:e2e` 실행. 인증 필요 테스트는 `TEST_SELLER_EMAIL` / `TEST_SELLER_PASSWORD` / `TEST_DRIVER_EMAIL` / `TEST_DRIVER_PASSWORD` 환경변수 세팅 시 활성화.
- **Vercel 빌드 규칙**: lockfile 변경 커밋 시 반드시 `pnpm-lock.yaml` 함께 커밋. `.npmrc`에 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` 등 env var 형태 키 작성 금지 — pnpm install 오류 유발.
- **Consumer SW 캐시 문제**: 새 배포 후 Workbox `bad-precaching-response` 에러 발생 시 DevTools → Application → Service Workers → Unregister 후 새로고침.
- **Switch onChange 패턴**: `setForm((f) => ({...f, isActive: e.currentTarget.checked}))` 금지 — updater 내부에서 currentTarget은 null. `setForm({...form, isActive: e.currentTarget.checked})` 사용.
- **Vercel SW 400 에러**: `worker/index.ts` NetworkOnly로 수정 완료. 브라우저 재시작 또는 DevTools → "Update on reload" 시 해소.
- **CareLevel 타입 위치**: `product.types.ts`에 정의 (variety.types.ts → 이동). variety.types.ts가 product.types.ts를 import하므로 역방향 시 순환의존 발생.
- **Selection.careLevel 하위 호환**: optional 필드 — 기존 상품은 undefined → 아이콘 카드 미표시. 셀러 수정 저장 시 Firestore에 기록됨.
- **shared 타입 변경 시 필수**: `pnpm --filter @greenhub/shared build` 후 dist 커밋.

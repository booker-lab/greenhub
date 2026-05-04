# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/memory_archive_20260425.md`

최종 수정: 2026-05-05 (세션7)

---

## ✅ 완료된 작업

| 항목 | 커밋 | 완료일 |
|------|------|--------|
| Consumer 디자인 시스템 (T0~T13) | `0ff8ada` | 2026-04-25 |
| Seller/Driver 디자인 시스템 | `e2cccd8` `e64b629` | 2026-04-25 |
| 성능 최적화 1·2·3·6순위 (Perf 53→99) | `b3d0625`~`d8e7d02` | 2026-04-26~28 |
| PWA RSC CORS 수정 | `ccab465` | 2026-04-28 |
| 상품등록 플로우 버그 4건 | `b9f35f4` | 2026-05-01 |
| DS 리팩토링 T0~T9 (위반 18건) + e2e 회귀 스펙 | `9a5d45f`~`3d23fd6` | 2026-05-02 |
| 툴체인 도입 (TruffleHog·Just·Biome) | `0c77aca`~`0a6faa0` | 2026-05-03 |
| a11y 접근성 38건 수정 | `30a21f7`~`988a43f` | 2026-05-03 |
| e2e 실 검증 스펙 추가 (60 pass) + 카카오 이메일 fix | `4b7876d` | 2026-05-03 |
| **세션7: seller/driver e2e 재검증** (38 pass) | — | 2026-05-03 |
| **세션7: Just 1.50.0 재설치 (바이너리 누락 수정)** | — | 2026-05-03 |
| **세션7: 셀러앱 e2e 인증 자동화** (26 pass / 2 skip) | 세션7 | 2026-05-05 |

---

## 🔜 다음 세션 착수 작업

### 1순위 — 최적화 4순위: Driver Kakao Maps 연동
- **선행 조건**: Kakao Developers 콘솔에서 JavaScript 앱 키 발급
- `NEXT_PUBLIC_KAKAO_MAP_KEY` Vercel 환경변수 설정
- `map/page.tsx` 지도 플레이스홀더 → 실제 SDK 연동 + `dynamic()` 분리
- **효과**: Driver 초기 번들 -200KB

### 2순위 — Seller 기능 플로우 e2e 추가
- `seller-orders.spec.ts` — 주문 상태 탭 전환, 카드 렌더링 (인증 포함)
- `seller-product-create.spec.ts` — 상품 등록 폼 렌더링·입력 (submit 전까지)
- 테스트 계정: `seller@test.com` / `test1234` (`apps/e2e/.env` 설정됨)

### 외부 조건 대기

- 네이버페이 채널키 승인 이메일 수신 후 Vercel 환경변수 설정
- 알리고 ↔ 카카오 연동 (사업자등록증 발급 후)

### 향후 조건부 작업

- consumer cart·checkout·mypage 인증 후 e2e (카카오 OAuth 자동화 불가 → 이메일 로그인 추가 시 활성화)

---

## e2e 커버리지 현황 (2026-05-03)

| 파일 | 상태 | 비고 |
|------|------|------|
| `consumer-home` | ✅ | |
| `consumer-groupbuy` | ✅ | |
| `consumer-design-system` | ✅ 28/28 | DS 토큰 T0~T9 |
| `consumer-auth` | ✅ | 로그인 UI, 오픈 리디렉트 방어, 보호경로 |
| `consumer-product-detail` | ✅ | 상세, 뒤로가기, 가격, 담기 버튼, 404 |
| `consumer-cart` | ⚠️ 비인증만 | 인증 후 CRUD 주석 블록 |
| `consumer-checkout` | ⚠️ 비인증만 | storageState 필요 |
| `consumer-search` | ✅ | 검색창, 입력, 초기화 |
| `consumer-mypage` | ⚠️ 비인증만 | storageState 필요 |
| `perf-css-regression` | ✅ | |
| `seller-design-system` | ✅ 26/26 | 인증 후 주문·정산·설정·거점·상품목록 검증 완료 (2026-05-03) |
| `seller-banner` | ✅ | 공개 2개 pass / 배너토글은 admin 권한 필요로 skip |
| `driver-design-system` | ✅ 22/22 | biome·a11y 이후 재검증 완료 (2026-05-03) |
| `driver` | ✅ | 공개 3개 pass |

---

## 툴체인 현황

| 도구 | 상태 | 역할 |
|------|------|------|
| TruffleHog 3.95.2 | ✅ | git 히스토리 시크릿 스캔 |
| Just 1.50.0 | ✅ | 태스크 러너 (Justfile) |
| Biome 2.4.14 | ✅ | consumer/seller/driver 린터+포매터, api 포매터 |

---

## 성능 현황

| 지표 | 기준선(모바일) | 최적화 후 | 목표 |
|------|--------------|----------|------|
| Performance | 53 | **99** | 80+ |
| LCP | 19.2s | **0.9s** | <3s |
| CLS | 0.204 | **0** | ~0 |

---

## 배포 현황

| 항목 | 값 |
|------|-----|
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` |
| Vercel Seller | `https://seller.greenlove.co.kr` |
| Firebase | `green-e4fe3` · asia-northeast3 |

---

## 핵심 기술 특이사항

- **gemini-3-flash-preview**: 유효한 모델명 (2025-12 출시), 변경 금지
- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수
- **useStoreProducts firebaseReady 가드 금지**: 이중 인스턴스로 상품 목록 미표시
- **`<img>` 예외 3곳**: seller onboarding logoPreview, ImageUpload, consumer 상세 이미지 — blob URL
- **Mantine CSS 선택적 import**: `aggressiveFrontEndNavCaching: false` 필수 유지
- **Pretendard 폰트**: `scripts/copy-fonts.cjs` postinstall 자동 실행, git에 woff2 미포함
- **DS 폰트 예외**: BottomNav/ProductTopBar 라벨(10px), 주문상태 뱃지(12px), 카운트다운(13px), Stepper 설명(12px)
- **e2e 미들웨어 보호경로**: `/cart`, `/checkout/*`, `/mypage/*`, `/order/*` → 비인증 시 `/login` 리디렉트 (proxy.ts)
- **카카오 이메일**: scope 미포함 시 null → session 콜백에서 `token.email ?? session.user.email` 처리

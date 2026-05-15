# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/archive/memory_archive_20260425.md`

최종 수정: 2026-05-15 (세션25 — 사전 결함 정리)

---

## ✅ 완료된 작업 (세션22까지)

| 항목 | 완료일 |
|------|--------|
| Consumer/Seller/Driver DS + 성능(53→99) + PWA/CORS + 상품등록 버그 | 2026-04-25~05-01 |
| DS 리팩토링·툴체인·a11y·e2e 전체 구축·OrderGroup 리팩토링 | 2026-05-02~06 |
| BUG-SEC 초대토큰·next-auth beta.31·G4 셀러 대시보드 | 2026-05-08 |
| **세션18**: G2 상품명·preparedAt UI·B1 pre-fill·B2 에러피드백·G3 날짜선택기 | 2026-05-08 |
| **세션19**: 보안 패치 — Next.js 16.2.5 + React 19.2.6 CVE, HTTP 보안헤더, auth.ts 강화 | 2026-05-09 |
| **세션20**: 루트 vercel.json 삭제·Railway CORS fix·login force-dynamic·E2E_TEST 값 수정 | 2026-05-10 |
| **세션21**: 세션20이 남긴 허위 BLOCKER 검증·정정 | 2026-05-10 |
| **세션22**: E2E 보안 결함 정리 — Vercel `E2E_TEST` Production 제거·약한비번 54건 일소·**옵션 B 헤더 게이팅 도입** | 2026-05-10 |
| **세션23**: 셀러 fatal constraint 해소 — `orders/[id]` 629→217·`settlements` 531→116 분할 (#CL-22) | 2026-05-15 |
| **세션24**: 세션23 e2e 회귀 검증 (회귀 0건) + 인증 헬퍼 진단 강화 (#CL-23) | 2026-05-15 |
| **세션25**: 사전 결함 정리 — biome.json 파싱 에러·`.env.vercel.tmp` gitignore·driver Credentials 부재 확인 (#CL-25) | 2026-05-15 |

---

## ✅ 세션22 — 보안 결함 정리 (BLOCKER 해소)

**트랙별 결과**:
- **트랙 1**: seller·consumer Vercel `E2E_TEST` Production env 삭제 + 재배포 → `/login` HTML에서 `type="email"`·`type="password"` 0건 확인
- **트랙 2**: `scripts/delete-test-accounts.mjs --apply`로 54건 user + 2건 refreshToken 삭제. seller@test.com만 보존 결정. 새 e2e consumer로 `consumer@test.com` 생성(test1234 — 사용자 결정, 강한비번 권장은 follow-up). `seller-auth-invite.spec.ts`에 `afterAll` cleanup + `scripts/cleanup-spec-residue.mjs` 헬퍼 추가
- **트랙 3 옵션 B**: `E2E_TEST_SECRET` 32자 6환경 적용. `auth.ts`(seller·consumer) Credentials Provider 상시 등록 + `request.headers.get('x-e2e-test-token')` 검증. `apps/e2e/tests/_helpers/auth.ts` + `playwright.config.ts extraHTTPHeaders` 도입. 12개 spec helper migration 완료
- **트랙 4 통합 검증 5종**: 폼 노출 0, 약한비번 401, 보존 200, Firestore email-provider 2건(seller·consumer), 헤더 없는 credentials 호출 → `error=CredentialsSignin` ✓

**상세 설계**: [docs/CRITICAL_LOGIC.md](CRITICAL_LOGIC.md) #CL-20 (옵션 B), #CL-21 (옵션 A 향후 과제)
**원본 가이드**: [docs/archive/sessions/session22-prep.md](archive/sessions/session22-prep.md)

---

## 후속 기능 작업 순서

- G1: `seller/app/hubs/[id]` 거점 수정 페이지
- Driver Kakao Maps SDK 연동
- 네이버페이 채널키 승인 → Vercel 환경변수
- 옵션 A 보강 (#CL-21) — Production env에서 `E2E_TEST_SECRET` 제거 + Preview env 분리 (4단계 다중 PR — 세션25 #CL-25 검증 결과)
- e2e 인증 인프라 race 해소 (#CL-23) — storageState 패턴 도입 + Railway `/auth/login` 계측

---

## e2e 인증 패턴 (옵션 B 이후)

| 항목 | 값 |
|------|-----|
| 헬퍼 | `apps/e2e/tests/_helpers/auth.ts` `loginViaCredentials(page, base, email, password)` |
| 호출 패턴 | `test.beforeEach`에서 1줄 호출 (NextAuth `/api/auth/csrf` + `/api/auth/callback/credentials` 직접) |
| 헤더 주입 | helper의 csrf GET + credentials POST 두 호출에만 명시적 (`headers: { 'x-e2e-test-token': SECRET }`) — **전역 extraHTTPHeaders 사용 금지** (Firebase Identity Toolkit 등 third-party API에 헤더가 따라가 CORS preflight 차단됨) |
| 검증 통과 | seller-orders 12/12, consumer-cart·checkout·mypage·seller-onboarding 각 1 |

---

## 툴체인·배포

| 항목 | 값 |
|------|-----|
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` |
| Vercel Seller | `https://seller.greenlove.co.kr` |
| next-auth | 5.0.0-beta.31 |
| Lighthouse Perf | 99 |

---

## 핵심 기술 특이사항

- **login/page.tsx (seller·consumer)**: `export const dynamic = 'force-dynamic'` — 옵션 B 도입 후 폼 노출은 항상 false지만 force-dynamic은 유지(런타임 env 평가 보장)
- **E2E_TEST_SECRET**: Vercel seller·consumer × Production·Preview·Development 6환경 동일값. `apps/{seller,consumer}/.env.local`·`apps/e2e/.env`에도 동일값. 32자 base64. **MVP 출시 시 #CL-20 정리표대로 삭제**
- **Railway CORS**: no-origin 요청 허용(헬스체크) — `if (!origin) return callback(null, true)` 유지 필수
- **gemini-3-flash-preview**: 유효한 모델명, 변경 금지
- **aggressiveFrontEndNavCaching: false**: 변경 금지 (RSC CORS 재발)
- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수
- **useStoreProducts firebaseReady 가드 금지**: 이중 인스턴스 버그
- **DS 폰트 예외**: BottomNav/ProductTopBar(10px), 주문상태뱃지(12px), 카운트다운(13px)
- **공동구매 CONFIRMED**: 시스템 자동 (선착순+크론) — 셀러 수동 확정 없음
- **preparedAt**: 빠른 선택지 UI (오늘 2시/4시/내일 오전) 확정
- **seller register inviteToken**: seller role 가입 시 필수
- **Portone V2**: PORTONE_V2_SECRET·PORTONE_WEBHOOK_SECRET `apps/api/.env` 반영 완료
- **orders ?tab= 딥링크**: `window.location.search` 사용 (Suspense 빌드 에러 방지)
- **proxy.ts**: Next.js 16 미들웨어 컨벤션 파일명, 정상 동작
- **AUTH_SECRET**: 3앱 Vercel 설정 완료

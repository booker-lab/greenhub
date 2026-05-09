# 세션22 — E2E 보안 결함 정리 결과 보고

> 작성: 2026-05-10 (세션22 종료 시점)
> 입력 가이드: [session22-prep.md](session22-prep.md) (세션21에 작성)
> 결정 문서: [../CRITICAL_LOGIC.md](../CRITICAL_LOGIC.md) #CL-19 (SUPERSEDED) · #CL-20 (옵션 B) · #CL-21 (옵션 A 향후 과제)

---

## 결과 요약

| 항목 | 결과 |
|------|------|
| BLOCKER 해소 | ✅ 프로덕션 이메일 폼 노출 차단, 약한비번 잔존 일소, e2e 인증 복구 |
| 트랙 1 (즉시 차단) | ✅ Vercel `E2E_TEST` Production env 삭제(seller·consumer) + 재배포 |
| 트랙 2 (계정 정리) | ✅ 약한비번 54건 + refreshTokens 2건 삭제. 보존 2건(seller·consumer) |
| 트랙 3 옵션 B (헤더 게이팅) | ✅ `auth.ts`(seller·consumer) Credentials 상시 등록 + 헤더 검증 |
| e2e migration | ✅ 12개 spec을 `loginViaCredentials` 헬퍼로 통일 (`page.fill` 폼 입력 패턴 폐기) |
| 트랙 4 (통합 검증 5종) | ✅ 모두 통과 |
| 트랙 5 (메모리·문서) | ✅ #CL-19 SUPERSEDED + #CL-20·#CL-21 추가, memory.md 88줄, auto-memory 4건 갱신 |
| 추가: consumer@test.com 비번 강화 | ✅ `test1234` → `test1234!` (COMMON_WEAK 사전 미매칭) |
| 추가: Firebase CORS 부수효과 진단·해결 | ✅ `extraHTTPHeaders` 전역 주입 → helper 명시 주입으로 전환 |
| 최종 e2e | ✅ seller-orders 12/12 passed, 핵심 spec(consumer-cart·checkout, seller-onboarding) 각 1 passed |

---

## 사용자 결정 4건 (세션 시작 시)

| # | 결정 | 결과 반영 |
|---|------|----------|
| 1 | `test@test.com`·`test@example.com` 처리 | 둘 다 `EXPLICIT_DELETE_EMAILS`에 추가, 삭제됨 |
| 2 | consumer 인증 e2e 처리 | (b) 새 e2e consumer 발급 — `consumer@test.com` 신규 생성 |
| 3 | 옵션 A vs B 우선순위 | **B 진행** + A는 #CL-21 향후 과제로 기록 |
| 4 | `seller-auth-invite.spec.ts` afterEach cleanup 포함 여부 | 포함 — `afterAll` + `scripts/cleanup-spec-residue.mjs` |

세션 중 추가 결정 (충돌·정합성 검토에서 도출):
- 5. 기존 `consumer@test.com`(약한비번 미상) 처리 → EXPLICIT_DELETE 추가 후 새로 register
- 6. 새 consumer 비번 → `test1234` 우선(편의), 막판에 `test1234!`로 강화
- 7. seller-orders empty state 실패 진단 → 옵션 B 부수효과 아닌 것 확인 후 helper 명시 주입으로 해결

---

## 통합 검증 5종 (세션 종료 시점 기준)

| # | 검증 항목 | 결과 |
|---|-----------|------|
| 1 | `curl https://seller.greenlove.co.kr/login` `type="email"`/`type="password"` 카운트 | seller 0 / consumer 0, 카카오 버튼 1 |
| 2 | Railway `/auth/login` 약한비번(`e2e.consumer@test.com`·`customer@test.com`·`consumer-sec-…@example.com`/test1234·password123) | 모두 401 |
| 3 | Railway `/auth/login` 보존 계정(`seller@test.com`/test1234, `consumer@test.com`/test1234!) | 둘 다 200 |
| 4 | Firestore email-provider count | 2건 (seller@test.com, consumer@test.com) |
| 5 | NextAuth `/api/auth/callback/credentials` 헤더 게이팅 | 헤더 없음 → `Location: /login?error=CredentialsSignin&code=credentials`, 정상 SECRET → `Location: <callbackUrl>` |

---

## 트랙 1 — 즉시 차단 (5분)

**조치**: seller·consumer Vercel Production env에서 `E2E_TEST` 키 삭제 → 빈 커밋(`169ed50`)으로 재배포 트리거 → 두 deployment Ready 후 `/login` HTML 검증.

**커밋**: `169ed50 chore: trigger redeploy after E2E_TEST production env removal`

**검증**:
- seller deployment: 9m 전 Ready (1m 빌드)
- consumer deployment: 9m 전 Ready (57s 빌드)
- 폼 카운트 0/0, 카카오 버튼 1 (양 도메인)

---

## 트랙 2 — 약한비번 일소 (10분)

**조치**:
1. `scripts/delete-test-accounts.mjs`의 `EXPLICIT_DELETE_EMAILS`에 5건 추가(test@test.com, test@example.com, 그 후 충돌 발견되어 consumer@test.com도 추가)
2. dry-run으로 매칭 54건 확인 (storeId 보유 0건 — 안전)
3. `--apply` 실행 → users 54건 + refreshTokens 2건 삭제
4. Railway `/auth/login`으로 약한비번 401 + 보존 200 검증
5. `consumer@test.com` 신규 register (`/auth/register` POST, role=consumer, password=test1234)
6. `apps/e2e/.env`의 `TEST_CONSUMER_EMAIL` 갱신
7. `seller-auth-invite.spec.ts`에 `test.afterAll` cleanup 추가 + `scripts/cleanup-spec-residue.mjs` 신규 (PROTECT 가드 + ALLOWED_PATTERN 정규식 검증)

**산출 스크립트**:
- `scripts/delete-test-accounts.mjs` (신규)
- `scripts/diagnose-email-accounts.mjs` (세션21 작성, 이번 세션 commit)
- `scripts/diagnose-test-account.mjs` (세션21 작성, 이번 세션 commit)
- `scripts/delete-seller-test-account.mjs` (세션21 작성, 이번 세션 commit)
- `scripts/cleanup-spec-residue.mjs` (신규 — afterAll 호출용)

**검증**:
- 잔여 email-provider 계정: seller@test.com (test1234) + consumer@test.com (이후 test1234! 로 강화)
- e2e.consumer@test.com → 401 ✓ / seller@test.com → 200 ✓

---

## 트랙 3 옵션 B — 헤더 게이팅 (30분~)

**아키텍처**:
1. `E2E_TEST_SECRET` 32자 base64를 seller·consumer × Production·Preview·Development 6환경 + 로컬 `.env.local`/`.env`에 동일값으로 적용 (Vercel CLI에서 preview는 `vercel env add ... preview "" --value <v> --yes` 빈 branch 인자로 우회)
2. `apps/{seller,consumer}/src/auth.ts`의 Credentials Provider를 **상시 등록**하되 `authorize(credentials, request)` 내부에서 `request?.headers?.get('x-e2e-test-token')`이 `process.env.E2E_TEST_SECRET`과 일치할 때만 통과. **SECRET 미설정 시에도 즉시 null** (안전 기본값).
3. `apps/{seller,consumer}/src/app/login/page.tsx`의 `showCredentials` 게이트는 그대로(env 미존재로 항상 false) → 폼 어떤 환경에서도 비노출.
4. `apps/e2e/tests/_helpers/auth.ts`에 `loginViaCredentials(page, base, email, password)` 헬퍼 — NextAuth `/api/auth/csrf` GET + `/api/auth/callback/credentials` POST 직접 호출.
5. 12개 spec의 `page.goto(/login) → page.fill → page.click → waitForURL` 5–6줄 인증 블록을 helper 1줄 호출로 통일.

**migration된 spec**:
- seller(8): orders, banner, home-dashboard, order-detail, onboarding, product-create, design-system, settlements, products
- consumer(3): cart, checkout, mypage
- consumer-auth.spec.ts: 폼 의존 3개 테스트는 이미 `skipEmailForm` 가드로 비활성화 상태 유지 (#CL-20 정리표에 제거 항목으로 등재)

**커밋**: `51971ce feat(security)` + `e684c01 test(e2e): 11개 spec helper migration`

---

## 추가 작업 1 — consumer@test.com 비번 강화

**조치**: `scripts/reset-user-password.mjs` 신규(bcrypt 12 rounds로 Firestore passwordHash 갱신, user_id 유지). `consumer@test.com` 비번을 `test1234` → `test1234!`로 갱신.

**연관 갱신**:
- `apps/e2e/.env` `TEST_CONSUMER_PASSWORD=test1234!` (gitignore)
- `scripts/delete-test-accounts.mjs` `PROTECT_EMAILS`에 `consumer@test.com` 추가, `EXPLICIT_DELETE_EMAILS`에서 제거
- `MEMORY/test_accounts.md` 갱신

**검증**: `/auth/login test1234! → 200`, `test1234 → 401`, consumer-cart e2e 1 passed.

**커밋**: `9b25d20 feat(scripts)`

---

## 추가 작업 2 — Firebase CORS 부수효과 진단·해결

**증상**: seller-orders 12개 중 1개 (`주문 없을 때 empty state 렌더링`)만 timeout. 페이지가 `연결 중`에서 멈추고 데이터 미도착.

**1차 진단 (오류)**: 옵션 B와 무관한 인프라 이슈로 판단, spec skip + memory에 BUG-INFRA로 기록 → 사용자에게 Firebase Console 도메인 인증 확인 요청.

**2차 진단 (정확)**: 사용자가 보내준 스크린샷 3장으로 (1)Firebase Authorized domains 모두 정상 등록 (2)production 카카오 사용자 화면에서 `/orders` 정상 작동 확인. **e2e 한정 문제**임이 명확.

**진짜 원인**: playwright의 `extraHTTPHeaders`는 모든 outgoing fetch에 적용되므로 Firebase Identity Toolkit `signInWithCustomToken` 호출에도 `x-e2e-test-token` 헤더가 따라감 → 이 헤더는 CORS-safelisted가 아니라 **preflight 트리거** → Firebase API의 preflight 응답이 `Access-Control-Allow-Headers`에 해당 헤더 미허용 → 차단.

**해결**:
1. `playwright.config.ts`의 `extraHTTPHeaders` 제거 + 사유 주석
2. `_helpers/auth.ts`에서 csrf GET + credentials POST 두 호출에만 명시적 `headers: { 'x-e2e-test-token': SECRET }` 주입
3. `seller-orders.spec.ts` empty state test.skip 해제 + selector('연결 중' 추가) + polling 패턴

**검증**: Firebase API들이 모두 200 응답 (signInWithCustomToken·accounts:lookup·firestore Listen). seller-orders **12/12 passed (32.9s)**.

**커밋**: `de35d21 fix(e2e): seller-orders empty state 테스트 skip` (1차 잘못된 조치, 후속 commit으로 dehydrated) → `45691c8 fix(e2e): extraHTTPHeaders 제거 + helper 명시 헤더 주입`

---

## 커밋 트레일 (세션22 main 기준)

| 커밋 | 내용 |
|------|------|
| `169ed50` | chore: trigger redeploy after E2E_TEST production env removal |
| `51971ce` | feat(security): 옵션 B 헤더 게이팅 도입 + 약한비번 일소 인프라 |
| `e684c01` | test(e2e): 11개 spec helper migration — 옵션 B 헤더 게이팅에 정합 |
| `8bf1c19` | docs(session22): 보안 결함 정리 마무리 — 결정·메모리·진단 스크립트 보존 |
| `9b25d20` | feat(scripts): consumer@test.com 비번 강화 + reset-user-password 헬퍼 추가 |
| `de35d21` | fix(e2e): seller-orders empty state 테스트 skip + Firebase CORS 이슈 기록 |
| `45691c8` | fix(e2e): extraHTTPHeaders 제거 + helper 명시 헤더 주입 — Firebase CORS 차단 해소 |

---

## 자가 검증 프로토콜 (CLAUDE.md)

| 항목 | 결과 |
|------|------|
| 단일 파일 500라인 초과 여부 | ✅ 모두 미만 (CRITICAL_LOGIC.md 1263줄은 결정 누적 문서, 제한 외) |
| memory.md 200라인 가드 | ✅ 88라인 |
| 작업 완료 체크박스 | ✅ 트랙별 todo + AskUserQuestion 결정 추적 |

---

## 후속 작업 (별도 세션)

1. **driver app 옵션 B 적용** — driver/auth.ts는 Credentials Provider 자체가 없어 e2e 인증 불가 (현재 driver는 카카오 OAuth 전용)
2. **옵션 A 보강 (#CL-21)** — Production env에서 `E2E_TEST_SECRET` 제거 + Preview alias 분리. 21개 spec BASE 환경변수화 작업 포함
3. **MVP 출시 직전 #CL-20 정리표 실행** — Credentials Provider·SECRET·헬퍼·게이트·spec 일괄 제거

---

## 산출 자산 (커밋 보존)

- `scripts/diagnose-email-accounts.mjs` — email-provider 전수 + bcrypt sweep
- `scripts/diagnose-test-account.mjs` — 단일 계정 점검 (read-only)
- `scripts/delete-seller-test-account.mjs` — 단발(이미 적용된 seller_test@greenhub.dev)
- `scripts/delete-test-accounts.mjs` — 다중 정리 (dry-run 기본 + `--apply`)
- `scripts/cleanup-spec-residue.mjs` — spec afterAll에서 호출하는 mini cleanup
- `scripts/reset-user-password.mjs` — Firestore passwordHash bcrypt 12 갱신 (재사용)
- `apps/e2e/tests/_helpers/auth.ts` — `loginViaCredentials` 헬퍼 (옵션 B 인증 표준)
- `docs/specs/session22-prep.md` — 세션21이 작성한 사전 가이드
- `docs/specs/session22-result.md` — 본 문서 (세션22 결과)

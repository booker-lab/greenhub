# 세션22 — E2E 게이팅 보안 결함 정리 준비

> 작성: 2026-05-10 (세션21)
> 트리거: 세션19~20 보안 작업 부수효과로 Vercel Production env에 `E2E_TEST=true`가 영구 박혀 일반 사용자에게 이메일 로그인 폼이 노출됨
> 목표: 프로덕션은 카카오 OAuth만 노출 + e2e용 게이트는 외부 노출 0

---

## 진단 요약 (세션21 검증)

| 항목 | 상태 | 비고 |
|------|------|------|
| Vercel `E2E_TEST=true` Production | seller·consumer 양쪽 (driver는 미설정) | 48~49분 전 추가 — `5a4e4a5` 커밋 시점 |
| 폼 노출 (HTML curl) | seller·consumer 둘 다 input[type=email/password] 노출 | 즉시 차단 필요 |
| `seller_test@greenhub.dev` (난플렉스) | **세션21에 삭제 완료** (API 401 검증됨) | store는 보존 |
| 약한 비번(test1234) 잔존 | `seller@test.com`, `consumer_test@…`, `customer@test.com`, `e2e.consumer@test.com` | seller@test.com만 보존 결정됨 |
| 약한 비번(password123) 잔존 | `*-sec-*@example.com` 51개 | [seller-auth-invite.spec.ts:50,66](../../apps/e2e/tests/seller-auth-invite.spec.ts) 가 매 실행마다 등록만 하고 정리 안 함 |
| 추가 의심 계정 | `test@test.com`, `test@example.com` (consumer) | 약한 비번 미적중, 정체 불명 — 사용자 확인 필요 |
| 옵션 B 기술 검증 | `authorize(credentials, request: Request)` — 헤더 접근 가능 | [@auth/core/providers/credentials.d.ts:64-65](../../node_modules/.pnpm/@auth+core@0.41.2/node_modules/@auth/core/providers/credentials.d.ts) |

---

## 사전 준비물 (세션21 산출물)

| 자산 | 경로 | 상태 |
|------|------|------|
| Firestore 진단 (단일 계정) | `scripts/diagnose-test-account.mjs` | read-only, 사용 가능 |
| Firestore 진단 (전체 email-provider) | `scripts/diagnose-email-accounts.mjs` | read-only + bcrypt sweep |
| 단일 계정 삭제 스크립트 (적용 완료) | `scripts/delete-seller-test-account.mjs` | seller_test@greenhub.dev 삭제용 |
| **다중 계정 삭제 스크립트** | `scripts/delete-test-accounts.mjs` | dry-run 기본, `--apply`로 실행 |

---

## 미해결 결정 사항 (세션22 시작 시 사용자 확인)

1. **`test@test.com`·`test@example.com` 처리**: 명시 삭제 리스트에 포함할까?
2. **consumer 인증 e2e** (cart·checkout·mypage 3 spec)
   - (a) 영구 비활성화 — `apps/e2e/.env`의 `TEST_CONSUMER_EMAIL` 제거
   - (b) 새 e2e consumer 계정 발급 + 강력한 비번 + Vercel env에 추가
   - (c) spec 자체 폐기 (코드 삭제)
3. **옵션 A vs B 우선순위**: 단기 차단 후 곧바로 옵션 A(env 분리)로 갈지, 옵션 B(헤더 게이팅)로 직행할지
4. **seller-auth-invite.spec.ts 잔여물 방지**: spec 자체에 `afterEach` cleanup 추가하는 작업을 세션22에 포함할지

---

## 트랙 1 — 즉시 차단 (Vercel env 제거)

### T1.1 — seller `E2E_TEST` Production 제거
- 명령: `cd apps/seller && vercel env rm E2E_TEST production --yes`
- 정합성 검증:
  - `vercel env ls production` 출력에 `E2E_TEST` 부재
  - 이전 deployment는 캐시 빌드라 변경 안 보임 → T1.3에서 재배포 필요

### T1.2 — consumer `E2E_TEST` Production 제거
- 명령: `cd apps/consumer && vercel env rm E2E_TEST production --yes`
- 정합성 검증: 위와 동일

### T1.3 — 재배포 트리거
- 옵션 1: `git commit --allow-empty -m "chore: trigger redeploy after E2E_TEST removal" && git push`
- 옵션 2: 각 앱 `.vercel/` 디렉토리에서 `vercel --prod` 직접 실행
- 정합성 검증: Vercel 대시보드에서 새 deployment가 Current로 잡혔는지 확인 (sha 변경)

### T1.4 — 폼 노출 부재 검증
- 명령:
  ```bash
  curl -sS https://seller.greenlove.co.kr/login | grep -c 'type="email"'
  curl -sS https://greenlove.co.kr/login | grep -c 'type="email"'
  ```
- 기대: `0`
- 추가: `curl -X POST https://api-production-13e7.up.railway.app/auth/login -d {seller@test.com 자격}` 은 **여전히 200** (API는 변경 없음 — 의도대로)
- 사용자 시각 확인: 두 도메인 `/login` 새로고침 후 카카오 버튼만 노출

---

## 트랙 2 — 테스트 계정 일괄 정리

### T2.1 — 미해결 결정 사항 1·2 확정
- `test@test.com`, `test@example.com` 포함 여부 결정 → 결정 시 `delete-test-accounts.mjs`의 `EXPLICIT_DELETE_EMAILS` 수정
- consumer e2e 처리 방향 결정

### T2.2 — Dry-run 재실행
- 명령: `node scripts/delete-test-accounts.mjs`
- 정합성 검증:
  - "보존: seller@test.com" 출력 확인
  - 삭제 대상 카운트가 예상과 일치 (현재: 51건 + 결정사항 추가)
  - storeId 보유 계정이 0건 (dry-run에서 확인)

### T2.3 — 실제 삭제
- 명령: `node scripts/delete-test-accounts.mjs --apply`
- 정합성 검증:
  - 종료 메시지 `✅ 삭제 완료 users: N건, refreshTokens: M건`
  - `node scripts/diagnose-email-accounts.mjs` 재실행 → email provider 계정이 1건(seller@test.com) + 사용자 결정 잔존만

### T2.4 — Railway API 차단 확인
- 명령:
  ```bash
  curl -X POST https://api-production-13e7.up.railway.app/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"e2e.consumer@test.com","password":"test1234"}'
  ```
- 기대: `HTTP 401`

### T2.5 — seller@test.com 보존 검증
- 명령: 위와 동일하되 `seller@test.com / test1234`
- 기대: `HTTP 200 + accessToken` (e2e 회복용)

### T2.6 — `seller-auth-invite.spec.ts` 잔여물 방지 (선택)
- spec에 `test.afterEach`로 등록한 user 즉시 삭제하는 cleanup 추가
- 미래의 잔여물 방지

---

## 트랙 3 — 옵션 A 또는 B (정상 e2e 복구)

> 트랙 1 적용 후 e2e 인증 테스트는 **모두 깨짐** (`E2E_TEST` 미설정 → Credentials Provider 미등록 → 폼 미노출). 이를 정상화하기 위한 트랙.

### 옵션 A — Preview env로 분리

#### T3A.1 — e2e BASE URL 21개 환경변수화
- 21개 spec 파일의 `const BASE = '...'` 하드코딩을 제거
- `apps/e2e/.env`에 `SELLER_BASE`, `CONSUMER_BASE`, `DRIVER_BASE` 추가
- 각 spec: `const BASE = process.env.SELLER_BASE!`
- 정합성: `cd apps/e2e && npx playwright test --reporter=list -g 'render'` 등 가벼운 테스트 통과

#### T3A.2 — Preview env에 `E2E_TEST=true` 추가
- 명령: `vercel env add E2E_TEST preview` (값: `true`) — seller·consumer 양쪽
- 정합성: `vercel env ls preview` 출력에 `E2E_TEST` 존재

#### T3A.3 — e2e 타겟을 Preview deployment URL로
- 어려운 부분: PR마다 Preview URL이 바뀜 → 안정 alias 필요
- 방안: branch alias (`vercel alias set <preview-url> e2e-seller.vercel.app`) 또는 PR에서 e2e 실행 시 deployment URL을 동적으로 받기
- 정합성: Preview 빌드 후 `curl <preview-url>/login | grep -c 'type="email"'` = 1

#### T3A.4 — e2e 재실행
- `cd apps/e2e && SELLER_BASE=<preview-url> CONSUMER_BASE=<preview-url> npx playwright test`
- 기대: 인증 테스트 통과율이 세션21 검증 수준 회복

### 옵션 B — 헤더 기반 게이팅 (권장)

#### T3B.1 — 비밀 토큰 도입
- Vercel env에 `E2E_TEST_SECRET=<32자 랜덤>` 추가 — Production·Preview·Dev 동일값 (seller·consumer)
- 로컬 `.env`에도 추가

#### T3B.2 — `apps/{seller,consumer}/src/auth.ts` 변경
- Credentials Provider를 **항상 등록**
- `authorize(credentials, request)` 첫 줄에서 `request.headers.get('x-e2e-test-token')` 검증, 불일치 시 즉시 `null` 반환
- 정합성: 토큰 없는 요청은 401, 토큰 일치 요청만 통과

#### T3B.3 — login 페이지 게이팅
- 페이지 폼은 **여전히 안 노출** — `process.env.E2E_TEST === 'true'`는 그대로 두거나 다른 cookie 기반 게이트로
- e2e는 폼 없이 NextAuth `signIn` API 직접 호출하거나, hidden form 패턴
- 정합성: 일반 사용자 시각으로 폼 안 보임

#### T3B.4 — `playwright.config.ts`에 헤더 주입
```ts
use: {
  extraHTTPHeaders: {
    'x-e2e-test-token': process.env.E2E_TEST_SECRET!,
  },
}
```
- 정합성: Playwright의 모든 요청에 헤더 자동 추가

#### T3B.5 — e2e 통합 검증
- `npx playwright test seller-orders --reporter=line` → 11+ passed 회복
- `curl <prod>/login` 별도 검증 → 폼 미노출 유지

---

## 트랙 4 — 정합성 통합 검증 (Cross-cutting)

각 트랙 종료 시 마지막에 다음 4개 블랙박스 검증을 실행:

1. **HTML curl**: `curl -sS https://seller.greenlove.co.kr/login | grep -c 'type="email"'` = 0
2. **API 약한 비번 시도**:
   ```
   curl -X POST <api>/auth/login -d '{"email":"e2e.consumer@test.com","password":"test1234"}'
   ```
   = 401
3. **API 보존 계정**:
   ```
   curl -X POST <api>/auth/login -d '{"email":"seller@test.com","password":"test1234"}'
   ```
   = 200 (seller 보존)
4. **Firestore email-provider count**: `node scripts/diagnose-email-accounts.mjs` → 보존 1건 + 사용자 결정 잔존만

---

## 안전 가드 요약

- 모든 삭제 스크립트는 **dry-run 기본**, `--apply` 명시 필요
- `PROTECT_EMAILS` 리스트로 `seller@test.com` 보호 (defensive 검증 + 매칭 단계)
- storeId 보유 계정은 별도 표시 + `--include-stored` 명시 시에만 처리
- Vercel env 변경 후 즉시 재배포 트리거 (변경이 캐시 빌드에 안 들어가면 무용)
- 트랙별 정합성 검증을 건너뛰지 않음

---

## 진행 순서 권고

1. **T1.1 → T1.2 → T1.3 → T1.4** (보안 노출 즉시 차단)
2. 미해결 결정 사항 1·2 확인
3. **T2.1 → T2.2 → T2.3 → T2.4 → T2.5** (잔여 약한 비번 정리)
4. 옵션 A or B 결정 → 트랙 3 진행 (정상 e2e 복구)
5. 트랙 4 통합 검증
6. 메모리 및 `docs/memory.md` 갱신

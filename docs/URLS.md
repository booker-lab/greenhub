# Green Hub — 서비스 URL 마스터 레퍼런스

> **이 파일이 모든 환경변수 설정의 기준(SSOT)입니다.**
> URL 변경 시 반드시 이 파일을 먼저 수정하고, 아래 체크리스트를 따르세요.

---

## Production URL (확정)

| 서비스 | URL |
|--------|-----|
| **Consumer 앱** | `https://greenlove.co.kr` |
| **Seller 앱** | `https://seller.greenlove.co.kr` |
| **Driver 앱** | `https://driver.greenlove.co.kr` |
| **Railway API** | `https://api-production-13e7.up.railway.app` |

> 도메인 연결 완료: 2026-04-06 (가비아 greenlove.co.kr → Vercel)

---

## 도메인 연결 체크리스트 (완료)

> 구입처: 가비아(gabia.com) · 도메인: `greenlove.co.kr` · 만료: 2027-04-06

- [x] STEP 1 — Vercel 3개 앱 도메인 추가
- [x] STEP 2 — 가비아 DNS 레코드 설정
- [x] STEP 3 — Vercel 환경변수 `NEXTAUTH_URL` 3개 앱 수정 + Redeploy
- [x] STEP 4 — Railway `CORS_ORIGIN` 업데이트
- [x] STEP 5 — 카카오 개발자 콘솔 Redirect URI 추가
- [x] STEP 6 — 전 구간 접속 검증 완료

---

## 가비아 DNS 레코드 (확정)

| 타입 | 호스트 | 값 | TTL |
|------|--------|----|-----|
| A | `@` | `216.198.79.1` | 1800 |
| CNAME | `seller` | `8839be1a99af91d5.vercel-dns-017.com.` | 1800 |
| CNAME | `driver` | `fbf792e03b40869b.vercel-dns-017.com.` | 1800 |

---

## 환경변수 현재 상태

### Vercel 환경변수

> 적용 환경은 2026-07-01 `vercel env ls` 기준이다. 값 자체는 내려받지 않았다.

| 앱 | 변수명 | 문서 기준값 | 적용 환경 |
|----|--------|-------------|-----------|
| consumer | `NEXTAUTH_URL` | `https://greenlove.co.kr` | Production, Preview, Development |
| seller | `NEXTAUTH_URL` | `https://seller.greenlove.co.kr` | Production, Development |
| driver | `NEXTAUTH_URL` | `https://driver.greenlove.co.kr` | Production, Preview, Development |
| 전체 | `NEXT_PUBLIC_API_URL` | `https://api-production-13e7.up.railway.app` | Production, Preview, Development |

### Preview Auth URL 정책

상세 정책은 `docs/specs/ops/preview-auth-url-policy.md`를 따른다.

- Production 로그인은 앱별 production 도메인을 callback 기준으로 유지한다.
- Preview에서 카카오 로그인 완료 smoke가 필요하면 stable branch Preview alias만 승인 대상으로 삼는다.
- 커밋별 Preview URL은 카카오 Redirect URI에 등록하지 않는다.
- `VERCEL_URL`은 커밋별 deployment URL이므로 OAuth callback 기준으로 사용하지 않는다.
- `AUTH_URL`과 `NEXTAUTH_URL`은 같은 의미로 취급하며, 둘을 서로 다른 값으로 두지 않는다.

### Railway 환경변수

| 변수명 | 값 |
|--------|-----|
| `CORS_ORIGIN` | `https://greenlove.co.kr,https://seller.greenlove.co.kr,https://driver.greenlove.co.kr` |

### 카카오 Redirect URI 전체 목록

아래 목록은 production, 기존 Vercel project alias, local 개발 URL만 관리한다. 커밋별 Preview URL은 등록 금지다.
stable branch Preview alias(`*-git-preview-*`)는 Preview 로그인 완료 smoke를 승인할 때만 별도로 추가한다.

- `https://greenlove.co.kr/api/auth/callback/kakao`
- `https://seller.greenlove.co.kr/api/auth/callback/kakao`
- `https://driver.greenlove.co.kr/api/auth/callback/kakao`
- `https://greenhubconsumer.vercel.app/api/auth/callback/kakao`
- `https://greenhub-seller.vercel.app/api/auth/callback/kakao`
- `https://greenhub-driver.vercel.app/api/auth/callback/kakao`
- `http://localhost:3000/api/auth/callback/kakao`
- `http://localhost:3002/api/auth/callback/kakao`
- `http://localhost:3003/api/auth/callback/kakao`

---

## 로컬 개발 포트 규칙

| 앱 | 포트 |
|----|------|
| consumer | `http://localhost:3001` |
| seller | `http://localhost:3002` |
| driver | `http://localhost:3003` |
| API | `http://localhost:3000` |

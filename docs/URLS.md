# Green Hub — 서비스 URL 마스터 레퍼런스

> **이 파일이 모든 환경변수 설정의 기준(SSOT)입니다.**
> URL 변경 시 반드시 이 파일을 먼저 수정하고, 아래 체크리스트를 따르세요.

---

## 확정 Production URL (커스텀 도메인 적용 후)

| 서비스 | 신규 URL (목표) | 현재 URL (Vercel 기본) |
|--------|----------------|----------------------|
| **Consumer 앱** | `https://greenlove.co.kr` | `https://greenhubconsumer.vercel.app` |
| **Seller 앱** | `https://seller.greenlove.co.kr` | `https://greenhub-seller.vercel.app` |
| **Driver 앱** | `https://driver.greenlove.co.kr` | `https://greenhub-driver.vercel.app` |
| **Railway API** | (변경 없음) | `https://api-production-13e7.up.railway.app` |

> 도메인 연결 완료 후 "현재 URL" 열 삭제 예정.

---

## 도메인 연결 체크리스트

> 구입처: 가비아(gabia.com) · 도메인: `greenlove.co.kr` · 만료: 2027-04-06

### STEP 1 — Vercel 도메인 추가 (각 앱 반복)

- [ ] consumer 프로젝트 → Settings → Domains → `greenlove.co.kr` 추가
- [ ] seller 프로젝트 → Settings → Domains → `seller.greenlove.co.kr` 추가
- [ ] driver 프로젝트 → Settings → Domains → `driver.greenlove.co.kr` 추가
- Vercel이 표시하는 DNS 레코드 값을 복사해 STEP 2에서 사용

### STEP 2 — 가비아 DNS 설정

가비아 My가비아 → 도메인 관리 → greenlove.co.kr → DNS 관리 → 레코드 추가

| 타입 | 호스트 | 값 | TTL |
|------|--------|----|-----|
| A | @ | `76.76.21.21` (Vercel 안내값 확인) | 600 |
| CNAME | seller | `cname.vercel-dns.com` | 600 |
| CNAME | driver | `cname.vercel-dns.com` | 600 |
| CNAME | www | `cname.vercel-dns.com` | 600 |

> Vercel이 안내하는 실제 값이 다를 수 있으니 반드시 Vercel 화면의 값 우선 적용.

- [ ] 레코드 저장 후 Vercel에서 Verify 클릭
- [ ] 초록 체크 표시 확인 (5분~48시간 소요)

### STEP 3 — Vercel 환경변수 업데이트

각 앱 Settings → Environment Variables:

| 앱 | 변수명 | 변경 값 |
|----|--------|--------|
| consumer | `NEXTAUTH_URL` | `https://greenlove.co.kr` |
| seller | `NEXTAUTH_URL` | `https://seller.greenlove.co.kr` |
| driver | `NEXTAUTH_URL` | `https://driver.greenlove.co.kr` |

- [ ] 3개 앱 모두 수정 후 Redeploy

### STEP 4 — Railway CORS_ORIGIN 업데이트

Railway 대시보드 → API 서비스 → Variables:

```
CORS_ORIGIN=https://greenlove.co.kr,https://seller.greenlove.co.kr,https://driver.greenlove.co.kr
```

- [ ] 저장 (자동 재시작)

### STEP 5 — 카카오 개발자 콘솔

developers.kakao.com → 앱 선택:

**앱 설정 → 플랫폼 → Web → 사이트 도메인 추가:**
- `https://greenlove.co.kr`
- `https://seller.greenlove.co.kr`
- `https://driver.greenlove.co.kr`

**카카오 로그인 → Redirect URI 추가 (기존 유지):**
- `https://greenlove.co.kr/api/auth/callback/kakao`
- `https://seller.greenlove.co.kr/api/auth/callback/kakao`
- `https://driver.greenlove.co.kr/api/auth/callback/kakao`

- [ ] 저장

### STEP 6 — 검증

- [ ] `https://greenlove.co.kr` → 소비자 앱 로딩 + HTTPS 자물쇠
- [ ] `https://seller.greenlove.co.kr` → 판매자 앱 로딩 + HTTPS 자물쇠
- [ ] `https://driver.greenlove.co.kr` → 드라이버 앱 로딩 + HTTPS 자물쇠
- [ ] 카카오 로그인 → 콜백 정상 처리
- [ ] 소비자 앱 주문 생성 → API 정상 응답 (CORS 확인)

### STEP 7 — 코드 반영 (연결 완료 후)

- [ ] 이 파일 URL 표 정리 (현재 URL 열 삭제)
- [ ] git commit & push

---

## 환경변수 최종 상태 (도메인 연결 완료 후 목표)

### Vercel 환경변수

| 앱 | 변수명 | 값 |
|----|--------|-----|
| consumer | `NEXTAUTH_URL` | `https://greenlove.co.kr` |
| seller | `NEXTAUTH_URL` | `https://seller.greenlove.co.kr` |
| driver | `NEXTAUTH_URL` | `https://driver.greenlove.co.kr` |
| 전체 | `NEXT_PUBLIC_API_URL` | `https://api-production-13e7.up.railway.app` |

### Railway 환경변수

| 변수명 | 값 |
|--------|-----|
| `CORS_ORIGIN` | `https://greenlove.co.kr,https://seller.greenlove.co.kr,https://driver.greenlove.co.kr` |

### 카카오 Redirect URI 전체 목록

- `https://greenlove.co.kr/api/auth/callback/kakao`
- `https://seller.greenlove.co.kr/api/auth/callback/kakao`
- `https://driver.greenlove.co.kr/api/auth/callback/kakao`
- `http://localhost:3001/api/auth/callback/kakao`
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

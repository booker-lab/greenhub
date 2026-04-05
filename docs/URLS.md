# Green Hub — 서비스 URL 마스터 레퍼런스

> **이 파일이 모든 환경변수 설정의 기준(SSOT)입니다.**
> URL 변경 시 반드시 이 파일을 먼저 수정하고, 아래 체크리스트를 따르세요.

## 확정 Production URL

| 서비스 | URL |
|--------|-----|
| **Consumer 앱** | `https://greenhubconsumer.vercel.app` |
| **Seller 앱** | `https://greenhub-seller.vercel.app` |
| **Driver 앱** | `https://greenhub-driver.vercel.app` |
| **Railway API** | `https://api-production-13e7.up.railway.app` |

## 환경변수 설정 체크리스트

URL 변경 시 아래를 모두 업데이트해야 합니다.

### Vercel 환경변수 (각 앱 대시보드 → Settings → Environment Variables)

| 앱 | 변수명 | 값 |
|----|--------|-----|
| consumer | `NEXTAUTH_URL` | `https://greenhubconsumer.vercel.app` |
| seller | `NEXTAUTH_URL` | `https://greenhub-seller.vercel.app` |
| driver | `NEXTAUTH_URL` | `https://greenhub-driver.vercel.app` |
| consumer/seller/driver | `NEXT_PUBLIC_API_URL` | `https://api-production-13e7.up.railway.app` |

### Railway 환경변수 (대시보드 → Variables)

| 변수명 | 값 |
|--------|-----|
| `CORS_ORIGIN` | `https://greenhubconsumer.vercel.app,https://greenhub-seller.vercel.app,https://greenhub-driver.vercel.app` |

### 카카오 개발자 콘솔 (developers.kakao.com)

Redirect URI 등록 목록:
- `https://greenhubconsumer.vercel.app/api/auth/callback/kakao`
- `https://greenhub-seller.vercel.app/api/auth/callback/kakao`
- `https://greenhub-driver.vercel.app/api/auth/callback/kakao`
- `http://localhost:3001/api/auth/callback/kakao`
- `http://localhost:3002/api/auth/callback/kakao`
- `http://localhost:3003/api/auth/callback/kakao`

## 로컬 개발 포트 규칙

| 앱 | 포트 |
|----|------|
| consumer | `http://localhost:3001` |
| seller | `http://localhost:3002` |
| driver | `http://localhost:3003` |
| API | `http://localhost:3000` |

# 성능 최적화 5순위 — www 리디렉션 제거

> 작성: 2026-04-27
> 목표: www.greenlove.co.kr 접속 시 apex 리디렉션 RTT 제거 → FCP -500~800ms 전 앱

---

## 정합성 검토

### 현황 파악

- **Vercel Consumer**: `greenlove.co.kr` (apex) = primary
- **www.greenlove.co.kr**: Vercel 대시보드에서 apex로 301 리디렉션 중 (추정)
- **현재 vercel.json**: redirects 설정 없음 → 대시보드 도메인 설정에 의존
- **Lighthouse "Avoid multiple page redirects"**: 리디렉션 체인 감지 시 FCP 지연 경고

### 리디렉션이 느린 이유

```
사용자 → www.greenlove.co.kr
         ↓ (301 Redirect, ~50~200ms RTT)
사용자 → greenlove.co.kr → 실제 페이지 로드
```

첫 DNS lookup + TCP handshake + 리디렉션 응답 대기 = **추가 RTT 1회**

### 설계 결정

- **apex(`greenlove.co.kr`)를 primary로 유지** — SEO, 쿠키 범위, 기존 링크 호환성
- www 접속은 Vercel 대시보드에서 즉시 리디렉션하되, **Vercel Edge에서 처리**되므로 서버 코드 변경 불필요
- `next.config.ts`의 `redirects()`는 **Next.js 서버를 거쳐야** 하므로 Vercel 도메인 설정보다 느림 → 사용 금지

### 주의사항

- Seller(`seller.greenlove.co.kr`)는 서브도메인이므로 www 이슈 없음
- Driver 앱도 별도 도메인 확인 필요
- Vercel 대시보드 작업이 주이므로 코드 변경 최소화

---

## 아토믹 태스크

### T0 — 현재 리디렉션 체인 진단 (착수 전 필수)

```bash
# 실제 리디렉션 경로 확인
curl -I https://www.greenlove.co.kr 2>&1 | grep -E "HTTP|Location"
curl -I https://greenlove.co.kr 2>&1 | grep -E "HTTP|Location"
```

확인 항목:
- www → apex 301/308 몇 번 발생하는지
- HTTP → HTTPS 리디렉션 체인 있는지 (`http://` 접속 시)
- Lighthouse 감사 결과의 "Avoid multiple page redirects" 항목

**이 결과 없이 T1 진행 금지**

---

### T1 — Vercel 대시보드 도메인 설정 최적화

**위치**: Vercel 대시보드 → greenhubconsumer → Settings → Domains

작업 내용:
1. `www.greenlove.co.kr` 도메인이 등록되어 있는지 확인
   - 미등록 시: Add Domain → `www.greenlove.co.kr` → "Redirect to greenlove.co.kr" 선택
   - 등록 시: Redirect 설정이 308(영구)인지 확인 (301보다 빠름)
2. `http://greenlove.co.kr` → `https://greenlove.co.kr` 리디렉션이 Vercel에서 자동 처리되는지 확인

**정합성 주의**: Vercel은 www 리디렉션을 CDN 엣지에서 처리하므로 next.config.ts 수정 불필요.

---

### T2 — next.config.ts HSTS 헤더 추가 (선택적, HTTP→HTTPS 반복 방지)

T0에서 HTTP→HTTPS 리디렉션이 반복 발생한다고 확인될 경우에만 적용.

```ts
// next.config.ts
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
  // ... 기존 설정
}
```

**정합성**: Vercel은 HTTPS를 기본 강제하므로 이미 적용된 상태일 가능성 높음 → T0 결과 확인 후 결정.

---

### T3 — tsc + 빌드 검증 (T2 적용 시)

```bash
pnpm --filter consumer exec tsc --noEmit
pnpm --filter consumer build
```

---

### T4 — 리디렉션 체인 재측정

```bash
curl -I https://www.greenlove.co.kr 2>&1 | grep -E "HTTP|Location"
```

Lighthouse 재실행 후 "Avoid multiple page redirects" 항목 해소 확인.

---

## 기대 효과

| 지표 | 현재 | 목표 |
|------|------|------|
| www 접속 RTT | +1회 리디렉션 | 0회 (또는 엣지 즉시 처리) |
| FCP (첫 방문) | +500~800ms | 제거 |

**주의**: T0 결과에 따라 이미 Vercel이 최적으로 처리 중일 수 있음 → 실제 체감 개선 없을 수도 있음.

---

## 실행 순서

```
T0(진단) → T1(Vercel 대시보드) → T2(HSTS, 필요 시) → T3(빌드) → T4(재측정)
```

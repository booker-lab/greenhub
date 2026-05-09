# 성능 최적화 3순위 — 번들 분할 + HeroBanner SSR 전환

> 작성: 2026-04-26 | 직전 기준선 재확인 필요 (ANALYZE=true 실행)
> 목표: Consumer LCP < 3s / TBT < 150ms / Performance 80+

---

## 정합성 검토 결과 (2026-04-26)

### 원래 스펙의 오류 발견

> ~~"Firebase 함수별 import + dynamic import 확대"~~

**실제 현황**: 3개 앱 모두 이미 `from 'firebase/firestore'` 방식의 선택적 import 사용 중.
Tree-shaking이 이미 적용되어 있어 이 작업은 효과 없음.

### 진짜 병목 원인 분석

| 원인 | 근거 | 예상 효과 |
|------|------|-----------|
| HeroBanner CSR fetch | API 응답 후 이미지 URL 확정 → LCP 지연 누적 | LCP -3~5s |
| 대형 클라이언트 컴포넌트 | products/[id]/page.tsx가 400줄 이상의 단일 CSR 컴포넌트 | TBT -100ms |
| 실제 큰 청크 미파악 | ANALYZE=true 미실행 상태로 추정에 의존 | 확인 필요 |

### next/image 결과가 기대보다 낮은 이유

- Vercel Edge 이미지 캐시는 **최초 요청 시 원본 fetch + 변환** → 첫 Lighthouse 측정은 캐시 미스
- 두 번째 방문부터 WebP 캐시 히트 → 실사용자 체감 LCP는 7s보다 훨씬 빠름
- Lighthouse 점수보다 실사용자 Core Web Vitals (Vercel Speed Insights) 수치가 실제 지표

---

## 아토믹 태스크

### T0 — Bundle Analyzer 실행으로 실제 큰 청크 파악 (착수 전 필수)

```bash
cd apps/consumer && ANALYZE=true pnpm build 2>&1 | tail -20
cd apps/seller  && ANALYZE=true pnpm build 2>&1 | tail -20
```

결과에서 300KB 이상 청크 목록 기록.
**이 결과 없이 T2 이후 진행 금지.**

---

### T1 — HeroBanner SSR 전환 (LCP 직접 개선, 최우선)

**파일**: `apps/consumer/src/components/HeroBanner.tsx`

**정합성 검토**:
- 현재: `'use client'` + `useEffect` + `fetch` → CSR. 배너 이미지 URL이 클라이언트에서 확정됨.
- 변환 가능 여부: Banner 데이터는 외부 API 호출만. 인터랙션(state) 없음 → 서버 컴포넌트 전환 가능.
- 단, CTA 버튼의 `<Link>` 등은 서버 컴포넌트에서도 사용 가능.
- **주의**: 스켈레톤 플레이스홀더(2026-04-26 추가)는 SSR 전환 시 불필요해짐.

```tsx
// 변환 방향: async 서버 컴포넌트
export default async function HeroBanner() {
  let banner: Banner | null = null
  try {
    const res = await fetch(`${API_URL}/banner`, { next: { revalidate: 60 } })
    if (res.ok) {
      const data = await res.json()
      if (data?.isActive) banner = data
    }
  } catch {}

  if (!banner) return null
  // ... 기존 JSX 동일
}
```

**검증 포인트**:
- `'use client'` 제거 후 `useEffect`/`useState` 없는지 확인
- `revalidate: 60` — 배너 변경 반영 주기 (60초)
- `Image priority` 유지 (LCP 요소 preload)
- 스켈레톤 플레이스홀더 제거 (SSR이면 초기 렌더에 배너 포함됨)

---

### T2 — Bundle Analyzer 결과 기반 대형 청크 dynamic import

**전제**: T0 결과에서 300KB+ 청크 확인 후 해당 모듈에만 적용.

일반 패턴:
```tsx
import dynamic from 'next/dynamic'

const HeavyComponent = dynamic(() => import('@/components/HeavyComponent'), {
  loading: () => <Skeleton height={200} />,
  ssr: false,  // 인터랙션 전용 컴포넌트만
})
```

**정합성 주의사항**:
- `ssr: false` 남용 금지 → CLS 유발 가능
- 첫 화면에 노출되는 컴포넌트는 dynamic 금지 (LCP 악화)
- 관리자 전용 페이지 (seller/admin/*) — 이미 일부 dynamic 적용됨. 미적용 파일 확인 후 추가.

---

### T3 — products/[id]/page.tsx 서버/클라이언트 레이어 분리

**파일**: `apps/consumer/src/app/products/[id]/page.tsx`

**정합성 검토**:
- 현재 400줄 단일 `'use client'` 컴포넌트
- 상단 상품 정보 (이름, 가격, 이미지) → 서버 컴포넌트로 분리 가능
- 하단 장바구니/수량/결제 UI → `'use client'` 유지 필요 (useState, 이벤트)

```
page.tsx (서버 컴포넌트)
├── ProductImages (서버)  ← 이미지 캐러셀, LCP 요소
├── ProductInfo (서버)    ← 이름, 가격, 설명
└── ProductActions (클라이언트) ← 수량, 결제, 장바구니
```

**주의**: `useProduct`, `useStore` 훅이 Firestore 실시간 구독 사용 → 서버로 이전 시 일회성 fetch로 전환 필요. 실시간성 포기 여부 확인 필요.

---

### T4 — tsc + Bundle 크기 비교 검증

```bash
pnpm --filter consumer exec tsc --noEmit
pnpm --filter seller exec tsc --noEmit
pnpm --filter driver exec tsc --noEmit
```

T0 기준선 대비 번들 크기 개선 수치 기록.

---

### T5 — Lighthouse + Vercel Speed Insights 재측정

```bash
npx lighthouse https://greenlove.co.kr \
  --output=json --output-path=docs/performance/after/consumer-v2.json \
  --chrome-flags="--headless=new" --quiet
```

**Vercel Speed Insights**: 대시보드 > Speed Insights 탭에서 실사용자 Core Web Vitals 확인.
Lighthouse 점수보다 이 수치가 실제 체감 성능 지표.

---

## 개선 기대치 (정합성 검토 후 수정)

| 지표 | 현재 (1차 최적화 후) | 예상 목표 |
|------|---------------------|-----------|
| Consumer LCP | 🔴 7~8s | 🟢 < 3s (SSR 전환 시) |
| Consumer CLS | 🟢 0.024 | 🟢 ~0 유지 |
| Consumer TBT | 230ms (기준선) | 🟢 < 150ms |
| Consumer Performance | 53~57 | 🟢 75+ |

---

## 한계 및 솔직한 기록

### next/image 전환 결과가 기대보다 낮은 이유

| 예상 | 실제 |
|------|------|
| LCP 19.2s → 3s 이하 | LCP 7~8s 수준 (1~2회 측정) |
| CLS 0 달성 | 0.024 (개선됨, 목표 근접) |
| Performance 80+ | 53~57 수준 |

**주요 원인:**
1. **Vercel Edge 캐시 미스**: next/image의 WebP 변환+캐시는 최초 요청 시 생성됨. Lighthouse가 항상 콜드 측정이라 실사용자 체감과 괴리.
2. **HeroBanner CSR 지연**: 배너 이미지 URL 자체가 API 응답 후 확정 → image preload 불가.
3. **Firebase Storage 응답 지연**: 이미지 Origin이 Firebase Storage (asia-northeast1) → 한국에서도 RTT 50~100ms.
4. **Lighthouse 모바일 시뮬레이션 편차**: TBT 등은 ±100~200ms 편차가 정상.

**실사용자 체감**은 Vercel Speed Insights로 별도 확인 필요.

# 성능 최적화 1·2순위 — next/image 전환 플랜

> 작성: 2026-04-26 | 기준선: Consumer LCP 19.2s / CLS 0.204 / Performance 53
> 목표: LCP < 3s / CLS = 0 / Performance 80+

---

## 정합성 검토 결과

### 로직 영향 없음 확인

`next/image` 교체는 렌더링 레이어만 변경. 아래 항목은 **일절 수정하지 않는다**:
- `useProducts`, `useOrders` 등 모든 훅
- Firebase Firestore / Storage 호출 코드
- API 라우트, 인증, 라우팅 로직
- 데이터 타입 (`Product`, `Banner` 인터페이스)

### 교체 방식 결정

| 상황 | 방식 | 이유 |
|------|------|------|
| `position:relative` + `aspectRatio` 부모 있음 | `fill` prop | 부모가 공간 확보 → CLS 0 |
| 고정 px 크기 (44×44, 56×56) | `width`/`height` prop | 사이즈 명시 가능 |
| blob URL (`createObjectURL`) | `<img>` 유지 | next/image 미지원 도메인 |
| 종횡비 미정 상세 이미지 | `<img loading="lazy">` | dimensions 없으면 fill 불가 |

### HeroBanner 구조 이슈

현재 배너 이미지는 `position:absolute, right:0, top:0, width:'50%', height:'100%'`로 직접 배치됨.
`next/image fill`을 쓰려면 **별도 위치 컨테이너**가 필요.

```tsx
// 수정 전 — img가 직접 absolute 포지셔닝
<img style={{ position:'absolute', right:0, top:0, height:'100%', width:'50%', objectFit:'cover' }} />

// 수정 후 — wrapper div가 absolute 담당, Image는 fill
<div style={{ position:'absolute', right:0, top:0, width:'50%', height:'100%' }}>
  <Image fill src={banner.imageUrl} alt="배너" style={{ objectFit:'cover', objectPosition:'center' }}
    sizes="50vw" />
</div>
```

---

## 아토믹 태스크

### T0 — next.config.ts remotePatterns 설정 (3개 앱)

**파일**: `apps/consumer/next.config.ts`, `apps/seller/next.config.ts`, `apps/driver/next.config.ts`

```ts
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
  },
}
```

검증: 설정 후 `next build` 오류 없음.

---

### T1 — Consumer HeroBanner.tsx (LCP 원인, 최우선)

**파일**: `apps/consumer/src/components/HeroBanner.tsx`
**변경 줄**: 48

```tsx
// 추가
import Image from 'next/image'

// 수정 전
{banner.imageUrl && (
  <img
    src={banner.imageUrl}
    alt="배너"
    style={{ position:'absolute', right:0, top:0, height:'100%', width:'50%', objectFit:'cover', objectPosition:'center' }}
  />
)}

// 수정 후
{banner.imageUrl && (
  <div style={{ position:'absolute', right:0, top:0, width:'50%', height:'100%' }}>
    <Image
      fill
      src={banner.imageUrl}
      alt="배너"
      sizes="50vw"
      style={{ objectFit:'cover', objectPosition:'center' }}
      priority
    />
  </div>
)}
```

> `priority` 추가 이유: LCP 요소이므로 preload 처리. 브라우저가 가장 먼저 다운로드하도록 지시.

---

### T2 — Consumer ProductCard.tsx

**파일**: `apps/consumer/src/components/ProductCard.tsx`
**변경 줄**: 29

부모 `<Box style={{ position:'relative', aspectRatio:'4/5' }}>` 이미 존재 → fill 바로 적용.

```tsx
import Image from 'next/image'

// 수정 전
<img src={imgSrc} alt={product.name} style={{ objectFit:'cover', width:'100%', height:'100%' }} />

// 수정 후
<Image fill src={imgSrc} alt={product.name} sizes="(max-width: 600px) 50vw, 33vw"
  style={{ objectFit:'cover' }} />
```

---

### T3 — Consumer DeadlineSection.tsx

**파일**: `apps/consumer/src/components/DeadlineSection.tsx`
**변경 줄**: 51

부모 `<Box style={{ aspectRatio:'4/5', position:'relative' }}>` 이미 존재 → fill 바로 적용.

```tsx
import Image from 'next/image'

// 수정 전
<img src={product.images?.[0] ?? '/icons/icon-192x192.png'} alt={product.name}
  style={{ width:'100%', height:'100%', objectFit:'cover' }} />

// 수정 후
<Image fill src={product.images?.[0] ?? '/icons/icon-192x192.png'} alt={product.name}
  sizes="140px" style={{ objectFit:'cover' }} />
```

---

### T4 — Consumer products/[id]/page.tsx (캐러셀 메인)

**파일**: `apps/consumer/src/app/products/[id]/page.tsx`
**변경 줄**: 179, 181

부모 Box에 `position:'relative'` 누락 → 추가 필요.

```tsx
import Image from 'next/image'

// 수정 전 Box
<Box key={i} style={{ flexShrink:0, width:'100%', scrollSnapAlign:'start', aspectRatio:'4/5', overflow:'hidden' }}>
  <img src={src} ... />
</Box>

// 수정 후 Box (position 추가)
<Box key={i} style={{ flexShrink:0, width:'100%', scrollSnapAlign:'start', aspectRatio:'4/5', overflow:'hidden', position:'relative' }}>
  <Image fill src={src} alt={`${product.name} ${i + 1}`} sizes="100vw" style={{ objectFit:'cover' }} />
</Box>
```

> 주의: `carouselRef`와 scroll 계산은 **외부 컨테이너**(`Box` 상위의 scroll Box)에 달려 있어 이 Box 변경과 무관. 로직 영향 없음.

---

### T5 — Consumer products/[id]/page.tsx (썸네일 스트립)

**파일**: `apps/consumer/src/app/products/[id]/page.tsx`
**변경 줄**: 197, 202

부모 Box가 `width:56, height:56` 고정 → `position:'relative'` 추가 후 fill.

```tsx
// 수정 전 Box
<Box ... style={{ flexShrink:0, width:56, height:56, borderRadius:6, overflow:'hidden', cursor:'pointer', border:..., transition:... }}>
  <img src={src} ... />
</Box>

// 수정 후 Box (position 추가)
<Box ... style={{ flexShrink:0, width:56, height:56, borderRadius:6, overflow:'hidden', cursor:'pointer', border:..., transition:..., position:'relative' }}>
  <Image fill src={src} alt={`${product.name} 썸네일 ${i + 1}`} sizes="56px" style={{ objectFit:'cover' }} />
</Box>
```

> `onClick`으로 carouselRef.scrollTo 호출하는 로직은 Box에 붙어 있어 영향 없음.

---

### T6 — Consumer products/[id]/page.tsx (상세 이미지 — 예외)

**파일**: `apps/consumer/src/app/products/[id]/page.tsx`
**변경 줄**: 273

종횡비 미정(셀러가 자유 업로드) → `next/image` 불가. `loading="lazy"` 추가만.

```tsx
// 수정 전
<img key={i} src={src} alt={`${product.name} 상세 ${i + 1}`} style={{ width:'100%', display:'block' }} />

// 수정 후
<img key={i} src={src} alt={`${product.name} 상세 ${i + 1}`}
  loading="lazy" style={{ width:'100%', display:'block' }} />
```

---

### T7 — Consumer products/[id]/page.tsx (스토어 로고)

**파일**: `apps/consumer/src/app/products/[id]/page.tsx`
**변경 줄**: 399

44×44 고정 크기 → width/height prop.

```tsx
// 수정 전
<img src={store.logoUrl} alt={store.name} style={{ width:44, height:44, borderRadius:'50%', objectFit:'cover' }} />

// 수정 후
<Image src={store.logoUrl} alt={store.name} width={44} height={44}
  style={{ borderRadius:'50%', objectFit:'cover' }} />
```

---

### T8 — Seller products/page.tsx

**파일**: `apps/seller/src/app/products/page.tsx`
**변경 줄**: 202

```tsx
import Image from 'next/image'

// 부모 구조 확인 후 fill 또는 width/height 적용
<Image fill src={product.images[0]} alt={product.name} sizes="(max-width:600px) 50vw, 25vw"
  style={{ objectFit:'cover' }} />
```

---

### T9 — Seller admin/banner/_client.tsx

**파일**: `apps/seller/src/app/admin/banner/_client.tsx`
**변경 줄**: 75

```tsx
import Image from 'next/image'

// 부모에 position:relative 추가 후 fill
<Image fill src={form.imageUrl} alt="배너 미리보기" style={{ objectFit:'cover' }} sizes="100vw" />
```

---

### T10 — Seller onboarding/page.tsx (예외 — 유지)

**파일**: `apps/seller/src/app/onboarding/page.tsx`
**변경 없음**

`logoPreview = URL.createObjectURL(file)` → blob URL. `next/image`는 blob: 스킴 미지원.
기존 `eslint-disable-next-line @next/next/no-img-element` 주석 그대로 유지.

---

### T11 — tsc + ESLint 검증

```bash
cd apps/consumer && pnpm tsc --noEmit
cd apps/seller   && pnpm tsc --noEmit
cd apps/driver   && pnpm tsc --noEmit
```

0 errors 확인 후 다음 단계 진행.

---

### T12 — Lighthouse 재측정

```bash
mkdir -p docs/performance/after
npx lighthouse https://greenlove.co.kr --output=json \
  --output-path=docs/performance/after/consumer.json \
  --chrome-flags="--headless --no-sandbox" --quiet
# seller, driver 동일
```

기준선 대비 개선 수치 기록.

---

## 예상 결과

| 지표 | 현재 | 목표 |
|------|------|------|
| Consumer LCP | 🔴 19.2s | 🟢 < 3s |
| Consumer CLS | 🔴 0.204 | 🟢 ~0 |
| Consumer Performance | 🔴 53 | 🟢 80+ |
| 배너 이미지 전송 크기 | 1,322 KB | ~60–100 KB |
| 상품 카드 이미지 | 467 KB | ~20–40 KB |

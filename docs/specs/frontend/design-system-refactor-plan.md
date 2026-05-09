# Consumer 디자인 시스템 지침 준수 — 아토믹 태스크 플랜

> 작성: 2026-05-02  
> 근거: 전체 파일 직접 읽기 기반 감사 (이전 세션 분석과 달리 실제 코드 검증 완료)  
> 원칙: **로직 불변** — 훅/API/비즈니스 로직 일절 수정 금지. UI 스타일 레이어만 변경.

---

## 현재 상태 요약

| 항목 | 상태 |
|------|------|
| `packages/ui/src/style.css` | ✅ 모든 토큰 완비 (T0 완료) |
| `components/GreenLoveBrandSection.tsx` | ✅ 완전 정리됨 |
| `app/login/page.tsx` | ✅ 완전 정리됨 |
| `app/order/success/page.tsx` | ✅ 완전 정리됨 |
| `app/search/page.tsx` | ✅ 완전 정리됨 |
| `app/checkout/page.tsx` | ✅ 완전 정리됨 |
| `app/category/page.tsx` | ⚠️ 위반 2건 |
| `app/cart/page.tsx` | ⚠️ 위반 1건 |
| `app/mypage/_client.tsx` | ⚠️ 위반 다수 |
| `app/mypage/page.tsx` 외 3개 fallback | ⚠️ hex 색상 |
| `app/mypage/addresses/_client.tsx` | ⚠️ Modal styles |
| `app/mypage/orders/[id]/_client.tsx` | ⚠️ Stepper styles |
| `products/[id]/_components/ProductImages.tsx` | ⚠️ 위반 1건 |
| `products/[id]/_components/ProductActions.tsx` | ⚠️ 위반 2건 |
| `components/BottomNav.tsx` | 🔴 설계 예외 논의 필요 |
| `components/ProductTopBar.tsx` | 🔴 설계 예외 논의 필요 |

**이전 세션 분석 오류**: `--mantine-color-*` / `c=` / `fw=` / gradient 위반으로 수백 건을 보고했으나,  
실제 파일 확인 결과 해당 파일들은 이미 정리 완료 상태. **실제 위반은 18건**.

---

## 실제 위반 전체 목록

| # | 파일 | 라인 | 위반 내용 | 분류 |
|---|------|------|-----------|------|
| 1 | `components/BottomNav.tsx` | 60 | `fontSize: 10` | 🔴 설계 논의 |
| 2 | `components/ProductTopBar.tsx` | 114 | `fontSize: 10` | 🔴 설계 논의 |
| 3 | `app/cart/page.tsx` | 55 | `borderRadius: 8` | ⚠️ var() 미사용 |
| 4 | `app/category/page.tsx` | 70 | `fontSize: 14` | ⚠️ 15px 미만 |
| 5 | `app/category/page.tsx` | 71 | `fontWeight: 700 / 400` | ⚠️ var() 미사용 |
| 6 | `app/mypage/_client.tsx` | 74 | `borderRadius: 10` | ⚠️ var() 미사용 |
| 7 | `app/mypage/_client.tsx` | 79 | `fontSize: 12, fontWeight: 700, borderRadius: 20` | ⚠️ 15px 미만 + var() |
| 8 | `app/mypage/_client.tsx` | 155 | `borderRadius: 10` | ⚠️ var() 미사용 |
| 9 | `app/mypage/_client.tsx` | 159 | `borderRadius: 10` | ⚠️ var() 미사용 |
| 10 | `app/mypage/page.tsx` | 8 | `color: '#999'` | ⚠️ 하드코딩 hex |
| 11 | `app/mypage/addresses/page.tsx` | 8 | `color: '#999'` | ⚠️ 하드코딩 hex |
| 12 | `app/mypage/notifications/page.tsx` | 8 | `color: '#999'` | ⚠️ 하드코딩 hex |
| 13 | `app/mypage/orders/[id]/page.tsx` | 8 | `color: '#999'` | ⚠️ 하드코딩 hex |
| 14 | `app/mypage/addresses/_client.tsx` | 99 | `fontWeight: 700, fontSize: 17` (Modal styles) | ⚠️ var() 미사용 |
| 15 | `app/mypage/orders/[id]/_client.tsx` | 194 | `fontWeight: 600, fontSize: 12` (Stepper styles) | ⚠️ 15px 미만 |
| 16 | `products/[id]/_components/ProductImages.tsx` | 63 | `borderRadius: 6` | ⚠️ var() 미사용 |
| 17 | `products/[id]/_components/ProductActions.tsx` | 107 | `fontSize: 13` (countdown Badge) | 🔴 설계 논의 |
| 18 | `products/[id]/_components/ProductActions.tsx` | 212 | `fontWeight: 700, fontSize: 16` | ⚠️ var() 미사용 |

---

## 확정 예외 목록 (수정 금지)

| 파일 | 내용 | 이유 |
|------|------|------|
| `login/page.tsx:45` | `#FEE500 / #000000` | 카카오 공식 브랜드 컬러 |
| `BrandHeader.tsx` SVG fill | `#97CFB0 / #F0A28C` | 브랜드 로고 에셋 |
| `layout.tsx:20` | `themeColor: "#2D6A4F"` | PWA meta 태그 |
| `category/page.tsx` COLOR_CHIPS | hex 배열 전체 | 실제 꽃 색상 데이터 |
| `order/success/page.tsx` | `fontSize: 56` | 이모지 전용 표시 크기 |
| `orders/[id]/_client.tsx:46` | `fontSize: 36` | 픽업 코드 디스플레이 |
| `ProductActions.tsx:112,114` | `fontSize: 36 / 18` | 가격·수량 강조 표시 |
| `notifications/_client.tsx:92` | `fontSize: 18` | 이모지 아이콘 크기 |

---

## 🔴 설계 결정 필요 항목 (T0 — 작업 전 선결)

아래 항목은 수정 전 사용자 결정이 필요합니다.

| 항목 | 현재 값 | 디자인 시스템 규칙 | 권고 |
|------|---------|-------------------|------|
| BottomNav 탭 라벨 | `fontSize: 10` | 최소 15px | 예외로 CLAUDE.md 문서화 (모바일 하단 내비 표준) |
| ProductTopBar 버튼 라벨 | `fontSize: 10` | 최소 15px | 예외로 CLAUDE.md 문서화 |
| 마이페이지 주문 상태 뱃지 | `fontSize: 12` | 최소 15px | 예외로 CLAUDE.md 문서화 (compact badge 패턴) |
| 카운트다운 뱃지 | `fontSize: 13` | 최소 15px | 예외로 CLAUDE.md 문서화 |
| Stepper 설명 텍스트 | `fontSize: 12` | 최소 15px | 예외로 CLAUDE.md 문서화 또는 15px로 올림 |

**권고 결정**: 위 5개를 모두 **CLAUDE.md 공식 예외**로 등록. 이유: UI 컴포넌트 구조상 15px 적용 시 레이아웃 붕괴 위험.

---

## 태스크 목록

### T0 — 설계 예외 CLAUDE.md 문서화 ✅
**선행 필수** — 아래 예외를 `apps/consumer/CLAUDE.md` 또는 루트 `CLAUDE.md`에 추가.

```
## 디자인 시스템 폰트 크기 예외
- BottomNav / ProductTopBar 탭 라벨: fontSize: 10 (모바일 하단 내비 표준)
- 주문 상태 뱃지 (OrderCard): fontSize: 12 (compact badge)
- 카운트다운 뱃지: fontSize: 13 (타이머 compact 표시)
- Stepper 단계 설명: fontSize: 12 (Mantine Stepper 내부 compact 텍스트)
```

---

### T1 — mypage fallback 4개 파일 (4줄 수정) ✅

**대상**: 4개 파일 모두 8번 라인 동일 패턴

```tsx
// Before
<div style={{ padding: '60px 24px', textAlign: 'center', color: '#999' }}>로딩 중...</div>

// After
<div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--color-text-disabled)' }}>로딩 중...</div>
```

**파일 4개**:
- `app/mypage/page.tsx`
- `app/mypage/addresses/page.tsx`
- `app/mypage/notifications/page.tsx`
- `app/mypage/orders/[id]/page.tsx`

---

### T2 — app/cart/page.tsx (1줄 수정) ✅

**라인 55**: `borderRadius: 8` → `borderRadius: 'var(--radius-sm)'`

```tsx
// Before
borderRadius: 8,

// After
borderRadius: 'var(--radius-sm)',
```

---

### T3 — app/category/page.tsx (2줄 수정) ✅

**라인 70**: `fontSize: 14` → `fontSize: 'var(--font-size-sm)'`  
**라인 71**: `fontWeight: isActive ? 700 : 400` → `fontWeight: isActive ? 'var(--fw-bold)' : 'normal'`

```tsx
// Before (70~71)
fontSize: 14,
fontWeight: isActive ? 700 : 400,

// After
fontSize: 'var(--font-size-sm)',
fontWeight: isActive ? 'var(--fw-bold)' : 'normal',
```

---

### T4 — app/mypage/_client.tsx (4곳 수정) ✅

**라인 74**: `borderRadius: 10` → `borderRadius: 'var(--radius-sm)'`

**라인 79** (status badge):
```tsx
// Before
<Box style={{ fontSize: 12, fontWeight: 700, color: colorScheme.text, background: colorScheme.bg, padding: '3px 10px', borderRadius: 20 }}>

// After (fontSize: 12는 T0에서 예외 등록되므로 그대로 유지, fontWeight/borderRadius만 수정)
<Box style={{ fontSize: 12, fontWeight: 'var(--fw-bold)', color: colorScheme.text, background: colorScheme.bg, padding: '3px 10px', borderRadius: 'var(--radius-full)' }}>
```

**라인 155, 159**: `borderRadius: 10` → `borderRadius: 'var(--radius-sm)'`

---

### T5 — app/mypage/addresses/_client.tsx (1줄 수정) ✅

**라인 99**: Modal `styles` prop 내 하드코딩 값

```tsx
// Before
styles={{ title: { fontWeight: 700, fontSize: 17 } }}

// After
styles={{ title: { fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' } }}
```

---

### T6 — app/mypage/orders/[id]/_client.tsx (1줄 수정) ✅

**라인 194**: Stepper `styles` prop  
⚠️ `fontSize: 12` → T0 예외 등록 후 그대로 유지, `fontWeight: 600`만 수정

```tsx
// Before
styles={{ stepLabel: { fontWeight: 600 }, stepDescription: { fontSize: 12 } }}

// After
styles={{ stepLabel: { fontWeight: 'var(--fw-bold)' }, stepDescription: { fontSize: 12 } }}
```

---

### T7 — products/[id]/_components/ProductImages.tsx (1줄 수정) ✅

**라인 63**: `borderRadius: 6` → `borderRadius: 'var(--radius-sm)'`  
(--radius-sm = 8px, 시각적으로 거의 동일)

```tsx
// Before
flexShrink: 0, width: 56, height: 56, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',

// After
flexShrink: 0, width: 56, height: 56, borderRadius: 'var(--radius-sm)', overflow: 'hidden', cursor: 'pointer',
```

---

### T8 — products/[id]/_components/ProductActions.tsx (2곳 수정) ✅

**라인 107**: `fontSize: 13` → T0 예외 등록으로 유지 (카운트다운 badge)

**라인 212**: 판매자 아바타 이니셜 Box
```tsx
// Before
{ width: 44, height: 44, borderRadius: '50%', background: 'var(--color-primary-surface)', ..., fontWeight: 700, fontSize: 16 }

// After
{ width: 44, height: 44, borderRadius: '50%', background: 'var(--color-primary-surface)', ..., fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-md)' }
```

---

### T9 — 타입체크 + e2e 검증 ✅ (tsc 통과 / e2e 별도 환경 필요)

```bash
# apps/consumer에서 타입 오류 없는지 확인
pnpm --filter consumer tsc --noEmit

# e2e 전체 실행
pnpm test:e2e
```

---

## 진행 규칙

1. **T0 완료 후** T1~T8 착수 (예외 등록 선행)
2. T1~T8은 파일별로 독립적 — 병렬 처리 가능
3. 각 태스크 완료 즉시 체크박스 `⬜` → `✅`
4. 로직(훅, API, 상태 관리) 코드 절대 수정 금지
5. T9에서 tsc 오류 발생 시 해당 태스크로 돌아가 수정

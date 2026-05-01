# Consumer DS e2e 검증 확인리스트

> 대상: `apps/e2e/tests/consumer-design-system.spec.ts` (28 tests)  
> 환경: `https://greenlove.co.kr` (production)

---

## 실행 명령

```bash
# 전체 실행 (chromium + mobile, 권장)
pnpm --filter e2e exec playwright test consumer-design-system --reporter=list

# 실패한 케이스만 재실행
pnpm --filter e2e exec playwright test consumer-design-system --reporter=list --last-failed

# 특정 케이스만
pnpm --filter e2e exec playwright test consumer-design-system --reporter=list --grep "products"
```

---

## 검증 케이스 목록

### T1 — mypage 페이지군 (JS 에러 + 토큰)

| # | 케이스 | 통과 기준 |
|---|--------|-----------|
| 1 | `/mypage` — JS 에러 없음 | critical 에러 0건 (hydration·ChunkLoad 제외) |
| 2 | `/mypage/addresses` — JS 에러 없음 | critical 에러 0건 |
| 3 | `/mypage/notifications` — JS 에러 없음 | critical 에러 0건 |
| 4 | `--color-text-disabled` 토큰 해석 | CSS 변수 값이 비어있지 않음 |

### T2 — cart 페이지

| # | 케이스 | 통과 기준 |
|---|--------|-----------|
| 5 | `/cart` — JS 에러 없음 | critical 에러 0건 |
| 6 | `--radius-sm` 토큰 해석 | CSS 변수 값이 비어있지 않음 |

### T3 — category 페이지

| # | 케이스 | 통과 기준 |
|---|--------|-----------|
| 7 | `/category` — JS 에러 없음 | critical 에러 0건 |
| 8 | 탭 버튼 렌더링 | 첫 번째 `<button>` 가시성 확인 |
| 9 | `--font-size-sm` 토큰 해석 | 값이 존재하고 ≥ 15px |

### T4~T6 — mypage 클라이언트 컴포넌트

| # | 케이스 | 통과 기준 |
|---|--------|-----------|
| 10 | mypage 오더 목록 영역 렌더링 | critical 에러 0건 |
| 11 | `/mypage/addresses` — JS 에러 없음 | critical 에러 0건 |

### T7~T8 — 상품 상세 페이지

| # | 케이스 | 통과 기준 |
|---|--------|-----------|
| 12 | `products/[id]` — JS 에러 없음 | 홈에서 첫 상품 링크 클릭 후 critical 에러 0건 (hydration·ChunkLoad·404 제외) |
| 13 | `--radius-sm` / `--fw-bold` / `--font-size-md` 토큰 해석 | 세 변수 모두 비어있지 않음 |

### 예외 — 공식 compact 컴포넌트

| # | 케이스 | 통과 기준 |
|---|--------|-----------|
| 14 | 홈 — JS 에러 없음 (BottomNav·ProductTopBar 10px 예외 포함) | critical 에러 0건 |

> 각 케이스는 chromium + mobile 2개 워커로 실행 → 총 **28 tests**

---

## 통과 기준 요약

| 항목 | 기준 |
|------|------|
| 전체 통과 수 | **28/28** |
| JS critical 에러 | 0건 (hydration·ChunkLoad·404는 허용 예외) |
| CSS 토큰 해석 | `--color-text-disabled`, `--radius-sm`, `--font-size-sm` (≥15px), `--font-size-md`, `--fw-bold` 모두 비어있지 않음 |
| 상품 상세 진입 | 홈 첫 상품 링크 → `load` 이벤트 완료 (30초 이내) |

---

## 실패 시 대응

| 증상 | 원인 후보 | 조치 |
|------|-----------|------|
| `networkidle` 타임아웃 | 백그라운드 폴링·스트림 요청 | `waitForLoadState('load')` 로 변경 |
| CSS 토큰 값 빈 값 | `globals.css` / `theme.ts` 변수 누락 | 해당 파일에서 변수 선언 확인 |
| JS critical 에러 | 클라이언트 컴포넌트 런타임 오류 | 스크린샷(`test-results/`) + 콘솔 메시지 확인 |
| `products/[id]` 404 | 홈에 상품 없음 (테스트 데이터 부재) | 실 DB 상품 등록 여부 확인 |

---

## 허용 예외 (공식 등록)

| 컴포넌트 | 예외 내용 | 등록 위치 |
|----------|-----------|-----------|
| BottomNav | 라벨 10px (compact) | `apps/consumer/CLAUDE.md` |
| ProductTopBar | 라벨 10px (compact) | `apps/consumer/CLAUDE.md` |
| 주문상태 뱃지 | 12px | `apps/consumer/CLAUDE.md` |
| 카운트다운 | 13px | `apps/consumer/CLAUDE.md` |
| Stepper 설명 | 12px | `apps/consumer/CLAUDE.md` |

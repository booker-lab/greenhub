# 세션54 진입 문서 — 세션53 플랜 정합성 검토 + T-UX1 진입

> 작성: 2026-05-20 (세션53 종료) · 선행: 세션53 UX-07~10 진단 + 아토믹 태스크 플랜 수립
> 목표: ① 세션53 산출물 정합성 검토(플랜·BACKLOG·memory·진단 결과 일관성), ② 사용자와 결정 사항 합의, ③ T-UX1(탭 단일화) 진입

---

## 1. 세션53 컨텍스트 요약

세션53은 Railway Major Outage(세션52 진단) 미복구 확인 후 **백엔드 무관 작업**으로 전환했다. UX-07~10 잔여를 다루기로 결정 → 현재 코드 상태 진단 → 5개 아토믹 태스크 플랜 수립으로 마무리. 코드 변경 없음.

**산출물 1건**:
- [`docs/specs/frontend/seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md) (147라인, SSOT)

**문서 갱신**:
- `docs/BACKLOG.md` §11-3 UX-07~10 상태 마킹 (UX-10 자연 해소로 ⏹️) + §12-1 신규 T-UX 항목 등재 + §12 활동 로그 세션53 추가
- `docs/memory.md` 세션53 결과 반영 (59라인 — 200 한도 여유)

**커밋**: `docs(session53): UX-07~10 진단 + 아토믹 태스크 플랜 수립 (T-UX1~5)`

---

## 2. T8-A — 세션53 산출물 정합성 검토

세션54 진입 시 가장 먼저 수행. 코드 변경 없는 검토 작업.

### 2-1. 플랜 자체 검토 (사용자 합의 필요)

세션53은 사용자가 "각 태스크 세션 분할 + 정합성 검토 포함" 요청 → 5개 태스크로 분해. 다음 항목을 사용자와 명시 합의:

- [ ] **태스크 분해 단위**: T-UX1·2·3·4a·4b·4c·5의 7개 sub-task로 6세션에 매핑한 권장안(53 plan §2)이 적절한지 / 더 묶거나 더 쪼갤지.
- [ ] **태스크 순서**: 권장 순서 T-UX1 → T-UX3 → T-UX2 → T-UX4 → T-UX5. 변경 의향 확인 (T-UX2 상품 카드를 먼저 보고 싶다 등).
- [ ] **T-UX4 분할 범위**: admin / 본 화면 / products _components 3분할이 합리적인지 (한 번에 처리 vs 더 세분화).
- [ ] **백엔드 호스팅 단일 장애점 회고(§12-1 🔵 검토)** 와의 우선순위. Railway 복구 후 e2e 검증을 위해 T-UX5는 어쨌든 Outage 종결 대기.

### 2-2. 진단 결과 재검증 (코드 grep)

세션53 진단이 2026-05-20 시점 스냅샷. 세션54 진입 시 변경된 게 있는지 빠른 재확인:

```powershell
# UX-09 native confirm() 잔존 6건 (변동 없어야 함)
rg "window\.confirm|\bconfirm\(" apps/seller/src

# UX-07 탭 색상 혼재 (3페이지)
rg "borderBottom.*var\(--color-(primary|text)\)" apps/seller/src/app/{orders,products,settlements}/page.tsx

# fontSize 하드코딩 잔존 (~30곳)
rg "fontSize:\s*\d+" apps/seller/src

# settlements/page.tsx top: 57 매직넘버 (T-UX1에서 동시 해소 예정)
rg "top:\s*57" apps/seller/src
```

진단 결과와 동일하면 OK. 차이 발생 시 플랜 갱신.

### 2-3. 결정 필요 사항 확정 (T-UX1 진입 전)

플랜 §3에 명시된 각 태스크의 미결정 사항 중 **T-UX1 진입에 필요한 것만** 먼저 확정:

- [ ] **탭 색상**: `var(--color-primary)`(초록, 상품·정산 기준) vs `var(--color-text)`(검정, 주문 기준).
  - 권장: **초록**(`--color-primary`) — 브랜드 일관성. 주문 탭만 검정인 게 예외였음.
- [ ] **탭 강조 패턴**: active 시 `fontWeight: 700`(주문) vs `medium`(상품·정산).
  - 권장: **medium + active 시 700** (기존 주문 탭 패턴).
- [ ] **카운트 Badge 정책**: 주문 탭만 카운트(`groupCounts`) + `ACTION_REQUIRED` 빨강 점. 신설 컴포넌트가 prop으로 받음.
  - 권장: **유지** — 카운트 의미 있는 페이지만 사용.
- [ ] **sticky 정책**: 주문·정산 sticky, 상품 non-sticky. 신설 컴포넌트 `sticky?: boolean` prop.
  - 권장: **유지** (각 페이지 IA 결정).
- [ ] **컴포넌트 위치**: `apps/seller/src/components/SegmentedTabs.tsx` (PageShell·PageHeader 등과 동일 폴더).

나머지 태스크(T-UX2/3/4)의 결정은 각 태스크 진입 시점에 확정.

---

## 3. T-UX1 진입 (정합성 검토 후)

검토·합의 완료 시 즉시 T-UX1 구현 진입. 작업 단위는 다음과 같다(플랜 §1 T-UX1 그대로):

### 3-1. 작업

1. **신설**: `apps/seller/src/components/SegmentedTabs.tsx`
   - Props: `tabs: { key: string; label: string; count?: number; badgeColor?: 'red' | 'gray' }[]` · `value: string` · `onChange: (key) => void` · `sticky?: boolean` (default false) · `topOffset?: string` (sticky 시 `top` 값, default `'var(--header-height)'`)
   - 색상·강조·테두리 패턴 단일 (위 §2-3 합의 사항 반영)
   - 카운트 Badge는 `count > 0` 일 때만 렌더, `badgeColor` 없으면 'gray'
2. **치환 — 주문 탭** (`apps/seller/src/app/orders/page.tsx:160-195`):
   - sticky=true·topOffset=default
   - tabs는 `GROUP_TABS.map(t => ({ ...t, count: groupCounts[t.key], badgeColor: t.key === 'ACTION_REQUIRED' ? 'red' : 'gray' }))`
   - 기존 wrapping `<Box>` + `<Container size="sm">` 유지(레이아웃 영향 격리)
   - SubFilter row(`activeTab === 'IN_DELIVERY'`)는 별도 — 본 태스크 범위 밖
3. **치환 — 상품 탭** (`apps/seller/src/app/products/page.tsx:62-94`):
   - sticky=false
   - tabs는 `[{key:'all', label:'전체', count:products.length}, ...]` 형태로 변환 (기존 label에 인라인된 카운트 → count prop)
   - 카운트 없는 케이스 회귀 방지 — 카운트 0이면 Badge 미렌더
4. **치환 — 정산 탭** (`apps/seller/src/app/settlements/page.tsx:37-69`):
   - sticky=true·topOffset=default → 기존 `top: 57` 매직넘버 동시 해소
   - 카운트 없음 (label만)

### 3-2. 검증

```powershell
pnpm --filter seller typecheck
pnpm --filter seller build  # 23라우트 통과 기대
pnpm -w biome check apps/seller/src/components/SegmentedTabs.tsx apps/seller/src/app/{orders,products,settlements}/page.tsx
```

dev 서버 (`pnpm --filter seller dev`):
- [ ] 주문 페이지 — 탭 시각 변경 확인(초록/medium), sticky 위치(header-height), 카운트 Badge·ACTION_REQUIRED 빨강 점 정상 동작
- [ ] 상품 페이지 — 탭 시각 변경 확인, 카운트 표시(전체/판매중/비활성)
- [ ] 정산 페이지 — sticky 위치(매직넘버 57 → header-height)·탭 동작

e2e: `apps/e2e/tests/seller-orders.spec.ts`·`seller-products.spec.ts`(있다면)·`seller-settlements.spec.ts`(있다면) 셀렉터 점검 — `getByRole('button')` + 텍스트 기반이면 영향 없음. Railway 복구 후 회귀 풀런.

### 3-3. 커밋·문서

- 커밋: `refactor(seller): UX-07 탭 스타일 단일화 — SegmentedTabs 공통 컴포넌트 (T-UX1)`
- BACKLOG §11-3 UX-07 ✅ 마킹 + 세션·커밋 해시 기록
- BACKLOG §12 활동 로그 세션54 추가
- memory.md 갱신
- `seller-refactor-visual-verify.md` 육안 검증 체크리스트 항목 추가
- 세션55 진입 문서 작성 (T-UX3 진입)

---

## 4. 세션54 완료 기준

- [ ] §2 정합성 검토 완료 + 결정 사항 합의 (사용자 응답 기록)
- [ ] T-UX1 구현 + 빌드·타입체크·biome 통과
- [ ] BACKLOG·memory 갱신 + 세션55 진입 문서 작성
- [ ] 커밋 1건 (또는 T-UX1 완료 시점에 따라 분할)

---

## 5. 참조

- 세션53 플랜 SSOT: [`docs/specs/frontend/seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md)
- 세션38 감사: [`docs/specs/frontend/seller-ux-audit.md`](../../specs/frontend/seller-ux-audit.md)
- 세션40 패턴(아토믹 분해 참고): [`docs/specs/frontend/seller-orders-refactor-plan.md`](../../specs/frontend/seller-orders-refactor-plan.md)
- Railway Outage 진단 (세션52): [`session53-prep.md`](session53-prep.md) §컨텍스트
- BACKLOG §11-3 UX-07~10·§12-1 T-UX 항목

---

## 6. 진행 규칙 (세션53과 동일)

- Railway Outage와 무관하게 진행. T-UX5만 복구 대기.
- 각 태스크는 별도 커밋. 결정 사항은 `CRITICAL_LOGIC.md`에 추가(신설 컴포넌트·신설 토큰).
- 사용자 명시 승인 후 진입 — 정합성 검토 결과를 보고한 뒤 T-UX1 진입 동의 받기.

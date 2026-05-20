# 셀러앱 UX 잔여(UX-07~10) 정합 — 아토믹 태스크 플랜

> 작성: 2026-05-20 (세션53 진입 시점) · 선행 진단: [seller-ux-audit.md](seller-ux-audit.md)
> SSOT 추적: [BACKLOG.md](../../BACKLOG.md) §11-3 UX-07~10
> 전제: Railway Major Outage(세션52 진단)로 e2e 풀런 보류 중. **본 플랜은 백엔드 무관**하며 빌드·타입체크·biome·로컬 dev로 검증 가능.

---

## 0. 사전 진단 (현재 코드 상태)

세션41~51의 주문 탭 리팩토링·IA 재구성·홈 대시보드 작업으로 일부 항목은 자연 해소됐다. 세션53 진입 시점 잔여:

| 항목 | 감사 진단 (세션38) | 현재 상태 (2026-05-20) | 처리 |
|------|---------------------|------------------------|------|
| UX-07 탭 스타일 2종 혼재 | 주문(검정 underline) vs 상품·정산(초록 underline) | **혼재 유지** — `orders/page.tsx:178-181` 검정·700, `products/page.tsx:78-83` 초록·medium, `settlements/page.tsx:53-65` 초록·500 + `top: 57` 매직넘버·`fontSize: 14` 하드코딩 | T-UX1 |
| UX-08 Badge-as-button | 상품 카드 판매중·수정·삭제가 같은 pill | **유지** — `products/page.tsx:257-289` Badge×3 | T-UX2 |
| UX-09 confirm() vs Modal | 삭제 확인 native | ✅ 세션55 종결 — `ConfirmModal` 신설 + 6곳 교체 | T-UX3 ✅ |
| UX-10 주문 3중 sticky | 헤더+요약바+탭 모두 sticky | **사실상 해소** — 현재 sticky 1곳(`orders/page.tsx:164` 상태 탭)뿐. `top: var(--header-height)` 토큰화도 완료 | 종결 (작업 없음) |

추가로 진단 중 발견한 잔재(플랜에 포함):

- **fontSize 하드코딩** ~30곳 (admin 9파일·settlements 컴포넌트·hubs 픽업·settings·products 컴포넌트). UX-07의 settlements 탭 토큰화와 같은 결의 작업이라 별도 태스크(T-UX4)로 분리.
- **공통 `ConfirmModal` 부재** — `CancelOrderModal`은 도메인 전용. 6건 confirm() 교체 시 공통 컴포넌트 필요(T-UX3 첫 단계).

---

## 1. 태스크 분해 (아토믹 단위)

각 태스크는 **단독 PR/세션 단위**로 머지 가능하도록 분리. 의존성 화살표는 한 방향이며, 각각 자체 검증 가능.

```
T-UX1 (탭 단일화) ──┐
                    ├──> T-UX5 (정합성 검토)
T-UX2 (Badge 분리) ─┤
T-UX3 (Confirm 모달) ┤
T-UX4 (fontSize 토큰화)┘
```

T-UX1~4 상호 무관(다른 파일 영역). 순서는 자유, 권장은 **T-UX1 → T-UX3 → T-UX2 → T-UX4 → T-UX5** (공통 컴포넌트 신설이 있는 T-UX1/T-UX3 먼저).

### T-UX1 — 탭 스타일 단일화 (`SegmentedTabs` 공통 컴포넌트)

- **목적**: 주문·상품·정산 3개 페이지의 탭 스타일을 하나로 통일하여 앱 정체성 일관성 확보.
- **결정 필요 사항** (T-UX1 진입 시 사용자 확인):
  1. 색상 — `var(--color-primary)`(초록, 상품·정산 기준) vs `var(--color-text)`(검정, 주문 기준). 권장 **`--color-primary`** (브랜드 일관성).
  2. 강조 — `fontWeight: 700`(주문) vs `medium`(상품·정산). 권장 **medium + active 시 700**.
  3. 카운트 Badge 위치 — 주문만 Badge로 카운트 표시(`ACTION_REQUIRED` 빨강 점). 신설 컴포넌트가 카운트 prop 지원.
- **신설**: `apps/seller/src/components/SegmentedTabs.tsx` — `tabs: { key, label, count?, badgeColor? }[]` + `value`/`onChange`. sticky·non-sticky 양쪽 지원(prop).
- **치환 대상**:
  - `apps/seller/src/app/orders/page.tsx:160-195` (sticky, count + badgeColor)
  - `apps/seller/src/app/products/page.tsx:62-94` (non-sticky, label에 count 인라인)
  - `apps/seller/src/app/settlements/page.tsx:37-69` (sticky, count 없음, `top: 57` 매직넘버 → `var(--header-height)` 동시 수정)
- **검증**: `pnpm --filter seller typecheck`·`build` 통과, biome 신규 0건, dev 서버에서 3페이지 탭 시각 일치 + 클릭 동작 동일, e2e seller-orders.spec/settlements.spec smoke 영향 없음 확인.
- **추정**: 1세션 (컴포넌트 30~60라인 + 3페이지 치환).

### T-UX2 — 상품 카드 Badge-as-button 분리

- **목적**: 상태 표시(`판매 중`)와 액션(`수정`·`삭제`)의 시각·시맨틱 구분.
- **변경**:
  - `apps/seller/src/app/products/page.tsx:257-289` — `<Badge>` × 3 → 다음 패턴:
    - 판매 중 Badge: `Badge variant="light"` 유지하되 **non-interactive** (`component="button"` 제거). 토글은 별도 Mantine `Switch` 또는 `ActionIcon`(눈 모양)으로 분리.
    - 수정/삭제: Mantine `Button size="xs" variant="subtle"` 또는 `ActionIcon`(lucide `Pencil`/`Trash2`). 액션 어포던스 분명한 컴포넌트로 교체.
- **결정 필요**: 토글 패턴 — `Switch`(명시적 on/off) vs `ActionIcon`(눈 표시/숨김) vs `Badge + 별도 토글 메뉴`. 권장 **Switch + 아이콘 버튼(수정/삭제)**, 모바일 터치 타깃 44px 보장.
- **부수 효과**: 카드 액션 row 시각이 달라지므로 육안 검증 체크리스트 갱신.
- **검증**: typecheck/build/biome, dev 서버에서 토글·수정·삭제 동작 + 시각 구분 확인. e2e `apps/e2e/tests/seller-products.spec.ts`(있다면)에서 `getByRole('button', { name: '삭제' })` 셀렉터 영향 점검.
- **추정**: 1세션 (스타일+토글 패턴 결정 + UX 검증).

### T-UX3 — 공통 `ConfirmModal` + native `confirm()` 6건 교체 ✅ 세션55 완료

> 결과: `apps/seller/src/components/ConfirmModal.tsx` 신설(~75라인). 6건 전부 교체. 페이지 단일 state(products는 ProductCard 내부 state 예외). 셀러 타입체크·빌드(23라우트)·biome 신규 0건 통과. #CL-37 정책 등재. 상세는 `docs/archive/sessions/session55-prep.md` 결과 반영.


- **목적**: 삭제·승인·정지 확인 패턴 통일. native confirm은 모바일 PWA에서 OS chrome 의존이라 일관성·접근성 모두 떨어짐.
- **신설**: `apps/seller/src/components/ConfirmModal.tsx`
  - props: `opened`·`title`·`message`(string 또는 ReactNode)·`confirmLabel`·`cancelLabel`·`confirmColor`·`onConfirm`·`onClose`·`loading?`
  - 패턴: Mantine `Modal` 직접 사용(기존 `CancelOrderModal`과 동일 결).
  - 대안 검토: `@mantine/modals` 의 `openConfirmModal`. 장점은 hook 호출만으로 끝, 단점은 의존성 추가 + provider 셋업. 권장 **자체 컴포넌트**(이미 Modal 패턴 정착).
- **치환 대상** (각 페이지에서 `confirm()` 호출을 hook state + `<ConfirmModal>` 렌더링으로 전환):
  - `hubs/page.tsx:61` — 거점 삭제
  - `products/page.tsx:171` — 상품 삭제 (ProductCard 내부, state는 카드별)
  - `admin/drivers/_client.tsx:58` — 드라이버 승인
  - `admin/drivers/_client.tsx:66` — 드라이버 정지 (msg 가변)
  - `admin/settlements/_client.tsx:43` — 정산 지급 완료
  - `admin/users/_client.tsx:13` — 계정 정지/해제 (라벨 가변)
- **결정 필요**: 카드별 state vs 페이지 단일 state + targetId. 권장 **페이지 단일 state**(메모리 누수·prop drilling 최소).
- **검증**: typecheck/build/biome, dev 서버에서 6곳 모달 동작 + ESC/외부 클릭 닫힘 + 확인 시 비동기 처리(loading) 동작 확인. **백엔드 호출 경로는 변경 없음 → Railway 복구 후 e2e 영향 없음 예상**.
- **추정**: 1세션 (공통 컴포넌트 + 6곳 교체).

### T-UX4 — `fontSize` 하드코딩 토큰화 (잔여)

- **목적**: 디자인 시스템 일관성 + 향후 글로벌 폰트 스케일 변경 시 단일 진입점.
- **진행 상태**: ✅ **T-UX4a 완료**(세션57, admin 17건 → `var(--font-size-sm)` 통일). ✅ **T-UX4b 완료**(세션58, settlements/hubs/settings 10건/5파일 + `--font-size-xs: 12px` 신설 #CL-38). ✅ **T-UX4c 완료**(세션59, products `_components` 7건/3파일 — ImageUpload 5건 xs · AIPreviewPanel Mantine styles.input 15→sm · SellerNoteInput Mantine styles.input 16→md).
- **현황 (세션58 확정)**: `packages/ui/src/style.css` 정의 = `--font-size-xs: 12px`(세션58 신설) · `--font-size-sm: 15px` · `md: 16px` · `lg: 18px` · `xl: 20px` · `2xl: 24px`. 세션57 매핑 정책 — 12·14 모두 sm으로 통일(가독성). 세션58 보완 정책(#CL-38) — **의도적으로 작은 보조 인디케이터(셀 내부 카운트 라벨 등)에만 xs 허용**, 일반 보조 텍스트는 여전히 sm.
- **치환 대상** (`fontSize: <숫자>` → `var(--font-size-*)`):
  - admin 9파일 (`drivers/_client.tsx`·`invite/_client.tsx`×2·`layout.tsx`·`users/_client.tsx`×2·`settlements/_client.tsx`×4·`orders/_client.tsx`×3·`banner/_client.tsx`·`stores/_client.tsx`×3)
  - settlements 컴포넌트 (`page.tsx:56`은 T-UX1에서 처리됨·`DailySummaryTab.tsx:42`·`OrdersTab.tsx:46`·`PeriodTab.tsx:48,61,91`)
  - hubs (`[id]/pickup/page.tsx:180` — `20` → `--font-size-lg` 또는 신설)
  - settings (`delivery/page.tsx:181,244`·`daily-caps/page.tsx:277,313`)
  - products 컴포넌트 (`AIPreviewPanel.tsx:147`·`ImageUpload.tsx:102,121,140,168,194`·`SellerNoteInput.tsx:38`)
- **결정 필요**: 토큰 신설 여부. `fontSize: 9`(ImageUpload — 이미지 라벨)·`fontSize: 10`(daily-caps) 같은 작은 사이즈는 기존 `--font-size-xs`로 흡수 가능한지, 신설 필요한지 확인.
- **세분화**: 1회에 전부 하면 PR 크기 부담. 권장 분할:
  - T-UX4a: admin 9파일 (관리자 영역, 영향 범위 격리)
  - T-UX4b: settlements + hubs + settings (셀러 본 화면)
  - T-UX4c: products 컴포넌트 (상품 등록 폼 — 시각 회귀 주의)
- **검증**: 각 sub-task마다 typecheck/build/biome + dev 서버에서 시각 회귀 없음 확인. e2e 영향 없음(스타일만).
- **추정**: 1~3세션 (분할 정책에 따라).

### T-UX5 — 정합성 검토 (회귀·문서·SSOT)

- **목적**: T-UX1~4 머지 후 디자인 시스템·육안 검증 체크리스트·SSOT 정합성 확인.
- **체크리스트**:
  - [ ] `packages/ui/src/style.css` 정의된 모든 `--font-size-*` 토큰이 실제 사용처와 매핑되는가? 신설 토큰이 있으면 `CRITICAL_LOGIC.md`에 결정 기록.
  - [ ] `seller-refactor-visual-verify.md` (육안 검증 체크리스트)에 UX-07~09 항목 추가 — 탭 일관성·상품 카드 액션 구분·삭제 모달 6곳.
  - [ ] `apps/seller` 전역에서 `confirm(` 잔존 0건 (grep 검증).
  - [ ] `apps/seller` 전역에서 인라인 `fontSize: <숫자>` 잔존 0건 (grep 검증, AIPreviewPanel `styles.input.fontSize` 같은 Mantine API 경로는 예외 처리 — 결정 기록).
  - [ ] BACKLOG §11-3 UX-07·08·09 상태 ✅로 마킹 + 세션 번호·커밋 해시 기록. UX-10은 "세션41~45에서 자연 해소"로 ⏹️ 마킹.
  - [ ] e2e 풀런 (Railway 복구 후) 회귀 0건 — 특히 셀러 주문/상품/정산 spec, admin spec(있다면).
- **추정**: 0.5세션 (검토만, 변경 없으면 종결).

---

## 2. 세션 매핑 권장안

| 세션 | 태스크 | 비고 |
|------|--------|------|
| 53 | T-UX1 (탭 단일화) | 공통 컴포넌트 신설, 가장 시각 임팩트 큼 |
| 54 | T-UX3 (Confirm 모달) | 공통 컴포넌트 신설, 6곳 교체 |
| 55 | T-UX2 (Badge 분리) | 상품 카드 UX 결정 필요 |
| 56 | T-UX4a (admin fontSize) | 격리된 영역, 안전 |
| 57 | T-UX4b (settlements/hubs/settings fontSize) | 본 화면, 시각 회귀 주의 |
| 58 | T-UX4c (products _components) + T-UX5 | 마무리 + 정합성 검토 |

> 각 세션 진입 시 진입 문서(`docs/archive/sessions/sessionNN-prep.md`) 작성 + 결정 필요 사항을 사용자에게 질의 후 진행. Railway 복구 상태와 무관하게 진행 가능.

---

## 3. 미결정 사항 (각 태스크 진입 시 사용자 확정)

- T-UX1: 탭 색상(초록 vs 검정), 강조(medium vs 700)
- T-UX2: 상품 카드 토글 패턴(Switch vs ActionIcon vs Badge+메뉴)
- T-UX3: 카드별 state vs 페이지 단일 state
- T-UX4: 작은 사이즈(9·10·11px) 토큰 신설 여부

---

## 4. 진행 규칙

- 각 태스크는 별도 커밋. 메시지 패턴 `refactor(seller): UX-XX <짧은 설명> (T-UXn)`.
- 태스크 완료 시 BACKLOG §11-3·§1·§12-1·`memory.md` 동기 갱신.
- 결정 사항은 `CRITICAL_LOGIC.md`에 추가(특히 신설 컴포넌트·신설 토큰).
- 백엔드(Railway) 무관 작업이므로 Outage와 병행 가능. T-UX5 e2e 검증만 복구 대기.

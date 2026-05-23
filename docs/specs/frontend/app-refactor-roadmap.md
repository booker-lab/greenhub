# 멀티앱 프론트 리팩토링 로드맵

> 작성: 2026-05-24 (세션83) · 목적: **셀러앱 리팩토링 완료**를 기준선으로 삼아, 소비자·어드민·드라이버 앱을 차례대로 같은 패턴으로 리팩토링하기 위한 진행 현황·진입점 한눈 보기.
> 성격: 앱별 상세 아토믹 플랜은 각 앱 리팩토링 착수 세션에서 별도 작성. 이 문서는 **순서·현황·레퍼런스**만 관리한다.

---

## 진행 현황 한눈 보기

| 앱 | 위치 | 리팩토링 상태 | 육안 검증 | 비고 |
|----|------|--------------|----------|------|
| **셀러** | `apps/seller` | ✅ **완료** (A~F, 세션39~59) | ✅ 완료 (M-PATH, 세션83) | 기준선·레퍼런스 패턴 |
| **소비자** | `apps/consumer` | ⚠️ 부분 (DS 감사만, 2026-05-02) | ⏳ C 섹션 미진행 | 디자인시스템 위반 18건 목록 존재 |
| **어드민** | `apps/seller/src/app/admin` | 🔴 미착수 | 🔴 미진행 | **모바일 반응형 미적용**(세션83 발견) |
| **드라이버** | `apps/driver` | 🔴 미착수 | 🔴 미진행 | board·map·login·profile |

---

## 리팩토링 순서 (사용자 결정)

**셀러 → 소비자 → 어드민 → 드라이버** 차례로 진행.

### 1. 셀러앱 — ✅ 완료 (기준선)

- 범위 A~F: 홈 대시보드·주문 탭·소비자 배송일 풀스택·셀러 IA·정산 탭(SETTLE-REFACTOR)·UX 잔여(폰트 토큰화·ConfirmModal·SegmentedTabs).
- 육안 검증: `seller-refactor-visual-verify.md` M-PATH(M0~M6) 완주(세션83).
- **레퍼런스로 삼을 패턴**: `_lib/`·`_hooks/`·`_components/` SDD 분리 / `@greenhub/shared` 타입·상수 SSOT / `packages/ui/src/style.css` 토큰(인라인 fontSize 0·hex 0) / 공통 `ConfirmModal`·`SegmentedTabs` / 500라인 모듈화 한도.

### 2. 소비자앱 — ⚠️ 부분 (다음 차례)

- **기존 산출물**: `design-system-refactor-plan.md`(2026-05-02) — CSS 토큰 위반 18건 목록(BottomNav·ProductTopBar `fontSize:10` 설계 논의 2건 포함). 이 플랜이 착수 진입점.
- **남은 육안**: M-PATH C 섹션(소비자 배송일 선택 #58~73) — 소비자 계정·소비자 앱 진입. 상품 상세→장바구니→체크아웃 흐름. 시드 베이스라인 = `seed-e2e-orders.mjs` dailyCaps 14일치.
- 라우트: cart·category·checkout·groupbuy·login·mypage·products·search·order.

### 3. 어드민 — 🔴 미착수

- **세션83 발견 결함**(BACKLOG 등재): 어드민 콘솔(`apps/seller/src/app/admin`)이 **모바일 PWA 폭 미최적화** — 정산 테이블 7컬럼 중 상태·지급처리버튼이 화면 밖으로 잘림. stores/users/orders/drivers 테이블도 동일 점검 필요.
- **방향**: 데스크톱 테이블 → 모바일 카드형 전환 또는 가로 스크롤. 셀러 컴포넌트(SegmentedTabs·ConfirmModal·토큰) 재사용.
- 탭: 판매자·소비자·드라이버·주문·정산·초대·배너.

### 4. 드라이버앱 — 🔴 미착수

- 라우트: board(수거 보드)·map·login·profile.
- 착수 시 별도 감사·아토믹 플랜 작성.

---

## 공통 리팩토링 원칙 (셀러에서 확립)

1. **로직 불변** — 훅/API/비즈니스 로직 수정 금지, UI 스타일 레이어만.
2. **토큰 SSOT** — 인라인 `fontSize`/hex 색상 0, `packages/ui/src/style.css` 토큰(`var(--font-size-*)`·`var(--color-*)`). 시각 회귀 시 **한 단계 위/아래 토큰으로만 조정, 토큰 값 자체 변경 금지**.
3. **타입/상수 SSOT** — 앱별 중복 정의 제거, `@greenhub/shared`로 통합(정산 `settlement.types.ts` 선례).
4. **SDD 분리** — `_lib/`(순수함수)·`_hooks/`·`_components/` 분리, 페이지는 조립만. 단일 파일 500라인 초과 시 분리.
5. **공통 컴포넌트 재사용** — `ConfirmModal`(native confirm 금지)·`SegmentedTabs`.
6. **육안 검증** — 각 앱 리팩토링 후 `seller-refactor-visual-verify.md` 패턴으로 검증 동선 추가.

---

## 검증 환경 주의 (세션83 실측)

- **로그인은 카카오만** — 이메일 폼은 `E2E_TEST=true`+`x-e2e-test-token` 헤더 필요(Playwright 전용, 사람 브라우저 불가).
- **운영 = 단일 Firebase `green-e4fe3`** — 스테이징 없음. 시드/삭제는 실데이터 직접 작용.
- **육안용 시드는 로그인 store의 storeId로** — 리팩토링 이전 더미는 신스키마 필드 누락이라 `scripts/reset-store-data.mjs`로 재시드 권장.
- 검증/시드 스크립트: `reset-store-data`·`seed-settlements-visual`·`seed-prep-today`·`seed-orderdate-spread`·`test-settlement-query`·`peek-store`·`list-stores`·`find-store-by-order`.

---

## 관련 문서

- `seller-refactor-visual-verify.md` — 셀러 육안 검증 체크리스트(M-PATH) + 소비자 C 섹션
- `design-system-refactor-plan.md` — 소비자 디자인시스템 감사(위반 18건)
- `docs/BACKLOG.md` §1(seller)·§1-8(admin) — 후속 결함 목록
- `docs/CRITICAL_LOGIC.md` #CL-46·47 — 정산 라이브 결함 결정 기록

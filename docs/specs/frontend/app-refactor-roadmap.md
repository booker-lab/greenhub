# 멀티앱 프론트 리팩토링 로드맵

> 작성: 2026-05-24 (세션83) · 목적: **셀러앱 리팩토링 완료**를 기준선으로 삼아, 소비자·어드민·드라이버 앱을 차례대로 같은 패턴으로 리팩토링하기 위한 진행 현황·진입점 한눈 보기.
> 성격: 앱별 상세 아토믹 플랜은 각 앱 리팩토링 착수 세션에서 별도 작성. 이 문서는 **순서·현황·레퍼런스**만 관리한다.

---

## 진행 현황 한눈 보기

| 앱 | 위치 | 리팩토링 상태 | 육안 검증 | 비고 |
|----|------|--------------|----------|------|
| **셀러** | `apps/seller` | ✅ **완료** (A~F, 세션39~59) | ✅ 완료 (M-PATH, 세션83) | 기준선·레퍼런스 패턴 |
| **소비자** | `apps/consumer` | ⚠️ 부분 (DS 감사만, 2026-05-02) | ⏳ C 섹션 미진행 | 디자인시스템 위반 18건 목록 존재 |
| **어드민** | `apps/seller/src/app/admin` | ✅ **완료** (반응형 세션88 + SDD 분리 세션91) | ⏳ 상태변경 육안만 | 7개 탭 전부 _lib/_components 분리 |
| **드라이버** | `apps/driver` | ✅ 완료 (board·map·photo·login·profile 분리 + Kakao 지도 1차) | ⏳ 운영 키·좌표 데이터 확인 필요 | 지도 실렌더 확인만 잔여 |

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

### 3. 어드민 — ✅ 완료

- **반응형(세션88, #CL-51)**: 5개 테이블(settlements·orders·stores·invite·users) 모바일 카드형 전환 — 세션83 발견 "정산 테이블 7컬럼 잘림" 결함 해소. `hiddenFrom`/`visibleFrom` 분기.
- **SDD 분리(세션91, #CL-54)**: settlements 모범 패턴(`_lib`·`_components` 분리, `_client`는 조립만)을 나머지 6개 탭(stores·orders·invite·users·drivers·banner)에 적용. 각 탭 모놀리식 `_client`(223~335라인)를 순수함수(`_lib.ts`)·표현 컴포넌트(`_components/`)로 분해.
  - 원칙: 로직·hook·API 불변, DOM 동일(시각 회귀 0). 라벨/색·필터·상태판정 등 중복 로직을 `_lib`로 SSOT화. 순수함수 없는 탭(users·banner)은 `_lib` 미생성(과분할 회피).
  - 정합성: 탭마다 tsc0·biome0·build0·500라인 한도(최대 212라인) 통과 후 개별 커밋.
- 탭: 판매자(stores)·소비자(users)·드라이버(drivers)·주문(orders)·정산(settlements)·초대(invite)·배너(banner).
- **잔여**: 상태변경(치우기·복구·차단·환불·승인) 육안 검증 — `pending-visual-verify.md` §4. 순수 표현 레이어 리팩토링이라 e2e 회귀 위험은 낮음.

### 4. 드라이버앱 — ⚠️ 부분 완료

- 완료: `driver-app-refactor-plan.md`로 board·map 순수 로직, 상세/사진 업로드 판정, 사진 UI, login·profile 화면 조립 책임을 분리했다.
- 완료: `driver-kakao-map-plan.md`로 `/map` Kakao Maps JavaScript SDK 1차 표시를 추가했다. 키·좌표가 없으면 기존 플레이스홀더를 유지한다.
- 잔여 검증: 운영 `NEXT_PUBLIC_KAKAO_MAP_KEY`와 좌표 포함 주문 데이터가 있는 환경에서 실제 지도 렌더링 육안 확인.

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

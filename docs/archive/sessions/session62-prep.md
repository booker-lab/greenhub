# 세션62 진입 문서 — T-CLEAN1 biome baseline 정리

> 작성: 2026-05-21 (세션61 후속 종료) · 선행: 세션61 본편 e2e 회귀 가드 fix(`f6c275b`) + 세션61 후속 셀러앱 종합 점검 + 정리 플랜 수립(코드 변경 0건).
> 목표: 셀러앱 biome **40 errors / 16 warnings → 5 errors 이내**. `seller-cleanup-plan.md` T-CLEAN1 실행.
> 예상: 1세션 (1~3 커밋).

---

## 1. 세션61 컨텍스트 요약

**세션61 본편**: e2e 풀런 회귀 가드 fix — consumer mypage OrderCard에 `data-testid="order-card"` 부여 + seller OrderCard에 `{order.productName && <Text lineClamp={1}>}` 옵셔널 라인(UX 개선 겸 e2e 가드). 세션60 dispatch 3회 동일 2건 실패 → 스크린샷 아티팩트 직접 대조로 **회귀 아님 / 누적 selector 불일치** 확정. 수동 dispatch 26204985493 success 전건 통과. 커밋 `f6c275b`.

**세션61 후속**: 셀러앱 리팩토링(세션 28~60) 전수 점검 + 정리 플랜 신설. 전반 양호 평가(500라인 한도 0건 위반·#CL-27~38 9건 결정 일관·공통 컴포넌트 3종·`apiJson` 통일·디자인 토큰 100% 커버). 개선 필요 4건 도출 → T-CLEAN1~3 3 아토믹 세션 플랜(`docs/specs/frontend/seller-cleanup-plan.md`) 신설. 사용자 결정 4건(진행 순서·Lint 범위·alert 대체·정합성 검토 시점).

---

## 2. 사전 정합성 검토 (세션 진입 시 실행)

5항목 확인 후 진입. 불일치 발견 시 작업 중단·플랜 갱신·사용자 합의 후 재개.

### 2-1. 이전 세션 머지 상태
- [ ] `git log --oneline -5` — `f6c275b`(세션61 회귀 가드 fix) main 머지 확인
- [ ] `git status` — clean working tree 확인 (untracked `.claude/` 외)

### 2-2. biome baseline 일치
- [ ] `npx biome check apps/seller/src --max-diagnostics=120` 실행
- [ ] **errors 40 · warnings 16 · info 1** baseline 일치 확인 (drift 시 플랜 갱신)
- [ ] FIXABLE `assist/source/organizeImports` 약 25건 존재 확인

### 2-3. 의존성 상태
- [ ] `pnpm-lock.yaml` 미변경 확인 (T-CLEAN1은 신규 의존성 없음 — T-CLEAN2 도입 예정)
- [ ] `@biomejs/biome` 버전 변경 없음 확인

### 2-4. e2e baseline
- [ ] 직전 풀런 결과 — 수동 dispatch 26204985493 success 전건 통과(세션61)
- [ ] T-CLEAN1은 정적 코드 변경만이라 e2e 영향 예상 없음

### 2-5. 500라인 한도
- [ ] `npx biome check --write`로 format 자동 정리 시 라인 수 변동 가능
- [ ] 자동 수정 후 `daily-caps/page.tsx` 339라인이 500 한도 안에 머무는지 사후 확인

---

## 3. 사용자 결정 대기 항목 (세션 진입 시 질문)

T-CLEAN1 본격 시작 전 2건 확인:

### 3-1. noArrayIndexKey ImageUpload 처리
- 위치: [ImageUpload.tsx:85](apps/seller/src/app/products/_components/ImageUpload.tsx#L85)
- 시나리오: 상품 이미지 reorder/swap이 가능한가?
- 옵션:
  - **A. 실제 reorder 가능 → 이미지 id/url 기반 키로 마이그레이션** (코드 변경, 회귀 표면 작음)
  - **B. reorder 없음(추가/삭제만) → `biome-ignore` + 사유 "이미지 순서 변경 불가, index가 안정 키"** (코드 변경 0)
- 사전 조사: ImageUpload 컴포넌트의 reorder 핸들러 존재 여부 확인

### 3-2. noNonNullAssertion auth.ts env 변수
- 위치: [auth.ts:5,34,35](apps/seller/src/auth.ts#L5)
- 패턴: `process.env.API_BASE_URL!` 형태
- 옵션:
  - **A. 가드 추가** — 모듈 최상위 `if (!process.env.X) throw new Error(...)` (런타임 fail-fast)
  - **B. `biome-ignore` + 사유** — "Next 빌드 시점 `NEXT_PUBLIC_*` 인라인 보장 / 서버 측은 Vercel env 6환경 등록 완료"
- 권장: B (기존 결정 #CL-20·#CL-21로 env 등록은 보장됨, 가드 추가는 런타임 부담)

---

## 4. T-CLEAN1 작업 체크리스트

`seller-cleanup-plan.md` §T-CLEAN1 그대로 수행. 각 Phase는 별도 커밋.

### Phase A — 자동 수정 (1 커밋)
- [ ] `npx biome check apps/seller/src --write` 실행
- [ ] 자동 수정 항목 확인:
  - organizeImports FIXABLE 약 25건
  - format 항목 (CSS 공백·줄바꿈)
- [ ] 자동 수정 후 `npx biome check apps/seller/src` 재측정 → ~15 errors 기대
- [ ] `npx tsc --noEmit` (apps/seller/) exit 0
- [ ] `pnpm --filter seller build` (23라우트) 통과
- [ ] 커밋 — `chore(seller): biome --write 자동 수정 (organizeImports + format)`

### Phase B — 안전한 수동 fix (1~2 커밋)
- [ ] `lint/correctness/noUnusedImports` — [useOrders.ts:7](apps/seller/src/hooks/useOrders.ts#L7) 미사용 import 제거
- [ ] `lint/style/useTemplate` — [useSettlements.ts:52](apps/seller/src/app/settlements/_hooks/useSettlements.ts#L52) 문자열 연결 → 템플릿 리터럴
- [ ] `lint/suspicious/noArrayIndexKey` 5건 처리:
  - daily-caps:233,235 (캘린더 주/요일) — `biome-ignore` + 사유 명시
  - pickup:165 (OTP 박스 6개 고정) — `biome-ignore` + 사유 명시
  - AIPreviewPanel:73 (AI 미리보기 list) — 데이터 구조 검토 후 처리
  - ImageUpload:85 — **§3-1 사용자 결정에 따라 처리**
- [ ] 빌드·타입체크 통과
- [ ] 커밋 — `fix(seller): biome lint 수동 fix (noUnusedImports·useTemplate·noArrayIndexKey)`

### Phase C — biome-ignore + 사유 명시 (1 커밋)
- [ ] `noNonNullAssertion` 6건 처리:
  - auth.ts:5,34,35 — **§3-2 사용자 결정에 따라 처리**
  - useFirebaseAuth.ts:12 — 검토 후 처리
  - admin/banner/_client.tsx 4건 — 검토 후 처리
- [ ] `noAssignInExpressions` (VarietySelector:54) — 기존 코드, 리팩토링 vs ignore 판단
- [ ] 모든 ignore에는 **사유 1줄 주석** 동반 필수
- [ ] 커밋 — `chore(seller): biome-ignore 사유 명시 + 잔여 lint 정리`

---

## 5. 범위 외 (본 세션 처리 금지)

- `lint/performance/noImgElement` 2건 ([onboarding:186](apps/seller/src/app/onboarding/page.tsx#L186)·[ImageUpload:96](apps/seller/src/app/products/_components/ImageUpload.tsx#L96)) — Next/Image 마이그레이션은 LCP 영향 측정 필요한 별건
- consumer·driver 앱 — 셀러 한정
- 신규 의존성 도입 — T-CLEAN2에서
- 코드 동작 변경 — Phase B의 수동 fix는 동작 보존 (template literal·미사용 import 제거는 의미상 동치)

---

## 6. 종결 조건

- [ ] `npx biome check apps/seller/src` errors **5건 이내** · 신규 0건 (전체 카운트 감소)
- [ ] 셀러 타입체크 exit 0
- [ ] `pnpm --filter seller build` 23라우트 통과
- [ ] 모든 `biome-ignore`에 사유 주석 동반
- [ ] BACKLOG §12-1 셀러앱 정리 작업 행에 T-CLEAN1 ✅ 진행 표기
- [ ] memory.md 세션62 진행 추가
- [ ] e2e 영향 없음 — 정적 코드 변경만, 풀런 재실행 불필요 (세션61 success 풀런이 baseline 유지)

---

## 7. 세션63 이월 사항

- **T-CLEAN2 진입 준비**:
  - `@mantine/notifications` 패키지 도입 예정 (신규 의존성)
  - `alert()` 3건 위치 재확인 (admin/orders·settlements·stores)
  - #CL-39 신규 등재 예정 (셀러앱 알림 패턴: Mantine notifications 단일화)
  - 세션62 완료 후 `session63-prep.md` 작성

---

## 8. 참조

- 플랜 SSOT: [seller-cleanup-plan.md](../../specs/frontend/seller-cleanup-plan.md) §T-CLEAN1
- 점검 보고서 컨텍스트: 세션61 후속 (memory.md)
- biome baseline 기록: 세션60 종료 시점 40 errors / 16 warnings / 1 info
- 관련 결정: #CL-32 P3(useAdmin 팩토리, baseline 일부 영향)·#CL-36~38(세션54~58 자동 포맷 부수효과)

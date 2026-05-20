# 세션57 진입 문서 — T-UX4a admin fontSize 토큰화

> 작성: 2026-05-21 (세션56 종료) · 선행: 세션56 T-UX2 `ProductCard Switch+Button` 완료
> 목표: ① 머지 상태 가드(타입체크·biome 재확인), ② T-UX4a 진입 — `apps/seller/src/app/admin/**` 의 하드코딩 fontSize(숫자 리터럴) 17건을 `var(--font-size-*)` 토큰으로 치환

---

## 1. 세션56 컨텍스트 요약

T-UX2 완료. `apps/seller/src/app/products/page.tsx` ProductCard에서 Badge×3 → ① `Switch`(상품명 우측, 활성 토글) ② `Button subtle gray`(수정) ③ `Button subtle red loading`(삭제) 분리. 사용자 결정 모두 권장안 채택. 셀러 타입체크 통과·`pnpm --filter seller build` 통과(23라우트)·biome baseline 68→64 errors·신규 0건.

**플랜 권장 순서** [seller-ux-residual-plan.md](../../specs/frontend/seller-ux-residual-plan.md) §2 표대로 세션57은 T-UX4a(admin 영역 fontSize). T-UX4b(셀러 본 화면)·T-UX4c(상품 컴포넌트)는 세션58~59 예정.

---

## 2. T-UX4a 진입 — 결정 필요 사항 (사용자 확정)

플랜 §1 T-UX4 기준. 진입 전 사용자 합의:

- [ ] **토큰 매핑 정책**: `fontSize: 12` → `var(--font-size-xs)` / `14` → `var(--font-size-sm)` / `15·16` → `var(--font-size-md)` / `18`+ → `var(--font-size-lg)`. **권장 — 이 매핑 그대로**(세션52 T7-B fontSize 토큰화에서 채택한 정책 동일). 단, 표 셀(`width:100%; fontSize:14` 등 테이블 baseline)은 sm 동일.
- [ ] **변환 범위**: ① **숫자 리터럴만**(17건) — 이미 `var(--font-size-*)`로 토큰화된 19건은 건드리지 않음. 권장 **①**(시각 회귀 위험 최소화). ② 전체 fontSize를 layout 토큰으로 재검토 — 범위 확장 위험.
- [ ] **검증 강도**: ① 타입체크·빌드·biome + dev 서버에서 admin 7페이지 시각 회귀 스팟 체크(layout·banner·drivers·invite·orders·settlements·stores·users). 권장 **①**. ② e2e 추가 — admin 영역 e2e 미비, 스킵.
- [ ] **시각 회귀 발견 시**: 정책. 권장 **그 자리에서 token을 한 단계 위(sm→md)로 조정** 후 결과 기록. md 토큰 자체 변경 금지(다른 화면 영향).

---

## 3. T-UX4a 작업 계획

### 3-1. 변경 대상 (17건, 7파일)

```
banner/_client.tsx:116        fontSize: 14   → var(--font-size-sm)
drivers/_client.tsx:122       fontSize: 14   → var(--font-size-sm)
invite/_client.tsx:144        fontSize: 14   → var(--font-size-sm)
invite/_client.tsx:224        fontSize: 12   → var(--font-size-xs)
layout.tsx:53                 fontSize: 14   → var(--font-size-sm)
orders/_client.tsx:103        fontSize: 14   → var(--font-size-sm)
orders/_client.tsx:169        fontSize: 12   → var(--font-size-xs)
orders/_client.tsx:177        fontSize: 12   → var(--font-size-xs)
settlements/_client.tsx:91    fontSize: 14   → var(--font-size-sm)
settlements/_client.tsx:102   fontSize: 14   → var(--font-size-sm)
settlements/_client.tsx:158   fontSize: 14   → var(--font-size-sm)
settlements/_client.tsx:235   fontSize: 12   → var(--font-size-xs)
stores/_client.tsx:... (잔여)  fontSize: 14   → var(--font-size-sm)
users/_client.tsx:... (잔여)  fontSize: 14   → var(--font-size-sm)
```

실제 진행 시 `grep -rnE "fontSize:\s*[0-9]+" apps/seller/src/app/admin --include="*.tsx"`로 17건 재확인 후 일괄 Edit.

### 3-2. 검증

```powershell
pnpm --filter seller exec tsc --noEmit
pnpm --filter seller build  # 23라우트
pnpm -w biome check --write apps/seller/src/app/admin
```

dev 서버(`pnpm --filter seller dev`):
- [ ] `/admin` layout — 메뉴 라벨 fontSize 자연스러움
- [ ] `/admin/banner` — 입력 폼·표 시각 회귀 없음
- [ ] `/admin/drivers` — 카드 정보 정상
- [ ] `/admin/invite` — 표·복사 코드
- [ ] `/admin/orders` — 표 헤더·셀
- [ ] `/admin/settlements` — 표 + 입력 폼
- [ ] `/admin/stores` · `/admin/users` — 표 baseline

e2e: admin 영역 spec 부재 → 추가 없음. Railway 복구 후 기존 167+ spec 풀런 영향 없음 확인.

### 3-3. 커밋·문서

- 커밋: `refactor(seller): UX-04a admin fontSize 토큰화 17건 (T-UX4a)` (UX-04 = fontSize 토큰화 카테고리. UX-08 자리는 세션56에서 소진 → T-UX4 시리즈는 신규 UX 카테고리 없이 플랜 T-ID로 추적)
- BACKLOG §12 활동 로그 세션57 추가, §12-1 우선순위 표 셀러 UX 잔여 P3 항목에 T-UX4a ✅ 마킹
- memory.md 갱신(72→...라인, 200 한도 모니터링)
- CRITICAL_LOGIC — fontSize 토큰화는 #CL-31 이전 결정과 같은 결의 작업이라 신규 #CL 등재 불필요(정책 변경 없음). 단, 세션52 T7-B 매핑이 admin까지 확장 적용된다는 메모는 활동 로그에 명시.
- visual-verify F-T-UX4a 섹션 추가(#124~)
- 세션58 진입 문서 작성 (T-UX4b settlements/hubs/settings)

---

## 4. 세션57 완료 기준

- [ ] §2 결정 사항 사용자 합의
- [ ] admin 17건 fontSize 토큰 치환
- [ ] 타입체크·빌드·biome 통과·신규 0건
- [ ] BACKLOG·memory·visual-verify 갱신 + 세션58 진입 문서 작성
- [ ] 커밋 1건

---

## 5. 참조

- 플랜 SSOT: [`docs/specs/frontend/seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX4·§2 표(세션56~58)
- 세션56 결과: [`session56-prep.md`](session56-prep.md) (T-UX2 ProductCard Switch+Button)
- CRITICAL_LOGIC #CL-36(SegmentedTabs)·#CL-37(ConfirmModal) — T-UX4는 정책 변경 없음
- 토큰 정의: `packages/shared/styles/tokens.css` 또는 globals.css `--font-size-xs/sm/md/lg/xl/2xl`

---

## 6. 진행 규칙

- Railway Outage와 무관하게 진행. 백엔드 호출 경로 변경 없음.
- 사용자 명시 승인 후 진입.
- 시각 회귀 시 token을 한 단계 위로 조정해도 좋으나, 디자인 시스템 토큰 자체 값은 변경 금지.
- T-UX4b/c는 본 세션 범위 외 — 별도 세션으로 분리.

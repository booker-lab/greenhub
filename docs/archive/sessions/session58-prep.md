# 세션58 진입 문서 — T-UX4b 셀러 본 화면 fontSize 토큰화

> 작성: 2026-05-21 (세션57 종료) · 선행: 세션57 T-UX4a admin 17건 토큰화 완료
> 목표: ① 머지 상태 가드(타입체크·biome 재확인), ② T-UX4b 진입 — 셀러 본 화면(settlements 컴포넌트·hubs·settings)의 하드코딩 fontSize 10건을 `var(--font-size-*)` 토큰으로 치환

---

## 1. 세션57 컨텍스트 요약

T-UX4a 완료. `apps/seller/src/app/admin/**` 의 하드코딩 `fontSize: 숫자` **17건/7파일** → `fontSize: 'var(--font-size-sm)'`. **매핑 재설계**: 진입점 권장 `12→xs, 14→sm`이 현 토큰 정의(sm=15·md=16·lg=18·xl=20·2xl=24, **xs 미정의**)와 불일치 → 사용자 결정으로 12·14 모두 sm 통일. 셀러 타입체크 exit 0·빌드 23라우트·biome 전체 baseline 64→63 errors(자동 포맷 부수효과)·admin 폴더 errors 0건. 시각 검증은 사용자 합의로 생략(정적 검증만).

**플랜 권장 순서** [seller-ux-residual-plan.md](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX4 — 세션58 = T-UX4b(셀러 본 화면), 세션59 = T-UX4c(products 컴포넌트), 세션60 = T-UX5(정합성 검토).

---

## 2. T-UX4b 진입 — 결정 필요 사항 (사용자 확정)

세션57 매핑 정책 = **12·14 모두 sm(15px)로 통일**. 본 화면도 동일 정책 적용 권장.

- [ ] **토큰 매핑 정책 (재확인)**: 12·13·14 → `var(--font-size-sm)` / 15·16 → `var(--font-size-md)` / 18~20 → `var(--font-size-lg)`. 권장 — **세션57과 동일 정책 + 13(DailySummaryTab)은 sm, 20(hubs pickup)은 lg**. 본 화면은 admin보다 시각 회귀 영향 큼 → 변경 전 사용자 합의 필수.
- [ ] **Mantine `styles={{ input: { fontSize: ... } }}` 경로**: `AIPreviewPanel.tsx:147`(15)·`SellerNoteInput.tsx:38`(16)은 본 세션 범위 외(T-UX4c에서 다룸). 변환 시 Mantine 컴포넌트 props 검증 필요.
- [ ] **검증 강도**: ① 타입체크·빌드·biome + dev 서버에서 settlements 3탭·hubs pickup·settings 2페이지 스팟 체크. 권장 **①**. ② 정적만(세션57처럼) — 셀러 본 화면이라 시각 회귀 위험 큼, 권장하지 않음.
- [ ] **시각 회귀 발견 시**: 세션57과 동일 — 해당 자리만 한 단계 위 토큰으로 조정(sm→md), 토큰 자체 값은 변경 금지.

---

## 3. T-UX4b 작업 계획

### 3-1. 변경 대상 (10건, 5파일)

```
settlements/_components/DailySummaryTab.tsx:42   fontSize: 13   → var(--font-size-sm)
settlements/_components/OrdersTab.tsx:46         fontSize: 12   → var(--font-size-sm)
settlements/_components/PeriodTab.tsx:48         fontSize: 14   → var(--font-size-sm)
settlements/_components/PeriodTab.tsx:61         fontSize: 14   → var(--font-size-sm)
settlements/_components/PeriodTab.tsx:91         fontSize: 12   → var(--font-size-sm)
hubs/[id]/pickup/page.tsx:180                    fontSize: 20   → var(--font-size-lg) [18px, -2px]
settings/daily-caps/page.tsx:277                 fontSize: 10   → var(--font-size-sm) [+5px, 시각 회귀 위험]
settings/daily-caps/page.tsx:313                 fontSize: 14   → var(--font-size-sm)
settings/delivery/page.tsx:181                   fontSize: 14   → var(--font-size-sm)
settings/delivery/page.tsx:244                   fontSize: 14   → var(--font-size-sm)
```

**주의 케이스**:
- `daily-caps:277 fontSize: 10` → sm(15px)은 +5px 큰 변화. **신설 토큰 `--font-size-xs: 12px` 검토** 또는 그대로 sm 흡수(가독성 개선 효과).
- `hubs/pickup:180 fontSize: 20` → lg(18px)는 -2px 축소. 픽업 화면 강조 텍스트일 가능성 → xl(20px) 채택 검토.

진행 시 `grep -rnE "fontSize:\s*[0-9]+" apps/seller/src --include="*.tsx"`로 잔여 재확인 (T-UX4c 대상은 products 컴포넌트 7건).

### 3-2. 검증

```powershell
pnpm --filter seller exec tsc --noEmit
pnpm --filter seller build  # 23라우트
pnpm -w biome check --write apps/seller/src/app/settlements apps/seller/src/app/hubs apps/seller/src/app/settings
```

dev 서버(`pnpm --filter seller dev`):
- [ ] `/settlements` 일별/주문/기간 3탭 — 합계·라벨·하이라이트 폰트 자연스러움
- [ ] `/hubs/[id]/pickup` — 픽업 강조 텍스트(20px → lg)
- [ ] `/settings/daily-caps` — 10px 자리(요일 인디케이터?) 가독성 확인
- [ ] `/settings/delivery` — 옵션 라벨 폰트

e2e: settlements·hubs·settings spec 존재 → Railway 복구 후 풀런 영향 없음 확인.

### 3-3. 커밋·문서

- 커밋: `refactor(seller): UX-04b 본 화면 fontSize 토큰화 10건 (T-UX4b)`
- BACKLOG §12 활동 로그 세션58 추가, §12-1 표 T-UX4b ✅ 마킹
- memory.md 갱신(82→...라인, 200 한도 모니터링)
- CRITICAL_LOGIC — 토큰 신설(`--font-size-xs`) 결정 시 #CL 등재. 매핑 정책 변경 없으면 생략.
- visual-verify F-T-UX4b 섹션 추가(#135~)
- 세션59 진입 문서 작성 (T-UX4c products 컴포넌트 7건)

---

## 4. 세션58 완료 기준

- [ ] §2 결정 사항 사용자 합의 (특히 `fontSize: 10` 처리·`fontSize: 20` 처리)
- [ ] 본 화면 10건 fontSize 토큰 치환
- [ ] 타입체크·빌드·biome 통과·신규 0건
- [ ] BACKLOG·memory·visual-verify 갱신 + 세션59 진입 문서 작성
- [ ] 커밋 1건

---

## 5. 참조

- 플랜 SSOT: [`docs/specs/frontend/seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX4 (세션57에서 진행 상태·매핑 정책 업데이트됨)
- 세션57 결과: [`session57-prep.md`](session57-prep.md) (T-UX4a admin 17건)
- 토큰 정의: `packages/ui/src/style.css` `--font-size-sm/md/lg/xl/2xl` (xs 미정의 — 본 세션에서 신설 여부 결정 필요)

---

## 6. 진행 규칙

- Railway Outage와 무관하게 진행. 백엔드 호출 경로 변경 없음.
- 사용자 명시 승인 후 진입.
- 셀러 본 화면이라 admin보다 시각 회귀 위험 큼 — 정적 검증만으로 갈음하기 전에 사용자 확인 필수.
- T-UX4c(products 컴포넌트 7건)는 별도 세션.

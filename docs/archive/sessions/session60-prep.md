# 세션60 진입 문서 — T-UX5 정합성 검토 (T-UX4 시리즈 종결 후 회귀·SSOT 확인)

> 작성: 2026-05-21 (세션59 종료) · 선행: 세션59 T-UX4c products `_components` 7건 토큰화 — **T-UX4 시리즈 a/b/c 전부 종결**.
> 목표: 셀러 UX 잔여(UX-07~09) 정합 플랜의 마지막 단계인 **T-UX5 정합성 검토**. 변경 없으면 0.5세션 종결 예상.

---

## 1. 세션59 컨텍스트 요약

T-UX4c 완료. products `_components` 7건/3파일 토큰화. `ImageUpload.tsx` 5건(9·9·9·11·12px) 모두 `var(--font-size-xs)`로 흡수(#CL-38 "의도적 작은 보조 인디케이터" 정책 일관 적용). Mantine `styles.input.fontSize` 2건(AIPreviewPanel 15→sm·SellerNoteInput 16→md)도 토큰화 — emotion이 CSS 변수 통과 처리, 타입체크 exit 0으로 검증. 셀러 타입체크 exit 0·빌드 23라우트·biome 대상 폴더 errors 0건·전체 baseline 63→1 error(자동수정 부수효과)·신규 0건. **`grep fontSize:\s*[0-9]+` 잔여 0건 확인.**

---

## 2. T-UX5 체크리스트 (플랜 §1 T-UX5)

`docs/specs/frontend/seller-ux-residual-plan.md` §1 T-UX5에 정의된 검토 항목을 그대로 수행. 각 항목은 grep/문서 확인으로 충족 가능 → **코드 변경 없으면 0.5세션 종결**.

### 2-1. 토큰 정의 ↔ 사용처 정합

- [ ] `packages/ui/src/style.css` 정의된 모든 `--font-size-*` 토큰(`xs:12·sm:15·md:16·lg:18·xl:20·2xl:24`)이 실제 사용처와 매핑되는가?
  - 확인 명령: `grep -rn "var(--font-size-" apps/seller/src/`
  - 신설 토큰(`--font-size-xs`)이 #CL-38에 등재되어 있는가? — **이미 등재 완료**(세션58).

### 2-2. 인라인 fontSize 잔존

- [ ] `apps/seller` 전역 인라인 `fontSize: <숫자>` 잔존 **0건**:
  - 확인 명령: `grep -rnE "fontSize:\s*[0-9]+" apps/seller/src --include="*.tsx"`
  - 세션59 종료 시점 0건 확인됨. T-UX5 진입 시 재확인.
  - Mantine `styles.input.fontSize` 경로도 토큰화 완료(세션59) → 예외 처리 불필요.

### 2-3. native `confirm()` 잔존

- [ ] `apps/seller` 전역 `confirm(` 잔존 **0건**:
  - 확인 명령: `grep -rn "confirm(" apps/seller/src --include="*.ts" --include="*.tsx"`
  - 세션55(T-UX3) 종료 시점 0건 처리됨. 회귀 확인.

### 2-4. SSOT 갱신 정합

- [ ] BACKLOG §11-3 UX-07·08·09 상태 ✅ 마킹 + 세션 번호·커밋 해시 기록 확인.
- [ ] UX-10은 "세션41~45에서 자연 해소"로 ⏹️ 마킹 확인.
- [ ] `seller-refactor-visual-verify.md` F-T-UX1~4c 섹션 완비 확인:
  - F-T-UX1(탭 단일화, 세션54) #97~107
  - F-T-UX2(상품 카드 Badge 분리, 세션56) — 세션56 시점 추가
  - F-T-UX3(ConfirmModal, 세션55) — 세션55 시점 추가
  - F-T-UX4a(admin fontSize, 세션57) #119~134
  - F-T-UX4b(본 화면 fontSize, 세션58) #135~146
  - F-T-UX4c(products `_components` fontSize, 세션59) #147~157

### 2-5. CRITICAL_LOGIC 정합

- [ ] #CL-36(`SegmentedTabs` 신설, 세션54), #CL-37(`ConfirmModal` + native confirm 금지, 세션55), #CL-38(`--font-size-xs: 12px` 신설 + 사용 기준, 세션58) 모두 등재 확인.
- [ ] T-UX4c 작업에서 **#CL 신규 등재 없음**(#CL-38 그대로 적용) — 정합성 검토 시 신규 결정 발생하지 않았는지 재확인.

### 2-6. e2e 회귀 (Railway 복구 후만)

- [ ] e2e 풀런 회귀 0건 — 특히 셀러 주문/상품/정산 spec, admin spec(있다면).
- **현재 보류**: Railway Major Outage 미복구. T-UX5 본 세션에서는 정적 검증만 수행, e2e는 Railway 복구 후 별도 세션에서 풀런.

---

## 3. 결정 필요 사항 (사용자 확정)

T-UX5는 정적 검증·문서 확인이 주된 작업이라 사용자 결정이 거의 없음. 단:

- [ ] **회귀 발견 시 처리**: §2 체크리스트 중 하나라도 미충족이면 **본 세션 내 수정** vs **신규 sub-task로 분리** 결정. 권장 **본 세션 내 수정**(작업 단위가 작을 가능성 높음).
- [ ] **e2e 풀런 보류 처리**: §2-6은 Railway 복구 후로 미루고 본 세션은 정적 검증만 완료. 권장 **수락**(Railway 무관 작업).
- [ ] **셀러 UX 잔여 플랜 종결 마킹**: T-UX5 통과 시 BACKLOG §12-1 "셀러 UX 잔여(UX-07~09) 정합" 행을 ✅로 종결 마킹.

---

## 4. T-UX5 작업 계획

### 4-1. 정적 검증 (코드 변경 없음 가정)

```powershell
# 인라인 fontSize 잔존 확인
grep -rnE "fontSize:\s*[0-9]+" apps/seller/src --include="*.tsx"
# 기대: 0건

# native confirm 잔존 확인
grep -rn "confirm(" apps/seller/src --include="*.ts" --include="*.tsx"
# 기대: 0건 (window.confirm·confirm(...)·Mantine confirm 등 모두 ConfirmModal로 통합)

# 토큰 사용처 그루핑 (참고용)
grep -rn "var(--font-size-" apps/seller/src/ | awk -F'var\\(--font-size-' '{print $2}' | awk -F')' '{print $1}' | sort | uniq -c

# 셀러 타입체크·빌드·biome (regression guard)
pnpm --filter seller exec tsc --noEmit
pnpm --filter seller build  # 23라우트
pnpm -w biome check apps/seller/src 2>&1 | Select-String "Found"
```

### 4-2. 문서 정합 확인 (없으면 수정)

- BACKLOG §11-3 UX-07·08·09 ✅ 마킹 / UX-10 ⏹️ 마킹 확인.
- BACKLOG §12-1 우선순위 표 "셀러 UX 잔여" 행 ✅ 종결 마킹(T-UX5 통과 후).
- visual-verify F-T-UX2·F-T-UX3 섹션 누락 시 추가.
- `seller-ux-residual-plan.md` T-UX5 체크박스 ✅ 마킹.

### 4-3. 커밋·문서 (변경 발생 시만)

- 커밋(필요 시): `refactor(seller): UX-05 정합성 검토 — T-UX1~4 종결 마킹 + SSOT 갱신 (T-UX5)`
- BACKLOG §12 활동 로그 세션60 추가, §12-1 표 "셀러 UX 잔여" 행 ✅ 종결.
- memory.md 갱신(200 한도 모니터링 — 현재 ~95라인).

---

## 5. 세션60 완료 기준

- [ ] §2 체크리스트 6항목(2-6 e2e는 보류) 모두 ✅
- [ ] 회귀 발견 시 본 세션 내 수정 또는 분리 결정
- [ ] BACKLOG·visual-verify·플랜 SSOT 갱신
- [ ] 셀러 UX 잔여 플랜 종결 마킹
- [ ] 커밋 0~1건 (변경 발생 시만)

---

## 6. 참조

- 플랜 SSOT: [`docs/specs/frontend/seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX5
- 세션54~59 결과: BACKLOG §12 활동 로그
- 토큰 정의: `packages/ui/src/style.css` `--font-size-xs/sm/md/lg/xl/2xl` (세션58 xs 신설 완료)
- #CL-36/37/38: `docs/CRITICAL_LOGIC.md`

---

## 7. 진행 규칙

- Railway Outage와 무관하게 진행. 백엔드 호출 경로 변경 없음.
- 사용자 명시 승인 후 진입.
- 변경 없으면 0.5세션 종결, 회귀 발견 시에만 작업.
- T-UX5 통과 후 다음 우선순위(Railway 복구 시 e2e 풀런, BUG-16, UX-11, Driver Kakao Maps SDK 등) 논의.

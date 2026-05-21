# 세션59 진입 문서 — T-UX4c products `_components` fontSize 토큰화

> 작성: 2026-05-21 (세션58 종료) · 선행: 세션58 T-UX4b 본 화면 10건 + `--font-size-xs` 신설(#CL-38)
> 목표: ① 머지 상태 가드(타입체크·biome 재확인), ② T-UX4c 진입 — products `_components` 의 하드코딩 fontSize **7건/3파일** 토큰화. T-UX4 마지막 sub-task.

---

## 1. 세션58 컨텍스트 요약

T-UX4b 완료. 셀러 본 화면 10건/5파일 토큰화. 위험 케이스 2건 사용자 결정 — ① `daily-caps:277 fontSize:10` 의도적 작은 보조 인디케이터(셀 내부 usedSlots 카운트 `↑`)는 **신규 토큰 `--font-size-xs: 12px` 신설**(#CL-38) 후 `var(--font-size-xs)` 적용(+2px) · ② `hubs/pickup:180 fontSize:20` OTP 6자리 입력 박스(48×56 강조 폰트)는 `var(--font-size-xl)` 채택(변동 0, 기존 토큰 정의와 정확히 일치). 셀러 타입체크 exit 0·빌드 23라우트·biome 대상 폴더 errors 0건·전체 baseline 63→50 errors(자동수정 부수효과).

**플랜 권장 순서** [seller-ux-residual-plan.md](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX4 — 세션59 = T-UX4c(products `_components`), 세션60 = T-UX5(정합성 검토).

---

## 2. T-UX4c 진입 — 결정 필요 사항 (사용자 확정)

세션57·58 매핑 정책 = **12·14 → sm(15px) 통일** + **#CL-38 보완(의도적 작은 보조 인디케이터는 xs(12px) 허용)**. products `_components`는 상품 등록 폼이라 시각 회귀 영향 큼.

- [ ] **`fontSize: 9` 4건 처리 (`ImageUpload.tsx:102,121,140`·기타) — 핵심 결정 사항**:
  - **컨텍스트**: 이미지 썸네일 80×80 위에 절대 위치로 겹치는 "대표"/"대표 설정"/"순번 1·2·3·4·5"/"✕" 라벨. 9px = sub-12px 작은 라벨. 폰트 굵기 700·흰색·반투명 배경 위에 표시 → 의도적으로 작게 디자인된 오버레이 인디케이터.
  - **선택지**:
    - (a) `var(--font-size-xs)` 흡수(+3px, 9→12). 가독성 개선이지만 80px 썸네일 위 오버레이라 라벨이 비좁아지거나 넘침 위험. **#CL-38 보완 정책 "의도적 작은 보조 인디케이터는 xs"와 일치**.
    - (b) 그대로 두기(literal 9 유지). T-UX5 정합성 검토 항목에서 "9·10·11px sub-12px 잔존 0건" 체크 불가 → 정책 위반.
    - (c) 추가 토큰 `--font-size-2xs: 9px` 또는 `10px` 신설. **권장하지 않음** — #CL-38이 "sub-12px 토큰 신설은 시각 잡음·접근성 하한 우려로 회피"라고 명시. 새 결정으로 #CL-38을 뒤집어야 함.
  - **권장**: **(a) xs 흡수** — #CL-38 정책 일관. 단 80px 썸네일 안에서 라벨 줄바꿈/넘침 위험이 실측되면 사용자 결정으로 (b) literal 유지 + 정책 보완 등재.

- [ ] **`fontSize: 11` 1건 처리 (`ImageUpload.tsx:168`)**:
  - **컨텍스트**: 썸네일 우상단 `✕`(삭제) 버튼, 20×20 원형 버튼 안의 글리프. 폰트 굵기는 기본·검정 배경 위 흰색.
  - **선택지**: (a) xs(+1px, 11→12). 20×20 버튼 안에서 약간 더 가독성. (b) sm(+4px, 11→15). 20×20 버튼에서 글리프 비중 과대.
  - **권장**: **(a) xs**.

- [ ] **`fontSize: 12` 1건 처리 (`ImageUpload.tsx:194`)**:
  - **컨텍스트**: "이미지 추가" 80×80 빈 박스(점선 테두리) 안의 라벨. 폰트 굵기는 기본·disabled gray.
  - **선택지**: (a) xs(변동 0, 12→12). 정의값 일치. (b) sm(+3px, 12→15). 80px 박스에서 약간 큼.
  - **권장**: **(a) xs** — 토큰 정의(12px)와 정확히 일치, 일반 보조 텍스트의 sm 통일 정책에서 살짝 벗어나지만 80×80 박스 내 라벨이라 #CL-38 "작은 보조 인디케이터" 범주에 해당.

- [ ] **Mantine `styles={{ input: { fontSize: ... } }}` 경로 2건**:
  - `AIPreviewPanel.tsx:147` `fontSize: 15` — Mantine `Textarea` 의 input 슬롯 스타일. 이미 sm(15px) 값과 일치 → `var(--font-size-sm)`로 토큰화 가능.
  - `SellerNoteInput.tsx:38` `fontSize: 16` — Mantine `Textarea` 의 input 슬롯 스타일. md(16px) 값과 일치 → `var(--font-size-md)`로 토큰화 가능.
  - **확인 필요**: Mantine `styles` prop이 CSS 변수 문자열을 받아들이는지(런타임 emotion). 인라인 `style` 에서 동작했으므로 같은 결로 동작할 것으로 예상하지만 변환 직후 lint·시각 확인 필요.
  - **권장**: **양쪽 토큰화 진행** — T-UX5 정합성 검토에서 "AIPreviewPanel styles.input.fontSize는 Mantine API 경로라 예외 처리"라고 명시하지 않으려면 본 세션에서 일관 처리하는 편이 깔끔.

- [ ] **검증 강도**: ① 타입체크·빌드·biome + dev 서버에서 `/products/new` 와 `/products/[id]/edit` 의 이미지 업로드 영역(라벨 시각 회귀)·AI 프리뷰·셀러 노트 입력 시각 확인. 권장 **①**(상품 등록 폼이라 시각 영향 큼). ② 정적 검증만(세션57·58과 동일) — 사용자 합의 시 채택.

- [ ] **시각 회귀 발견 시**: 세션57·58과 동일 — 해당 자리만 한 단계 위 토큰으로 조정(xs→sm), 토큰 자체 값 변경 금지.

---

## 3. T-UX4c 작업 계획

### 3-1. 변경 대상 (7건, 3파일)

```
products/_components/AIPreviewPanel.tsx:147   styles input fontSize: 15  → var(--font-size-sm)
products/_components/ImageUpload.tsx:102      fontSize: 9                → var(--font-size-xs) [+3px, 위험]
products/_components/ImageUpload.tsx:121      fontSize: 9                → var(--font-size-xs) [+3px, 위험]
products/_components/ImageUpload.tsx:140      fontSize: 9                → var(--font-size-xs) [+3px, 위험]
products/_components/ImageUpload.tsx:168      fontSize: 11               → var(--font-size-xs) [+1px]
products/_components/ImageUpload.tsx:194      fontSize: 12               → var(--font-size-xs) [변동 0]
products/_components/SellerNoteInput.tsx:38   styles input fontSize: 16  → var(--font-size-md)
```

**주의 케이스 요약**:
- `ImageUpload` 4건(9px) 9→12 +3px는 80×80 썸네일 오버레이 라벨이라 줄바꿈/넘침 잠재 위험. 사용자가 (a) 흡수를 선택하더라도 dev 스팟 체크에서 실측 후 회귀 시 (b) literal 유지로 복귀 옵션 열어 둠.
- Mantine `styles` 슬롯 토큰 인젝션 동작 검증 필요(주입은 emotion CSS 변수 통과 가능).

진행 시 `grep -rnE "fontSize:\s*[0-9]+" apps/seller/src --include="*.tsx"`로 잔여 재확인. 세션58 종료 시점 잔여 = products `_components` 7건 정확히 일치 확인됨.

### 3-2. 검증

```powershell
pnpm --filter seller exec tsc --noEmit
pnpm --filter seller build  # 23라우트
pnpm -w biome check --write apps/seller/src/app/products/_components
```

dev 서버(`pnpm --filter seller dev`) — 사용자 결정 시:
- [ ] `/products/new` — 이미지 업로드 영역 4가지 라벨(대표·대표 설정·순번·✕) 시각 + "이미지 추가" 박스 라벨
- [ ] `/products/[id]/edit` — 동일
- [ ] AI 프리뷰 패널(`AIPreviewPanel`) — Textarea 입력 폰트(이미 15px 값이라 변동 0 예상)
- [ ] 셀러 노트 입력(`SellerNoteInput`) — Textarea 입력 폰트(이미 16px 값이라 변동 0 예상)

e2e: 영향 없음(스타일만). Railway 복구 후 풀런 영향 없음 확인.

### 3-3. 커밋·문서

- 커밋: `refactor(seller): UX-04c products _components fontSize 토큰화 7건 (T-UX4c)`
- BACKLOG §12 활동 로그 세션59 추가, §12-1 표 T-UX4c ✅ 마킹
- memory.md 갱신(88→...라인, 200 한도 모니터링)
- CRITICAL_LOGIC — 9px 처리 정책이 (b) literal 유지로 결정 시 #CL-38 보완 등재. (a) xs 흡수로 진행 시 #CL-38 정책 그대로 적용되므로 신규 등재 불필요.
- visual-verify F-T-UX4c 섹션 추가(#147~)
- 세션60 진입 문서 작성 — **T-UX5 정합성 검토** (변경 없으면 0.5세션으로 종결)

---

## 4. 세션59 완료 기준

- [ ] §2 결정 사항 사용자 합의 (특히 9px 4건 처리·Mantine styles 슬롯 2건)
- [ ] products `_components` 7건 fontSize 토큰 치환
- [ ] 타입체크·빌드·biome 통과·신규 0건
- [ ] BACKLOG·memory·visual-verify 갱신 + 세션60 진입 문서 작성
- [ ] 커밋 1건

---

## 5. 참조

- 플랜 SSOT: [`docs/specs/frontend/seller-ux-residual-plan.md`](../../specs/frontend/seller-ux-residual-plan.md) §1 T-UX4 (세션58 완료 반영됨)
- 세션58 결과: [`session58-prep.md`](session58-prep.md) (T-UX4b 본 화면 10건 + #CL-38)
- 토큰 정의: `packages/ui/src/style.css` `--font-size-xs/sm/md/lg/xl/2xl` (세션58 xs 신설 완료)
- #CL-38: `docs/CRITICAL_LOGIC.md` 디자인 시스템 폰트 토큰 `--font-size-xs: 12px` 신설 + 사용 기준

---

## 6. 진행 규칙

- Railway Outage와 무관하게 진행. 백엔드 호출 경로 변경 없음.
- 사용자 명시 승인 후 진입.
- products 컴포넌트는 셀러 본 화면보다 시각 회귀 위험 더 큼(80×80 썸네일 오버레이) — 정적 검증만으로 갈음하기 전에 사용자 확인 필수.
- T-UX5(정합성 검토)는 세션60에서 — `confirm(` 잔존 0건·인라인 `fontSize: <숫자>` 잔존 0건·신설 토큰 #CL 등재·visual-verify 체크리스트 완비 확인.

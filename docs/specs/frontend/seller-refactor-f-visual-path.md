# 셀러 리팩토링 F-VISUAL-PATH 통합 시각 검증 경로

> 원본: `docs/specs/frontend/seller-refactor-visual-verify.md`에서 2026-06-29 문서 정리 시 분리.
> 목적: 세션54~59 F-T-UX1~4 검증 동선을 별도 문서로 유지해 상위 체크리스트를 500라인 이하로 보존.

---

## F-VISUAL-PATH — 셀러앱 UX 잔여(T-UX1~4) 통합 시각 검증 경로 (세션60 합본)

> 작성: 2026-05-21 (세션59 종료 후) · 통합 대상: F-T-UX1(세션54, 탭 단일화)·F-T-UX2(세션56, 상품 카드 분리)·F-T-UX3(세션55, ConfirmModal)·F-T-UX4a/b/c(세션57·58·59, fontSize 토큰화).
> **목적**: 세션57~59에서 사용자 합의로 "정적 검증으로 갈음"한 22개 항목 + F-T-UX1~3 미체크 27개 항목을 **한 번의 로그인 세션 동선으로** 사람이 직접 확인. 화면 이동 최소화.
> **사용법**: 위에서 아래로 순서대로 진행. 각 화면 진입 시 상단에 적힌 행을 모두 본 뒤 다음 화면으로. 결과는 `[x]` 통과 / `[ ]` 실패(메모 기재) / `[-]` 해당없음.
> **사전 준비**: 모바일 PWA 폭(≤480px) · 셀러 계정 `seller@test.com / test1234` · e2e 시드 적용(`node scripts/seed-e2e-orders.mjs`) · DevTools Elements 패널(폰트 토큰 계산값 검증용) 준비.

### V0 — 사전 점검 (DevTools 콘솔 1회)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 158 | 토큰 정의 확인 | DevTools console: `getComputedStyle(document.documentElement).getPropertyValue('--font-size-xs').trim()` → `12px`. `--font-size-sm` → `15px`, `--font-size-md` → `16px`, `--font-size-xl` → `20px` | [ ] | 모든 화면에서 유효 |

### V1 — 주문 탭 (`/orders`) — F-T-UX1 sticky·count Badge

진입: BottomNav **[주문]** 탭.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 159 | 상태 탭 색상 | active=**초록(`--color-primary`)** · inactive=secondary 회색. 검정 잔재 없음 | [ ] | F-T-UX1 #97 재확인 |
| 160 | 상태 탭 강조 | active 폰트 굵기 **700**, inactive medium | [ ] | F-T-UX1 #98 |
| 161 | 상태 탭 sticky | 카드 목록 스크롤 시 탭이 헤더 바로 아래에 고정. DevTools 측정값 `top = var(--header-height)` (≈56~57px) | [ ] | F-T-UX1 #99·#106 |
| 162 | 카운트 Badge | `ACTION_REQUIRED` 탭에 빨강 점 Badge, 나머지는 회색 점(count>0 탭만 노출) | [ ] | F-T-UX1 #100 |
| 163 | 모바일 가로 스크롤 | 탭 5개 이상일 때 가로 스크롤 가능, 스크롤바 미노출 | [ ] | F-T-UX1 #101 |
| 164 | 탭 클릭 전환 | 클릭 시 즉시 active 전환 + 카드 목록 변경(라우팅 없음) | [ ] | F-T-UX1 #107 |

### V2 — 상품 탭 (`/products`) — F-T-UX1·F-T-UX2·F-T-UX3 통합

진입: BottomNav **[상품]** 탭. 상품 1건 이상 존재 가정.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 165 | 필터 탭 시각 | 주문 탭과 **동일 패턴**(초록·active 700·medium) | [ ] | F-T-UX1 #102 |
| 166 | 카운트 인라인 | 라벨에 `전체 N` 형태 인라인 표시(0건 포함) | [ ] | F-T-UX1 #103 |
| 167 | 필터 탭 non-sticky | 스크롤 시 상단 고정 **안 됨** | [ ] | F-T-UX1 #104 |
| 168 | 카드 — 활성 Switch 외관 | 상품명 우측에 Mantine **Switch**(초록, sm) — 활성 상품은 켜짐, 비활성은 꺼짐 | [ ] | F-T-UX2 #116 |
| 169 | 활성 Switch 동작 | Switch 토글 시 즉시 PATCH 호출, 처리 중 disabled, 성공 시 즉시 반영. 실패 시 카드 내부 인라인 에러 | [ ] | F-T-UX2 #117 |
| 170 | 활성 Switch 접근성 | DevTools에서 Switch 요소 선택 → `aria-label`이 "판매 중 — 클릭하여 비활성" 또는 그 반대 문구 | [ ] | F-T-UX2 #118 |
| 171 | 액션 row 수정 | "수정" Button (xs subtle **gray**) 탭 → `/products/[id]/edit` 이동 | [ ] | F-T-UX2 #119 |
| 172 | 액션 row 삭제 외관 | "삭제" Button (xs subtle **red**) 탭 → ConfirmModal 열림 | [ ] | F-T-UX2 #120 |
| 173 | Badge 잔존 회귀 | DevTools Elements에서 상품 카드에 `<span class="*Badge*">` 없음(Switch + Button 2개만) | [ ] | F-T-UX2 #123 |
| 174 | 상품 삭제 모달 메시지 | ConfirmModal 본문에 **상품명 동적** 표시 + `\n` 다행 처리 정상 | [ ] | F-T-UX3 #110 |
| 175 | 상품 삭제 로딩·동시성 | 확인 누른 후 Button + 모달 모두 loading 표시, 처리 중 외부 클릭/ESC로 닫히지 않음. 완료 시 자동 닫힘 + 카드 제거 | [ ] | F-T-UX3 #111 + F-T-UX2 #121 |

### V3 — 상품 등록/편집 (`/products/new`) — F-T-UX4c products `_components`

진입: 상품 페이지에서 "**+ 새 상품 등록**" 또는 `/products/new` 직접 진입. 이미지 1장 이상 업로드 후 진행.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 176 | 이미지 — "대표" 배지 | 첫 칸(80×80) 좌하단 "대표" 라벨이 보임. DevTools에서 해당 요소 `font-size: 12px` (computed) | [ ] | F-T-UX4c #147, 9→xs(+3px) |
| 177 | 이미지 — "대표 설정" 버튼 | 2번째~5번째 칸 좌하단 "대표 설정" 라벨, `font-size: 12px`, 잘림 없음·줄바꿈 없음 | [ ] | F-T-UX4c #148, 9→xs(+3px), 줄바꿈 발생 시 메모 |
| 178 | 이미지 — 순번 1·2·3·4·5 | 좌상단 16×16 원형 인디케이터 안 숫자, `font-size: 12px`, 원형 컨테이너 넘침 없음 | [ ] | F-T-UX4c #149, 9→xs(+3px), 넘침 발생 시 메모 |
| 179 | 이미지 — ✕ 삭제 버튼 | 우상단 20×20 원형 ✕ 버튼, `font-size: 12px`, 글리프가 버튼 안에 자연스럽게 위치 | [ ] | F-T-UX4c #150, 11→xs(+1px) |
| 180 | 이미지 — "사진 추가" 빈 박스 | 마지막 점선 80×80 박스 안 "사진 추가" 라벨, `font-size: 12px`, + 아이콘과 정렬 자연스러움 | [ ] | F-T-UX4c #151, 12→xs(변동 0) |
| 181 | AI 프리뷰 Textarea | AI 생성 후 "상세 설명" Mantine Textarea 입력 영역, `font-size: 15px` (computed) | [ ] | F-T-UX4c #152, 15→sm(변동 0) |
| 182 | 셀러 노트 Textarea | "셀러 노트" Mantine Textarea 입력 영역, `font-size: 16px` (computed) | [ ] | F-T-UX4c #153, 16→md(변동 0) |
| 183 | products/[id]/edit 동일 확인 | 기존 상품 1건 편집 진입 → 이미지 영역 라벨군 동일하게 표시(176~180 재확인 불필요, 회귀만 체크) | [ ] | F-T-UX4c 보강 |

### V4 — 정산 탭 (`/settlements`) — F-T-UX1·F-T-UX4b settlements

진입: BottomNav **[정산]** 탭.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 184 | 정산 페이지 탭 시각 | 주문·상품 탭과 **동일 패턴**(초록·active 700) | [ ] | F-T-UX1 #105 |
| 185 | 정산 탭 sticky 위치 | DevTools에서 탭 컨테이너 측정값 `top = var(--header-height)` (≈56~57px). 매직넘버 `57` 없음 | [ ] | F-T-UX1 #106 |
| 186 | 일별 탭 — 날짜 input | "일별" 탭 진입 시 날짜 input 폰트 `font-size: 15px` (computed) | [ ] | F-T-UX4b #135, DailySummaryTab 13→sm |
| 187 | 주문 탭 — CSV 라벨 | "주문" 탭 CSV 다운로드 버튼 라벨 폰트 `font-size: 15px` | [ ] | F-T-UX4b #136, OrdersTab 12→sm |
| 188 | 기간 탭 — from/to + CSV | "기간" 탭 from·to date input 폰트와 CSV 라벨 모두 `font-size: 15px` | [ ] | F-T-UX4b #137, PeriodTab 3건 |

### V5 — 거점 픽업 (`/hubs/[id]/pickup`) — F-T-UX4b OTP xl

진입: BottomNav **[설정]** → **거점 관리** → 거점 1건 진입 → **픽업** 또는 `/hubs/{id}/pickup` 직접 진입.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 189 | OTP 6자리 입력 박스 | 48×56 입력 박스 6칸의 입력 글자 폰트 `font-size: 20px` (computed) — 변동 0, 강조 폰트 의도 보존 | [ ] | F-T-UX4b #138, 20→xl |

### V6 — 설정/일일 캡 (`/settings/daily-caps`) — F-T-UX4b xs·sm

진입: BottomNav **[설정]** → **일일 발송 캡 관리**.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 190 | 캘린더 셀 카운트 (xs) | 그리드 셀 내부 usedSlots `↑` 카운트, `font-size: 12px` (computed). 셀(약 60×60) 안에서 위치·정렬 자연스러움 | [ ] | F-T-UX4b #139, 10→**xs**(+2px), 의도적 작은 보조 인디케이터 |
| 191 | 편집 패널 totalCap 입력 | 셀 클릭 → 편집 패널 totalCap 입력 폰트 `font-size: 15px` | [ ] | F-T-UX4b #140, 14→sm |

### V7 — 설정/배송 옵션 (`/settings/delivery`) — F-T-UX4b sm

진입: BottomNav **[설정]** → **배송 설정**.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 192 | 직배송/거점/택배 비용 입력 | 3개 비용 input의 폰트 `font-size: 15px` (computed) | [ ] | F-T-UX4b #141a, delivery:181 14→sm |
| 193 | 무료 배송 기준 입력 | 무료 배송 기준 input 폰트 `font-size: 15px` | [ ] | F-T-UX4b #141b, delivery:244 14→sm |

### V8 — 거점 삭제 모달 (`/hubs`) — F-T-UX3 ConfirmModal

진입: BottomNav **[설정]** → **거점 관리** (`/hubs`).

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 194 | 거점 삭제 모달 외관 | 거점 카드 "삭제" 클릭 → ConfirmModal 열림. 제목 "거점 삭제", confirm 라벨 "삭제"(**red**) | [ ] | F-T-UX3 #108 |
| 195 | 거점 삭제 처리 | 확인 시 "처리 중..." → 카드 제거, 모달 자동 닫힘. 취소/외부 클릭/ESC 시 무변화 | [ ] | F-T-UX3 #109 |

### V9 — 관리자(`/admin/**`) — F-T-UX3·F-T-UX4a

진입: 셀러 계정이 admin 권한이라는 가정(없으면 V9 전체 [-]). admin BottomNav 또는 `/admin` 직접 진입.

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 196 | admin 레이아웃 탭 (`/admin`) | 상단 admin 탭 라벨군 폰트 `font-size: 15px` (computed) | [ ] | F-T-UX4a #124, layout:53 |
| 197 | 배너 업로드 (`/admin/banner`) | 업로드 영역 라벨/버튼 폰트 `15px` | [ ] | F-T-UX4a #125 |
| 198 | 드라이버 목록 (`/admin/drivers`) | 탭 라벨·표 셀 폰트 `15px` | [ ] | F-T-UX4a #126 |
| 199 | 드라이버 3액션 모달 | 드라이버 카드 "승인"=**초록**·"정지"=**빨강**·"해제"=**회색** ConfirmModal. 1개 모달로 색상·라벨만 변경 | [ ] | F-T-UX3 #112 |
| 200 | 초대 (`/admin/invite`) | 표 셀(`#144,224`) 폰트 `15px` | [ ] | F-T-UX4a #127 |
| 201 | 정산 (`/admin/settlements`) | 날짜 input·storeId·표 셀 폰트 `15px`(4건) | [ ] | F-T-UX4a #128 |
| 202 | 정산 지급 모달 | "지급처리" 클릭 → ConfirmModal(**blue**). 확인 시 상태 paid. 실패 시 기존 alert 유지 | [ ] | F-T-UX3 #113 |
| 203 | 주문 (`/admin/orders`) | 표·orderId·storeId 폰트 `15px`(3건) | [ ] | F-T-UX4a #129 |
| 204 | 스토어 (`/admin/stores`) | 표·storeId·수수료 입력 폰트 `15px`(3건) | [ ] | F-T-UX4a #130 |
| 205 | 사용자 (`/admin/users`) | 표·userId 폰트 `15px`(2건) | [ ] | F-T-UX4a #131 |
| 206 | 사용자 정지/해제 모달 | 정상 계정 → "계정 정지"(**red**), 정지된 계정 → "계정 정지 해제"(**green**). confirmColor·라벨이 상태별로 가변 | [ ] | F-T-UX3 #114 |

### V10 — 회귀 가드 (코드/콘솔, 화면 무관)

| # | 확인 항목 | 통과 기준 | 결과 | 메모 |
|---|----------|----------|:----:|------|
| 207 | 셀러 전역 인라인 fontSize 잔존 | `grep -rnE "fontSize:\s*[0-9]+" apps/seller/src --include="*.tsx"` → **0건** | ✅ | 세션59 검증 |
| 208 | 셀러 전역 native confirm 잔존 | `grep -rn "confirm(" apps/seller/src --include="*.ts" --include="*.tsx"` → **0건** | ✅ | 세션55 검증 |
| 209 | 콘솔 에러 — 전 화면 통과 후 | DevTools Console에 V1~V9 동선 진행 중 누적된 빨강 에러 0건 (Firebase·Mantine·Next 정상 로그 제외) | [ ] | 전 동선 종합 |
| 210 | 시각 회귀 발견 시 처리 정책 | (메모 전용) 라벨 잘림·줄바꿈·정렬 깨짐 등 발생 시 — 한 단계 위 토큰으로 조정(xs→sm 등), **토큰 자체 값 변경 금지**. 발견 즉시 메모란에 라우트·요소·현상 기재 | [-] | 세션57~59 정책 |

---

### 진행 도움말 — DevTools로 폰트 빠르게 검증

1. 모바일 폭(≤480px)으로 줄인 Chrome 창에서 진입.
2. DevTools 열고(F12) **Elements** 패널에서 확인하고자 하는 텍스트 요소 클릭.
3. 우측 **Computed** 탭 검색창에 `font-size` 입력 → 계산된 px값 확인.
4. 화면 일괄 검증 시 console에 다음 한 줄 — V0 #158의 토큰 정의 재확인 또는 임의 셀렉터 폰트 일괄 측정:

```js
// 페이지 내 모든 텍스트 요소 fontSize 계산값 추출 (인라인 숫자 잔존 확인용)
[...document.querySelectorAll('*')].filter(e=>e.textContent.trim()&&!e.children.length).slice(0,200).map(e=>({el:e.tagName,text:e.textContent.trim().slice(0,20),fs:getComputedStyle(e).fontSize})).filter(o=>parseInt(o.fs)<12||(parseInt(o.fs)>0&&![12,15,16,18,20,24].includes(parseInt(o.fs))))
```
   → **빈 배열이면 토큰 6단계 외 폰트 없음 = 통과**. (Mantine 내부 기본값에 따라 14px가 일부 나타날 수 있음 — 그 경우는 우리 인라인 잔존이 아닌 라이브러리 기본값이므로 회귀로 보지 않음.)

5. **V3 이미지 라벨 시각 회귀(176~180)** 가 가장 위험 — 80×80 컨테이너에서 라벨 잘림/줄바꿈 발생 시 메모 후 사용자 결정(literal 9 복귀 또는 xs 유지) 진행.

---

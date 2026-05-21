# 셀러앱 정리 작업 플랜 (세션 62~64)

> **배경**: 세션 28~60 셀러앱 프론트엔드 리팩토링 종합 점검(세션 61 말미)에서 도출된 후속 정리 작업 3건. 각 세션 독립·아토믹·상호 무관.
>
> **진입 규칙**: 매 세션 시작 시 **사전 정합성 검토** 후 진입 — 플랜과 현재 코드 상태 일치 여부 확인, 일치 시 진입 / 불일치 시 플랜 갱신 후 사용자 합의.
>
> **공통 검증**:
> - 셀러 타입체크 `cd apps/seller && npx tsc --noEmit` exit 0
> - 빌드 `pnpm --filter seller build` (23라우트)
> - biome 신규 에러 0건
> - 세션 종료 시 BACKLOG·memory·CRITICAL_LOGIC(필요 시) 갱신

---

## 진행 순서 (사용자 결정)

**T-CLEAN1 (Lint) → T-CLEAN2 (alert) → T-CLEAN3 (apiJson)**

회귀 표면이 작은 것부터. Lint 정리로 baseline 0~5 만든 뒤 신규 변경 검증력을 회복하고, 그 위에서 alert 흡수·apiJson 마이그레이션을 진행한다.

---

## T-CLEAN1 — biome lint baseline 정리 (세션 62)

### 목표
seller baseline **40 errors / 16 warnings → 5 errors 이내**.

### 사전 정합성 검토 (세션 진입 시)
- [ ] `npx biome check apps/seller/src --max-diagnostics=120` 실행
- [ ] errors 40·warnings 16 baseline 일치 확인 (drift 발생 시 플랜 갱신)
- [ ] FIXABLE assist/source/organizeImports 약 25건 존재 확인

### 작업 범위 (사용자 결정: FIXABLE 자동 + 명확한 수동 fix)

#### Phase A — 자동 수정 (1 커밋)
- [ ] `npx biome check apps/seller/src --write` 실행
- [ ] organizeImports FIXABLE 약 25건 자동 해소 예상
- [ ] format 항목 자동 정리
- [ ] 자동 수정 후 errors 재측정 → ~15건 기대
- [ ] 빌드·타입체크 통과 확인

#### Phase B — 수동 fix (안전한 케이스만, 1~2 커밋)
- [ ] `lint/correctness/noUnusedImports` (useOrders.ts:7) — 미사용 import 제거
- [ ] `lint/style/useTemplate` (useSettlements.ts:52) — 문자열 연결 → 템플릿 리터럴
- [ ] `lint/suspicious/noArrayIndexKey` — 의미 검토 후 처리:
  - daily-caps:233,235 (캘린더 주/요일) — 안정 키, `biome-ignore` + 사유 명시
  - pickup:165 (OTP 박스) — 안정 키, `biome-ignore` + 사유 명시
  - AIPreviewPanel:73 (AI 미리보기 list) — 안정 키 추정, 검토
  - **ImageUpload:85 — reorder 가능성 있음, 실제 id 기반 키로 수정**

#### Phase C — biome-ignore + 사유 명시 (남은 항목)
- [ ] `noNonNullAssertion` 6건 — 옵셔널 체이닝 대체 vs ignore 판단
  - auth.ts:5,34,35 (env 변수) — 빌드 시점 보장, `biome-ignore` + "env 변수는 next 빌드 시점 인라인 보장"
  - useFirebaseAuth.ts:12 — 검토
  - admin/banner/_client.tsx 4건 — 검토
- [ ] `noAssignInExpressions` (VarietySelector:54) — 기존 코드, 리팩토링 vs ignore 판단

### 범위 외
- `lint/performance/noImgElement` 2건 (onboarding:186·ImageUpload:96) — Next/Image 마이그레이션은 별건(LCP 영향 측정 필요)
- consumer·driver 앱

### 사용자 결정 필요 항목 (세션 진입 시 확인)
- [ ] noArrayIndexKey ImageUpload 처리 — 실제 reorder 시나리오 존재 여부 확인 후 키 마이그레이션 vs ignore
- [ ] noNonNullAssertion auth.ts — env 변수 가드 추가 vs biome-ignore

### 검증
- [ ] biome errors 5건 이내 (목표) / 신규 0건
- [ ] 타입체크·빌드 통과
- [ ] e2e 영향 없음 (정적 코드 변경만)

### 산출
- 1~3 커밋
- 회귀 윈도우 최소 (자동 수정은 별도 커밋으로 분리)

---

## T-CLEAN2 — `alert()` 3건 → Mantine notifications (세션 63)

### 목표
셀러앱 native `alert()` **3건 → 0건**. ConfirmModal(#CL-37)과 정책 일관성 회복.

### 사전 정합성 검토 (세션 진입 시)
- [ ] `Grep "alert\("` apps/seller/src — 3건 일치 확인
  - admin/orders/_client.tsx:44 (환불 실패)
  - admin/settlements/_client.tsx:50 (지급 실패)
  - admin/stores/_client.tsx:28 (입력 검증)
- [ ] `package.json`에 `@mantine/notifications` 미존재 확인 (신규 의존성)
- [ ] T-CLEAN1 완료 후 신규 lint 에러 0 baseline 확인

### 작업 (사용자 결정: Mantine notifications)

#### Phase A — 패키지 도입 + Provider 등록 (1 커밋)
- [ ] `pnpm --filter seller add @mantine/notifications`
- [ ] `apps/seller/src/app/providers.tsx`에 `<Notifications />` 추가 (MantineProvider 내부)
- [ ] `@mantine/notifications/styles.css` import in layout.tsx
- [ ] 빌드·번들 사이즈 변화 측정 (~5KB 예상)

#### Phase B — alert 치환 3건 (1 커밋)
- [ ] admin/orders/_client.tsx:44 — `notifications.show({ color: 'red', title: '환불 처리 실패', message: ... })`
- [ ] admin/settlements/_client.tsx:50 — 동일 패턴 (지급 실패)
- [ ] admin/stores/_client.tsx:28 — `color: 'orange'` (입력 검증 경고)
- [ ] 메시지 톤 통일 (실패=red, 경고=orange, 성공=green)

#### Phase C — 결정 기록
- [ ] `CRITICAL_LOGIC.md`에 **#CL-39** 등재 — "셀러앱 알림 패턴: Mantine notifications 단일화, native alert 금지"
- [ ] BACKLOG UX-09 후속 종결 마킹 (또는 신규 UX-12 항목)

### 범위 외
- 성공 알림 신규 추가 (현재 미사용 위치는 건드리지 않음)
- consumer·driver 앱
- ConfirmModal 정보 표시 모드 확장 (요청 시 별건)

### 사용자 결정 필요 항목
- [ ] Notifications 위치(top-right vs bottom) — 모바일 PWA 기준
- [ ] 자동 닫힘 시간 (default 4000ms 유지 여부)
- [ ] 성공 케이스(상품 등록·정산 처리 완료 등)에도 선제적으로 도입할지 여부

### 검증
- [ ] `Grep "alert\("` apps/seller/src — 0건
- [ ] 수동: admin 페이지 3곳에서 알림 노출·자동 닫힘 확인
- [ ] 타입체크·빌드·biome 신규 0건

### 산출
- 2~3 커밋
- 신규 의존성 `@mantine/notifications` (피어 @mantine/core 호환)
- #CL-39 (정책 결정)

---

## T-CLEAN3 — products/page.tsx → `apiJson` 마이그레이션 (세션 64)

### 목표
#CL-32 Phase 2(API 레이어 통일) **잔여분 봉합**. raw `apiFetch` + `res.ok` 직접 검사 → `apiJson` + `ApiError` catch 패턴.

### 사전 정합성 검토 (세션 진입 시)
- [ ] `Grep "apiFetch" apps/seller/src` 잔존 위치 재확인 (현재 19파일)
- [ ] [products/page.tsx:121-156](apps/seller/src/app/products/page.tsx#L121-L156) 패턴 일치 확인
- [ ] `apiJson` 시그니처 변경 없음 확인

### 작업 범위 (ProductCard 한정 — `apiFetch` 전체 마이그레이션 아님)

#### Phase A — ProductCard 마이그레이션 (1 커밋)
- [ ] `handleToggleActive` — `apiJson<{ ok: boolean }>` + try/catch (ApiError)
- [ ] `handleDelete` — 동일 패턴, DELETE는 빈 응답 처리 검토
- [ ] 에러 메시지 형식 — `useAdmin` 계열과 톤 통일 ("상품 상태 변경 실패" 등)
- [ ] ProductCard 자체 state(`toggling`/`deleting`/`error`) 유지 — #CL-37 §3 카드 내부 state 예외 패턴

#### Phase B — 범위 평가 (코드 변경 없음, 다음 세션 입력)
- [ ] 잔존 `apiFetch` 사용처 19파일 중 마이그레이션 가치 있는 후보 식별:
  - admin/banner/_client.tsx (이미지 업로드 멀티파트는 제외)
  - hubs/* 페이지들
  - products/_components/useProductForm.ts (대용량 form submit)
- [ ] **결정**: 일괄 마이그레이션 vs 점진 vs 현상 유지 — 사용자 의견 필요

### 범위 외
- 멀티파트/스트리밍 응답 (raw `apiFetch` 유지가 정당)
- consumer·driver 앱
- `apiFetch` 자체 제거 (인프라 함수로 유지)

### 사용자 결정 필요 항목
- [ ] Phase B 식별 후 추가 마이그레이션 진행 여부 — products 외 확장 시 별도 세션 등재
- [ ] 에러 메시지 톤 — useAdmin 계열 "...조회 중 오류 발생" vs ProductCard 기존 "상태 변경 실패 (404)"

### 검증
- [ ] ProductCard 토글·삭제 수동 테스트 (성공·실패 양쪽)
- [ ] 타입체크·빌드 통과
- [ ] biome 신규 0건
- [ ] e2e seller-products spec 영향 점검 (셀렉터는 텍스트 기반이라 무영향 예상)

### 산출
- 1 커밋
- Phase B 결과는 BACKLOG 후속 항목으로 등재 (코드 변경 없음)

---

## 정합성 검토 체크리스트 (각 세션 진입 시 공통)

각 세션 시작 시 아래 5항목 확인 후 진입 — 불일치 발견 시 작업 중단·플랜 갱신·사용자 합의 후 재개:

1. **이전 세션 산출 검증**: 직전 세션 커밋이 main 머지·preview 동기화 완료
2. **baseline 상태**: 본 플랜이 기록한 baseline(lint·alert·apiFetch 카운트)과 현재 grep 결과 일치
3. **의존성 상태**: 사용 패키지 버전·`pnpm-lock.yaml` 정합
4. **e2e baseline**: 직전 풀런 170 passed / 0 failed / 11 skipped (또는 갱신값)
5. **CLAUDE.md 한도**: 본 작업으로 500라인 위반 신규 발생 가능성 사전 평가

---

## 세션 간 의존성

```
T-CLEAN1 (Lint 정리)
  ↓ (baseline 회복 후 신규 변경 검증력 확보)
T-CLEAN2 (alert → notifications)
  ↓ (정책 일관성 → apiJson 패턴 안착 분위기)
T-CLEAN3 (apiJson 마이그레이션)
```

각 세션은 **이전 세션 완료를 전제**하지만, 코드 의존성은 없음 — 순서를 바꿔도 동작 회귀 없음. 단 순서가 바뀌면 사전 정합성 검토 baseline이 어긋남.

---

## 종결 조건

세 세션 모두 완료 시:
- 셀러앱 biome errors 5건 이내
- native `alert()`·`confirm()` 모두 0건
- ProductCard `apiJson` 패턴
- BACKLOG UX-09 / #CL-32 잔여분 종결
- 신규 #CL-39 (알림 패턴) 등재

다음 단계 후보: BUG-16(택배 갭) / UX-11(주문번호 통합) / Driver Kakao Maps SDK / 백엔드 단일 장애점 회고.

# 세션37 진입 가이드 — P3 잔여 기능 + P4 정비

> 작성: 2026-05-17 (세션36 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션36 — seller 프론트엔드 5-Phase 리팩토링(#CL-32). e2e 167/0 유지(run 25970814882).
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 후 통과해야 다음 진행.

---

## 배경

세션36은 셀러앱 프론트엔드를 5개 Phase로 리팩토링했다(#CL-32, main `8111b3b`):

- **Phase 1**: `ProductForm.tsx` 705→154라인 — Fatal Constraint(500라인) 위반 해소.
- **Phase 2**: `lib/api.ts`에 `apiJson<T>()`+`ApiError` — raw fetch 통일.
- **Phase 3**: `useAdmin.ts` 462→341라인 — `useAdminList` 팩토리화.
- **Phase 4**: `useOrderStatusUpdate` 공통 코어로 주문 액션 훅 통합 (BACKLOG P3 종결).
- **Phase 5**: `PageShell`/`PageHeader`/`EmptyState`/`LoadingState` 신설, 9개 페이지 치환.

`docs/BACKLOG.md` §12-1에서 **P0·P1·P2·P3 구조 항목 + e2e 안정성 + `/admin/banner` +
consumer 강한비번 + `useOrderActions` 통합 전부 종결**. 남은 것은 **P3 기능 2건 + P4 정비 2건**이다.

---

## 핸드오프 — 잔여 작업

| 우선 | 항목 | 범위 | 비고 |
|------|------|------|------|
| 🟢 P3 | **G1 거점 수정 페이지** | `apps/seller/src/app/hubs/[id]` edit 화면 신규 구현 | Phase B 잔여. 규모 중~대. `/hubs/[id]` 상세·`/hubs/[id]/pickup`은 존재 — edit만 누락. 세션36 신설 `PageShell`/`PageHeader`/`FormPrimitives`·`apiJson` 재사용 가능 |
| 🟢 P3 | **Driver Kakao Maps SDK** | 드라이버 앱 Kakao Maps SDK 연동 | 신규 SDK 연동. 밀크런 경로 프리뷰(§7 Should Have)와 연계 가능 |
| 🟢 P4 | **global-setup flake 보강** | `apps/e2e/global-setup.ts:133` `context.storageState()` 직전 navigation 안정 대기 추가 | 규모 소(小). 세션36 e2e 1차 실패(재실행 통과)로 가시화된 #CL-23/#CL-27 인증 레이스 잔여. 아래 상세 참조 |
| 🟢 P4 | **CI 액션 Node.js 20 deprecation** | `.github/workflows/*.yml` 액션 버전 갱신 | 2026-06-02 강제 Node.js 24 전환. `actions/checkout`·`setup-node`·`upload-artifact`·`pnpm/action-setup` |

권장 착수 순서: **P4 global-setup 보강(소규모·빠름)** → P4 CI 액션 → P3 G1 → P3 Driver. P4 둘은 단독·저위험이라 워밍업으로 적합.

---

## P4 global-setup flake — 상세

세션36 머지 후 e2e 1차 실행(run 25970814882)이 `global-setup.ts:133`
`await context.storageState({ path: AUTH_STATE_PATH })`에서 실패:
`browserContext.storageState: Navigation to *** is interrupted by another navigation to ***/login`.

- **원인**: `loginWithRetry`는 `loginViaCredentials`의 **throw**만 흡수한다. 로그인이
  성공(throw 없음)했어도 직후 클라이언트 네비게이션이 in-flight인 상태에서
  `storageState()`가 호출되면, 세션 미확정 페이지가 `/login`으로 리다이렉트되며 레이스.
- **재실행 결과**: 동일 코드·환경에서 167/0 통과 → flake 확정. 코드 무관(consumer 앱 미변경).
- **처리 방향**: line 133 직전에 `await page.waitForLoadState('networkidle')`(또는
  로그인 후 안착 페이지의 명시적 안정 대기)를 넣어 레이스 창을 닫는다. `loginViaCredentials`
  helper(`tests/_helpers/auth.ts`) 내부에서 처리할지 global-setup에서 처리할지 검토.

---

## T0. 진입 — 현황 재확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. 167/0 유지 여부.
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출 연산자)
  - 세션36 베이스라인: run 25970814882 (167 passed / 0 failed / 11 skipped).
- [ ] `docs/memory.md` 라인 수 확인 — 약 52라인. 200라인 한도 여유 있음.
- [ ] `docs/CRITICAL_LOGIC.md` 라인 수 확인 — 약 311라인. 1000라인 한도 여유 있음.
- [ ] `docs/BACKLOG.md` §12-1 우선순위 표에서 P3·P4 상태 확인.
- [ ] **정합성 검토**: 167/0에서 회귀했다면 잔여 착수 전 회귀 원인 우선 처리.

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12 — 처리한 항목 완료 체크 + 변경 이력.
- [ ] 설계 결정 발생 시 `docs/CRITICAL_LOGIC.md` 신규 #CL 기록 (현재 #CL-32까지).
- [ ] `docs/memory.md` 세션37 섹션 갱신.
- [ ] 다음 진입점(`session38-prep.md`) 갱신 + `BACKLOG.md` §12 진입점 링크 수정.

## 참조

- 한도 정책: `docs/CRITICAL_LOGIC.md` #CL-29 · 활성 결정 로그(#CL-19~#CL-32)
- seller 프론트 구조(#CL-32): `apiJson` 사용·공통 UI 컴포넌트·`useAdminList`·`useOrderStatusUpdate`
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 절
- 베이스라인 풀런: run 25970814882 (167 passed / 0 failed / 11 skipped)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

# 세션28 진입 가이드 — #CL-23 인증 race 해소 (storageState 패턴)

> 작성: 2026-05-16 (세션27 종료 시) · SSOT: `docs/BACKLOG.md` §12-2 「P1 #CL-23」
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토**를 수행하고 통과해야 다음으로 진행.

---

## T0. 진입 — 세션27 e2e 실패 37건 재검토 (먼저 수행)

세션27 e2e CI 풀런 결과를 **다시 열어 분류를 확정**한 뒤 작업을 시작한다. 추정만으로 코드를 고치지 않는다.

- [ ] run **25926181316** 로그 재확인 — `gh run view 25926181316 --log-failed`
- [ ] 실패 리포트 아티팩트 확보 — `gh run download 25926181316 -n playwright-report -D /tmp/s27-report`
- [ ] 37건을 아래 3분류로 확정 (세션27 추정 → 증거로 확정/반증):
  - **분류 A — 인증 race**: `auth.ts:64` throw `set-cookie count=0`. 셀러 인증 spec 대부분. → T1~T4가 해소 대상.
  - **분류 B — 데이터 의존 flake**: `consumer-groupbuy`(모집 중 섹션)·`consumer-mypage`(주문 목록)·`consumer-home`(공동구매 섹션). storageState와 무관할 수 있음.
  - **분류 C — `waitForLoadState` 타임아웃**: `perf-css-regression` Seller 로그인 2건. networkidle 미정착 의심(셀러 페이지 상시 연결).
- [ ] **정합성 검토**: 분류별 건수 합 = 37 확인. A가 다수임을 확인(아니면 T1 설계 재검토). B·C는 T5로 분리 기록.

→ 산출: 분류 확정표. 이후 태스크는 분류 A를 푼다.

---

## T1. `global-setup.ts` 확장 — 인증 storageState 발급

기존 `global-setup.ts`는 Vercel SSO 우회 쿠키(`_vercel_jwt`)만 `.bypass-state.json`에 저장한다(#CL-21). 여기에 **세션 쿠키 발급을 1회 추가**한다.

- [ ] 기존 bypass 루프 유지 + seller·consumer 각 1회 `loginViaCredentials` 호출 → 세션 쿠키 포함 컨텍스트를 storageState로 저장.
- [ ] 산출 파일 결정: 통합 1개(`.auth-state.json` — bypass + seller + consumer 쿠키 누적) vs 앱별 분리. **통합 권장** — 쿠키는 도메인 스코프라 충돌 없음.
- [ ] driver는 Credentials provider 부재(Kakao 전용, #CL-25 확인) → 인증 storageState 대상에서 제외.
- [ ] 산출 파일을 e2e gitignore에 추가 (`apps/e2e`에 `.gitignore` 없음 → 루트 `.gitignore`에 `apps/e2e/.auth-state.json`·`apps/e2e/.bypass-state.json` 패턴 확인·보강).
- [ ] **정합성 검토**:
  - storageState JSON에 `_vercel_jwt` + `__Secure-authjs.session-token`(seller·consumer 도메인)이 모두 존재하는지 확인.
  - `loginViaCredentials`의 set-cookie 검증 throw가 globalSetup 안에서도 동작 → race 시 globalSetup이 즉시 실패하므로 fail-fast 보장됨을 확인.
  - 시크릿 미설정 시 명시적 throw 유지 확인.

---

## T2. `playwright.config.ts` · spec storageState 배선

미인증 동작을 검증하는 spec(`/cart 비로그인 → /login 리디렉트` 등)이 깨지지 않도록 **인증/미인증 상태를 분리**한다.

- [ ] 기본 `use.storageState`는 `.bypass-state.json` 유지(미인증 + SSO 우회).
- [ ] 인증이 필요한 spec은 `test.use({ storageState: '.auth-state.json' })`를 describe 상단에 선언.
- [ ] `chromium`·`mobile` 양 project 모두 반영.
- [ ] **정합성 검토**:
  - 미인증 검증 spec(리디렉트류)이 여전히 **미인증 상태**로 도는지 — 잘못 인증되면 리디렉트 테스트가 거짓 통과/실패.
  - 인증 spec이 storageState만으로 보호 페이지 진입 가능한지 1개 spec으로 선검증.

---

## T3. spec 개별 `loginViaCredentials` 호출 제거

인증 spec의 `beforeEach` 로그인 호출을 제거(또는 옵션화)해 Railway 인증 호출을 N→1로 줄인다.

- [ ] 분류 A에 해당하는 셀러 인증 spec들의 `beforeEach`/`beforeAll` 내 `loginViaCredentials` 제거.
- [ ] 한글 파일 일괄 편집 시 PowerShell `Get-Content/Set-Content` 금지 — Python(utf-8 명시) 또는 Edit 도구 사용 (`feedback_windows_encoding`).
- [ ] `loginViaCredentials` 헬퍼 자체는 globalSetup이 쓰므로 **삭제 금지**.
- [ ] **정합성 검토**:
  - 제거된 spec이 storageState 인증 상태로 진입하는지 spec별 grep으로 누락 확인.
  - 인증이 필요 없는 spec에 잘못 `.auth-state.json`이 붙지 않았는지 교차 확인.

---

## T4. 회귀 검증 — e2e CI 풀런

- [ ] `preview` 동기화 후 e2e 풀런 (`main` push → `sync-preview` 자동, 또는 `gh workflow run e2e.yml --ref preview`).
- [ ] 세션27 베이스라인 **124 passed / 37 failed**와 비교.
- [ ] **완료 기준**: 분류 A(인증 race) 실패 **0건**. 잔여는 B·C만.
- [ ] **정합성 검토**: 통과 수 증가가 storageState 효과인지 확인 — 우연한 flake 회복과 구분(2회 연속 풀런 권장).

---

## T5. 잔여 분류 처리 + Railway 계측

- [ ] **분류 B·C** — T4 후에도 남으면 원인별로 BACKLOG에 별도 항목 분리 기록(데이터 시드 의존 / `waitForLoadState` 전략 등). 이번 세션 범위에 무리하게 포함하지 않는다.
- [ ] **Railway `/auth/login` 계측** (BACKLOG §12-2 인접 P1) — storageState 도입 **직전**(세션27 run 25926181316이 baseline 역할)·**직후**(T4 run) Railway 로그에서 `/auth/login` p50/p95/p99 + 실패율 비교.
- [ ] **정합성 검토**: 인증 호출량이 실제로 N→1 수준으로 감소했는지 Railway 로그 호출 건수로 확인.

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12-2 — #CL-23 항목 완료 체크 + 변경 이력 추가.
- [ ] `docs/CRITICAL_LOGIC.md` — #CL-27 결정 기록(storageState 패턴).
- [ ] `docs/memory.md` — 세션28 섹션. 200라인 초과 시 50라인 요약 후 아카이브.
- [ ] 다음 진입점 갱신: P1 잔여(분류 B·C) 또는 P2(`CRITICAL_LOGIC.md` 한도 정책).

## 참조

- 인증 헬퍼: `apps/e2e/tests/_helpers/auth.ts` (`loginViaCredentials` — set-cookie 검증 throw는 세션24 #CL-23 진단)
- 현행 globalSetup: `apps/e2e/global-setup.ts` (SSO 우회 전용)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화: `.github/workflows/sync-preview.yml`
- 설계 맥락: `docs/CRITICAL_LOGIC.md` #CL-20(옵션 B)·#CL-21(옵션 A·Preview)·#CL-26(CI 활성화)

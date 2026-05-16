# 세션32 진입 가이드 — P3 단독 항목 + e2e 안정성 잔여

> 작성: 2026-05-16 (세션31 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션31 #CL-30 — P2-A Railway latency 계측(`/auth/login` p50 922ms·0% 실패) + 계측 중 발견한 throttler 전역 누수 버그 수정
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 후 통과해야 다음 진행.

---

## 배경

세션31에 P2-A(Railway `/auth/login` 로그 계측)가 종결됐다. Railway 배포 로그에
요청 단위 로그가 없어 synthetic 측정 스크립트(`scripts/measure-api-latency.mjs`)로
p50/p95/p99·실패율을 산출했고, 그 과정에서 **throttler 전역 누수 버그**(#CL-30)를
발견·수정했다. P2-B(Vercel cold-start)는 #CL-28·#CL-30 데이터로 **불필요 판정(moot)**.

`docs/BACKLOG.md` §12-1 우선순위 표에서 **P0·P1·P2가 모두 종결**. 남은 것은
**P3 잔여**와 세션31 T0에서 발견한 **e2e 안정성 이슈 2건**이다.

---

## 핸드오프 — 착수 가능성 분류

### 🟢 즉시 착수 가능 (외부 의존 없음 — 권장 1순위)

| 항목 | 범위 | 규모 | 산출물 |
|------|------|------|--------|
| **P3 `/admin/banner` prerender 실패** | Vercel admin/seller 프로젝트 Firebase env 점검 → 누락 config 추가 → 재배포 검증 | 소 | `auth/invalid-api-key` 해소, 빌드 prerender 통과 |
| **e2e `cleanup-spec-residue` CI 실패** | `scripts/cleanup-spec-residue.mjs:19`가 `apps/api/firebase-adminsdk.json`(gitignore된 로컬 키)을 `require` → CI 러너엔 없어 `exit=1`. CI 환경변수 기반 인증으로 전환 | 소 | seller-auth-invite `afterAll` 정리가 CI에서 동작, 테스트 계정 잔여 누적 차단 |
| **e2e `consumer-groupbuy:14` flake** | 페이지 느린 로드 시 리스트도 empty-state도 미렌더 상태에서 `isEmpty=false` 판정 → "모집 중" 강제 단언 실패. 리스트 OR empty-state 중 하나가 뜰 때까지 대기하도록 로직 보강 | 소 | flake 제거, 167/0 베이스라인 신뢰도 회복 |
| **P3 consumer@test.com 강한비번 전환** | Firebase Auth 비번 교체 + `apps/e2e/.env`·repo Secret `TEST_CONSUMER_PASSWORD` 갱신 + e2e 풀런 검증 | 소 | 편의 결정(test1234) → 보안 정상화. `feedback_security_convenience` 재확인 필요 |

### 🟠 조건부 / 다른 작업 의존 (단독 착수 비권장)

| 항목 | 의존·사유 |
|------|-----------|
| **P3 `useOrderActions` 훅 통합** | detail/OrderCard 시그니처 불일치 — 단순 통합 시 동작 변경 위험. UI 리팩토링 사이클에서 일괄 |
| **P3 G1 거점 수정 페이지** | `hubs/[id]/page.tsx` 신규 기능 구현 — 규모 중~대, 별도 기능 세션 권장 |
| **P3 Driver Kakao Maps SDK** | 신규 SDK 연동 — 별도 기능 세션 권장 |

**세션32 권장 시나리오**: T0(회귀 점검) → 🟢 항목을 아토믹 커밋으로 순차 처리.
e2e 안정성 2건(`cleanup-spec-residue`·`consumer-groupbuy` flake)을 먼저 처리하면
167/0 베이스라인이 견고해진 상태에서 나머지를 진행할 수 있어 권장.

---

## T0. 진입 — 현황 재확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. 167/0 유지 여부.
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출 연산자)
- [ ] `docs/BACKLOG.md` §12-1 우선순위 표에서 P3 상태 확인.
- [ ] **정합성 검토**: 167/0에서 회귀했다면 P3 착수 전 회귀 원인 우선 처리.

---

## 세션31 T0에서 발견한 e2e 안정성 이슈 (미해소 — 세션32 후보)

세션31은 사용자 선택에 따라 P2-A에 집중했고, 아래 2건은 발견·기록만 했다.

1. **`consumer-groupbuy.spec.ts:14` flake** — 1차 시도 15.5s 실패 → retry 통과.
   `waitForSelector('text=모집 중', 10s).catch()` 후 `empty.isVisible()`가 false면
   "모집 중"을 강제 단언하는데, 페이지가 아직 로딩 중이면 리스트도 empty-state도
   없어 오판한다. → 둘 중 하나가 확정 렌더될 때까지 대기하도록 수정.
2. **`scripts/cleanup-spec-residue.mjs` CI 실패** — line 19가 `apps/api/firebase-adminsdk.json`
   (gitignore된 로컬 전용 서비스 계정 키)을 `require`. CI 러너엔 파일이 없어
   `Cannot find module` → `exit=1; 2 emails may remain`. seller-auth-invite `afterAll`
   정리가 CI에서 무력화 → 테스트 계정 잔여 누적. 세션22 도입 이후 상존.
   → `firebase-admin`을 env 기반 인증(`FIREBASE_SERVICE_ACCOUNT` JSON 또는
   `GOOGLE_APPLICATION_CREDENTIALS`)으로 전환 + 필요 시 repo Secret 추가.

---

## P3 잔여 (BACKLOG §12-2 참조)

- [ ] `/admin/banner` prerender 실패 — Vercel admin/seller Firebase env 점검·추가·재배포.
- [ ] consumer@test.com 강한비번 전환 — 현재 test1234(편의 결정). 보안 follow-up.
- [ ] `useOrderActions` 훅 통합 — detail/OrderCard 시그니처 불일치. UI 리팩토링 사이클에서.
- [ ] G1 `apps/seller/src/app/hubs/[id]/page.tsx` 거점 수정 페이지 신규 구현.
- [ ] Driver Kakao Maps SDK 연동.

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12 — 처리한 항목 완료 체크 + 변경 이력.
- [ ] 설계 결정 발생 시 `docs/CRITICAL_LOGIC.md` 신규 #CL 기록 (1000라인 초과 시 #CL-29 아카이브 정책 적용).
- [ ] `docs/memory.md` 세션32 섹션 (200라인 초과 시 50라인 요약 후 아카이브 — 현재 164라인).
- [ ] 다음 진입점(`session33-prep.md`) 갱신 + `BACKLOG.md` §12 진입점 링크 수정.

## 참조

- 한도 정책: `docs/CRITICAL_LOGIC.md` #CL-29 · 활성 결정 로그(#CL-19~#CL-30) / 아카이브 `archive/CRITICAL_LOGIC_archive_20260516.md`
- P2-A 계측 결과·throttler fix: `docs/CRITICAL_LOGIC.md` #CL-30 · `scripts/measure-api-latency.mjs`
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 표
- 베이스라인 풀런: run 25962635875 (167 passed / 0 failed / 11 skipped)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

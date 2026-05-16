# 세션33 진입 가이드 — P3 단독 항목

> 작성: 2026-05-17 (세션32 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션32 — e2e 안정성 2건 해소(`consumer-groupbuy` flake + `cleanup-spec-residue` CI 인증). 풀런 167/0 유지.
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 후 통과해야 다음 진행.

---

## 배경

세션32에 세션31 T0에서 발견한 e2e 안정성 이슈 2건을 모두 해소했다.

1. **`consumer-groupbuy:14` flake** — `list.or(empty)`가 확정 렌더될 때까지
   대기 후 분기하도록 수정 (커밋 `abd2a13`).
2. **`cleanup-spec-residue` CI 인증 실패** — `FIREBASE_SERVICE_ACCOUNT_JSON`
   env 기반 인증으로 전환 + repo Secret 등록 (커밋 `b095023`, `4934468`).
   세션22 이후 처음으로 CI에서 `afterAll` 잔여 계정 정리가 동작
   (풀런 run 25965438455 `users=2` 삭제 확인).

`docs/BACKLOG.md` §12-1 우선순위 표에서 **P0·P1·P2 + e2e 안정성 전부 종결**.
남은 것은 **P3 단독·기능 항목**이다.

---

## 핸드오프 — 착수 가능성 분류

### 🟢 즉시 착수 가능 (단, 사용자 입력 필요)

| 항목 | 범위 | 필요한 사용자 입력 |
|------|------|--------------------|
| **P3 `/admin/banner` prerender 실패** | Vercel admin/seller 프로젝트 Firebase env 점검 → 누락 config 추가 → 재배포 검증 | Vercel 대시보드 환경변수 확인·추가는 사용자 작업 (코드/원인 분석은 에이전트 가능) |
| **P3 consumer@test.com 강한비번 전환** | Firebase Auth 비번 교체 + `apps/e2e/.env`·repo Secret `TEST_CONSUMER_PASSWORD` 갱신 + e2e 풀런 검증 | `feedback_security_convenience`(편의 우선 — test1234 재사용) 결정과 충돌 → 전환 여부 재확인 필요 |

### 🟠 조건부 / 다른 작업 의존 (단독 착수 비권장)

| 항목 | 의존·사유 |
|------|-----------|
| **P3 `useOrderActions` 훅 통합** | detail/OrderCard 시그니처 불일치 — 단순 통합 시 동작 변경 위험. UI 리팩토링 사이클에서 일괄 |
| **P3 G1 거점 수정 페이지** | `hubs/[id]/page.tsx` 신규 기능 구현 — 규모 중~대, 별도 기능 세션 권장 |
| **P3 Driver Kakao Maps SDK** | 신규 SDK 연동 — 별도 기능 세션 권장 |

---

## T0. 진입 — 현황 재확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. 167/0 유지 여부.
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출 연산자)
- [ ] `docs/BACKLOG.md` §12-1 우선순위 표에서 P3 상태 확인.
- [ ] **정합성 검토**: 167/0에서 회귀했다면 P3 착수 전 회귀 원인 우선 처리.

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
- [ ] `docs/memory.md` 세션33 섹션 (200라인 초과 시 50라인 요약 후 아카이브 — 현재 ~178라인).
- [ ] 다음 진입점(`session34-prep.md`) 갱신 + `BACKLOG.md` §12 진입점 링크 수정.

## 참조

- 한도 정책: `docs/CRITICAL_LOGIC.md` #CL-29 · 활성 결정 로그(#CL-19~#CL-30) / 아카이브 `archive/CRITICAL_LOGIC_archive_20260516.md`
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 표
- cleanup-spec-residue 인증: `FIREBASE_SERVICE_ACCOUNT_JSON` env (CI) / 로컬 키 fallback — `docs/memory.md` 핵심 기술 특이사항
- 베이스라인 풀런: run 25965438455 (167 passed / 0 failed)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

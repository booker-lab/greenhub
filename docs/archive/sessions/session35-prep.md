# 세션35 진입 가이드 — P3 잔여 기능 항목

> 작성: 2026-05-17 (세션34 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션34 — P3 consumer@test.com 강한비번 전환. 풀런 167/0 유지.
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 후 통과해야 다음 진행.

---

## 배경

세션34에 P3 consumer 강한비번 전환을 완료했다. 세션22에 편의 우선으로 채택했던
약한비번(`test1234!`)을 사용자가 보안 우선으로 재확인 → `reset-user-password.mjs`로
Firestore `passwordHash`를 30자 랜덤 비번(bcrypt-12)으로 갱신, `apps/e2e/.env`·repo
Secret `TEST_CONSUMER_PASSWORD` 동기 교체. e2e 풀런 167/0 회귀 0건.

`docs/BACKLOG.md` §12-1 우선순위 표에서 **P0·P1·P2 + e2e 안정성 + `/admin/banner` +
consumer 강한비번 전부 종결**. 남은 것은 **P3 기능 항목 3건**이다.

---

## ⚠️ 먼저 처리 — memory.md 한도

`docs/memory.md`가 **197라인** — CLAUDE.md §1 Memory SSOT Guard 200라인 한도 임박.
**세션35에서 새 항목을 추가하기 전 50라인 이내로 요약 후 아카이브화**해야 한다
(`docs/archive/memory_archive_*.md`). 이것이 세션35 최우선 작업.

---

## 핸드오프 — P3 잔여 (모두 신규 기능, 별도 기능 세션 권장)

| 항목 | 범위 | 비고 |
|------|------|------|
| **G1 거점 수정 페이지** | `apps/seller/src/app/hubs/[id]/page.tsx` 신규 구현 | Phase B 잔여. 규모 중~대. `/hubs/[id]` 거점 상세·`/hubs/[id]/pickup`은 이미 존재 — edit 화면만 누락 |
| **`useOrderActions` 훅 통합** | detail용 `useOrderDetailActions`(모달 reason+apiFetch)와 OrderCard용 `useOrderActions`(prompt() reason+raw fetch) 시그니처 통일 | #CL-22 분리 항목. 단순 통합 시 동작 변경 위험 — UI 리팩토링 사이클에서 일괄 |
| **Driver Kakao Maps SDK** | 드라이버 앱 Kakao Maps SDK 연동 | 신규 SDK 연동. 밀크런 경로 프리뷰(§7 Should Have)와 연계 가능 |

---

## T0. 진입 — 현황 재확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. 167/0 유지 여부.
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출 연산자)
  - 세션34는 코드 변경 없음(데이터·Secret만) → 베이스라인 run 25966655016 (167/0).
- [ ] `docs/memory.md` 라인 수 확인 — 200라인 초과 시 즉시 50라인 요약·아카이브.
- [ ] `docs/BACKLOG.md` §12-1 우선순위 표에서 P3 상태 확인.
- [ ] **정합성 검토**: 167/0에서 회귀했다면 P3 착수 전 회귀 원인 우선 처리.

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12 — 처리한 항목 완료 체크 + 변경 이력.
- [ ] 설계 결정 발생 시 `docs/CRITICAL_LOGIC.md` 신규 #CL 기록 (현재 #CL-31까지, ~310라인).
- [ ] `docs/memory.md` 세션35 섹션 (T0에서 아카이브 처리 후 작성).
- [ ] 다음 진입점(`session36-prep.md`) 갱신 + `BACKLOG.md` §12 진입점 링크 수정.

## 참조

- 한도 정책: `docs/CRITICAL_LOGIC.md` #CL-29 · 활성 결정 로그(#CL-19~#CL-31)
- 테스트 계정 비번 회전: `scripts/reset-user-password.mjs` + `apps/e2e/.env` + `gh secret set TEST_*_PASSWORD --body` 3곳 동기
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 표
- 베이스라인 풀런: run 25966655016 (167 passed / 0 failed / 11 skipped)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

# 세션36 진입 가이드 — P3 잔여 기능 항목

> 작성: 2026-05-17 (세션35 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션35 — docs 정리(코드 변경 없음). e2e 베이스라인 167/0 유지.
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 후 통과해야 다음 진행.

---

## 배경

세션35는 docs 정리 세션이었다. 사용자가 P3 잔여 3건을 별도 세션 작업으로 두기로 결정해
세션35는 문서 정비에 집중했다:

- `docs/memory.md` 200라인 한도 임박(197라인) → 50라인 이내 요약(50라인).
  세션22~34 상세 narrative는 `docs/archive/memory_archive_20260517.md`로 아카이브.
- 폴더 이동(`docs/design/`·`docs/specs/api/`)으로 깨진 design↔api spec 상호 참조 링크 14곳 수정.
- `docs/BACKLOG.md` 변경 이력 — 세션32 행 순서 보정 + 누락된 세션26 행 추가.

`docs/BACKLOG.md` §12-1 우선순위 표에서 **P0·P1·P2 + e2e 안정성 + `/admin/banner` +
consumer 강한비번 전부 종결**. 남은 것은 **P3 기능 항목 3건**이다.

---

## 핸드오프 — P3 잔여 (모두 신규 기능, 별도 기능 세션 권장)

| 항목 | 범위 | 비고 |
|------|------|------|
| **`useOrderActions` 훅 통합** | detail용 `useOrderDetailActions`(모달 reason+apiFetch)와 OrderCard용 `useOrderActions`(prompt() reason+raw fetch) 시그니처 통일 | #CL-22 분리 항목. 단순 통합 시 동작 변경 위험 — UI 리팩토링 사이클에서 일괄 |
| **G1 거점 수정 페이지** | `apps/seller/src/app/hubs/[id]/page.tsx` 신규 구현 | Phase B 잔여. 규모 중~대. `/hubs/[id]` 거점 상세·`/hubs/[id]/pickup`은 이미 존재 — edit 화면만 누락 |
| **Driver Kakao Maps SDK** | 드라이버 앱 Kakao Maps SDK 연동 | 신규 SDK 연동. 밀크런 경로 프리뷰(§7 Should Have)와 연계 가능 |

---

## T0. 진입 — 현황 재확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. 167/0 유지 여부.
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출 연산자)
  - 세션35는 코드 변경 없음(docs만) → 베이스라인 run 25966655016 (167/0).
- [ ] `docs/memory.md` 라인 수 확인 — 50라인. 200라인 한도 여유 있음.
- [ ] `docs/BACKLOG.md` §12-1 우선순위 표에서 P3 상태 확인.
- [ ] **정합성 검토**: 167/0에서 회귀했다면 P3 착수 전 회귀 원인 우선 처리.

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12 — 처리한 항목 완료 체크 + 변경 이력.
- [ ] 설계 결정 발생 시 `docs/CRITICAL_LOGIC.md` 신규 #CL 기록 (현재 #CL-31까지).
- [ ] `docs/memory.md` 세션36 섹션 갱신.
- [ ] 다음 진입점(`session37-prep.md`) 갱신 + `BACKLOG.md` §12 진입점 링크 수정.

## 참조

- 한도 정책: `docs/CRITICAL_LOGIC.md` #CL-29 · 활성 결정 로그(#CL-19~#CL-31)
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 절
- 베이스라인 풀런: run 25966655016 (167 passed / 0 failed / 11 skipped)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

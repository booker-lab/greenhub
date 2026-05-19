# 세션52 진입 문서 — T6 CI 풀런 검증 + 잔여 백로그 진입

> 작성: 2026-05-20 (세션51 종료) · 선행: 세션51 T6 e2e 회귀 가드 시드/spec 완료
> 목표: **preview 동기화 후 CI 풀런으로 세션51 신규 spec 검증** + 잔여 백로그(P3/P4/BUG-16) 1건 선정 진입
> SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (T1·T2·T3·T4·T5·T6 ✅)

---

## 컨텍스트

세션51에서 e2e 시드 스크립트 + 신규 spec 7건이 main에 들어갔다(예정 커밋). 로컬 풀런은 #CL-23 set-cookie race로 막혀, 검증은 다음 두 경로:
1. **육안 검증** — `docs/specs/frontend/seller-refactor-visual-verify.md` D-T6 섹션(#89~#96).
2. **CI 풀런** — main 머지 → sync-preview → e2e workflow 자동 실행, 신규 5+2건 passed 확인.

세션52는 ① CI 풀런 결과 확인 + flake 대응, ② 잔여 백로그 1건 진입을 함께 처리한다.

---

## 세션52 태스크

### T7-A — 세션51 신규 spec CI 풀런 검증

**확인 경로**:
- `gh run list --workflow=e2e.yml --limit 5` (CLI 절대경로 `C:\Program Files\GitHub CLI\gh.exe`)
- 새 풀런이 sync-preview 후 트리거됐는지 확인. 베이스라인(170 passed) + 신규 7건 = 177 passed 기대.

**flake 대응 패턴**:
- seller 로그인 set-cookie race(#CL-23)는 globalSetup 3회 재시도로 흡수되지만, 그래도 실패 시 재실행으로 stale preview race(`[[reference_e2e_preview_race]]`) 회피.
- 신규 D-T6 spec이 시드 데이터(`e2e-normal-order-001` 등)에 의존 — Firestore 상태가 정리되어 있다면 시드 재실행: `node scripts/seed-e2e-orders.mjs`.

**기대 결과**:
- [ ] 새 베이스라인 177 passed 갱신 + memory.md 반영
- [ ] flake 발견 시 `apps/e2e/tests/seller-orders.spec.ts` T6 섹션 보정(timeout 상향/locator 정교화)

### T7-B — 잔여 백로그 1건 진입

후보 (사용자 선택):

| 순위 | 항목 | 출처 | 작업량 추정 |
|------|------|------|-------------|
| P3 | Driver Kakao Maps SDK 통합 | BACKLOG.md | 중대 — 외부 SDK + 권한 + e2e flow |
| P4 | 준비 물량·픽업 코드 fontSize 토큰화 (24px DS 토큰 신설) | BACKLOG.md §1-3 | 소형 — DS 토큰 + 2~3곳 치환 |
| BUG-16 | 택배 주문 상태 전환 갭 | BACKLOG.md | 중간 — 상태 머신 정합성 검토 |

세션 진입 시 사용자에게 후보 제시 후 선정.

---

## 진행 규칙

- T7-A는 별도 커밋 불필요(검증·문서 갱신만). T7-B 진입 시 플랜 SSOT 갱신 → 구현 단위로 분할.
- 시드 스크립트는 멱등이지만 `cleanup-spec-residue.mjs`가 `e2e-` prefix를 보존하는지 점검(보존 안 된다면 정책 보강).
- 한글 파일 편집 시 PowerShell `Get-Content`/`Set-Content` 금지 — Edit/Python.

## 세션52 완료 기준

- [ ] T7-A CI 풀런 결과 확인 + 베이스라인 반영 (flake가 있다면 1차 보정)
- [ ] T7-B 백로그 1건 선정 + 진입 (스펙 갱신·1차 커밋)
- [ ] `docs/memory.md` 갱신 + 다음 세션 진입 문서

## 참조

- 플랜 SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (T6 ✅)
- 세션51 커밋 (예정): 시드 스크립트 + 신규 spec + 육안 검증 보강 + #CL-35 T6 fragment
- e2e 시드: `scripts/seed-e2e-orders.mjs` — 활성 상품 store dailyCaps 14일 + 셀러 store 일반/공구 주문
- 잔여 백로그 — `docs/BACKLOG.md` §1-3 (P4), Driver Kakao(P3), BUG-16

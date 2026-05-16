# 세션30 진입 가이드 — #CL-23 종결 후 P2 정비

> 작성: 2026-05-16 (세션29 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션29 #CL-28 — e2e 잔여 B·C·D 전부 해소 (run 25957177092 167/0)
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 후 통과해야 다음 진행.

---

## 배경

세션27~29에 걸친 #CL-23(e2e 인증 race + 잔여 B·C·D)이 완전히 종결됐다.
e2e CI 풀런은 124/37 → **167 passed / 0 failed / 11 skipped**(run 25957177092)로
잔여 실패 0건. `docs/BACKLOG.md` §12 우선순위 표에서 P0·P1이 모두 ✅이며,
다음은 **P2 3종** + P3 잔여다.

| 분류 | 항목 | 외부 의존 |
|------|------|-----------|
| P2-A | Railway `/auth/login` 로그 계측 | **Railway 대시보드 접근 — 사용자 협조 필요** |
| P2-B | Vercel function cold-start mitigation 검토 | P2-A 데이터 선행 |
| P2-C | `CRITICAL_LOGIC.md` 한도 정책 결정 | 없음 — 단독 진행 가능 |

**권장 순서**: P2-C(단독·즉시 착수 가능) → P2-A(사용자 협조 확보 시) → P2-B(P2-A 의존).
P2-A·B는 외부 조건에 묶이므로, 한 세션에 전부 넣지 말고 P2-C를 우선 목표로 한다.

---

## T0. 진입 — 현황 재확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. 167/0 유지 여부 확인(회귀 감시).
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — 호출 연산자 `&` 사용)
- [ ] `docs/BACKLOG.md` §12-1 우선순위 표에서 P2 3종 상태 확인.
- [ ] **정합성 검토**: e2e 풀런이 167/0에서 회귀했다면 P2 착수 전 회귀 원인 우선 처리.

→ 산출: 회귀 없음 확인 후 아래 P2 태스크 진행.

---

## P2-C. `CRITICAL_LOGIC.md` 한도 정책 결정 (단독 — 우선 착수)

`docs/CRITICAL_LOGIC.md`는 #CL-28까지 누적되어 1400라인 초과. CLAUDE.md §1의
단일 파일 500라인 모듈화 한도와 충돌하나, 누적 결정 로그 파일은 코드 모듈과
성격이 다르다(`BACKLOG.md`도 동일 사례).

- [ ] **C-1 옵션 결정** (`docs/BACKLOG.md` §12-2 P2 항목의 3개 옵션 중 택):
  - 옵션 1: 분기별 archive (`CRITICAL_LOGIC_2026Q1.md` 등) — 현행 파일은 최근 분기만
  - 옵션 2: 도메인별 분리 (auth/payment/schema) — 검색성 trade-off
  - 옵션 3: CLAUDE.md §1에 "누적 결정 로그 파일 예외" 명시 — 최소 변경
  - 사용자 결정 사항이면 `AskUserQuestion`으로 확인.
- [ ] **C-2 적용**: 선택 옵션대로 파일 재구성 + CLAUDE.md §1 갱신 + `docs/memory.md` 반영.
- [ ] **정합성 검토**: 기존 #CL-xx 참조 링크(여러 문서가 `CRITICAL_LOGIC.md` 앵커 참조)가
      깨지지 않는지. 분리 시 리다이렉트/인덱스 유지.

---

## P2-A. Railway `/auth/login` 로그 계측 (외부 접근 필요)

#CL-23으로 인증 호출은 풀런당 67회+retry → 2회로 **구조상 N→1 확정**.
#CL-28로 cold-start 가설은 CORS로 반증됨 — 본 항목은 **순수 latency 계측**으로 격하.
B 차단 요인이 아니므로 긴급도 낮음.

- [ ] **A-1**: Railway 대시보드/로그에서 `/auth/login`·주요 REST endpoint의 응답시간
      p50/p95/p99 + 실패율 추출. — **Railway 대시보드 접근 필요, 사용자 협조 사항**.
- [ ] **A-2 (옵션)**: 별도 헬스체크 endpoint로 정기 수치화 자동화.
- [ ] **정합성 검토**: storageState 도입 전후(s27 vs 세션28~29 풀런) latency 비교 데이터로 정리.

---

## P2-B. Vercel function cold-start mitigation 검토 (P2-A 의존)

NextAuth API route cold start가 set-cookie 누락의 또 다른 원인일 가능성.
**P2-A 계측 데이터 확보 후 데이터 기반 결정** — 데이터 없이 착수 금지.

- [ ] **B-1**: Vercel Function `regions`·`memory` 설정 현황 점검.
- [ ] **B-2 (옵션)**: ISR pre-warm cron으로 핵심 라우트 워밍.

---

## P3 잔여 (시간 여유 시)

- `useOrderActions` 훅 통합 — detail/OrderCard 시그니처 불일치. UI 리팩토링 사이클에서.
- `/admin/banner` prerender 실패 — Vercel admin/seller Firebase env 점검·추가·재배포.
- G1 `apps/seller/src/app/hubs/[id]/page.tsx` 거점 수정 페이지 신규 구현.
- Driver Kakao Maps SDK 연동.
- consumer@test.com 강한비번 전환 (현재 test1234 — 편의 결정, 보안 follow-up).

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12 — 처리한 P2 항목 완료 체크 + 변경 이력.
- [ ] 설계 결정 발생 시 `docs/CRITICAL_LOGIC.md` 신규 #CL 기록.
- [ ] `docs/memory.md` 세션30 섹션 (200라인 초과 시 50라인 요약 후 아카이브).
- [ ] 다음 진입점 갱신.

## 참조

- #CL-23 종결: `docs/CRITICAL_LOGIC.md` #CL-27(인증 race)·#CL-28(CORS) · 세션29 가이드 `session29-prep.md`
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 표
- 베이스라인 풀런: run 25957177092 (167 passed / 0 failed / 11 skipped)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

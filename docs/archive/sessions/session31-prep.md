# 세션31 진입 가이드 — P2-A Railway 로그 계측 + P3 잔여

> 작성: 2026-05-16 (세션30 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션30 #CL-29 — `CRITICAL_LOGIC.md` 한도 정책(누적 결정 로그 모듈화 예외 + 1000라인 트리거), 1415→229라인 아카이브 분리
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 후 통과해야 다음 진행.

---

## 배경

세션27~29에 걸친 #CL-23(e2e 인증 race + 잔여 B·C·D)이 완전히 종결됐고,
세션30에 P2-C(`CRITICAL_LOGIC.md` 한도 정책 #CL-29)가 완료됐다.
`docs/BACKLOG.md` §12-1 우선순위 표에서 P0·P1·P2-C가 모두 ✅.
남은 것은 **P2-A·P2-B**(외부 의존)와 **P3 잔여**다.

| 분류 | 항목 | 외부 의존 |
|------|------|-----------|
| P2-A | Railway `/auth/login` 로그 계측 | **Railway 대시보드 접근 — 사용자 협조 필요** |
| P2-B | Vercel function cold-start mitigation 검토 | P2-A 데이터 선행 |
| P3 | `useOrderActions` 통합 / `/admin/banner` env / G1 거점 수정 / Driver Maps / consumer 강한비번 | 항목별 상이 |

**권장 순서**: P2-A 착수 가능 여부를 먼저 사용자에게 확인. Railway 대시보드 접근이
불가하면 P2-A·P2-B는 보류하고 **P3 단독 항목**(env 점검·강한비번 등)을 우선 처리한다.

> ⚠️ **P2-A는 세션28·29에서 각각 한 번씩 가이드에 포함됐으나 Railway 대시보드 접근
> 조건 미충족으로 이월된 항목**이다(세션28-prep line 89, 세션29-prep line 107).
> #CL-28에서 cold-start 가설이 CORS로 반증되어 **순수 latency 계측으로 격하**됐다 —
> e2e 차단 요인이 아니므로 긴급도 낮음. 사용자 협조가 안 되면 미루어도 무방.

---

## T0. 진입 — 현황 재확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. 167/0 유지 여부(회귀 감시).
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — PowerShell 호출 연산자 `&` 사용)
- [ ] `docs/BACKLOG.md` §12-1 우선순위 표에서 P2·P3 상태 확인.
- [ ] **정합성 검토**: e2e 풀런이 167/0에서 회귀했다면 P2·P3 착수 전 회귀 원인 우선 처리.

→ 산출: 회귀 없음 확인 후 아래 진행.

---

## P2-A. Railway `/auth/login` 로그 계측 (외부 접근 필요)

#CL-23으로 인증 호출은 풀런당 67회+retry → 2회로 **구조상 N→1 확정**.
#CL-28로 cold-start 가설은 CORS로 반증됨 — 본 항목은 **순수 latency 계측**.

- [ ] **A-0**: 사용자에게 Railway 대시보드 접근 가능 여부 확인. 불가 시 본 항목 보류.
- [ ] **A-1**: Railway 대시보드/로그에서 `/auth/login`·주요 REST endpoint의 응답시간
      p50/p95/p99 + 실패율 추출.
- [ ] **A-2 (옵션)**: 별도 헬스체크 endpoint로 정기 수치화 자동화.
- [ ] **정합성 검토**: storageState 도입 전후(s27 vs 세션28~29 풀런) latency 비교로 정리.

---

## P2-B. Vercel function cold-start mitigation 검토 (P2-A 의존)

NextAuth API route cold start 영향 가능성. **P2-A 계측 데이터 확보 후 데이터 기반 결정** —
데이터 없이 착수 금지.

- [ ] **B-1**: Vercel Function `regions`·`memory` 설정 현황 점검.
- [ ] **B-2 (옵션)**: ISR pre-warm cron으로 핵심 라우트 워밍.

---

## P3 잔여 (P2 보류 시 우선 처리 가능)

단독으로 착수 가능한 항목부터:

- [ ] `/admin/banner` prerender 실패 — Vercel admin/seller Firebase env 점검·추가·재배포. (환경변수 점검만)
- [ ] consumer@test.com 강한비번 전환 — 현재 test1234(편의 결정). 보안 follow-up.
- [ ] `useOrderActions` 훅 통합 — detail/OrderCard 시그니처 불일치. UI 리팩토링 사이클에서.
- [ ] G1 `apps/seller/src/app/hubs/[id]/page.tsx` 거점 수정 페이지 신규 구현.
- [ ] Driver Kakao Maps SDK 연동.

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12 — 처리한 항목 완료 체크 + 변경 이력.
- [ ] 설계 결정 발생 시 `docs/CRITICAL_LOGIC.md` 신규 #CL 기록 (1000라인 초과 시 #CL-29 아카이브 정책 적용).
- [ ] `docs/memory.md` 세션31 섹션 (200라인 초과 시 50라인 요약 후 아카이브).
- [ ] 다음 진입점(`session32-prep.md`) 갱신 + `BACKLOG.md` §12 진입점 링크 수정.

## 참조

- 한도 정책: `docs/CRITICAL_LOGIC.md` #CL-29 · 활성 결정 로그(#CL-19~) / 아카이브 `archive/CRITICAL_LOGIC_archive_20260516.md`
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 표
- 베이스라인 풀런: run 25957177092 (167 passed / 0 failed / 11 skipped)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

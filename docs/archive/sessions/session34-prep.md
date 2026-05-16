# 세션34 진입 가이드 — P3 잔여 단독·기능 항목

> 작성: 2026-05-17 (세션33 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션33 — P3 `/admin/banner` prerender 실패 해소(#CL-31). 풀런 167/0 유지.
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 후 통과해야 다음 진행.

---

## 배경

세션33에 P3 `/admin/banner` prerender 실패를 코드로 종결했다. `firebase.ts`가
모듈 로드 시점에 `getAuth(app)`를 평가 → `apiKey` 부재 시 동기 throw하던 것을
`getAuth`/`getStorage` 지연 초기화 함수로 전환(#CL-31, 커밋 `32738fb`). Vercel은
env 존재로 무영향 — 환경변수 조치는 불필요로 확정됐다.

`docs/BACKLOG.md` §12-1 우선순위 표에서 **P0·P1·P2 + e2e 안정성 + `/admin/banner`
전부 종결**. 남은 것은 **P3 단독·기능 항목 4건**이다.

---

## 핸드오프 — 착수 가능성 분류

### 🟢 즉시 착수 가능 (단, 사용자 결정 필요)

| 항목 | 범위 | 필요한 사용자 입력 |
|------|------|--------------------|
| **P3 consumer@test.com 강한비번 전환** | Firebase Auth 비번 교체 + `apps/e2e/.env`·repo Secret `TEST_CONSUMER_PASSWORD` 갱신 + e2e 풀런 검증 | `feedback_security_convenience`(편의 우선 — test1234 재사용) 결정과 충돌 → 전환 여부 재확인 필요 |

### 🟠 조건부 / 다른 작업 의존 (단독 착수 비권장)

| 항목 | 의존·사유 |
|------|-----------|
| **P3 `useOrderActions` 훅 통합** | detail/OrderCard 시그니처 불일치 — 단순 통합 시 동작 변경 위험. UI 리팩토링 사이클에서 일괄 (#CL-22) |
| **P3 G1 거점 수정 페이지** | `apps/seller/src/app/hubs/[id]/page.tsx` 신규 기능 구현 — 규모 중~대, 별도 기능 세션 권장 |
| **P3 Driver Kakao Maps SDK** | 신규 SDK 연동 — 별도 기능 세션 권장 |

---

## T0. 진입 — 현황 재확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. 167/0 유지 여부.
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출 연산자)
  - 세션33 커밋 `32738fb`는 seller 코드 변경 → sync-preview가 e2e 디스패치. 회귀 0건 확인.
- [ ] `docs/BACKLOG.md` §12-1 우선순위 표에서 P3 상태 확인.
- [ ] **정합성 검토**: 167/0에서 회귀했다면 P3 착수 전 회귀 원인 우선 처리.

---

## P3 잔여 (BACKLOG §12-2 참조)

- [ ] consumer@test.com 강한비번 전환 — 현재 test1234(편의 결정). 보안 follow-up. **착수 전 사용자 재확인.**
- [ ] `useOrderActions` 훅 통합 — detail/OrderCard 시그니처 불일치. UI 리팩토링 사이클에서.
- [ ] G1 `apps/seller/src/app/hubs/[id]/page.tsx` 거점 수정 페이지 신규 구현.
- [ ] Driver Kakao Maps SDK 연동.

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12 — 처리한 항목 완료 체크 + 변경 이력.
- [ ] 설계 결정 발생 시 `docs/CRITICAL_LOGIC.md` 신규 #CL 기록 (현재 #CL-31까지, ~310라인 — 1000라인 초과 시 아카이브 정책 적용).
- [ ] `docs/memory.md` 세션34 섹션 (200라인 초과 시 50라인 요약 후 아카이브 — 현재 ~189라인, 임박).
- [ ] 다음 진입점(`session35-prep.md`) 갱신 + `BACKLOG.md` §12 진입점 링크 수정.

## 참조

- 한도 정책: `docs/CRITICAL_LOGIC.md` #CL-29 · 활성 결정 로그(#CL-19~#CL-31) / 아카이브 `archive/CRITICAL_LOGIC_archive_20260516.md`
- seller firebase 지연 초기화: `docs/CRITICAL_LOGIC.md` #CL-31 — `getAuth`/`getStorage` 모듈 최상위 호출 금지
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 표
- 베이스라인 풀런: run 25965603664 (167 passed / 0 failed)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

# 세션29 진입 가이드 — #CL-23 잔여 e2e 실패 B·C·D 해소

> 작성: 2026-05-16 (세션28 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션28 #CL-23 인증 race 해소 완료 (#CL-27 — storageState 패턴)
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 수행 후 통과해야 다음 진행.

> **[세션29 종료 — 결과]** 본 가이드 소비 완료. T0 재확인(run 25952638293 — B5·C2·D8·flake1, 인증 race 0건).
> **C 완료** (커밋 `0d466f1`): perf-css `networkidle` 제거 — 원인은 Vercel preview `vercel.live` 위젯 상시 연결. 로컬 15/15 통과.
> **B·D 단일 원인 확정** (커밋 `6542ecc`, #CL-28): 가이드의 B(Railway)·D(realtime)는 별개가 아니라 **동일 CORS 원인**. Railway API가 Vercel preview origin에 CORS 헤더 미발급 → `apiFetch`·`/auth/firebase-token` 차단 → D는 `firebaseReady=false`로 인한 하위 증상. cold-start 가설 반증. `main.ts`에 팀 스코프 정규식 추가.
> **[해소 완료]** `c5ee52f` push가 Railway 자동 재배포 트리거 → curl로 CORS 발급·차단 확인 → e2e 풀런 run 25957177092 **167 passed / 0 failed / 11 skipped** (B5·D8·인증 race 전부 해소). D spec 무변경. 다음 진입점은 `docs/BACKLOG.md` §12-1 「다음 세션 최우선」(P2 로그 계측).
> 아래 본문은 세션28 작성 원안(참고용 보존) — B·D는 위 결과로 대체됨.

---

## 배경

세션28에서 #CL-23 인증 race(분류 A 23건)를 storageState 패턴으로 해소했다. e2e CI 풀런이
124/37 → **145/16 · 146/15**로 개선됐고, 잔여 14~15건은 **전부 storageState와 무관**한
별도 원인이다. 세션28 T0 증거 분류 + T4 2회 풀런 재확인 결과:

| 분류 | 건수 | 대상 spec | 성격 |
|------|------|-----------|------|
| **B** | 5 | consumer-groupbuy:14·consumer-mypage:74·seller-onboarding:45·seller-onboarding:76·seller-settlements:98 | Railway API `Failed to fetch` — 페이지는 인증·렌더 정상, REST 호출만 실패 |
| **C** | 2 | perf-css-regression:87·:103 | `page.waitForLoadState('networkidle')` 30s 타임아웃 |
| **D** | 8 | seller-home-dashboard ×7 + seller-orders:65 | Firestore realtime indicator가 `연결 중`에서 미정착 |
| (flake) | 0~1 | consumer-home:15 | B와 동종 — 간헐 (1차 실패·2차 통과) |

**권장 순서**: C(가장 단순·국소) → D(spec vs 리스너 결정 필요) → B(Railway 의존, 외부 조건 일부).
한 세션에 전부 무리하게 넣지 말 것 — C+D를 우선 목표로, B는 계측과 함께 별도 판단.

---

## T0. 진입 — 최신 풀런으로 분류 재확인 (먼저 수행)

추정으로 고치지 않는다. 세션28 종료 후 최신 e2e run을 열어 B·C·D 현황을 확정한다.

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. (세션28 T5 docs push가 디스패치한 run 포함)
- [ ] `--log-failed` + `playwright-report` 아티팩트(`error-context.md`·`trace.zip`)로 B·C·D 건수 재확인.
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — 호출 연산자 `&` 사용)
  - `gh run view --log-failed > file` 는 PowerShell에서 UTF-16로 저장됨 → `Get-Content -Encoding Unicode` 후 UTF-8 재기록 필요 (세션28 절차 참조)
  - artifact zip은 `gh api .../artifacts/{id}/zip` 을 `Invoke-WebRequest -OutFile` 로 받아야 바이너리 보존 (`gh api > file` 은 손상)
- [ ] **정합성 검토**: B·C·D 건수 합이 세션28(5+2+8)과 일치하는지. 변동 시 원인 파악 후 본 가이드 갱신.

→ 산출: 최신 분류 확정. 인증 race(`set-cookie count=0`)가 0건 유지되는지도 확인 — 비0이면 #CL-27 회귀.

---

## C. perf-css `waitForLoadState('networkidle')` 타임아웃 (2건)

`perf-css-regression.spec.ts` 의 Seller 로그인 테스트 2건이 `goto('/login')` 직후
`page.waitForLoadState('networkidle')`(line 91·111)에서 30s 타임아웃. networkidle은
500ms 무네트워크를 요구하는데 셀러 `/login`이 끝내 정착하지 않는다.

- [ ] **C-1 원인 규명**: 실패 trace.zip을 `playwright show-trace`로 열어 networkidle을 막는
      요청 식별 — Firebase SDK 초기화 연결 / 애널리틱스 / 폴링 중 무엇인지.
- [ ] **C-2 수정**: 두 테스트의 의도(JS 에러 없음 / CDN 외부 폰트 요청 없음)는 networkidle을
      필수로 하지 않는다. `networkidle` → `load` 또는 `domcontentloaded` + 명시적 대기로 교체.
      외부 폰트 검사는 `page.on('request')` 수집이면 충분.
- [ ] **정합성 검토**: 로컬에서 perf-css 2건 통과 확인. 다른 perf-css 테스트 회귀 없는지 전체 spec 실행.

---

## D. 대시보드 realtime indicator 미정착 (8건)

`seller-home-dashboard` ×7 + `seller-orders:65`. 페이지·카드는 정상 렌더(인증 OK,
세션28 error-context로 확인 — 카드 "0" 표시)되나 Firestore realtime 연결 indicator가
`연결 중`에서 멈춰 종료 상태(`실시간 연결`/`연결 오류`)를 기다리는 단언이 타임아웃.
seller-home-dashboard의 line 35 테스트는 OR-locator에 `연결 중`을 포함해 통과,
line 47+ 는 미포함이라 실패 — 동일 페이지에서 갈린다.

- [ ] **D-1 원인 규명**: 실패 trace로 Firestore onSnapshot이 CI에서 **연결 자체에 성공하는지**
      확인. 핵심 갈림길:
  - 리스너가 CI에서 끝내 연결 안 됨 → 리스너/네트워크 문제 (BUG-03 인접 — Firebase Auth 없는 구독)
  - 리스너는 연결되나 느림 → 대기 시간 문제
- [ ] **D-2 결정·수정**: 원인에 따라
  - (a) spec 보정 — line 47+ OR-locator에 `연결 중` 추가 (line 35와 통일). 단 "연결 성공" 검증력 약화 trade-off.
  - (b) 리스너 수정 — CI에서 연결되도록. 범위 크면 BACKLOG 별도 항목.
  - `seller-orders:65`도 동일 realtime 의존(`poll` 15s) — 같은 결정 적용.
- [ ] **정합성 검토**: 수정 spec이 "정상 미연결"과 "버그"를 여전히 구분하는지. 과도 완화로 거짓 통과 안 되게.

---

## B. Railway API `Failed to fetch` (5건)

페이지는 인증·렌더 정상이나 앱의 `apiFetch`(→ Railway API) 호출이 브라우저 레벨
`Failed to fetch`로 실패 → 데이터 영역이 에러/빈 상태. consumer-mypage는
"주문 내역을 불러올 수 없습니다", consumer-groupbuy는 `Failed to fetch` 텍스트,
seller-onboarding은 pre-fill 0 + `Failed to fetch` pageerror로 확인됨(세션28 error-context).

- [ ] **B-1 원인 규명**: 실패 시점 Railway 로그에서 해당 endpoint 호출이 도달했는지 확인.
  - 도달·5xx → Railway 부하/cold-start
  - 미도달 → CORS preflight 차단 또는 CI 러너→Railway 네트워크
  - Railway 무료 티어 cold-start(슬립) 유력 — 풀런 초반 호출 편중 여부 확인
- [ ] **B-2 수정 후보** (B-1 결과에 따라 택):
  - 앱 `apiFetch`에 짧은 재시도(1~2회) — 일시 실패 흡수
  - Railway keep-warm (cron health ping) — cold-start 완화
  - 또는 known-flaky로 spec 허용오차 (최후수단, 비권장)
- [ ] **정합성 검토**: 수정이 실제 장애를 가리지 않는지. 재시도 도입 시 호출량 증가 영향 확인.

---

## Railway `/auth/login` 로그 계측 (P1 — 외부 접근 필요)

#CL-27로 인증 호출은 풀런당 67회+retry → 2회로 **구조상 N→1 확정**. 로그 기반 latency
수치화만 잔여 — **Railway 대시보드 접근이 필요하므로 사용자 협조 사항**.

- [ ] Railway 대시보드/CLI에서 `/auth/login`·주요 REST endpoint의 응답시간 p50/p95/p99 + 실패율 추출.
- [ ] B-1의 cold-start 가설 검증 데이터로 활용 — storageState 도입 전후(s27 vs 세션28 풀런) 비교.

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12 — 처리한 B·C·D 항목 완료 체크 + 변경 이력.
- [ ] 설계 결정 발생 시 `docs/CRITICAL_LOGIC.md` 신규 #CL 기록.
- [ ] `docs/memory.md` 세션29 섹션 (200라인 초과 시 50라인 요약 후 아카이브).
- [ ] 다음 진입점 갱신.

## 참조

- 세션28 #CL-23 해소: `docs/CRITICAL_LOGIC.md` #CL-27 · 진입 가이드 `session28-prep.md`(T0 분류 확정표)
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 표
- 베이스라인 풀런: run 25951442053(145/16)·25952075877(146/15)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

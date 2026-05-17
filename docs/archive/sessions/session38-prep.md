# 세션38 진입 가이드 — P3 Driver Kakao Maps SDK 연동

> 작성: 2026-05-17 (세션37 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션37 — P4 2건(global-setup flake·CI 액션 node24) + P3 G1 거점 수정 페이지.
> 진행 원칙: **아토믹 태스크 단위** — 한 태스크 = 한 커밋. 각 태스크 끝에 **정합성 검토** 후 통과해야 다음 진행.

---

## 배경

세션37은 P4 정비 2건과 P3 G1을 종결했다(main `be4fa2c`·`eb15e4e`·`3888522`):

- **P4 global-setup flake**: bypass 루프 직후 `page.goto('about:blank')`로 in-flight
  `/login` 리다이렉트를 종료 — `storageState()` "Navigation interrupted" 레이스 해소.
- **P4 CI 액션 node24 전환**: checkout/setup-node v6·upload-artifact v7·pnpm/action-setup
  v6, e2e 실행 Node 20→22 LTS. 2026-06-02 강제 전환 대비 완료.
- **P3 G1 거점 수정 페이지**: `hubs/[id]/edit/page.tsx` 신규 — GET 프리필 + apiJson
  PATCH + 상세 헤더 "수정" 진입 버튼.

`docs/BACKLOG.md` §12-1에서 **남은 P3 기능은 Driver Kakao Maps SDK 연동 1건**이다.
세션37 종료 시 사용자 요청으로 차기 세션 이월 — 신규 SDK 연동이라 사전 준비(키 발급·
도메인 등록)와 표시 범위 결정이 선행돼야 한다.

---

## 핸드오프 — 잔여 작업

| 우선 | 항목 | 범위 | 비고 |
|------|------|------|------|
| 🟢 P3 | **Driver Kakao Maps SDK 연동** | 드라이버 앱 Kakao Maps SDK 연동 | 신규 SDK. 밀크런 경로 프리뷰(설계 §7 Should Have)와 연계 가능 |

---

## Driver Kakao Maps SDK — 착수 전 확인 사항

신규 외부 SDK 연동이므로 코드 착수 전에 아래를 사용자와 확정한다.

1. **Kakao Developers 앱 키** — JavaScript 키 발급 여부. Vercel driver 프로젝트
   환경변수(`NEXT_PUBLIC_KAKAO_MAP_KEY` 등)에 등록 필요. 도메인 등록(driver 도메인·
   Preview `*.vercel.app`)도 Kakao 콘솔에서 선행.
2. **표시 범위·위치** — 지도를 어느 화면에 어떤 목적으로 띄울지(예: `/board` 배송
   목록의 거점 위치, 주문 상세의 픽업지, 밀크런 경로 프리뷰). MVP 최소 범위 합의.
3. **거점 좌표 데이터** — `hubs` 문서에 `lat`/`lng` 필드는 존재하나(`CreateHubDto`·
   `UpdateHubDto`) 현재 seller 거점 등록/수정 폼은 좌표를 입력받지 않는다. 지도에
   마커를 찍으려면 좌표 소스가 필요 — 주소 지오코딩 또는 seller 폼에 좌표 입력 추가.

---

## T0. 진입 — 현황 재확인 (먼저 수행)

- [ ] 최신 `e2e.yml` run 확인 — `gh run list --workflow=e2e.yml`. 세션37 머지
  (`be4fa2c`·`eb15e4e`·`3888522`) 이후 풀런 167/0 유지 여부.
  - gh CLI 경로: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출 연산자)
  - 세션36 베이스라인: run 25970814882 (167 passed / 0 failed / 11 skipped).
  - 세션37 P4 변경(global-setup·CI 액션)은 e2e 인프라 직접 변경 — 풀런 결과 우선 확인.
- [ ] `docs/memory.md` 라인 수 확인 — 약 52라인. 200라인 한도 여유 있음.
- [ ] `docs/CRITICAL_LOGIC.md` 라인 수 확인 — 약 311라인. 1000라인 한도 여유 있음.
- [ ] `docs/BACKLOG.md` §12-1 우선순위 표에서 P3 상태 확인.
- [ ] **정합성 검토**: 167/0에서 회귀했다면 잔여 착수 전 회귀 원인 우선 처리.

---

## 세션 종료 시

- [ ] `docs/BACKLOG.md` §12 — 처리한 항목 완료 체크 + 변경 이력.
- [ ] 설계 결정 발생 시 `docs/CRITICAL_LOGIC.md` 신규 #CL 기록 (현재 #CL-32까지).
- [ ] `docs/memory.md` 세션38 섹션 갱신.
- [ ] 다음 진입점(`session39-prep.md`) 갱신 + `BACKLOG.md` §12 진입점 링크 수정.

## 참조

- 한도 정책: `docs/CRITICAL_LOGIC.md` #CL-29 · 활성 결정 로그(#CL-19~#CL-32)
- seller 프론트 구조(#CL-32): `apiJson` 사용·공통 UI 컴포넌트·`useAdminList`·`useOrderStatusUpdate`
- e2e 인증 패턴(storageState): `docs/memory.md` 「e2e 인증 패턴」 절
- 베이스라인 풀런: run 25970814882 (167 passed / 0 failed / 11 skipped)
- e2e 워크플로: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml`

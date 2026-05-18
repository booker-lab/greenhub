# 세션40 진입 가이드 — Driver Kakao Maps SDK 연동

> 작성: 2026-05-18 (세션39 종료 시) · SSOT: `docs/BACKLOG.md` §12
> 선행: 세션39 — 셀러 홈 대시보드 재구성 T1~T8 전부 구현 완료 (#CL-33).

---

## 배경

세션39는 세션38 플랜(`docs/specs/frontend/seller-home-dashboard-plan.md`)의
8 아토믹 태스크를 전부 구현했다 — PageHeader 중앙 홈 아이콘, 홈 대시보드
(오늘 할 일 + 현황 카드 3개), BottomNav 거점→준비 탭 교체, 거점 관리 설정
하위 이동, 준비 물량 탭(`/prep`) 신설, ConnectionStatus 공통화. 태스크당
1커밋(`7a01168`~`da99954`), 타입체크·빌드(23라우트)·biome 신규 에러 0건.

남은 P3 기능은 **Driver Kakao Maps SDK 연동** 1건.

---

## 핸드오프 — 잔여 작업

| 우선 | 항목 | 비고 |
|------|------|------|
| 🟢 P3 | **Driver Kakao Maps SDK 연동** | 신규 SDK — 본 세션 우선 |
| 🟢 P4 | 준비 물량 탭 공동구매 포함 | `aggregatePrep`에 `groupProductConfig` fetch 추가 |
| 🟢 P4 | 당일 배송 컷오프 (소비자 앱) | 배송일 선택 시간 제약 |

---

## T0. 착수 전 확인 (먼저 수행)

- [ ] 세션39 커밋 푸시 여부 확인 — 미푸시 시 push → `sync-preview.yml`이
  preview 머지 후 `e2e.yml` 자동 트리거. 베이스라인 167/0 회귀 없음 확인.
  - gh CLI: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출).
  - 베이스라인: run 25970814882 (167 passed / 0 failed / 11 skipped).
- [ ] `docs/memory.md`(~52라인)·`CRITICAL_LOGIC.md`(~350라인) 한도 여유 확인.

## Kakao Maps SDK — 선결 사항

- **키 발급**: Kakao Developers 앱 등록 → JavaScript 키. Vercel driver 앱
  환경변수(`NEXT_PUBLIC_*`)로 주입. 도메인 등록 필요.
- **표시 범위 확정**: 드라이버 배송 보드에서 지도가 무엇을 보여줄지 —
  거점 위치만? 배송 경로? 실시간 위치? 착수 시 사용자와 범위 확정.
- driver 앱 구조는 `apps/driver/` — 기존 배송 보드 페이지 확인 후 진입.

## 세션 종료 시

- [ ] 설계 결정 발생 시 `CRITICAL_LOGIC.md` #CL-34 등재.
- [ ] `docs/BACKLOG.md` §12 처리 항목 체크 + §12 헤더 갱신.
- [ ] `docs/memory.md` 세션40 갱신 + `session41-prep.md` 작성.

## 참조

- 세션39 결정 정본: `docs/CRITICAL_LOGIC.md` #CL-33
- 홈 대시보드 플랜(구현 완료): `docs/specs/frontend/seller-home-dashboard-plan.md`
- 셀러앱 UX 감사 후속(탭 스타일·Badge-as-button 등): `docs/specs/frontend/seller-ux-audit.md` · BACKLOG §11-3

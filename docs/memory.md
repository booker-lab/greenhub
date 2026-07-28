<!-- Language: ko -->

# 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 상세 이력은 계획·보고서·아카이브에서 확인한다.

최종 수정: 2026-07-28 (Task 6.8 보존 정책 반영·Git 역사 게이트 미실행·불필요 종결)

## 현재 상태

- 브랜치: `codex/mvp-sales-round-direct`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 최종 Closeout 정본: `docs/plans/REPORT_task_6_8_final_closeout.md`
- A+ 보안 정리 보고서: `docs/plans/REPORT_task_6_8_a_plus_secure_cleanup.md`
- Git 역사 게이트 결정 정본은 `C:\Develop\greenhub-verified-39fdb2c\docs\discussions\DISCUSS_task_6_8_git_history_rewrite_gate.md`이고, 종결 증거는 `C:\Develop\greenhub-verified-39fdb2c\.artifacts\history-rewrite-gate\closeout.md`다.
- 원 계획 Task 0.1~6.8과 Task 6.7 준비조건 보완 계획은 모두 `done`이다.
- 최종 검증 SHA: `39fdb2c28c45b5c7658519181e41845bb24be2fd`
- 최종 원격 실행: GitHub Actions `30031472177`, 결론 `success`
- 현재 로컬 HEAD `8bcfb76b8efeac71c5e84a4743bedc2d6838d2c3`은 최종 검증 SHA보다 2개 커밋 이전이며, 금지 조건에 따라 pull·checkout으로 맞추지 않았다.
- 후속 작업 기준점은 `C:\Develop\greenhub-verified-39fdb2c`의 `codex/task-6-8-a-plus-cleanup` branch이며 HEAD는 최종 검증 SHA `39fdb2c28c45b5c7658519181e41845bb24be2fd`와 일치한다. 다만 후속 Git 역사 게이트 문서와 종결 산출물이 추가되어 현재 작업 트리는 clean 상태가 아니다.

## Task 6.8 최종 증거

- 로컬 보정 검증은 보드 5개, Firestore 인덱스 23개, Storage Emulator 12개, Firestore Emulator 14개, API 단위 249개, API E2E 10개, 소비자 78개, 셀러 43개, 드라이버 11개, fixture 7개, readiness 9개가 통과했다.
- shared·API·consumer·seller·driver·E2E 타입 검사, `pnpm build`, Playwright 52개 목록 수집과 `git diff --check`가 통과했다.
- 원격 실행은 세 Preview 배포 SHA 일치, readiness 통과, provider 외부 egress 0을 확인했다.
- Playwright는 `workers=1`, `retries=0`으로 52건 통과, skipped 0, unexpected 0, flaky 0이었다.
- chromium·mobile cleanup 뒤 잔여 Firestore 문서·Storage 객체는 각 프로젝트에서 모두 0이었다.
- 기존 `.artifacts/round-direct/task-6-8-20260722-k2m7p4/evidence/closeout-summary.json`은 이전 로컬 검증 상태를 담은 역사적 증거이며 수정하지 않는다.

## 유지 계약과 남은 위험

- Git 역사 노출 후보는 provider 경계에서 거부되고 Railway `staging`·`production`의 현재 PortOne 자격 증명은 인증 경계를 통과한다. 값 자체는 기록하지 않는다.
- Task 6.7 중간 실행 생성물 22개와 시스템 TEMP 증거 사본 10개를 승인 목록대로 제거했다. 최종 성공 readiness, credential 점검 JSON 2개, Task 6.8 역사적 Closeout은 보존한다.
- Git 역사 게이트는 비어 있지 않은 비밀값 후보 `0건`으로 확정됐으며, Git 역사 재작성은 미실행·불필요 종결됐다. 향후 비어 있지 않은 실제 비밀값 후보가 새로 확인되면 기존 게이트를 재개하지 않고 별도 보안 사건과 새 승인 게이트로 조사한다.
- 기상 보류, 배송 사진 생성 전용 해시, 완료 후속효과 재조정, 권한별 단건 서명 URL, 기사 보류 복구 계약을 유지한다.
- 회차 중첩 배송 사진은 클라이언트 직접 접근을 차단하고 legacy 거점 사진 경로는 제한된 기사 계약으로 보존한다.
- legacy 거점 사진의 기존 토큰형 URL 유출 위험, Node 모듈 형식 경고, 인덱스 테스트 비 null 단언 1건, webpack cache 성능 경고는 비차단 잔여 위험이다.
- 현재 작업 트리의 기존 사용자 변경은 그대로 보존한다.
- 운영 `salesMode`, Firebase·Storage, 실제 결제·환불·알림, 일반 배포·마이그레이션·commit·push는 A+ 정리에서 변경하거나 실행하지 않았다.

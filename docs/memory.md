<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 완료 이력과 상세 증거는 기본 Context로 읽지 않는다.

## 검증 기준

- Git·GitHub 직접 재검증: `2026-08-23 KST`
- 외부 환경 상태 기준: `2026-08-22 KST`
- Git·GitHub 상태는 이번 SSOT 정합화에서 직접 재조회했다.
- ALIGO·Firebase·Railway·Vercel 운영 상태와 `salesMode`는 `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`의 최신 확인 결과를 사용한다. 별도 승인 없이 외부 운영 상태를 변경하지 않는다.

## 개발 기준선

- 저장소: `booker-lab/greenhub`
- GitHub 기본 브랜치: `main`
- 개발 브랜치: `codex/mvp-sales-round-direct`
- `main`: `26d7f49bf1a2618f792641cb95b93802a062ebe4`
- 2026-08-23 Context/SSOT 정비 시작 기준 SHA: `0086f1302f0939a95457a6df5aff25dd09af5e55`
- 사용자 최신 로컬 push 확인 SHA: `2bda4be3b6bd2ff346dbe9a61ccc6370b9deb59e`
- 개발 브랜치는 `main`을 조상으로 포함하며 정비 시작 시 `main` 대비 ahead 112 / behind 0이었다.
- 이후 README·memory 같은 문서 정합화 commit이 개발 브랜치에 추가될 수 있으므로 현재 HEAD와 ahead/behind는 Task 시작 시 Git/GitHub에서 직접 확인한다.

## 활성 통합

- 활성 통합 PR: `#11`, `codex/mvp-sales-round-direct` → `main`
- 최신 직접 확인 상태: `OPEN` · `Draft` · `mergeable=true`
- PR 본문은 과거 ALIGO 대기 시점의 상세 상태를 포함하므로 제품 현재 상태 SSOT로 사용하지 않는다.
- 사용자 승인 없이 PR을 Ready로 전환하거나 제목·본문·라벨·base를 수정하거나 병합·종료하지 않는다.
- 최신 문서 commit도 Vercel/Railway 자동 검사를 새로 트리거할 수 있다. 자동 검사는 현재 HEAD에서 직접 확인하고, 전체 회차 E2E 성공과 동일한 증거로 취급하지 않는다.

## 제품 현재 상태

- 회차 직배송 MVP 구현은 개발 브랜치에 존재한다.
- API에는 `SaleRoundsModule`, 회차 주문·결제 최종화·환불·재배송비 청구, `OperationsModule`, `RetentionModule`, 배송 사진 처리가 포함된다.
- consumer에는 회차 구매 흐름, seller에는 회차 관리 및 주문 운영 흐름, driver에는 직배송 흐름이 구현돼 있다.
- 공통 회차 계약은 `packages/shared/src/sale-round.types.ts`가 소유한다.
- 카카오 비즈니스 채널 승인, ALIGO 발신 프로필 1건 등록, `senderkey` 발급은 완료됐다.
- 내부 논리 템플릿 코드와 ALIGO `tpl_code` 분리 및 필수 본문 변수 검증은 구현됐다.
- 실제 도달 가능한 회차 알림 템플릿 8종은 provider에 아직 등록·승인되지 않았다.
- 실제 알림톡 정상 발송과 SMS 대체 발송은 검증되지 않았다.
- 운영 ALIGO 자격 증명 4개와 `ALIGO_TEMPLATE_CODES_JSON`은 반영되지 않았다.
- 회차 출시 후보의 운영 애플리케이션 배포, 첫 운영 회차 생성, `salesMode` 전환은 실행되지 않았다.
- 판매 모드는 최신 HANDOFF 확인 기준 `legacy`다.
- 운영 Firebase 인덱스·Firestore 규칙·Storage 규칙은 최신 HANDOFF 확인 기준 반영 완료 상태다.
- 따라서 회차 직배송 MVP 출시는 `paused_external_review` 상태를 유지한다.

## 검증 상태

- 마지막 원격 회차 E2E 전체 성공 증거는 SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`다.
- 해당 run은 chromium 26건 + mobile 26건, 총 52건 및 양쪽 fixture cleanup 성공 증거다.
- 이 증거를 이후 문서-only HEAD의 전체 원격 E2E 성공으로 확장해서 기록하지 않는다.
- 운영 배포 전에 실제 출시 대상 SHA에서 요구되는 전체 원격 회차 E2E와 fixture cleanup을 다시 통과해야 한다.
- PR 자동 검사 성공은 전체 원격 회차 E2E 성공을 대신하지 않는다.

## 활성 문서

- 저장소 작업 규칙: `AGENTS.md`
- Context 라우터: `docs/PROJECT_MAP.md`
- 현재 상태 SSOT: 이 문서
- 현재 재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 출시 실행 계약: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- 미완료·향후 작업 목록: `docs/BACKLOG.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`
- 완료 보고서·과거 계획·archive는 증거가 필요한 경우에만 검색한다.

동작 계약이 충돌하면 현재 개발 브랜치의 코드·설정·테스트를 기준으로 현행 spec을 정합화한다. 운영·진행 상태가 충돌하면 직접 재검증 결과, 이 문서, 최신 HANDOFF·PLAN, 역사 자료 순으로 판정한다.

## SSOT 정합화 상태

- 루트 `AGENTS.md`와 `docs/PROJECT_MAP.md`를 기준 Context 체계로 정리했다.
- `README.md`는 실제 workspace 구조와 현재 코드 스택에 맞게 정합화했다. `packages/shared`, `packages/ui`, `apps/e2e`, Mantine 9, 회차 직배송·operations·retention 실제 구조를 반영한다.
- 이 `memory.md`는 현재 Git/GitHub·제품 상태와 문서 역할에 맞춰 정리했다.
- `docs/PROJECT_MAP.md`는 Context router 역할만 유지하며 제품 진행 상태를 복제하지 않는다.
- `docs/BACKLOG.md`는 오래된 완료 이력과 현재 우선순위가 섞여 있어 별도 로컬 정합화가 필요하다. 기존 내용을 손실하지 않도록 전체 파일을 검색·분류한 뒤 `ACTIVE / BLOCKED_EXTERNAL / NEXT / LATER / DONE_HISTORY / STALE_OR_SUPERSEDED` 기준으로 재구성한다.
- 활성 PLAN/HANDOFF의 역사 기록은 보존한다. 현재 상태와 직접 충돌하는 부분이 발견될 때만 최소 범위에서 정합화한다.

## 외부 승인 경계

사용자의 명시적 승인 없이 다음 작업을 수행하지 않는다.

- ALIGO 템플릿 등록·변경 또는 실제 알림톡·SMS 발송
- 운영 자격 증명·환경 변수·데이터 변경
- Railway·Vercel·Firebase 운영 변경 또는 배포
- 운영 회차 생성·상태 변경 또는 `salesMode` 전환
- PR Ready 전환·수정·병합·종료

비밀값과 개인정보 원문은 문서, 명령 출력, 로그, Git에 기록하지 않는다.

## 다음 작업

1. 로컬에서 `docs/BACKLOG.md` 전체를 실제 코드·현재 HANDOFF와 대조해 현재 미완료 우선순위 중심으로 정합화한다.
2. 같은 작업에서 활성 PLAN/HANDOFF의 현재 상태 섹션만 점검하고 `memory.md`와 실제 충돌이 있을 때만 최소 수정한다.
3. SSOT 문서 정합화가 끝난 뒤, 별도 외부 변경 승인을 받아 회차 알림 템플릿 8종 provider 등록·승인 → 격리 실제 알림톡/SMS fallback 검증 → 운영 변수 반영 → 최신 출시 SHA 원격 검증 순서로 재개한다.
4. 모든 선행 게이트를 통과해도 운영 배포에는 별도의 `Task 3.1 승인`이 필요하다.

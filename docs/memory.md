<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 완료 이력과 상세 증거는 기본 Context로 읽지 않는다.

## 검증 기준

- Git·GitHub 직접 재검증: `2026-08-23 KST`
- 외부 환경 상태 기준: `2026-08-22 KST`
- Git·GitHub 상태는 이번 감사에서 직접 재조회했다.
- ALIGO·Firebase·Railway·Vercel·`salesMode`는 `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`의 2026-08-22 확인 결과를 인용하며 이번 감사에서 외부 서비스를 다시 조회하지 않았다.

## 개발 기준선

- 저장소: `booker-lab/greenhub`
- GitHub 기본 브랜치: `main`
- 개발 브랜치: `codex/mvp-sales-round-direct`
- 정비 시작 기준 SHA: `0086f1302f0939a95457a6df5aff25dd09af5e55`
- 통합 대상: `main@26d7f49bf1a2618f792641cb95b93802a062ebe4`
- 정비 시작 시 작업 트리는 깨끗했고 개발 브랜치는 원격 추적 브랜치와 동일했다.
- 현재 HEAD는 이 문서와 핵심 Context/SSOT 지침을 포함한 최신 브랜치 HEAD를 Git에서 직접 확인한다.

## 활성 통합

- 활성 통합 PR: `#11`, `codex/mvp-sales-round-direct` → `main`
- `2026-08-23` 정비 시작 시 상태: `OPEN`·초안·`MERGEABLE`·`CLEAN`
- 정비 시작 SHA `0086f13` 대상 자동 검사 5개는 성공했다. 이후 push된 HEAD의 검사는 GitHub에서 다시 확인한다.
- PR #11의 제목과 본문은 이전 ALIGO 대기 상태를 담고 있으므로 제품 현재 상태의 정본으로 사용하지 않는다.
- PR #7은 현재 개발 브랜치보다 147커밋 뒤에 있고 고유 커밋이 0개인 대체 후보다.
- 사용자 승인 없이 PR을 Ready로 전환하거나 수정·병합·종료하지 않는다.

## 제품 현재 상태

- 회차 직배송 MVP 출시는 ALIGO 알림 준비 단계에서 `paused_external_review` 상태다.
- 카카오 비즈니스 채널 승인, ALIGO 발신 프로필 1건 등록, `senderkey` 발급은 완료됐다.
- 내부 논리 템플릿 코드와 ALIGO `tpl_code` 분리, 필수 본문 변수 검증은 현재 개발 기준선에 구현됐다.
- 회차 알림 템플릿 8종은 아직 provider에 등록·승인되지 않았다.
- 실제 알림톡 정상 발송과 SMS 대체 발송은 검증되지 않았다.
- 운영 ALIGO 자격 증명 4개와 `ALIGO_TEMPLATE_CODES_JSON`은 반영되지 않았다.
- 회차 출시 후보의 운영 배포, 첫 운영 회차 생성, `salesMode` 전환은 실행되지 않았다.
- 판매 모드는 최신 HANDOFF 확인 기준 `legacy`다.
- 운영 Firebase 인덱스·Firestore 규칙·Storage 규칙은 최신 HANDOFF 확인 기준 반영 완료 상태다.

## 원격 검증 게이트

- 정비 시작의 최신 제품 코드 SHA `0086f13`에 대한 전체 원격 회차 E2E 성공 증거는 없다.
- 마지막 원격 회차 E2E 52건 성공은 이전 SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`의 실행 기록이다.
- 운영 배포 전에 현재 출시 대상 SHA에서 전체 원격 E2E와 fixture 정리가 다시 성공해야 한다.
- PR 자동 검사 성공은 전체 원격 회차 E2E 성공을 대신하지 않는다.

## 활성 문서

- 현재 상태와 재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 출시 실행 계약: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- HANDOFF와 PLAN이 충돌하면 직접 재검증한 상태와 최신 HANDOFF를 우선한다.
- 완료 보고서와 과거 계획은 증거가 필요할 때만 검색한다.

## 외부 승인 경계

사용자의 명시적 승인 없이 다음 작업을 수행하지 않는다.

- ALIGO 템플릿 등록·변경 또는 실제 알림톡·SMS 발송
- 운영 자격 증명·환경 변수·데이터 변경
- Railway·Vercel·Firebase 운영 변경 또는 배포
- 운영 회차 생성·상태 변경 또는 `salesMode` 전환
- commit, push, PR Ready 전환·수정·병합·종료

비밀값과 개인정보 원문은 문서, 명령 출력, 로그, Git에 기록하지 않는다.

## 현재 정비 Task

- Context/SSOT Cleanup의 `C0.1`, Wave A, `C2.0`, `C2.1`~`C2.4`를 완료했다.
- 루트 작업 지침, 현재 상태 SSOT, Context 라우터, consumer 하위 지침 통합까지 적용했다.
- 사용자 요청에 따라 이 지점에서 중단했으며 Wave C의 README·BACKLOG·활성 PLAN/HANDOFF 정합화와 `C4.1`~`C4.3` 검증은 아직 수행하지 않았다.
- 정비 범위 밖 Engineering Hardening은 실행하지 않았다. BACKLOG 정합화는 재개 시 `C3.2`에서 수행한다.
- 정비를 재개할 때의 다음 Task는 `C3.1`~`C3.3`의 독립성 확인과 최소 정합화다.

## 다음 허용 제품 작업

- 별도 외부 변경 승인을 받은 뒤 실제 도달 가능한 회차 알림 템플릿 8종을 등록하고 모두 승인됐는지 확인한다.
- 이후 실제 알림톡·SMS 대체 발송, 운영 변수 반영, 현재 출시 SHA 원격 검증을 순서대로 완료한다.
- 모든 선행 게이트를 통과해도 운영 배포에는 별도의 `Task 3.1 승인`이 필요하다.

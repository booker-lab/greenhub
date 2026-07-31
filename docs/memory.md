<!-- Language: ko -->

# 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 상세 이력은 계획·보고서·아카이브에서 확인한다.

최종 수정: 2026-07-31 (회차 직배송 MVP ALIGO 심사 대기 중단)

## 현재 상태

- 브랜치: `codex/mvp-sales-round-direct`
- 현재 계획 상태: 카카오 비즈니스 채널 심사 완료 전까지 `paused_external_review`
- 현재 실행 SSOT: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 원계획: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- 상세 실행 보고서: `docs/plans/REPORT_mvp_round_direct_launch.md`
- 중단 정리 전 기준 HEAD: `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`
- 운영 Firestore 인덱스 정의 보존 commit: `34d32d5`
- PR #11은 심사 대기 동안 초안 상태로 유지하고 병합하지 않는다.
- 운영 Firebase 인덱스 41개와 Firestore·Storage 규칙 반영 및 재조회는 완료했다.
- 운영 애플리케이션은 출시 후보 SHA를 배포하지 않았고, 판매 모드는 마지막 확인 기준 `legacy`다.
- 심사 승인 후 Task 1.2의 ALIGO 발신 프로필 등록부터 재개한다.

## 중단 시점 완료 증거

- 출시 후보 SHA `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`의 원격 E2E 52건과 양쪽 fixture cleanup이 성공했다.
- ALIGO 계정·API Key 발급과 SMS 기본 발신번호 승인은 완료했지만, 카카오 비즈니스 채널은 심사 중이다.
- ALIGO 발신 프로필과 `senderkey`, 회차 템플릿 8종 승인은 아직 없다.
- 운영 Firestore 인덱스 41개는 모두 `READY`이며 로컬 합집합과 일치한다.
- 운영 Firestore·Storage 활성 ruleset 소스 SHA는 로컬 규칙 SHA와 일치한다.
- Task 3.1은 ALIGO 의존성 미충족으로 Railway 배포 없이 차단 종료했다.

## 중단 중 유지 계약과 재개 조건

- 심사 전에는 ALIGO 후속 작업, 실제 발송, 운영 자격 증명 등록, Railway·Vercel 배포를 진행하지 않는다.
- 첫 회차 생성, 운영 결제·환불·주문 변경, `salesMode` 전환과 당근 링크 공개를 진행하지 않는다.
- 완료된 Firebase 인프라를 추가 변경하거나 재배포하지 않는다.
- 비밀값과 개인정보 원문은 문서·명령 출력·Git에 기록하지 않는다.
- 심사 승인 후 발신 프로필, 템플릿 코드 매핑과 누락 변수, 템플릿 8종 승인, 격리 실제 발송, 운영 변수 4개를 차례로 확인한다.
- 위 ALIGO 게이트와 최신 HEAD 원격 검증을 통과한 뒤 별도의 `Task 3.1 승인`을 받아 운영 API 배포를 재개한다.

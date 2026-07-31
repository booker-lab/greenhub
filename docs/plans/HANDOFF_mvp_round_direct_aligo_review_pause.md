<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

## 한 줄 상태

카카오 비즈니스 채널 심사 완료 전까지 출시 계획을 중단한다. 심사 승인 후 ALIGO 발신 프로필 등록부터 재개하며, 그 전에는 운영 애플리케이션 배포와 판매 모드 전환을 하지 않는다.

## 중단 결정

- 결정일: 2026-07-31 KST
- branch: `codex/mvp-sales-round-direct`
- 중단 정리 전 기준 HEAD: `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`
- 운영 Firestore 인덱스 정의 보존 commit: `34d32d5`
- PR: #11 `회차 직배송 MVP 출시 후보 준비`
- 중단 사유: 카카오 비즈니스 채널 심사가 진행 중이라 ALIGO 발신 프로필과 알림톡 템플릿 승인을 받을 수 없음
- 재개 조건: 카카오 비즈니스 채널 심사 승인 확인
- 상세 증거: `docs/plans/REPORT_mvp_round_direct_launch.md`
- 원계획: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`

## 완료된 범위

- 출시 후보 branch와 PR을 준비하고 동일 SHA 원격 E2E 52건을 통과했다.
- ALIGO 계정과 API 담당자 등록, API Key 발급, SMS 기본 발신번호 승인 상태 확인을 완료했다.
- 운영 Firestore 인덱스를 삭제 없이 41개 합집합으로 정합화했고 모두 `READY`임을 확인했다.
- Firestore 규칙과 Storage 규칙을 운영에 반영하고 활성 ruleset 소스 SHA가 로컬과 일치함을 확인했다.
- Firebase 반영 뒤 운영 증거 재조회를 완료했다.

API Key, 발신번호, 사용자 정보와 그 밖의 비밀값 원문은 저장소 문서와 Git 변경에 기록하지 않았다.

## 현재 차단 상태

| 항목 | 상태 |
| :--- | :--- |
| 카카오 비즈니스 채널 | 심사 중 |
| ALIGO 발신 프로필 | 미등록, `senderkey` 없음 |
| 회차 알림 템플릿 8종 | 미등록·미승인 |
| 격리 실제 발송 | 미실행 |
| 운영 ALIGO 변수 4개 | 미등록 |
| Railway production API | 기존 버전 유지, 출시 후보 미배포 |
| Vercel production 프런트 3종 | 출시 후보 미배포 |
| 첫 회차 | 미생성 |
| `salesMode` | 마지막 확인 기준 `legacy` |
| PR #11 | 심사 대기 동안 초안 상태로 유지, 병합 금지 |

## 중단 중 지켜야 할 것

- PR #11을 병합하지 않는다.
- ALIGO 발신 프로필·템플릿·실제 발송 작업을 진행하지 않는다.
- ALIGO 자격 증명을 로컬 파일이나 Git에 기록하지 않는다.
- Railway·Vercel production을 배포하거나 재배포하지 않는다.
- Firebase 인덱스·규칙을 추가 변경하거나 재배포하지 않는다.
- 운영 회차를 만들거나 `salesMode`를 변경하지 않는다.
- 운영 결제·환불·주문 데이터를 변경하지 않는다.

## 심사 승인 후 재개 순서

1. 카카오 비즈니스 채널의 승인 상태와 채널 식별이 기존 대상과 일치하는지 확인한다.
2. ALIGO에서 발신 프로필을 등록하고 `senderkey` 발급 여부만 비밀값 없이 기록한다.
3. 다음 구현 차단점을 먼저 확정한다.
   - 내부 논리 템플릿 코드와 ALIGO `tpl_code`의 매핑 계층
   - `ORDER_ACCEPTED.name`
   - `ORDER_DELIVERY_HELD.reason`
   - `ORDER_CANCELLED.reason`
4. 실제 도달 가능한 회차 템플릿 8종을 등록하고 모두 승인 상태인지 확인한다.
5. 승인된 격리 수신자에게 알림톡 정상 발송과 SMS 대체 발송을 검증한다.
6. `ALIGO_API_KEY`, `ALIGO_USER_ID`, `ALIGO_SENDER_KEY`, `ALIGO_SENDER_PHONE`을 운영 환경에 값 비공개 방식으로 반영한다.
7. 현재 branch HEAD, PR 검사, 운영 Firebase 상태가 중단 기준에서 달라지지 않았는지 재조회한다.
8. 사용자에게 별도의 `Task 3.1 승인`을 받은 뒤 Railway production API 배포부터 원계획을 이어간다.

## 재개 완료 조건

- 카카오 비즈니스 채널 심사 승인
- ALIGO 발신 프로필과 `senderkey` 준비
- 회차 알림 템플릿 8종 승인
- 알림톡과 SMS 대체 발송 실검증 통과
- 운영 ALIGO 필수 변수 4개 존재 검사 통과
- 최신 branch HEAD의 원격 검증 성공
- Task 3.1 별도 승인

위 조건을 모두 충족하기 전에는 Task 3.1을 완료로 바꾸지 않는다.

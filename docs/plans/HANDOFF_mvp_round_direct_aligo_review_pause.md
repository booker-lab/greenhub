<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

## 한 줄 상태 — 2026-08-20 KST

consumer 개인정보처리방침·이용약관의 main·production 반영과 카카오 비즈니스 채널 최종 승인은 완료됐다. 최신 main을 회차 직배송 branch에 통합한 결과도 원격에 비강제 push했고 PR #11의 병합 가능 상태·자동 검사 성공과 동일 원격 head의 E2E 52건 성공을 재검증했다. 다만 ALIGO 발신 프로필 등록·`senderkey` 확인과 이후 단계, 운영 배포·첫 회차 생성·판매 모드 전환은 실행하지 않았으므로 회차 직배송 출시는 계속 중단한다.

## 2026-08-20 최신 확인

- branch: `codex/mvp-sales-round-direct`
- 통합 전 회차 branch HEAD: `674b59cda5212ff37cbf283b1a9871ff0da2c1c2`
- 통합한 `origin/main`: `26d7f49bf1a2618f792641cb95b93802a062ebe4`
- 로컬 merge commit: `e855d6cb1a787ff89c57abf3c352edda1beeca29`
- 최초 원격 동기화 head: `856ed492c0291260c464990fa2b398efd71305f0`
- 최종 원격 head: 이 절을 기록한 문서 종결 commit 포함 최신 원격 head. 문서가 자기 SHA를 순환 참조하지 않도록 정확한 SHA 대신 이 기준을 사용한다.
- merge 부모: 첫 번째 `674b59cda5212ff37cbf283b1a9871ff0da2c1c2`, 두 번째 `26d7f49bf1a2618f792641cb95b93802a062ebe4`
- 조상 검사: `origin/main`이 로컬 HEAD의 조상임을 종료 코드 0으로 확인
- merge commit 기준 분기: `origin/main`에만 0개, 로컬 회차 branch에만 107개 commit; 이후 기존 문서 정리 commit과 이 절을 기록한 문서 종결 commit만 추가
- PR #11: `OPEN`·초안·`MERGEABLE`, `mergeStateStatus: CLEAN`; Ready 전환·병합·제목·본문·라벨을 변경하지 않음
- 최초 원격 동기화 head 자동 검사: Vercel Preview Comments, Vercel driver·seller·consumer, Railway API까지 5개 모두 terminal `SUCCESS`, 실패·대기 0개
- 문서 종결 commit 포함 최신 원격 head 자동 검사: 5개 모두 terminal `SUCCESS`, 실패·대기 0개로 최종 재확인
- 원격 E2E: [`e2e-round-direct.yml` run `32351887404`](https://github.com/booker-lab/greenhub/actions/runs/32351887404), head SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, `completed` / `success`; chromium 26건·mobile 26건, 총 52건 성공, `skipped 0`·`unexpected 0`·`flaky 0`; chromium·mobile fixture cleanup 모두 `completed` / `success`; 동일 SHA `workflow_dispatch` 1회, `run_attempt 1`, 이전 attempt·rerun·cancel 없음
- 카카오 비즈니스 채널: 2026년 8월 20일 오전 9시 55분 카카오비즈니스 파트너센터 알림의 `그린러브가 비즈니스 채널로 전환되었습니다. 매장이 있다면 매장정보 관리를 위한 기능도 사용할 수 있습니다.` 문구를 확인해 최종 승인 완료로 판정
- consumer 법적 고지: `https://greenlove.co.kr/privacy`, `https://greenlove.co.kr/terms`를 main과 production에 반영하고 비로그인 HTTP 200, 데스크톱·375×812 모바일 접근성, 문서 상호 이동, 가로 넘침·하단 가림 없음, console/page 오류 0건을 검증
- 법적 고지와 카카오 재심사 접수 기록: PR #29 `MERGED`, main 병합 SHA `26d7f49bf1a2618f792641cb95b93802a062ebe4`, GitHub consumer production deployment `5979132065` 성공
- consumer 운영 도메인: `greenlove.co.kr`
- seller·driver는 법적 고지 변경 대상이 아니었고 Railway API는 기존 활성 배포를 유지

## 2026-08-20 최신 상태

| 항목 | 상태 |
| :--- | :--- |
| 카카오 비즈니스 채널 | 최종 승인 완료 |
| consumer 법적 고지 | main·consumer production 반영 및 운영 검증 완료 |
| 최신 `origin/main` | `26d7f49bf1a2618f792641cb95b93802a062ebe4` |
| 회차 branch에 최신 main 통합 | 로컬 완료·회귀 통과, 원격 비강제 push 완료 |
| 로컬 통합 commit | `e855d6cb1a787ff89c57abf3c352edda1beeca29` |
| 최초 원격 동기화 head | `856ed492c0291260c464990fa2b398efd71305f0` |
| 최종 원격 head | 이 절을 기록한 문서 종결 commit 포함 최신 원격 head |
| 원격 회차 E2E 52건 | head SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`, `completed` / `success`; 건너뜀·예상 밖 실패·`flaky` 없음, 양쪽 cleanup 성공 |
| ALIGO 발신 프로필 | 미등록 |
| `senderkey` | 미발급 |
| 회차 알림 템플릿 8종 | 미등록·미승인 |
| 실제 알림톡·SMS fallback 검증 | 미실행 |
| 운영 ALIGO 변수 4개 | 미등록 |
| 회차 출시 후보 운영 배포 | 미실행 |
| 첫 회차 | 미생성 |
| `salesMode` | `legacy` 유지 |
| PR #11 | `OPEN`·초안·`MERGEABLE`, `mergeStateStatus: CLEAN`, 자동 검사 5개 성공 |

카카오 승인으로 2026년 7월 31일의 외부 차단 조건 하나가 해소됐고, 최신 main 통합·원격 동기화·PR #11 재검증과 동일 원격 head E2E 52건 선행 조건도 충족됐다. 그러나 이 완료가 ALIGO 준비와 회차 직배송 출시를 자동으로 재개하지 않는다. 다음 외부 작업은 별도 승인 범위에서만 수행한다.

## 2026-08-20 로컬 통합 검증

- 충돌 9건을 해소하면서 회차/legacy 판매 모드 분기와 최신 main의 consumer 법적 고지·공개 사업자 정보·공동구매 판매 가능성·이미지 복구 계약을 함께 보존했다.
- shared 테스트 9건과 typecheck, API 단위 테스트 253건과 E2E 10건, consumer Node 테스트 106건과 TypeScript 검사, seller 테스트 43건, driver 테스트 11건, 회차 안전 스크립트 테스트 29건을 통과했다.
- workspace 빌드 선택 검사와 API·consumer·seller·driver 전체 production build를 통과했다.
- 통합 대상 diff와 문서에 대해 `git diff --check`를 통과했다.
- 최초 원격 동기화 head에서 자동 실행된 PR 검사 5개는 모두 성공했다. 원격 workflow 52건은 수동 dispatch 금지 범위라 실행하지 않았고 완료로 판정하지 않았다.
- 위 문장은 당시 작업의 역사 기록이다. 이후 별도 승인 실행에서 동일 원격 head의 `e2e-round-direct.yml`을 1회 수동 dispatch했고 run `32351887404`가 재실행·취소 없이 52건과 양쪽 fixture cleanup을 모두 성공했다.

## 2026-07-31 중단 결정 (역사 기록)

- 결정일: 2026-07-31 KST
- branch: `codex/mvp-sales-round-direct`
- 중단 정리 전 기준 HEAD: `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`
- 운영 Firestore 인덱스 정의 보존 commit: `34d32d5`
- PR: #11 `회차 직배송 MVP 출시 후보 준비`
- 당시 중단 사유: 카카오 비즈니스 채널 심사가 진행 중이라 ALIGO 발신 프로필과 알림톡 템플릿 승인을 받을 수 없음
- 당시 재개 조건: 카카오 비즈니스 채널 심사 승인 확인
- 상세 증거: `docs/plans/REPORT_mvp_round_direct_launch.md`
- 원계획: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`

## 2026-07-31까지 완료된 범위 (역사 기록)

- 출시 후보 branch와 PR을 준비하고 동일 SHA 원격 E2E 52건을 통과했다.
- ALIGO 계정과 API 담당자 등록, API Key 발급, SMS 기본 발신번호 승인 상태 확인을 완료했다.
- 운영 Firestore 인덱스를 삭제 없이 41개 합집합으로 정합화했고 모두 `READY`임을 확인했다.
- Firestore 규칙과 Storage 규칙을 운영에 반영하고 활성 ruleset 소스 SHA가 로컬과 일치함을 확인했다.
- Firebase 반영 뒤 운영 증거 재조회를 완료했다.

API Key, 발신번호, 사용자 정보와 그 밖의 비밀값 원문은 저장소 문서와 Git 변경에 기록하지 않았다.

## 2026-07-31 중단 당시 상태 (역사 기록)

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

## 2026-07-31에 정한 심사 승인 후 재개 순서 (역사 기록)

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

## 2026-08-20 기준 재개 순서

1. consumer 개인정보처리방침·이용약관 main·production 반영과 운영 검증을 확인한다. 완료됐다.
2. 최신 main을 회차 branch에 비파괴 통합하고 로컬 충돌·회귀를 검증한다. merge commit `e855d6cb1a787ff89c57abf3c352edda1beeca29`에서 완료됐다.
3. 사용자 승인 후 로컬 통합 commit을 원격 branch에 push하고 PR #11의 충돌·검사 상태를 다시 확인한다. 비강제 push와 재검증을 완료했다.
4. 동일 원격 SHA에서 회차 E2E 52건, 무건너뜀 판정과 양쪽 fixture cleanup을 포함한 원격 검증을 통과시킨다. head SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`의 run `32351887404`에서 완료됐다.
5. 별도 외부 변경 승인 후 ALIGO 발신 프로필을 등록하고 `senderkey` 발급 여부만 비밀값 없이 기록한다.
6. 내부 논리 템플릿 코드와 ALIGO `tpl_code`의 매핑 계층, `ORDER_ACCEPTED.name`, `ORDER_DELIVERY_HELD.reason`, `ORDER_CANCELLED.reason` 차단점을 확정한다.
7. 실제 도달 가능한 회차 알림 템플릿 8종을 등록하고 모두 승인 상태인지 확인한다.
8. 승인된 격리 수신자에게 실제 알림톡 정상 발송과 SMS fallback을 검증한다.
9. 운영 ALIGO 필수 변수 4개를 값 비공개 방식으로 반영하고 존재 검사를 통과시킨다.
10. 사용자에게 별도의 `Task 3.1 승인`을 받아야만 회차 출시 후보 운영 배포를 진행한다.

## 재개 완료 조건

- [x] consumer 개인정보처리방침·이용약관 main·production 반영 및 운영 검증
- [x] 카카오 비즈니스 채널 최종 승인
- [x] 최신 main의 회차 branch 로컬 통합과 충돌·회귀 검증
- [x] 통합 SHA의 원격 push와 PR #11 재검증
- [x] 동일 원격 SHA의 전체 원격 검증 성공
- [ ] ALIGO 발신 프로필과 `senderkey` 준비
- [ ] 회차 알림 템플릿 8종 승인
- [ ] 실제 알림톡과 SMS fallback 검증 통과
- [ ] 운영 ALIGO 필수 변수 4개 존재 검사 통과
- [ ] Task 3.1 별도 승인

미완료 조건을 모두 충족하기 전에는 Task 3.1을 완료로 바꾸거나 회차 출시 후보를 운영에 배포하지 않는다.

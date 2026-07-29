<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

## 문서 메타

- **작성일**: 2026-07-28
- **상태**: `todo`
- **Priority**: P0
- **Labels**: `release`, `production`, `firebase`, `payments`, `notifications`, `operations`
- **SSOT Check**: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`, `docs/plans/REPORT_task_6_8_final_closeout.md`, `docs/specs/ops/mvp-sales-round-runbook.md`, `docs/memory.md`
- **Architectural Goal**: 검증된 회차 직배송 기능을 동일 SHA의 운영 인프라와 애플리케이션에 반영한 뒤 첫 회차와 운영 대응 체계를 준비하고 마지막 단계에서 디어 오키드의 판매 모드만 전환한다.

## 📋 업무 요약 (협업용)

### 개요

기능 개발과 비운영 검증은 끝났지만 운영 서비스에는 아직 회차 기능이 배포되지 않았다. 운영 데이터도 기존 판매 모드를 유지하고 있으며 첫 회차가 없다. 출시 전에 배포 기준을 하나로 고정하고, 알림·데이터베이스·보안 규칙을 준비한 뒤, 첫 회차와 담당자·롤백 절차를 확인해야 한다.

### 끝났을 때 확인할 것

- 운영 API와 소비자·셀러·기사 앱이 승인된 동일 출시 SHA를 사용한다.
- 운영 Firebase에 필요한 인덱스와 보안 규칙이 반영되고 기존 판매 흐름이 유지된다.
- 알림톡과 문자 대체 발송이 승인된 설정으로 동작한다.
- 첫 회차가 `SCHEDULED`이며 상품·가격·한도·일정·배송 지역이 검수됐다.
- 출시 담당자와 롤백 담당자가 정해지고 승인 기록이 남는다.
- 판매 모드 전환 직후 소비자·셀러·기사 핵심 흐름이 정상이며 이상 시 즉시 `legacy`로 돌아갈 수 있다.

### 이번 계획에서 하지 않는 것

- 네이버페이 채널 신규 출시
- 외부 셀러 입점과 정산 중개
- 정식 `growth`, `spike`, `soak` 부하테스트
- 기존 legacy 주문·상품·배송 데이터 변환
- Git 역사 재작성
- 승인 없는 운영 결제·환불·문자 발송·데이터 수정

## 🎯 Origin Intent

- **출처**: 원계획 완료 뒤 운영 상태 대조 결과와 사용자의 출시 차단 요소 순차 정리 요청
- **원래 목적**: 준비되지 않은 판매 방식을 노출하지 않고 이천시 주간 직배송을 안전하게 시작한다.
- **완료 관찰**: 승인된 첫 회차가 공개되고 한 주문·한 결제·직배송 흐름을 운영자가 런북대로 처리하며 장애 시 신규 유입만 즉시 차단할 수 있다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | 출처 | Task-ID / 범위 밖 | 안전 조건 |
| :--- | :--- | :--- | :--- |
| 로컬 HEAD와 원격 검증 SHA가 다름 | 현재 Git 상태 | 0.1~0.4 | 최종 SHA를 하나로 고정하고 같은 SHA를 다시 검증 |
| `main`과 출시 브랜치가 서로 앞선 commit을 가짐 | 현재 Git 상태 | 0.2 | 직접 덮어쓰기 금지, PR에서 통합 |
| 운영에만 있는 기존 Firebase 인덱스가 있음 | 운영 조회 | 2.1~2.4 | 로컬 누락분 추가 전 기존 운영 인덱스 삭제 금지 |
| 신규 Firebase 규칙이 legacy 접근을 막음 | 원계획 | 2.2~2.4 | 비운영 에뮬레이터와 legacy 회귀 통과 뒤 운영 반영 |
| ALIGO 자격 증명 또는 템플릿 승인이 없음 | 운영 환경 조회 | 1.1~1.4 | 키 존재만으로 완료 처리 금지, 실제 승인 수신자 발송 확인 |
| 운영 앱이 서로 다른 SHA로 배포됨 | 배포 조회 | 3.1~3.3 | 전환 금지, 동일 SHA가 될 때까지 재배포 |
| 첫 회차 일정·가격·한도가 잘못됨 | 운영 런북 | 4.1~4.3 | `DRAFT` 검수 후에만 `SCHEDULED` 전환 |
| 전환 직후 결제·주소·권한 오류가 발생함 | 운영 런북 | 6.1~6.3 | 당근 링크 공개 전 점검, 이상 시 즉시 `legacy` 롤백 |
| 전환 뒤 이미 결제된 회차 주문이 존재함 | 운영 런북 | 6.2, 7.1 | 주문 삭제·변환 금지, 기존 회차 주문 수명주기 유지 |
| 결제·알림 상태가 불명확함 | 운영 런북 | 5.3, 7.1 | 외부 상태 재조회 전 수동 상태 변경·중복 환불 금지 |
| 비밀값·개인정보가 증거에 포함됨 | 보안 Closeout | 모든 Task | 값 원문·전체 전화번호·주소·사진·서명 URL 기록 금지 |
| 외부 승인이 지연됨 | ALIGO·출시 승인 | 1.2, 5.1 | 다른 비파괴 Task는 진행하되 출시 전환은 금지 |

## 🔍 Diagnosis & Findings

- 원계획의 75개 Task는 모두 `done`이다.
- 최종 비운영 E2E는 SHA `39fdb2c28c45b5c7658519181e41845bb24be2fd`에서 52건 모두 통과했다.
- 현재 로컬 HEAD는 `534577b`이고 원격 출시 브랜치는 `39fdb2c`이며 열려 있는 PR이 없다.
- 운영 프런트는 `main`의 `164f65b`, 운영 API는 `110881a`를 사용해 회차 기능이 아직 운영에 없다.
- 운영 Firebase에는 로컬 정의 중 8개 인덱스가 없으며 `saleRounds(storeId, status)`도 누락됐다.
- 운영 Railway에는 PortOne·JWT·Firebase 자격 증명이 있으나 ALIGO 필수 변수 4개가 없다.
- Vercel 세 앱의 운영 필수 변수와 PortOne 카카오페이 공개 키는 설정돼 있다.
- 운영 디어 오키드의 `salesMode`는 미설정이라 호환값 `legacy`이고 `saleRounds`는 0건이다.
- 운영 URL 다섯 곳은 HTTP 200이며 최근 7일 Vercel 런타임 오류 집계는 0건이지만 이는 기존 운영 버전의 상태다.
- 기존 reset·visual 검증 시드는 운영 디어 오키드의 상품·주문·정산 컬렉션에 남아 있지 않다.

## 🏗️ Architectural Deepening

- **Seam**: 인프라와 애플리케이션을 먼저 운영에 배포하되 `salesMode`를 마지막까지 `legacy`로 유지한다.
- **Leverage**: 기존 Preview E2E, 판매 모드 dry-run, 런북, 롤백 스크립트를 출시 게이트로 재사용한다.
- **Compatibility**: 운영 배포 뒤에도 미설정 `salesMode`는 `legacy`이므로 소비자 신규 회차 진입이 열리지 않는다.
- **Safety**: Firebase 인덱스·규칙은 운영 전체 덮어쓰기가 아니라 현재 운영 상태와 차이를 확인해 필요한 항목만 반영한다.
- **Provider**: shared E2E 환경의 provider 대역을 실제 ALIGO 검증용으로 바꾸지 않고 별도 승인 수신자·격리 실행으로 확인한다.
- **Release**: 코드 배포, 첫 회차 예약, 판매 모드 전환, 당근 링크 공개를 각각 독립 게이트로 분리한다.
- **Recovery**: 롤백은 앱 버전보다 `salesMode: legacy` 전환을 우선해 신규 유입을 멈추고 기존 회차 주문은 계속 처리한다.

## Agent Completion Contract

1. Task를 Dependency 순서대로 한 번에 하나씩 실행한다.
2. 각 Task 시작 전 현재 Git·배포·운영 상태를 다시 읽는다.
3. push, PR 병합, 외부 자격 증명 등록, 운영 Firebase 배포, 운영 애플리케이션 배포, 실제 발송, 결제·환불, 회차 상태 변경, `salesMode` 전환은 해당 Task의 사용자 승인을 받은 뒤 실행한다.
4. 한 승인으로 이후의 다른 운영 변경까지 포괄하지 않는다.
5. 비밀값은 환경 변수 또는 provider 입력으로만 전달하고 명령·로그·문서에 원문을 기록하지 않는다.
6. 고객명·전체 전화번호·전체 주소·사진 원본·서명 URL을 증거에 남기지 않는다.
7. 운영 Firebase에만 있는 인덱스·규칙을 확인 없이 삭제하지 않는다.
8. 같은 출시 SHA가 API와 세 프런트에 배포되기 전 `salesMode`를 바꾸지 않는다.
9. ALIGO 실제 발송이 실패하면 알림 없는 출시를 임의 승인하지 않는다.
10. 첫 회차가 `SCHEDULED`이고 검수 증거가 없으면 전환하지 않는다.
11. 열린 결제·환불·고객 안내·배송·보관 예외가 있으면 영향과 담당자 승인 없이 출시하지 않는다.
12. 전환 직후 점검 실패 시 당근 링크를 공개하지 않고 `legacy` 롤백을 우선한다.
13. 이미 결제된 회차 주문은 롤백 시 삭제하거나 legacy 주문으로 변환하지 않는다.
14. 각 Verify 종료 코드가 0일 때만 Conclusion과 Status를 닫는다.
15. 전체 실행 요청 뒤 Blueprint 구조는 고정하고 Conclusion·Status·Closeout만 갱신한다.

> **에이전트 스코프**: 사용자가 이 계획 전체 실행을 요청하면 출시 기준 SHA 확정, ALIGO 준비, Firebase 운영 반영, 동일 SHA 운영 배포, 첫 회차 검수, 승인 기반 판매 모드 전환, 초기 모니터링을 순차 진행하며 각 외부 변경 게이트에서 별도 승인을 확인한다.

## Execution Plan

### Phase 0 — 출시 기준 SHA와 원격 검증

#### Task 0.1 — 출시 기준선 보고서 생성

- **Task-ID**: 0.1
- **Dependency**: 없음
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: Git·원격 branch·PR·배포 SHA·운영 환경·Firebase·판매 모드의 읽기 전용 기준선을 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: 통과 — Git·원격·운영 배포·환경 변수 존재 여부·Firebase 인덱스·판매 모드 기준선과 출시 차단 요소를 비민감 보고서에 고정했다. 공식 Verify와 UTF-8·후행 공백·필수 구획 보완 검사가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 0.2 — `main` 통합과 출시 SHA 확정 [승인 게이트]

- **Task-ID**: 0.2
- **Dependency**: Task 0.1
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 원격 `main`의 선행 commit을 출시 branch에 비파괴 방식으로 통합해 단일 출시 SHA를 확정한다.
- **Verify**: `git status --short`
- **Conclusion**: 통과 — `origin/main` 통합 중 `.github/workflows/e2e-round-direct.yml`의 `add/add` 충돌 1건을 확인했고, 원격 출시 branch에서 검증된 `${{ github.workspace }}` 절대 경로를 보존해 해결했다. merge commit `fbc7776d397efa31450650f417a9acec6fbfa5d8`의 두 부모와 `origin/main` 포함 여부, workflow 보존, `git diff --check`, 최종 `git status --short`를 검증했으며 Task 0.1 계획·보고서를 포함한 현재 HEAD를 단일 로컬 출시 후보로 확정했다.
- **Status**: done

#### Task 0.3 — 원격 branch와 PR 준비 [승인 게이트]

- **Task-ID**: 0.3
- **Dependency**: Task 0.2
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 확정된 출시 SHA를 원격 branch에 push하고 `main` 대상 PR의 검토 경계를 만든다.
- **Verify**: `gh pr view --json headRefOid,baseRefName,state,mergeStateStatus`
- **Conclusion**: [판정 — 원격 SHA와 PR head SHA가 일치. 검증 결과]
- **Status**: todo

#### Task 0.4 — 동일 SHA 전체 원격 게이트

- **Task-ID**: 0.4
- **Dependency**: Task 0.3
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 출시 SHA의 build·타입 검사·단위·E2E·52건 Playwright·cleanup을 원격에서 다시 통과시킨다.
- **Verify**: `gh run list --workflow e2e-round-direct.yml --limit 1 --json headSha,status,conclusion,url`
- **Conclusion**: [판정 — 동일 SHA에서 전체 원격 게이트 통과 여부. 검증 결과]
- **Status**: todo

### Phase 1 — ALIGO 알림 준비

#### Task 1.1 — 알림 계약과 provider 준비상태 감사

- **Task-ID**: 1.1
- **Dependency**: Task 0.1
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 필요한 ALIGO 계정·발신번호·발신 프로필·템플릿 코드·환경별 변수 존재 여부를 값 없이 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 실제 발송에 필요한 승인 항목과 누락 항목 확정. 검증 결과]
- **Status**: todo

#### Task 1.2 — ALIGO 계정·발신 프로필·템플릿 승인 [승인 게이트]

- **Task-ID**: 1.2
- **Dependency**: Task 1.1
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 운영 주체가 ALIGO 발신번호·알림톡 프로필·회차 알림 템플릿을 provider에서 승인받는다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — provider 승인 식별자와 상태를 값 없이 기록. 검증 결과]
- **Status**: todo

#### Task 1.3 — 격리된 실제 알림 발송 검증 [승인 게이트]

- **Task-ID**: 1.3
- **Dependency**: Task 1.2
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: shared E2E provider 대역을 유지한 채 승인된 수신자에게 알림톡 성공과 문자 대체를 격리 실행으로 검증한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 알림톡·문자 대체의 실제 provider 결과와 개인정보 배제 확인. 검증 결과]
- **Status**: todo

#### Task 1.4 — 운영 ALIGO 변수 반영 [승인 게이트]

- **Task-ID**: 1.4
- **Dependency**: Task 1.3
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 검증된 ALIGO 자격 증명을 운영 API 환경에 값 비공개·배포 보류 방식으로 반영한다.
- **Verify**: `powershell -NoProfile -Command "$v = railway variable --environment production --service api --json | ConvertFrom-Json; $required = @('ALIGO_API_KEY','ALIGO_USER_ID','ALIGO_SENDER_KEY','ALIGO_SENDER_PHONE'); if (@($required | Where-Object { [string]::IsNullOrWhiteSpace([string]$v.PSObject.Properties[$_].Value) }).Count -gt 0) { exit 1 }"`
- **Conclusion**: [판정 — 필수 변수 4개가 비어 있지 않고 원문 미노출. 검증 결과]
- **Status**: todo

### Phase 2 — Firebase 운영 인프라 반영

#### Task 2.1 — 운영 인덱스·규칙 차이 감사

- **Task-ID**: 2.1
- **Dependency**: Task 0.4
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 운영과 로컬의 Firestore 인덱스·Firestore 규칙·Storage 규칙 차이를 삭제 없는 반영 목록으로 고정한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 운영 보존 항목과 신규 반영 항목을 분리. 검증 결과]
- **Status**: todo

#### Task 2.2 — 비운영 Firebase 규칙 회귀

- **Task-ID**: 2.2
- **Dependency**: Task 2.1
- **Target**: `firestore.rules`
- **Goal**: 신규 회차 접근 차단과 기존 공개 상품·legacy 주문 접근을 실제 에뮬레이터에서 재검증한다.
- **Verify**: `pnpm test:firestore-rules`
- **Conclusion**: [판정 — 신규 서버 전용 경계와 legacy 호환 통과. 검증 결과]
- **Status**: todo

#### Task 2.3 — Storage 규칙 회귀

- **Task-ID**: 2.3
- **Dependency**: Task 2.2
- **Target**: `storage.rules`
- **Goal**: 회차 배송 사진 직접 접근 차단과 기존 상품·legacy 사진 호환을 실제 에뮬레이터에서 재검증한다.
- **Verify**: `pnpm test:storage-rules`
- **Conclusion**: [판정 — 비공개 회차 사진과 legacy 호환 통과. 검증 결과]
- **Status**: todo

#### Task 2.4 — 운영 인덱스 정의 보존 정합화

- **Task-ID**: 2.4
- **Dependency**: Task 2.3
- **Target**: `firestore.indexes.json`
- **Goal**: 운영에만 존재하는 인덱스를 보존하거나 삭제 승인을 명시하면서 로컬 정의를 배포 가능한 상태로 정합화한다.
- **Verify**: `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"`
- **Conclusion**: [판정 — 운영 전용 인덱스별 보존·삭제 결정과 `saleRounds` 필수 인덱스 포함 확인. 검증 결과]
- **Status**: todo

#### Task 2.5 — 운영 Firestore 인덱스 반영 [승인 게이트]

- **Task-ID**: 2.5
- **Dependency**: Task 2.4
- **Target**: `firestore.indexes.json`
- **Goal**: 승인된 정합화 정의만 운영 Firestore 인덱스에 반영한다.
- **Verify**: `firebase deploy --only firestore:indexes --project green-e4fe3`
- **Conclusion**: [판정 — 기존 운영 인덱스의 비의도 삭제 없이 신규 필수 인덱스 반영. 검증 결과]
- **Status**: todo

#### Task 2.6 — 운영 Firestore 규칙 반영 [승인 게이트]

- **Task-ID**: 2.6
- **Dependency**: Task 2.5
- **Target**: `firestore.rules`
- **Goal**: 에뮬레이터 회귀를 통과한 Firestore 규칙만 운영에 반영한다.
- **Verify**: `firebase deploy --only firestore:rules --project green-e4fe3`
- **Conclusion**: [판정 — 신규 회차 접근 경계와 기존 legacy 접근 호환 규칙 반영. 검증 결과]
- **Status**: todo

#### Task 2.7 — 운영 Storage 규칙 반영 [승인 게이트]

- **Task-ID**: 2.7
- **Dependency**: Task 2.6
- **Target**: `storage.rules`
- **Goal**: 에뮬레이터 회귀를 통과한 Storage 규칙만 운영에 반영한다.
- **Verify**: `firebase deploy --only storage --project green-e4fe3`
- **Conclusion**: [판정 — 비공개 회차 사진 경계와 기존 사진 호환 규칙 반영. 검증 결과]
- **Status**: todo

#### Task 2.8 — 운영 Firebase 반영 증거 재조회

- **Task-ID**: 2.8
- **Dependency**: Task 2.7
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 운영 인덱스 재조회 결과와 두 규칙 배포 성공 증거를 비밀값 없이 출시 보고서에 고정한다.
- **Verify**: `firebase firestore:indexes --project green-e4fe3 --json`
- **Conclusion**: [판정 — `saleRounds` 필수 인덱스와 두 규칙의 운영 반영 증거 확보. 검증 결과]
- **Status**: todo

### Phase 3 — 동일 SHA 운영 배포

#### Task 3.1 — API 운영 배포 [승인 게이트]

- **Task-ID**: 3.1
- **Dependency**: Task 0.4, Task 1.4, Task 2.8
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 승인된 출시 SHA를 Railway production API에 배포하고 health와 commit SHA를 확인한다.
- **Verify**: `railway status --json`
- **Conclusion**: [판정 — production API 배포 성공과 출시 SHA 일치. 검증 결과]
- **Status**: todo

#### Task 3.2 — 세 프런트 운영 배포 [승인 게이트]

- **Task-ID**: 3.2
- **Dependency**: Task 3.1
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: consumer·seller·driver를 API와 같은 출시 SHA로 production 배포한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 세 Vercel production 배포의 READY와 SHA 일치. 검증 결과]
- **Status**: todo

#### Task 3.3 — 운영 무변경 smoke

- **Task-ID**: 3.3
- **Dependency**: Task 3.2
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 운영 URL·health·카카오 로그인·legacy 화면·회차 API 조회를 상태 변경 없이 확인한다.
- **Verify**: `node scripts/load/check-production-probe.mjs`
- **Conclusion**: [판정 — 동일 SHA 운영 서비스의 읽기 전용 핵심 경로 통과. 검증 결과]
- **Status**: todo

#### Task 3.4 — 배포 후 오류 관찰

- **Task-ID**: 3.4
- **Dependency**: Task 3.3
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: API와 세 프런트의 5xx·인증·Firebase·provider 오류를 안정화 관찰창에서 확인한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 관찰창의 차단 오류와 담당자 확정. 검증 결과]
- **Status**: todo

### Phase 4 — 첫 회차 준비

#### Task 4.1 — 첫 회차 `DRAFT` 생성 [승인 게이트]

- **Task-ID**: 4.1
- **Dependency**: Task 3.4
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 운영 셀러 화면에서 첫 회차를 `DRAFT`로 만들고 상품·가격·노출 순서·한도를 입력한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 첫 회차 ID와 입력값 검수 결과. 검증 결과]
- **Status**: todo

#### Task 4.2 — 일정·지역·한도 검수

- **Task-ID**: 4.2
- **Dependency**: Task 4.1
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 일요일 24시 마감·월요일 경매·화요일 00~09시 배송·이천시·배송지 15곳·호접란 30개 계약을 재조회로 확인한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 일정·지역·한도·가격의 승인값 일치. 검증 결과]
- **Status**: todo

#### Task 4.3 — 첫 회차 `SCHEDULED` 전환과 링크 동결 [승인 게이트]

- **Task-ID**: 4.3
- **Dependency**: Task 4.2
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 검수된 회차만 `SCHEDULED`로 전환하고 당근 대표·상품 링크를 공개 전 상태로 보관한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — `SCHEDULED` 상태와 공개 전 링크 확인. 검증 결과]
- **Status**: todo

### Phase 5 — 운영 역할과 최종 출시 게이트

#### Task 5.1 — 역할·비상 연락·승인자 확정

- **Task-ID**: 5.1
- **Dependency**: Task 4.3
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 출시·셀러·배송·결제·고객 응대·개인정보·기술 담당자와 연락 경로를 개인정보 없이 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 역할별 담당과 에스컬레이션 경로 확정. 검증 결과]
- **Status**: todo

#### Task 5.2 — 전환·롤백 dry-run

- **Task-ID**: 5.2
- **Dependency**: Task 5.1
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 운영 대상 단일성·현재 `legacy`·예정 `round_direct`·롤백 명령을 읽기 전용으로 재확인한다.
- **Verify**: `node scripts/enable-dear-orchid-round-direct.mjs --dry-run`
- **Conclusion**: [판정 — 단일 대상과 양방향 전환 명령 확인. 검증 결과]
- **Status**: todo

#### Task 5.3 — 최종 출시 판정

- **Task-ID**: 5.3
- **Dependency**: Task 5.2
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 동일 SHA·Firebase·ALIGO·첫 회차·운영 예외·담당자·롤백 증거를 한 번에 대조해 출시 승인 여부를 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 출시 승인 또는 차단 사유 확정. 검증 결과]
- **Status**: todo

### Phase 6 — 판매 모드 전환과 공개

#### Task 6.1 — `round_direct` 전환 [최종 승인 게이트]

- **Task-ID**: 6.1
- **Dependency**: Task 5.3의 출시 승인
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 정확한 확인 플래그로 디어 오키드의 `salesMode`만 `legacy`에서 `round_direct`로 전환한다.
- **Verify**: `node scripts/enable-dear-orchid-round-direct.mjs --dry-run --target-mode=legacy`
- **Conclusion**: [판정 — 전환 후 현재값과 롤백 대상 확인. 검증 결과]
- **Status**: todo

#### Task 6.2 — 전환 직후 핵심 smoke와 롤백 판정

- **Task-ID**: 6.2
- **Dependency**: Task 6.1
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 당근 링크 공개 전에 소비자 회차 노출·주소 차단·결제 진입·셀러 회차·기사 보드·알림 준비상태를 확인한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 공개 진행 또는 즉시 `legacy` 롤백. 검증 결과]
- **Status**: todo

#### Task 6.3 — 당근 링크 공개 [승인 게이트]

- **Task-ID**: 6.3
- **Dependency**: Task 6.2 통과
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 검수된 대표 링크와 상품 링크만 당근 비즈프로필·소식·광고에 공개한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 공개 링크와 회차 정본 일치. 검증 결과]
- **Status**: todo

### Phase 7 — 첫 두 회차 안정화와 Closeout

#### Task 7.1 — 첫 두 회차 집중 모니터링

- **Task-ID**: 7.1
- **Dependency**: Task 6.3
- **Target**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **Goal**: 마감·결제·매입·배송·보류·사진·환불·알림·보관 예외를 런북 체크리스트로 두 회차 동안 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_mvp_round_direct_launch.md`
- **Conclusion**: [판정 — 두 회차의 정상 완료 또는 잔여 운영 위험 확정. 검증 결과]
- **Status**: todo

#### Task 7.2 — 출시 Closeout

- **Task-ID**: 7.2
- **Dependency**: Task 7.1
- **Target**: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- **Goal**: 전체 Task 결과와 후속 개선을 출시 Closeout으로 확정한다.
- **Verify**: `git diff --check`
- **Conclusion**: [판정 — 출시 차단 요소 해소와 후속 백로그 분리. 검증 결과]
- **Status**: todo

## Completion Criteria

- 출시 기준 SHA가 원격 branch·PR·원격 E2E·API production·세 Vercel production에서 일치한다.
- 52건 Playwright가 실패·건너뜀·재시도 없이 통과한다.
- 운영 `saleRounds(storeId, status)` 인덱스와 승인된 Firestore·Storage 규칙이 반영된다.
- ALIGO 필수 변수 4개가 운영에 있고 승인 수신자의 실제 알림톡·문자 대체가 확인된다.
- 첫 회차가 `SCHEDULED`이며 일정·지역·상품·가격·한도가 승인값과 일치한다.
- 운영 역할·비상 연락·출시 승인·롤백 담당이 기록된다.
- `round_direct` 전환 뒤 핵심 smoke가 통과하거나 실패 시 `legacy` 롤백이 확인된다.
- 당근 링크는 전환 직후 smoke 통과 뒤에만 공개된다.
- 첫 두 회차의 결제·배송·알림·운영 예외가 런북에 따라 종결된다.
- 비밀값·개인정보·사진·서명 URL이 출시 증거에 포함되지 않는다.

## Closeout Roll-up

- **Status**: `todo`
- **출시 기준 SHA**: Task 0.2에서 확정
- **원격 검증**: Task 0.4에서 확정
- **ALIGO 준비**: Task 1.4에서 확정
- **Firebase 운영 반영**: Task 2.8에서 확정
- **동일 SHA 운영 배포**: Task 3.2에서 확정
- **첫 회차 준비**: Task 4.3에서 확정
- **최종 출시 판정**: Task 5.3에서 확정
- **판매 모드 전환**: Task 6.1에서 확정
- **초기 안정화**: Task 7.1에서 확정

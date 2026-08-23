<!-- Language: ko -->

# Task 6.8 Git 역사 재작성 게이트 보존 산출물 관리 정책

- 정책 상태: 정본
- 기준일 `T0`: `2026-07-28 KST`
- 임시 저장소 보존 주체: GitHub `booker-lab`
- 임시 로컬 보관 주체: Windows `LAPTOP-6AVKK70U\tazan`
- 최종 보존 책임자: 미확정
- 보안 책임자: 미확정
- 문서 보존 책임자: 미확정
- 독립 삭제 확인자: 미확정
- `6개` worktree의 최종 데이터 소유자: 미확정
- 법적·보안 hold 판단권자: 미확정

미확정 항목은 이 정책의 성립을 막지 않는다. 최종 보존 책임자, worktree 최종 데이터 소유자, 독립 삭제 확인자가 모두 확정될 때까지 관련 산출물에는 삭제 금지 관리 hold를 적용한다.

## 1. 정책 범위

- 이 정책은 Git 역사 재작성 실행 정책이 아니다.
- 이 정책은 실행되지 않은 보존 산출물의 보존·접근·무결성·재검토·폐기 정책이다.
- history rewrite, force push, ref 변경, 원격 cutover, 재클론 또는 복구 적용을 승인하지 않는다.
- Git 역사 게이트의 최종 상태는 **비어 있지 않은 비밀값 후보 `0건`, Git 역사 재작성 미실행·불필요 종결**이다.
- backup mirror, bundle, bundle 복원 확인 mirror, 격리 source, 이름만 rewrite인 격리 mirror와 worktree 백업은 재작성 결과가 아니라 실행되지 않은 보존 산출물이다.
- 기존 역사 보고서와 준비 문서는 당시 판단을 기록한 자료로 유지하며 현재 결정 정본처럼 갱신하지 않는다.

## 2. 기준일과 보존 기간

보존 기준일 `T0`는 `2026-07-28 KST`로 고정한다.

| 보존 등급 | 삭제 금지 기한 | 정책 의미 |
| :--- | :--- | :--- |
| 90일 | `2026-10-27 00:00 KST` 이전 삭제 금지 | 기한 도달 뒤 최초 재검토 가능 |
| 180일 | `2027-01-25 00:00 KST` 이전 삭제 금지 | 기한 도달 뒤 최초 재검토 가능 |
| 365일 | `2027-07-29 00:00 KST` 이전 삭제 금지 | 기한 도달 뒤 최초 재검토 가능 |
| 영구 | 기간 만료 없음 | 폐기 대상이 아닌 최소 영구 보존 자료 |

기간 만료는 자동 삭제일이 아니라 최초 재검토 가능일이다. hold가 있거나 더 긴 조직 정책이 적용되면 해당 산출물은 기한 이후에도 삭제할 수 없다.

## 3. 산출물별 정책

| 절대 경로 | 분류 | 최소 보존·폐기 조건 |
| :--- | :--- | :--- |
| `C:\Develop\greenhub-history-rewrite-gate-backup\backup-mirror.git` | 원 ref 기준선 backup mirror | 180일 |
| `C:\Develop\greenhub-history-rewrite-gate-backup\task-6-8-original-refs.bundle` | 이식 가능한 주 Git 복구 사본 | 365일 |
| `C:\Develop\greenhub-history-rewrite-gate-backup\bundle-restore-check.git` | bundle 복원 확인 mirror | 180일 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\rewrite-source-16.git` | 승인된 `16개` ref의 격리 입력 사본 | 180일 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\rewrite-mirror.git` | 이름과 달리 `git-filter-repo`가 실행되지 않은 미재작성 사본 | 180일 |
| `C:\Develop\greenhub-history-rewrite-gate-backup\worktrees\greenhub` | 비어 있지 않은 변경·미추적 사본 | 365일 이상, 최종 소유자 확인 전 삭제 금지 |
| `C:\Develop\greenhub-history-rewrite-gate-backup\worktrees\greenhub-ai-hotfix` | 비어 있지 않은 변경·미추적 사본 | 365일 이상, 최종 소유자 확인 전 삭제 금지 |
| `C:\Develop\greenhub-history-rewrite-gate-backup\worktrees\greenhub-verified-39fdb2c` | 비어 있지 않은 변경·미추적 사본 | 365일 이상, 최종 소유자 확인 전 삭제 금지 |
| `C:\Develop\greenhub-history-rewrite-gate-backup\worktrees\greenhub-task-6-8-deploy-8bcfb76` | 빈 patch·미추적 `0건` 확인용 사본 | 180일, 소유자·내용 부재 이중 확인 뒤에만 폐기 가능 |
| `C:\Develop\greenhub-history-rewrite-gate-backup\worktrees\codex-682c-greenhub` | 빈 patch·미추적 `0건` 확인용 사본 | 180일, 소유자·내용 부재 이중 확인 뒤에만 폐기 가능 |
| `C:\Develop\greenhub-history-rewrite-gate-backup\worktrees\codex-85d0-greenhub` | 빈 patch·미추적 `0건` 확인용 사본 | 180일, 소유자·내용 부재 이중 확인 뒤에만 폐기 가능 |
| `C:\Develop\greenhub-history-rewrite-gate-backup\verification` | 준비 전후 patch 불일치 `0건` 검증 사본 | 365일 이상 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\evidence\commit-map-status.txt` | 실제 map이 아닌 미생성 상태 표식 | 영구, 결정 정본으로 사용 금지 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\evidence\new-refs.tsv` | 실제 map이 아닌 미생성 상태 표식 | 영구, 결정 정본으로 사용 금지 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\evidence\verification-summary.md` | 격리 조사·종결 검증 요약 | 영구 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\evidence\old-refs.tsv` | `.artifacts`의 `old-refs.tsv` 중복 사본 | 180일, 영구 정본 사본과 SHA-256 동일 확인 뒤 폐기 가능 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\redaction-rules.txt` | 조사 재현용 보조 파일 | 180일 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\verify_rewrite.py` | 조사 재현용 보조 파일 | 180일 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\downloads` | 다운로드·고정 도구·캐시 | 90일 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\tools` | 다운로드·고정 도구·캐시 | 90일 |
| `C:\Develop\greenhub-history-rewrite-gate-isolated\__pycache__` | 다운로드·고정 도구·캐시 | 90일 |

`commit-map-status.txt`와 `new-refs.tsv`는 실제 commit map 또는 실제 new ref map이 아니다. 실제 map은 생성되지 않았으며, 두 파일은 미생성 상태 표식이다. 두 표식과 isolated `old-refs.tsv`는 사용자 결정 정본이 아니다.

## 4. 정본 우선순위

### Task 6.8

1. `C:\Develop\greenhub\docs\plans\REPORT_task_6_8_final_closeout.md`
2. `C:\Develop\greenhub\docs\plans\PLAN_mvp_sales_round_direct_delivery.md`
3. `C:\Develop\greenhub\docs\memory.md`
4. `C:\Develop\greenhub-verified-39fdb2c\docs\plans\PLAN_mvp_sales_round_direct_delivery.md`

네 번째 문서는 Task 6.8이 `waiting`인 `74/75` 역사 스냅샷이며 현재 상태 판정에 사용하지 않는다. 현재 실질 진행도는 `75/75`이고 Task 6.8은 `done`이다.

### Git 역사 게이트

1. `C:\Develop\greenhub-verified-39fdb2c\docs\discussions\DISCUSS_task_6_8_git_history_rewrite_gate.md`
2. `C:\Develop\greenhub-verified-39fdb2c\.artifacts\history-rewrite-gate\closeout.md`
3. `C:\Develop\greenhub-verified-39fdb2c\docs\plans\PLAN_task_6_8_git_history_rewrite_gate.md`
4. `C:\Develop\greenhub\docs\memory.md`
5. `C:\Develop\greenhub\docs\plans\REPORT_task_6_8_a_plus_secure_cleanup.md`

다섯 번째 문서의 후보 `1건` 및 별도 승인 게이트 문구는 당시 판단을 기록한 역사 보고서다. Git 역사 게이트의 최신 결정은 비어 있지 않은 비밀값 후보 `0건`, Git 역사 재작성 미실행·불필요 종결이다.

## 5. 소유자 확정 절차

1. 경로·HEAD·branch·원 worktree를 기준으로 후보 소유자를 식별한다.
2. Windows ACL 소유자는 기술적 관리자 단서로만 사용하며 데이터 소유권의 단독 증거로 사용하지 않는다.
3. 후보 소유자의 서면 확인으로 최종 소유권을 확정한다.
4. 소유자가 확인되지 않으면 저장소 관리자가 임시 데이터 관리자를 지정한다.
5. 서면 확인 전에는 삭제 금지 관리 hold를 유지한다.

현재 임시 저장소 보존 주체는 GitHub `booker-lab`, 임시 로컬 보관 주체는 Windows `LAPTOP-6AVKK70U\tazan`이다. 이는 최종 보존 책임자나 최종 데이터 소유자가 확정됐다는 의미가 아니다.

## 6. 삭제 승인과 이중 확인

- 삭제 제안자와 독립 확인자를 분리한다.
- worktree 백업은 최종 데이터 소유자의 승인도 필요하다.
- 같은 사람이 모든 역할을 겸하면 이중 확인이 충족되지 않은 것으로 판정한다.
- 삭제 기록에는 절대 경로, 분류, 크기, SHA-256, 보존 기준일, 만료일, hold 확인, 승인자, 독립 확인자, 실행 시각, 삭제 후 부재 확인을 기록한다.
- 최종 보존 책임자, worktree 최종 데이터 소유자와 독립 삭제 확인자가 확정되기 전에는 관련 산출물을 삭제하지 않는다.

이 정책은 폐기를 승인하지 않으며 폐기 원장을 실제로 생성하지 않는다. 실제 폐기와 위치 변경은 별도 사용자 승인 뒤에만 수행할 수 있다.

## 7. hold 조건

다음 조건 중 하나라도 해당하면 삭제 금지 hold를 적용하거나 유지한다.

- 최종 소유자 미확정
- 법적 분쟁, 소송 예고, 규제·계약 보존 의무
- 보안 사건, 감사 또는 자격 증명 오용 조사
- 새 실제 비밀값 후보 발견
- SHA-256 불일치, ref 누락 또는 복원 실패
- 원본 worktree 손상·분실
- 삭제 승인 또는 독립 확인 부재
- 더 긴 조직 보존 정책 존재

법적·보안 hold 판단권자가 미확정인 동안에는 저장소 관리자가 임의로 hold를 해제할 수 없다.

## 8. 무결성 검증

향후 승인된 별도 작업에서 다음 방식을 사용한다. 이 정책 작성 작업에서는 검증용 manifest나 폐기 원장을 실제로 생성하지 않는다.

- 일반 파일: SHA-256
- 디렉터리: 상대 경로·크기·파일 SHA-256을 정렬한 tree manifest
- bundle: `git bundle verify`와 별도 격리 복원
- mirror: `git fsck --full`과 old-refs OID 대조
- worktree 백업: patch 구문, 파일 수, 파일별 SHA-256
- 검증 주기: 정책 시행 시, 보존 중 분기별, 접근권한·위치 변경 직후, 폐기 직전
- 영구 문서: 연 `1회`
- 불일치 발견 시: 삭제 중단과 새 보안 사건 개시

## 9. 접근·비밀정보 취급

- Git 객체 사본과 worktree patch는 보안 제한 자료로 취급한다.
- 비밀값 원문·부분 문자열·비밀값 파생 해시는 문서·로그·채팅에 기록하지 않는다.
- 무결성 해시는 산출물 전체 파일에 대해서만 생성한다.
- 일반 공유 폴더, 개인 클라우드 동기화, 전자우편 전송을 금지한다.
- 저장 장치 암호화와 최소권한 ACL 적용은 별도 사용자 승인 사항으로 남긴다.
- 현재 보존 루트의 상속된 `Authenticated Users: Modify` 상태는 권장 최소권한 기준에 미달하므로 후속 보안 정비 대상으로 기록하되 이 정책 작성 작업에서는 변경하지 않는다.
- ACL 변경, 암호화 적용, 실제 폐기와 저장 위치 변경은 별도 사용자 승인 전에는 시행하지 않는다.

## 10. 중복 보존 축소

1. 90일 이후 downloads·tools·cache를 먼저 재검토한다.
2. 180일 이후 bundle 복원 mirror, 격리 source, 미재작성 rewrite mirror, backup mirror를 재검토한다.
3. 삭제 전 bundle 검증, 새 격리 복원, 승인된 `16개` ref 대조, `git fsck --full` 통과가 필요하다.
4. bundle은 마지막 Git 대용량 복구 사본으로 365일까지 유지한다.
5. worktree 백업은 Git bundle과 별개의 사용자 데이터이므로 bundle로 대체됐다고 간주하지 않는다.
6. 비어 있지 않은 worktree 백업은 최종 소유자 승인 전 삭제하지 않는다.
7. 무결성 불일치나 복원 실패가 있으면 전체 중복 축소를 중단한다.

대용량 mirror·bundle·도구는 아래 최소 영구 보존 세트에 포함하지 않는다.

## 11. 최소 영구 보존 세트

다음 `19개` 파일을 최소 영구 보존 세트로 유지한다.

1. `C:\Develop\greenhub\docs\plans\REPORT_task_6_8_final_closeout.md`
2. `C:\Develop\greenhub\docs\plans\PLAN_mvp_sales_round_direct_delivery.md`
3. `C:\Develop\greenhub\.artifacts\round-direct\task-6-8-20260722-k2m7p4\evidence\closeout-summary.json`
4. `C:\Develop\greenhub\docs\discussions\DISCUSS_task_6_8_a_plus_secure_cleanup.md`
5. `C:\Develop\greenhub\docs\plans\PLAN_task_6_8_a_plus_secure_cleanup.md`
6. `C:\Develop\greenhub\docs\plans\REPORT_task_6_8_a_plus_secure_cleanup.md`
7. `C:\Develop\greenhub-verified-39fdb2c\docs\plans\PLAN_mvp_sales_round_direct_delivery.md`
8. `C:\Develop\greenhub-verified-39fdb2c\docs\discussions\DISCUSS_task_6_8_git_history_rewrite_gate.md`
9. `C:\Develop\greenhub-verified-39fdb2c\.artifacts\history-rewrite-gate\closeout.md`
10. `C:\Develop\greenhub-verified-39fdb2c\docs\plans\PLAN_task_6_8_git_history_rewrite_gate.md`
11. `C:\Develop\greenhub-verified-39fdb2c\.artifacts\history-rewrite-gate\approvals.md`
12. `C:\Develop\greenhub-verified-39fdb2c\.artifacts\history-rewrite-gate\backup-manifest.tsv`
13. `C:\Develop\greenhub-verified-39fdb2c\.artifacts\history-rewrite-gate\cutover-window.md`
14. `C:\Develop\greenhub-verified-39fdb2c\.artifacts\history-rewrite-gate\old-refs.tsv`
15. `C:\Develop\greenhub-verified-39fdb2c\.artifacts\history-rewrite-gate\toolchain.txt`
16. `C:\Develop\greenhub-verified-39fdb2c\.artifacts\history-rewrite-gate\worktree-recovery.md`
17. `C:\Develop\greenhub-history-rewrite-gate-isolated\evidence\verification-summary.md`
18. `C:\Develop\greenhub-history-rewrite-gate-isolated\evidence\commit-map-status.txt`
19. `C:\Develop\greenhub-history-rewrite-gate-isolated\evidence\new-refs.tsv`

대용량 mirror·bundle·다운로드·도구·캐시는 최소 영구 보존 세트에 포함하지 않는다. 보존 기간 만료, hold 해제, 무결성 검증과 별도 삭제 승인 전에는 이 제외만으로 폐기할 수 없다.

## 12. 새 비밀값 후보 사건 처리

- 기존 Git 역사 게이트는 닫힌 상태로 유지한다.
- 빈 문자열, 설정 키 이름, 변수명, 단순 문자열 언급은 새 사건 조건이 아니다.
- 비어 있지 않은 실제 값 후보가 자격 증명 의미를 갖는 위치 또는 provider 검증으로 확인된 경우에만 새 보안 사건을 연다.
- 원문·부분 문자열·파생 해시를 기록하지 않는다.
- 먼저 사용 중지·회전·접근 차단을 검토한다.
- 역사 재작성 필요성은 새 사건의 범위·ref·현재 유효성·협업 영향·사용자 승인으로 새로 판단한다.
- 기존 DISCUSS, 기존 게이트, 기존 상태 표식을 재개하거나 실제 map처럼 갱신하지 않는다.

## 13. 승인 경계

이 정책은 문서상 보존 기준만 확정한다. 다음 작업은 별도 사용자 승인 전에는 시행하지 않는다.

- ACL 또는 파일 권한 변경
- 저장 장치 암호화 적용 또는 저장 위치 변경
- 무결성 manifest 실제 생성
- 폐기 원장 또는 폐기 일정 실제 생성
- 보존 파일·디렉터리 삭제·이동·압축·변경
- history rewrite, `git-filter-repo`, `trufflehog`, force push, ref 생성·삭제·변경
- 원격 cutover, 재클론 또는 복구 적용


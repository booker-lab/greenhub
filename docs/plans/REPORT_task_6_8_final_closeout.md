<!-- Language: ko -->

# Task 6.8 최종 Closeout 보고서

## 판정

- **최종 상태**: `done`
- **최종 검증 SHA**: `39fdb2c28c45b5c7658519181e41845bb24be2fd`
- **최종 원격 증거**: GitHub Actions 실행 `30031472177`
- **검증일**: 2026-07-24
- **정본 범위**: Task 6.8의 로컬 검증 기록과 최종 원격 동일 SHA 검증을 연결하는 비민감 Closeout

Task 6.8은 로컬 보정 검증을 통과한 뒤, 보정이 포함된 정확한 SHA의 비운영 Preview에서 52건 실제 실행과 cleanup 무잔여가 확인됐으므로 최종 완료로 판정한다.

## 증거 연결

| 구분 | 증거 | 의미 | 보존 원칙 |
| :--- | :--- | :--- | :--- |
| 역사적 로컬 증거 | `.artifacts/round-direct/task-6-8-20260722-k2m7p4/evidence/closeout-summary.json` | 최초 Closeout 실행 당시의 build·테스트·타입 검사 상태와 알려진 오류를 기록한 시점 스냅샷 | 덮어쓰거나 현재 사실로 변조하지 않는다. |
| 보정 후 로컬 검증 | `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`의 Task 6.8 보정 로컬 검증 | 완료판정 리뷰 보정 뒤 전체 회귀·타입 검사·build·문서 검사를 기록한다. | 기존 로컬 증거보다 나중에 수행된 별도 검증으로 구분한다. |
| 최종 원격 증거 | GitHub Actions 실행 `30031472177`과 비민감 artifact `round-direct-e2e-30031472177-1` | 정확한 SHA의 세 Preview 배포, 실제 52건 판정, provider 차단과 cleanup 결과를 확정한다. | Task 6.8 최종 상태 판정에 사용한다. |

기존 `closeout-summary.json`의 `startedFromSha`는 `99b9bc0b852c75327ce5bec0b3dfea603ab5ed11`이고, 당시 API 전체 타입 검사 오류 6개와 드라이버 Node 10개 결과를 기록한다. 이후 완료판정 리뷰 보정과 로컬 재검증에서 API 전체 타입 검사 오류는 재현되지 않았고 드라이버 Node 계약은 11개로 갱신됐다. 두 결과는 서로 다른 시점의 증거이므로 기존 JSON을 수정하지 않고 이 보고서에서 시간 순서로 연결한다.

## 로컬 검증 요약

원 계획에 기록된 보정 후 로컬 검증 결과는 다음과 같다.

- 보드 5개, Firestore 인덱스 23개, Storage Emulator 12개, Firestore Emulator 14개
- API 단위 32개 스위트 249개, API E2E 4개 스위트 10개
- 소비자 Node 78개, 셀러 Vitest 43개, 드라이버 Node 11개
- fixture 계약 7개, readiness 계약 9개
- shared·API·consumer·seller·driver·E2E 타입 검사
- `pnpm build`, Playwright chromium·mobile 52개 목록 수집, `git diff --check`

이번 문서 정합성 대화에서는 애플리케이션 소스와 기존 작업 트리를 건드리지 않기 위해 위 로컬 회귀를 다시 실행하지 않았다. 기록된 로컬 결과와 현재 원격 실행 증거의 SHA·수치를 교차검증했다.

## 최종 원격 검증

`gh`로 실행 `30031472177`과 업로드된 비민감 artifact를 다시 조회한 결과는 다음과 같다.

| 항목 | 확인 결과 |
| :--- | :--- |
| 실행 상태 | `completed`, `success` |
| 실행 SHA | `39fdb2c28c45b5c7658519181e41845bb24be2fd` |
| 세 Preview 배포 SHA | 모두 실행 SHA와 일치 |
| readiness | `ready: true`, 실패 코드 0 |
| provider 외부 egress | 0 |
| 실행 설정 | `workers=1`, `retries=0` |
| Playwright | 52 passed, skipped 0, unexpected 0, flaky 0 |
| chromium cleanup | 성공, 잔여 Firestore 문서 0, Storage 객체 0 |
| mobile cleanup | 성공, 잔여 Firestore 문서 0, Storage 객체 0 |
| 실행·판정 게이트 | 모두 `success` |

실행 주소는 `https://github.com/booker-lab/greenhub/actions/runs/30031472177`이다.

## 운영 상태와 범위

- 애플리케이션 소스와 테스트 코드는 수정하지 않았다.
- 기존 사용자 변경을 복원·삭제·덮어쓰기하지 않았다.
- `git pull`, `reset`, `checkout`, commit, push, PR 생성을 수행하지 않았다.
- 운영 Firebase·Storage·Vercel·Railway, 운영 `salesMode`, 실제 결제·환불·알림을 조회·변경하지 않았다.
- 서비스 계정, 인증정보, 세션, 개인정보, 사진 원본, fixture manifest를 문서에 포함하지 않았다.

## 남은 위험

- legacy 거점 사진의 기존 토큰형 다운로드 URL은 토큰 유출 시 bearer 접근 위험이 남아 있다.
- 소비자 Node의 모듈 형식 경고, Firestore 인덱스 테스트의 기존 비 null 단언 1건, Next.js webpack cache 큰 문자열 직렬화 경고는 비차단 잔여 위험이다.
- 현재 로컬 HEAD `8bcfb76b8efeac71c5e84a4743bedc2d6838d2c3`은 최종 검증 SHA의 조상이며 2개 커밋 이전이다. 이번 범위에서는 원격 동기화를 금지했으므로 그대로 유지했다.
- 작업 트리에는 이번 문서 정합성 변경과 별개인 기존 수정·미추적 파일이 남아 있으며, 후속 대화에서 소유권을 구분해 정리해야 한다.

## 최종 결론

Task 6.8의 최신 문서 상태는 `done`이다. 최종 판정은 SHA `39fdb2c28c45b5c7658519181e41845bb24be2fd`와 GitHub Actions 실행 `30031472177`을 가리키며, 이전 `closeout-summary.json`은 역사적 로컬 증거로 분리 보존한다. 이 Closeout은 운영 전환이나 배포 승인을 의미하지 않는다.

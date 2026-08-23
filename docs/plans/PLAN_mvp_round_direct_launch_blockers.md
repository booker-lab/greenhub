<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

> 이 문서는 현재 실행 계약만 유지한다. 2026-07~08의 상세 진단·과거 Task 결론은 `docs/plans/REPORT_mvp_round_direct_launch.md`와 Git 이력에서 확인한다.

## 문서 메타

- **작성일**: 2026-07-28
- **최종 정합화**: 2026-08-23 KST
- **상태**: `paused_external_review`
- **Priority**: P0
- **현재 차단점**: ALIGO 회차 알림 템플릿 8종의 provider 심사 완료
- **현재 상태 SSOT**: `docs/memory.md`
- **재개 순서 SSOT**: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- **상세 과거 증거**: `docs/plans/REPORT_mvp_round_direct_launch.md`
- **운영 런북**: `docs/specs/ops/mvp-sales-round-runbook.md`

## 현재 기준선 — 2026-08-23 KST

- 회차 직배송 MVP 코드는 PR #11을 통해 `main`에 통합됐다.
- 기능 통합 기준 SHA는 `e55f25914cc7d01576fbd4639583daaf0fe6385e`다.
- PR #11은 `MERGED`·`CLOSED` 상태다.
- 병합 직후 `main`과 기존 개발 branch `codex/mvp-sales-round-direct`는 `identical`이었다.
- 카카오 비즈니스 채널 최종 승인 완료.
- ALIGO 발신 프로필 1건과 `senderkey` 준비 완료.
- 내부 논리 템플릿 코드↔ALIGO `tpl_code` 분리와 필수 본문 변수 검증 구현 완료.
- 회차 알림 템플릿 8종은 provider 등록·심사 요청 완료, 현재 모두 `검수중`.
- 실제 알림톡 정상 발송과 SMS fallback 검증은 미실행.
- 운영 ALIGO 자격 증명 4개와 `ALIGO_TEMPLATE_CODES_JSON`은 미반영.
- 운영 Firebase 인덱스·Firestore 규칙·Storage 규칙은 이전 출시 준비에서 반영 완료 상태.
- 운영 애플리케이션에 회차 출시 후보 배포는 미실행.
- 첫 운영 회차 미생성.
- `salesMode`는 `legacy` 유지.

## 상태 판정 원칙

1. 현재 상태는 `docs/memory.md`를 우선한다.
2. 재개 순서는 HANDOFF를 우선한다.
3. 이 문서의 Task는 실행 계약과 승인 경계를 정의한다.
4. 과거 보고서·PR 본문·완료 계획의 상태 문구가 현재 SSOT와 충돌하면 역사 기록으로만 취급한다.
5. 코드·설정·테스트 계약이 문서와 충돌하면 현재 `main`을 직접 확인해 spec을 정합화한다.

## 현재 출시 차단 요소

| 순서 | 게이트 | 상태 | 다음 조건 |
|---|---|---|---|
| 1 | ALIGO 8종 provider 등록 | 완료 | — |
| 2 | ALIGO 8종 최종 승인 | **대기** | 8종 모두 승인 |
| 3 | 실제 알림톡 정상 발송 | 미실행 | 사용자 승인 + 승인 템플릿 |
| 4 | SMS fallback 실제 검증 | 미실행 | 사용자 승인 + 격리 수신자 |
| 5 | 실제 출시 대상 SHA 원격 E2E | 미실행 | 출시 SHA 확정 |
| 6 | 운영 ALIGO 변수·매핑 반영 | 미실행 | 사용자 승인 + 실제 발송 검증 통과 |
| 7 | 운영 애플리케이션 배포 | 미실행 | **Task 3.1 별도 승인** |
| 8 | 첫 회차 검수 | 미실행 | 운영 배포·smoke 통과 |
| 9 | 최종 출시 판정 | 미실행 | 운영 역할·롤백·예외 확인 |
| 10 | `round_direct` 전환 | 미실행 | 최종 승인 |

## Agent Completion Contract

1. Task는 Dependency 순서대로 한 번에 하나씩 실행한다.
2. 각 Task 시작 전 현재 Git·배포·운영 상태를 다시 읽는다.
3. 외부 서비스 변경, 실제 발송, 운영 환경 변수, Firebase 운영 변경, 운영 배포, 운영 데이터 변경, `salesMode` 전환은 해당 Task의 사용자 승인을 받은 뒤 실행한다.
4. 한 승인으로 이후의 다른 운영 변경까지 포괄하지 않는다.
5. 비밀값은 환경 변수 또는 provider 입력으로만 전달하고 명령·로그·문서에 원문을 기록하지 않는다.
6. 고객명·전체 전화번호·전체 주소·사진 원본·서명 URL을 증거에 남기지 않는다.
7. 운영 Firebase에만 있는 인덱스·규칙을 확인 없이 삭제하지 않는다.
8. 실제 출시 대상 SHA의 전체 원격 회차 E2E가 통과하기 전 운영 배포를 진행하지 않는다.
9. ALIGO 실제 발송 검증이 실패하면 알림 없는 출시를 임의 승인하지 않는다.
10. 첫 회차가 검수된 `SCHEDULED` 상태가 아니면 `salesMode`를 전환하지 않는다.
11. 결제·환불·고객 안내·배송·보관 예외가 열려 있으면 영향과 담당자 승인 없이 출시하지 않는다.
12. 전환 직후 smoke 실패 시 신규 유입 공개를 중단하고 `legacy` 롤백을 우선한다.
13. 이미 결제된 회차 주문은 롤백 시 삭제하거나 legacy 주문으로 변환하지 않는다.
14. 실행하지 못한 검증을 완료로 기록하지 않는다.

## Execution Plan

### Phase 0 — 코드 통합 기준선

#### Task 0.1 — 회차 직배송 코드 `main` 통합

- **Dependency**: 없음
- **Goal**: 회차 직배송 MVP 구현을 기본 브랜치에 통합하고 통합 상태를 확인한다.
- **Conclusion**: 완료 — PR #11 병합, 기능 통합 기준 SHA `e55f25914cc7d01576fbd4639583daaf0fe6385e`.
- **Status**: done

#### Task 0.2 — 병합 후 branch 상태 확인

- **Dependency**: Task 0.1
- **Goal**: 병합 직후 `main`과 기존 개발 branch의 차이를 확인하고 branch 재사용 여부를 결정한다.
- **Conclusion**: 완료 — 병합 직후 `identical`, ahead 0 / behind 0. 기존 branch는 통합 완료 branch로 취급한다.
- **Status**: done

### Phase 1 — ALIGO 알림 게이트

#### Task 1.1 — 발신 프로필·코드 매핑 구현 준비

- **Dependency**: Task 0.1
- **Goal**: 발신 프로필·`senderkey`, 내부 논리 코드↔외부 `tpl_code`, 필수 본문 변수 검증을 준비한다.
- **Conclusion**: 완료.
- **Status**: done

#### Task 1.2 — 회차 알림 템플릿 8종 provider 등록·심사

- **Dependency**: Task 1.1
- **Goal**: 실제 도달 가능한 회차 템플릿 8종을 provider에 등록하고 최종 승인 상태를 확보한다.
- **Current**: 8종 등록·심사 요청 완료, 전부 `검수중`; 중복·오류·반려 없음.
- **Verify**: provider에서 8종 상태를 재조회하고 승인/수정요청/반려 여부만 기록한다.
- **Status**: blocked_external_review

#### Task 1.3 — 승인 템플릿 매핑 준비상태 검사

- **Dependency**: Task 1.2의 8종 승인
- **Goal**: 실제 승인된 `tpl_code`가 8개 논리 템플릿과 1:1 매핑되는지 값 비공개 방식으로 검증한다.
- **Status**: todo

#### Task 1.4 — 격리 실제 알림톡 정상 발송 [승인 게이트]

- **Dependency**: Task 1.3
- **Goal**: 승인된 격리 수신자에게 실제 알림톡 성공을 검증한다.
- **Safety**: 실제 고객에게 발송하지 않는다.
- **Status**: todo

#### Task 1.5 — SMS fallback 실제 검증 [승인 게이트]

- **Dependency**: Task 1.4
- **Goal**: 의도적으로 알림톡 정상 경로와 분리된 격리 절차에서 SMS fallback을 검증한다.
- **Status**: todo

### Phase 2 — 실제 출시 대상 SHA 검증과 운영 설정

#### Task 2.1 — 실제 출시 대상 SHA 확정

- **Dependency**: Task 1.5
- **Goal**: 운영 배포할 정확한 `main` SHA를 고정한다.
- **Note**: 과거 성공 SHA `6e0fc9d...`의 run `32351887404`는 역사 증거이며 현재 출시 SHA 검증을 대신하지 않는다.
- **Status**: todo

#### Task 2.2 — 동일 SHA 전체 원격 회차 E2E

- **Dependency**: Task 2.1
- **Goal**: 실제 출시 대상 SHA에서 chromium 26건 + mobile 26건 및 양쪽 fixture cleanup을 통과시킨다.
- **Verify**: `e2e-round-direct.yml`의 head SHA, conclusion, 52건 결과, cleanup을 확인한다.
- **Status**: todo

#### Task 2.3 — 운영 Firebase 재조회

- **Dependency**: Task 2.2
- **Goal**: 이미 반영된 인덱스·Firestore 규칙·Storage 규칙이 출시 전에도 기대 상태인지 읽기 전용으로 재확인한다.
- **Safety**: 차이가 있어도 이 Task에서는 배포·삭제하지 않는다.
- **Status**: todo

#### Task 2.4 — 운영 ALIGO 변수와 템플릿 코드 매핑 반영 [승인 게이트]

- **Dependency**: Task 1.5, Task 2.2
- **Goal**: `ALIGO_API_KEY`, `ALIGO_USER_ID`, `ALIGO_SENDER_KEY`, `ALIGO_SENDER_PHONE`, `ALIGO_TEMPLATE_CODES_JSON`을 운영 API 환경에 값 비공개 방식으로 반영한다.
- **Verify**: 필수 키가 모두 존재하고 비어 있지 않으며 8종 매핑 검사가 통과하는지 확인한다.
- **Status**: todo

### Phase 3 — 동일 SHA 운영 배포

#### Task 3.1 — API 운영 배포 [별도 승인 게이트]

- **Dependency**: Task 2.2, Task 2.3, Task 2.4
- **Goal**: 승인된 출시 SHA를 Railway production API에 배포하고 health와 SHA를 확인한다.
- **Important**: 선행 게이트가 모두 통과해도 사용자의 별도 `Task 3.1 승인` 없이는 실행하지 않는다.
- **Status**: todo

#### Task 3.2 — 세 프런트 운영 배포 [승인 게이트]

- **Dependency**: Task 3.1
- **Goal**: consumer·seller·driver를 API와 동일 출시 SHA로 production 배포한다.
- **Status**: todo

#### Task 3.3 — 운영 무변경 smoke

- **Dependency**: Task 3.2
- **Goal**: health·카카오 로그인·legacy 화면·회차 읽기 경로를 상태 변경 없이 확인한다.
- **Status**: todo

#### Task 3.4 — 배포 후 오류 관찰

- **Dependency**: Task 3.3
- **Goal**: API와 세 프런트의 5xx·인증·Firebase·ALIGO 오류를 확인한다.
- **Status**: todo

### Phase 4 — 첫 회차 준비

#### Task 4.1 — 첫 회차 `DRAFT` 생성 [승인 게이트]

- **Dependency**: Task 3.4
- **Goal**: 운영 첫 회차를 `DRAFT`로 생성한다.
- **Status**: todo

#### Task 4.2 — 일정·지역·상품·가격·한도 검수

- **Dependency**: Task 4.1
- **Goal**: 첫 회차 입력값을 운영 런북과 승인값으로 검수한다.
- **Status**: todo

#### Task 4.3 — 첫 회차 `SCHEDULED` 전환 [승인 게이트]

- **Dependency**: Task 4.2
- **Goal**: 검수된 회차만 `SCHEDULED`로 전환한다.
- **Status**: todo

### Phase 5 — 최종 출시 게이트

#### Task 5.1 — 운영 역할·비상 연락·승인자 확인

- **Dependency**: Task 4.3
- **Goal**: 출시·셀러·배송·결제·고객 응대·기술 담당 역할을 개인정보 없이 확인한다.
- **Status**: todo

#### Task 5.2 — 전환·롤백 dry-run

- **Dependency**: Task 5.1
- **Goal**: 현재 `legacy`, 예정 `round_direct`, 롤백 경로를 읽기 전용으로 재확인한다.
- **Status**: todo

#### Task 5.3 — 최종 출시 판정

- **Dependency**: Task 5.2
- **Goal**: 동일 SHA·Firebase·ALIGO·첫 회차·운영 예외·담당자·롤백 증거를 대조해 출시 승인 또는 차단을 기록한다.
- **Status**: todo

### Phase 6 — 판매 모드 전환과 공개

#### Task 6.1 — `round_direct` 전환 [최종 승인 게이트]

- **Dependency**: Task 5.3의 출시 승인
- **Goal**: 지정 판매자의 `salesMode`만 `legacy`에서 `round_direct`로 전환한다.
- **Status**: todo

#### Task 6.2 — 전환 직후 핵심 smoke와 롤백 판정

- **Dependency**: Task 6.1
- **Goal**: 소비자 회차 노출·주소·결제 진입·seller 회차·driver 보드·알림 준비상태를 확인한다.
- **Status**: todo

#### Task 6.3 — 외부 유입 링크 공개 [승인 게이트]

- **Dependency**: Task 6.2 통과
- **Goal**: 검수된 링크만 공개한다.
- **Status**: todo

### Phase 7 — 초기 안정화와 Closeout

#### Task 7.1 — 첫 두 회차 집중 모니터링

- **Dependency**: Task 6.3
- **Goal**: 결제·매입·배송·보류·사진·환불·알림·보관 예외를 런북으로 두 회차 동안 기록한다.
- **Status**: todo

#### Task 7.2 — 출시 Closeout

- **Dependency**: Task 7.1
- **Goal**: 출시 차단 요소 해소와 후속 개선을 확정한다.
- **Status**: todo

## Completion Criteria

- ALIGO 회차 알림 템플릿 8종이 모두 최종 승인된다.
- 격리 실제 알림톡과 SMS fallback이 검증된다.
- 실제 출시 대상 SHA에서 전체 원격 회차 E2E 52건과 cleanup이 통과한다.
- 운영 Firebase 상태가 기대 기준과 일치한다.
- 운영 ALIGO 필수 변수 4개와 8종 템플릿 매핑이 반영·검증된다.
- API와 세 프런트가 동일 출시 SHA로 운영 배포된다.
- 첫 회차가 검수된 `SCHEDULED` 상태다.
- 운영 역할·롤백 경로·최종 출시 승인이 확인된다.
- `round_direct` 전환 직후 핵심 smoke가 통과하거나 실패 시 `legacy` 롤백이 확인된다.
- 비밀값·개인정보·사진·서명 URL이 출시 증거에 포함되지 않는다.

## Closeout Roll-up

- **Status**: `paused_external_review`
- **코드 통합**: PR #11 `MERGED`·`CLOSED`, 기능 통합 기준 SHA `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- **ALIGO 발신 프로필**: 완료
- **`senderkey`**: 완료
- **템플릿 8종 등록**: 완료
- **템플릿 8종 승인**: 대기 — 전부 `검수중`
- **실제 알림톡·SMS fallback**: 미실행
- **실제 출시 대상 SHA 전체 E2E**: 미실행
- **운영 ALIGO 변수·매핑**: 미반영
- **운영 Firebase**: 이전 반영 완료, 출시 전 재조회 필요
- **동일 SHA 운영 배포**: 미실행
- **첫 회차 준비**: 미실행
- **판매 모드 전환**: 미실행, `legacy` 유지
- **재개 문서**: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`

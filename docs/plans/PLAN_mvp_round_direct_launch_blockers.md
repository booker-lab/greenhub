<!-- Language: ko -->

# Project Blueprint: 회차 직배송 MVP 출시 차단 요소 해소

> 현재 실행 계약만 유지한다. 과거 상세 진단·Task 증거는 `docs/plans/REPORT_mvp_round_direct_launch.md`와 Git 이력에서 확인한다.

## 문서 메타

- 작성일: 2026-07-28
- 최종 정합화: 2026-08-23 KST
- 상태: `paused_external_review`
- Priority: P0
- 현재 외부 차단점: ALIGO 회차 알림 템플릿 8종 provider 심사 완료
- 현재 상태 SSOT: `docs/memory.md`
- 재개 순서 SSOT: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 운영 런북: `docs/specs/ops/mvp-sales-round-runbook.md`
- 판매 활성화 전 법적 게이트: `docs/specs/legal/README.md`

## 현재 기준선

- 회차 직배송 MVP 코드는 PR #11을 통해 `main`에 통합됐다.
- 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- PR #11: `MERGED`·`CLOSED`
- 카카오 비즈니스 채널 최종 승인 완료.
- ALIGO 발신 프로필과 `senderkey` 준비 완료.
- 회차 알림 템플릿 8종은 provider 등록·심사 요청 완료, 현재 전부 `검수중`.
- 실제 알림톡 정상 발송·SMS fallback 검증 미실행.
- 운영 ALIGO 자격 증명 4개와 `ALIGO_TEMPLATE_CODES_JSON` 미반영.
- 운영 Firebase 인덱스·Firestore Rules·Storage Rules는 이전 준비에서 반영 완료 상태.
- 회차 출시 후보 production 배포 미실행.
- 첫 운영 회차 미생성.
- `salesMode`는 `legacy` 유지.
- 현재 공개 `/terms`, `/privacy`는 2026-08-19의 **비판매 상태**를 전제로 하므로 실제 판매 공개 전에 재정합화가 필요하다.

## 상태 판정 원칙

1. 현재 상태는 `docs/memory.md`를 우선한다.
2. 재개 순서는 HANDOFF를 우선한다.
3. 이 문서는 dependency·승인 경계를 정의한다.
4. 과거 PLAN·REPORT·PR 본문의 상태 문구는 현재 SSOT와 충돌하면 역사 기록으로만 취급한다.
5. 코드·설정·테스트 계약이 문서와 충돌하면 현재 `main`을 확인해 spec을 정합화한다.
6. 법적 문서의 현재 비판매 문구를 실제 판매 활성화 이후까지 그대로 두지 않는다.

## 현재 출시 게이트

| 순서 | 게이트 | 상태 | 다음 조건 |
|---|---|---|---|
| 1 | ALIGO 8종 provider 등록 | 완료 | — |
| 2 | ALIGO 8종 최종 승인 | **대기** | 8종 모두 승인 |
| 3 | 실제 알림톡 정상 발송 | 미실행 | 사용자 승인 + 승인 템플릿 |
| 4 | SMS fallback 실제 검증 | 미실행 | 사용자 승인 + 격리 수신자 |
| 5 | 판매 활성화 법적 문서 재정합화 | **미실행** | 실제 결제·알림·배송 정책 확정 |
| 6 | 실제 출시 대상 SHA 확정 | 미실행 | 법적 페이지 변경 포함 |
| 7 | 동일 SHA 전체 원격 회차 E2E | 미실행 | 출시 SHA 확정 |
| 8 | 운영 Firebase 재조회 | 미실행 | E2E 통과 |
| 9 | 운영 ALIGO 변수·매핑 반영 | 미실행 | 사용자 승인 + 발송 검증 통과 |
| 10 | 운영 애플리케이션 배포 | 미실행 | **Task 3.1 별도 승인** |
| 11 | 첫 회차 검수 | 미실행 | 운영 배포·smoke 통과 |
| 12 | 최종 출시 판정 | 미실행 | 운영 역할·롤백·예외 확인 |
| 13 | `round_direct` 전환 | 미실행 | 최종 승인 |

## Agent Completion Contract

1. dependency 순서대로 한 번에 하나씩 실행한다.
2. 각 Task 시작 전 현재 Git·배포·운영 상태를 다시 읽는다.
3. 외부 서비스 변경, 실제 발송, 운영 환경 변수, Firebase 운영 변경, 운영 배포, 운영 데이터 변경, `salesMode` 전환은 해당 Task의 사용자 승인을 받은 뒤 실행한다.
4. 한 승인으로 이후 다른 운영 변경까지 포괄하지 않는다.
5. 비밀값·고객 개인정보·사진 원본·서명 URL은 문서나 증거에 기록하지 않는다.
6. 실제 출시 대상 SHA의 전체 원격 회차 E2E가 통과하기 전 운영 배포를 진행하지 않는다.
7. ALIGO 실제 발송 검증 실패 시 알림 없는 출시를 임의 승인하지 않는다.
8. 판매 활성화 전에 공개 약관·개인정보처리방침의 비판매 문구와 실제 결제·알림·배송 흐름을 일치시킨다.
9. 법적 페이지 변경은 출시 SHA 고정 전에 포함한다.
10. 첫 회차가 검수된 `SCHEDULED` 상태가 아니면 `salesMode`를 전환하지 않는다.
11. 결제·환불·고객 안내·배송·보관 예외가 열려 있으면 영향과 담당자 승인 없이 출시하지 않는다.
12. 전환 직후 smoke 실패 시 신규 유입 공개를 중단하고 `legacy` 롤백을 우선한다.
13. 이미 결제된 회차 주문은 롤백 시 삭제하거나 legacy 주문으로 변환하지 않는다.
14. 실행하지 못한 검증을 완료로 기록하지 않는다.

## Execution Plan

### Phase 0 — 코드 통합 기준선

#### Task 0.1 — 회차 직배송 코드 `main` 통합
- Status: done
- Conclusion: PR #11 병합, 기능 통합 기준 SHA `e55f25914cc7d01576fbd4639583daaf0fe6385e`.

#### Task 0.2 — 병합 후 branch 상태 확인
- Status: done
- Conclusion: 병합 직후 `main`과 기존 회차 branch는 identical. 기존 branch는 통합 완료 branch로 취급한다.

### Phase 1 — ALIGO 알림 게이트

#### Task 1.1 — 발신 프로필·코드 매핑 구현 준비
- Status: done

#### Task 1.2 — 회차 알림 템플릿 8종 provider 등록·심사
- Dependency: Task 1.1
- Current: 8종 등록·심사 요청 완료, 전부 `검수중`.
- Status: `blocked_external_review`

#### Task 1.3 — 승인 템플릿 매핑 준비상태 검사
- Dependency: Task 1.2의 8종 승인
- Goal: 승인된 `tpl_code`와 내부 논리 템플릿 8종의 1:1 매핑을 값 비공개 방식으로 검증.
- Status: todo

#### Task 1.4 — 격리 실제 알림톡 정상 발송 [승인 게이트]
- Dependency: Task 1.3
- Safety: 실제 고객에게 발송하지 않는다.
- Status: todo

#### Task 1.5 — SMS fallback 실제 검증 [승인 게이트]
- Dependency: Task 1.4
- Status: todo

### Phase 2 — 판매 공개 계약과 출시 SHA

#### Task 2.1 — 판매 활성화 법적 문서 재정합화
- Dependency: Task 1.5
- Goal: 현재 비판매 상태의 `/privacy`, `/terms`를 실제 회차 판매·결제·알림·배송 정책과 일치시킨다.
- Contract: `docs/specs/legal/README.md`
- Required review:
  - 주문 성립·취소·환불·배송·재배송비·배송 보류 공개 문구
  - PortOne/실제 결제사업자 개인정보 처리 역할
  - ALIGO 실제 고객 알림의 전화번호·메시지 처리 흐름
  - seller/driver의 배송정보 접근 설명
  - 시행일·이전 버전 관리
  - `apps/consumer/src/app/legal-documents.test.mjs`의 비판매 assertion 갱신
- Important: **이 Task를 완료하기 전 출시 SHA를 고정하지 않는다.**
- Status: todo

#### Task 2.2 — 실제 출시 대상 SHA 확정
- Dependency: Task 2.1
- Goal: 운영 배포할 정확한 `main` SHA를 고정한다.
- Note: 과거 성공 SHA `6e0fc9d...`, run `32351887404`는 역사 증거다.
- Status: todo

#### Task 2.3 — 동일 SHA 전체 원격 회차 E2E
- Dependency: Task 2.2
- Goal: chromium 26 + mobile 26 = 52건과 fixture cleanup 통과.
- Status: todo

#### Task 2.4 — 운영 Firebase 재조회
- Dependency: Task 2.3
- Goal: 인덱스·Firestore Rules·Storage Rules를 읽기 전용으로 재확인.
- Status: todo

#### Task 2.5 — 운영 ALIGO 변수와 템플릿 매핑 반영 [승인 게이트]
- Dependency: Task 1.5, Task 2.3
- Goal: 운영 API에 ALIGO 필수 설정과 8종 매핑을 값 비공개 방식으로 반영·검증.
- Status: todo

### Phase 3 — 동일 SHA 운영 배포

#### Task 3.1 — API 운영 배포 [별도 승인 게이트]
- Dependency: Task 2.3, Task 2.4, Task 2.5
- Important: 사용자의 별도 `Task 3.1 승인` 없이는 실행하지 않는다.
- Status: todo

#### Task 3.2 — 세 프런트 운영 배포 [승인 게이트]
- Dependency: Task 3.1
- Goal: consumer·seller·driver를 API와 동일 출시 SHA로 production 배포.
- Status: todo

#### Task 3.3 — 운영 무변경 smoke
- Dependency: Task 3.2
- Goal: health·카카오 로그인·legacy 화면·회차 읽기 경로와 `/privacy`, `/terms` 새 버전을 상태 변경 없이 확인.
- Status: todo

#### Task 3.4 — 배포 후 오류 관찰
- Dependency: Task 3.3
- Status: todo

### Phase 4 — 첫 회차 준비

#### Task 4.1 — 첫 회차 `DRAFT` 생성 [승인 게이트]
- Dependency: Task 3.4
- Status: todo

#### Task 4.2 — 일정·지역·상품·가격·한도 검수
- Dependency: Task 4.1
- Status: todo

#### Task 4.3 — 첫 회차 `SCHEDULED` 전환 [승인 게이트]
- Dependency: Task 4.2
- Status: todo

### Phase 5 — 최종 출시 게이트

#### Task 5.1 — 운영 역할·비상 연락·승인자 확인
- Dependency: Task 4.3
- Status: todo

#### Task 5.2 — 전환·롤백 dry-run
- Dependency: Task 5.1
- Goal: 현재 `legacy`, 예정 `round_direct`, 롤백 경로를 읽기 전용으로 재확인.
- Status: todo

#### Task 5.3 — 최종 출시 판정
- Dependency: Task 5.2
- Goal: 동일 SHA·Firebase·ALIGO·법적 페이지·첫 회차·운영 예외·담당자·롤백 증거를 대조.
- Status: todo

### Phase 6 — 판매 모드 전환과 공개

#### Task 6.1 — `round_direct` 전환 [최종 승인 게이트]
- Dependency: Task 5.3의 출시 승인
- Status: todo

#### Task 6.2 — 전환 직후 핵심 smoke와 롤백 판정
- Dependency: Task 6.1
- Goal: 소비자 회차 노출·주소·결제 진입·seller 회차·driver 보드·알림·법적 페이지를 확인.
- Status: todo

#### Task 6.3 — 외부 유입 링크 공개 [승인 게이트]
- Dependency: Task 6.2 통과
- Status: todo

### Phase 7 — 초기 안정화와 Closeout

#### Task 7.1 — 첫 두 회차 집중 모니터링
- Dependency: Task 6.3
- Goal: 결제·매입·배송·보류·사진·환불·알림·보관 예외를 두 회차 동안 기록.
- Status: todo

#### Task 7.2 — 출시 Closeout
- Dependency: Task 7.1
- Status: todo

## Completion Criteria

- ALIGO 8종 최종 승인.
- 격리 실제 알림톡과 SMS fallback 검증.
- **판매 활성화에 맞는 개인정보처리방침·이용약관이 release SHA에 포함되고 production에서 확인됨.**
- 실제 출시 대상 SHA 원격 회차 E2E 52건 + cleanup 통과.
- 운영 Firebase 상태 기대 기준 일치.
- 운영 ALIGO 설정·8종 매핑 검증.
- API와 세 프런트 동일 출시 SHA production 배포.
- 첫 회차 `SCHEDULED` 검수 완료.
- 운영 역할·롤백 경로·최종 출시 승인 확인.
- `round_direct` 전환 직후 smoke 통과 또는 실패 시 `legacy` 롤백 확인.

## Closeout Roll-up

- Status: `paused_external_review`
- ALIGO 템플릿 8종 승인: 대기 — 전부 `검수중`
- 실제 알림톡·SMS fallback: 미실행
- 판매 활성화 법적 문서 재정합화: **미실행 — 현재 공개 문서는 비판매 상태**
- 실제 출시 대상 SHA 전체 E2E: 미실행
- 운영 ALIGO 변수·매핑: 미반영
- 운영 Firebase: 이전 반영 완료, 출시 전 재조회 필요
- 동일 SHA 운영 배포: 미실행
- 첫 회차 준비: 미실행
- 판매 모드 전환: 미실행, `legacy` 유지
- 재개 문서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`

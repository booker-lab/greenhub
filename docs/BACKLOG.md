<!-- Language: ko -->

# Greenhub Backlog

> 기준일: 2026-09-28 KST
>
> 현재 미완료·향후 작업만 관리한다. 완료 상세는 Git history, `docs/CRITICAL_LOGIC.md`, `docs/archive/`, 완료 PLAN·REPORT를 사용한다.
>
> 닫힌 역사 섹션(옛 P0 umbrella·이전 provider snapshot·이전 NEXT 체크리스트)의 추적 요약은 `docs/archive/BACKLOG_archive_20261107.md`에 있다.

## 우선순위 규칙

- **ACTIVE**: 지금 진행 가능한 최우선 작업
- **BLOCKED_EXTERNAL**: 외부 심사·승인 대기
- **NEXT**: 현재 게이트 해소 뒤 바로 진행
- **LATER**: MVP 출시 비차단 후속
- **STALE_OR_SUPERSEDED**: 현재 상태 재검증 전 실행 금지

---

## PUBLIC READINESS DOCUMENTATION CONVERGENCE

S2 → R1 Public Readiness의 accepted 종료 상태와 exact-source Preview 증거는 [현재 상태 SSOT](memory.md)에 기록한다. 이 Backlog는 그 종료 상태를 다시 열지 않으며, production release·activation과 혼동하지 않는다.

- S2 Browser Readiness: `CLOSED`
- exact-source Browser R3: `PASS` — 아래 source와 deployment는 역사적 Preview 증거다.
- physical-device disposition: `PHYSICAL_DEVICE_NOT_REQUIRED`
- R1 Combined Public Readiness: `PUBLIC_READINESS_CLOSED`
- S2 → R1 campaign: `TERMINAL_SUCCESS`
- #63이 확인한 pre-publication main 기준선: `ffd999423f8a98b0c1f34d020d832d7929feab72` — historical baseline
- #71이 재확인한 당시(2026-09-06) live `main`: `fe5e680fa58c8b3af5e508d07115bb8ab9df272a` — historical baseline
- #70 `SALE-ROUND-STATE-01`은 `MERGED`; 회차 atomicity/recovery implementation과 직접 proof가 publication되었다.
- 역사적 exact-source Preview 기준선: `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c` — 현재 main, PR, merge, production 증거로 승격하지 않는다.
- #63의 accepted closure는 닫힌 semantic work를 다시 열지 않는다는 뜻이며, Preview·Auth.js runtime 검증 잔여와 production/activation은 별도 상태다.
- 문서 candidate PR #69는 2026-09-05에 merge됐다.

---

## 상태 구분

| 주장 | 현재 판정 |
|---|---|
| implementation | `SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY`는 `IMPLEMENTATION_PROVEN`; #66이 race/recovery proof를 accepted함 |
| verification | Sale Round proof `PROVEN`; 2026-09-28 exact Preview 원격 E2E 52 + 세션 12 통과(`PRE_RELEASE_PROVEN`), 출시 SHA 재실행은 `PENDING` |
| prior candidate | PR #69의 기존 accepted candidate는 `9c921684a26597cb57887b6049288f1143b017c8` |
| updated candidate | PR #69의 후속 candidate는 remote-addressable 상태로 갱신하며, 정확한 head SHA는 Issue #75 TASK_RECORD에 기록 |
| PR | documentation PR #69는 2026-09-05 `MERGED` |
| published / merged | PR #70은 `MERGED`; 당시 live `main`은 `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`(historical) |
| Preview runtime proof | Auth.js 세션 런타임 `RUNTIME_PROVEN`(Preview); 출시 SHA 기준 재실행은 `PENDING` |
| production deployment | `DONE` — 2026-09-28 출시 SHA `197f84a4`, 이후 갱신 이력과 현재 운영 SHA는 `memory.md` 5절 |
| production activation | `DONE` — 2026-09-29 `salesMode=round_direct`, 첫 회차 `SCHEDULED` |
| first live round | `NOT DONE` — 첫 회차 "12월 1일 배송 회차" 주문 11/22 10:00 자동 오픈(2026-10-28 LIVE 채널 부재로 11/1에서 미룸) |

---

## IMPLEMENTED / PUBLISHED

### SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY

상태: `IMPLEMENTATION_PROVEN` + `PUBLISHED`.

Issue #66이 회차 수정·수동 개방·주문 예약·취소 복구의 race/recovery 구현과 직접 proof를
accepted했다. semantic candidate `4169bf250d3bdf4a5196209090307ca979e8d32a`는 PR #70으로
게시되었고, PR #70은 merge되어 당시 live `main` `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`로
read-back되었다.

직접 proof 범위:

| proof scope | 현재 판정 |
|---|---|
| fresh round/item edit gate와 snapshot 보호 | `PROVEN` |
| `SCHEDULED → OPEN` 및 reservation의 authoritative open/close window | `PROVEN` |
| cancellation owner/lease/expiry, takeover와 stale-worker fencing | `PROVEN` |
| crash recovery, partial cancellation/retry와 duplicate convergence | `PROVEN` |
| focused/integration/regression proof와 exact candidate publication | `PROVEN` / `PUBLISHED` |

이 상태는 implementation과 repository publication에 대한 proof다. 이 proof만으로 production
deployment·activation·live round·actual payment/notification을 주장하지 않는다. 운영 배포·activation
상태는 위 `상태 구분` 표와 `memory.md` 5절이 소유한다.

기술 계약은 `docs/specs/mvp-sales-round-direct-delivery.md`, 운영 중단·재개 규칙은
`docs/specs/ops/mvp-sales-round-runbook.md`에 둔다.

## ACTIVE

### BR-R3 — 증거 분류와 역사 승격 경계

이번 정본화는 선택지 B를 적용한다. 역사 보고서 전체를 current branch에 복구하지 않고, 역사
commit과 경로만 추적 가능한 `HISTORICAL_EVIDENCE`로 남긴다. 현재 판정과 acceptance의 정본은
아래 `CURRENT_IMPLEMENTATION_EVIDENCE`와 이 Backlog의 두 finding이다.

- `HISTORICAL_EVIDENCE`: `54af6edf44008848e586b1707d0f1fd13470a5f6`의
  `docs/reports/REPORT_retention_operations_sale_round_audit_20260824.md`는 2026-08-24 당시의
  감사 보고서다. 현재 branch에는 보고서 파일을 복구하지 않으며, 과거 결론을 현재 `VERIFIED`로
  승격하지 않는다.
- `CURRENT_IMPLEMENTATION_EVIDENCE`: 현재 source·직접 테스트·current spec·runbook을 다시
  대조한 결과다. Sale Round atomicity/recovery는 #66의 직접 proof와 #70/#71 publication으로
  `IMPLEMENTATION_PROVEN` / `PUBLISHED`가 되었으며, 남은 현재 공백은 retention과 operation
  claim fencing의 두 finding으로 분리했다.
- 위에서 유지된 직접 검증 항목은 `RESOLVED_NOT_PROMOTED`다. 이는 해당 base contract가 현재
  증거로 유지된다는 뜻일 뿐, 이번 두 finding이 해결되었거나 release gate·production 승인이
  되었다는 뜻이 아니다.
- `CURRENT_UNRESOLVED_FINDING`: `RETENTION-DELETE-ISSUE-ROUTING`,
  `OPERATION-ACTION-CLAIM-FENCING`만 이번 BR-R3의 current unresolved finding으로
  canonicalize한다. Sale Round finding은 #66/#70/#71로 implementation proof와 publication이
  완료되었지만, 이 사실이 exact-release runtime proof나 production 승인을 의미하지는 않는다.
- `FUTURE_REENABLE_REQUIREMENT`: 역사 보고서의 marketing consent lifecycle 논점은 현재
  `MARKETING_NOT_USED_IN_PILOT` controlled-pilot 정책을 변경하거나 새 finding으로 승격하지 않는다. 향후 marketing을 다시
  활성화할 때에만 당시의 동의·철회·보관·법무·provider·release 증거를 현재 권위로 재검증하고,
  별도 승인된 Task에서 범위를 확정한다.

---

## VERIFICATION

### Preview·exact-SHA proof

상태: `PRE_RELEASE_PROVEN` — 출시 SHA 확정 뒤 재실행 필요.

- 2026-09-28 run `36348002412`(live `main` `c8bec1f5`): exact Preview 3개 + 스테이징 API로 회차 52/52 + 세션 12/12, cleanup 잔여 0.
- 출시 SHA의 증거는 출시 SHA로 다시 실행한 run만 인정한다.

- #63이 인정한 Preview/browser/fixture 결과는 해당 exact source에 대한 재사용 가능한 역사적 증거다.
- `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`와 그 Preview deployment를 현재 main, 현재 candidate, production deployment로 표현하지 않는다.
- 현재 release candidate에서 필요한 exact-SHA Preview/browser/fixture proof와 Auth.js session/logout/rotation/stale-claim lifecycle proof는 별도 검증 gate다.
- 구현 완료, 검증 완료, Preview proof, production deployment·activation은 서로 대체하지 않는다.

## BLOCKED_EXTERNAL

### Auth.js session runtime

상태: `RUNTIME_PROVEN`(Preview, 2026-09-28) — run `36341189483`, `apps/e2e/tests/auth-session-lifecycle.spec.ts` 12건.

- 쿠키 발급·같은 컨텍스트 유지·로그아웃 후 소멸·정지/기사 승인 철회 뒤 세션 종료를 세 역할 × chromium·mobile로 확인했다.
- 이후 회차 E2E는 52건 뒤 이 12건을 함께 실행한다.

### ALIGO provider current metadata

상태: `EXTERNAL_GATE_PENDING`.

- repository logical 8-code contract: `VERIFIED` — #65에서 8개 logical code/body/required-variable 계약을 확인했다.
- provider 템플릿: 2026-09-28 콘솔에서 UK_5691~5698 코드·이름·승인완료·본문·변수 일치 확인.
- production mapping: Railway production 변수 저장값은 8종 모두 올바르고, 2026-09-28 출시 배포로 운영 API에 반영됐다.
- 2026-09-28 완료: 운영 송신 IP(Fixie 고정 IP)의 ALIGO 등록 확인, 운영 컨테이너 API 기준 템플릿 대조 일치, 격리 실제 알림톡 도착.
- 남은 gate: SMS fallback 실발송 — 사업자 발신번호 승인 뒤 `ALIGO_SENDER_PHONE` 교체와 재시험(아래 NEXT).

## AUTHORITY_PENDING

### Production deployment·activation

상태: deployment `DONE`(2026-09-28) / activation `DONE`(2026-09-29) / live round·실제 결제 `NOT DONE`.

- 운영 배포 이력과 현재 운영 SHA는 `memory.md` 5절이 소유한다.
- 남은 일: 파일럿 시작(2026-11-01)과 시작 직후 실제 결제·환불 1건 시험(아래 NEXT).
- 운영 배포는 계속 exact release SHA와 별도 사용자 승인으로만 한다.

## PRODUCT_POLICY_DECISION_REQUIRED

### Consumer self-cancel `ORDER_CANCELLED` notification

상태: `RESOLVED` — 2026-09-28 사용자 결정으로 소비자 회차 직접 취소도 `ORDER_CANCELLED`를 보낸다.

- 결제 전(`PENDING`)·이미 취소된 주문은 제외하고, 사유는 고정 문구 `고객 요청`, 멱등 키 `round-consumer-cancel:<orderId>`를 사용한다.
- 계약 정본: `docs/specs/api/notifications.md`. 직접 근거: `legacy-consumer-cancel-convergence.spec.ts` S9~S12.

### CONSUMER-UX-AUDIT-FOLLOWUPS

상태: `DECISION_REQUIRED` — 2026-11-07 소비자 UX 감사(#826 병합) 뒤 남은 사람 결정·확인. 자료: `docs/ux-audit/consumer/plan.md` 3·10·11절. C-28·재주문·우선순위는 결정됐고, C-01 실기기 확인과 그 결과에 따른 C-02 판단이 남았다.

- [ ] C-01 실기기 확인(사용자, 운영 반영 뒤): Android Chrome·카카오톡 인앱에서 결제창 이동·취소·복귀(10절 체크리스트 A~H)
- [x] C-28 배송 보류 안내: 2026-11-07 사용자 승인으로 10절 초안 확정·구현(사유 코드별 고정 문구, 직접 입력은 "담당자 메모", 미결제 안내). 11절
- [x] 재주문(`reorder` 기능 토글) 켜기: 2026-11-07 사용자 승인으로 Vercel consumer Production 값에 추가. 다음 운영 배포 뒤 운영 meta에 `reorder`가 있는지 확인한다
- [x] 빠진 기능 우선순위: 2026-11-07 사용자 승인으로 확정(11절 표). 1순위 주소 직접 입력 대체 수단부터 별도 PR로 한다

## DOC_DELTA

### Pilot marketing contract

상태: `VERIFIED` — 2026-10-10 코드·테스트·공개 문서 대조.

- Pilot 정책 `MARKETING_NOT_USED_IN_PILOT`: 회차 주문 API가 `marketingConsent`를 거부한다(`apps/api/src/orders/round-order-create.service.ts`, 회귀 `apps/api/src/orders/mvp-order-flow.spec.ts`). 결제 화면은 동의를 받지 않고 MY 마케팅 설정은 미운영 안내만 보인다.
- 공개 `/privacy`·`/terms`(시행일 2026-08-30)와 `docs/specs/legal/README.md`, `docs/specs/mvp-sales-round-direct-delivery.md`, `docs/specs/api/notifications.md`가 같은 정책을 적는다.
- 향후 marketing 활성화는 별도의 product·legal·provider·release authority와 현재 증거가 필요한 후속 판단이다.

## NEXT — 현재 residual 해소 후

### 외부·권한 gate

- [x] provider 템플릿과 repository logical 8-code mapping 대조 (2026-09-28 콘솔)
- [x] 운영 ALIGO 호출 경로 — Fixie 고정 IP 프록시 경유, 2026-09-28 `code=0`·템플릿 8종 API 대조 일치
- [x] 격리 실제 알림톡 — 2026-09-28 휴대폰 도착 확인
- [x] SMS 발신번호 — 개인 휴대폰 번호는 통신사 번호도용 차단으로 실패했다. 2026-10-08 운영 `ALIGO_SENDER_PHONE`을 ALIGO 승인된 사업자 번호(끝 2104)로 바꾸고 격리 실발송 알림톡(`TEST-1008`)·문자(`TEST-1008-SMS`)가 모두 접수·1회 시도·휴대폰 실수신됐다(사용자 확인).
- [ ] 별도 authority 후 격리 actual Alimtalk/SMS 및 fallback 검증
- [x] exact release SHA 기준 원격 회차 E2E 52 + 세션 12 재실행 — `197f84a4`, run `36372493414`
- [x] 운영 Firebase rules/indexes 대조와 배포 — 7/31 배포본 → `197f84a4` 규칙 반영, 재조회 일치
- [x] production deployment — 2026-09-28 `197f84a4` (API·프런트 3개·규칙)
- [x] activation — 2026-09-29 `salesMode` `round_direct` 전환, 첫 회차 `SCHEDULED`(read-back 확인)
- [x] 첫 회차 자동 오픈 차단 — 2026-09-29 회차 일정을 11/1 오픈·11/10 배송으로 이동
- [ ] 파일럿 운영 시작 — 첫 회차 "12월 1일 배송 회차" 주문 11/22(일) 10:00 자동 오픈(2026-10-28 LIVE 채널 부재로 11/1에서 21일 미룸, 배송 12/1)
- [ ] **파일럿 전 필수: PortOne 실연동(LIVE) 채널** (`PORTONE-CHANNEL-CHECK`). **2026-10-28: 첫 회차를 21일 미뤄 "12월 1일 배송 회차"(주문 11/22 10:00~11/30 00:00, 경매 11/30 07:00, 배송 12/1)로 옮김(#671 `ops-reschedule-round.yml`). LIVE 채널이 그 전에 안 나오면 같은 도구로 다시 미룬다.** 2026-10-13 사용자 PortOne 콘솔 확인: 운영 상점에 LIVE 채널이 없고 테스트 채널("카카오페이_테스트")만 있다. 이대로 11/1 첫 회차가 열리면 실제 돈이 오가지 않는 테스트 결제로 주문이 확정된다. PG 심사에 기간이 걸리므로 11/1 기준으로 일찍 신청한다. 순서는 `PORTONE-CHANNEL-CHECK` 참조. **2026-10-15**: 카카오페이 가맹점 심사가 아직 "심사중"(8/31 신청)이라 11/1 전 LIVE 전환이 불확실하다. **결정 필요(제안 기한 10/27)**: 그때까지 LIVE 채널이 없으면 자동 오픈 전에 첫 회차 일정을 옮긴다.
- [x] **파일럿 전 필수: 디어 오키드 매장 판매자 계정 연결** (`DEAR-ORCHID-STORE-OWNER-LINK`). 2026-10-15 사용자 승인으로 카카오 관리자 겸 판매자 계정에 연결(run `38757569432`).
- [ ] 파일럿 시작 직후 실제 결제·환불 1건 시험
- [ ] 첫 실회차 전 `legacy` 롤백 읽기 전용 dry-run(운영 조회, 사용자 실행) — 런북 `docs/specs/ops/mvp-sales-round-runbook.md` §7.2의 `node scripts/enable-dear-orchid-round-direct.mjs --dry-run --target-mode=legacy`. `docs/memory.md`·보고서에 실행 기록이 없다. 롤백 대상 legacy 흐름의 일반 E2E는 최근 100회 성공이 없다(`LEGACY-E2E-WORKFLOW-VARS`). 옛 출시 체크리스트 "최종 출시 판정·rollback dry-run"에서 옮김(`docs/archive/BACKLOG_archive_20261107.md`).
- [ ] 첫 두 실회차 모니터링·Closeout — 위 `상태 구분`의 first live round가 `NOT DONE`이다. 옛 출시 체크리스트·`docs/plans/PLAN_mvp_round_direct_launch_blockers.md` Phase 4~7 마지막 단계에서 옮김.

### 법무·출시 후보 정합성

2026-10-10 재대조 결과는 `docs/specs/legal/README.md` `2026-10-10 실제 흐름 재대조`가 소유한다.

- [ ] 주문 성립·취소·환불·배송·재배송비·보류 실제 정책 반영 — 8/30 판에 반영됐고, 남은 공백은 아래 `LEGAL-LATE-PAYMENT-REFUND-TERMS`
- [ ] settlement 및 payment 검증 결과 반영
- [x] PortOne/PG·ALIGO 전화번호·메시지 처리 경계 반영 — 8/30 판 `/privacy` 4절. ALIGO 고정 IP 프록시는 HTTPS 터널이라 위탁 고지 대상 아님(2026-10-10)
- [x] **`LEGAL-PRIVACY-OFFICER`**: 2026-10-10 사용자 결정(대표자)으로 `/privacy` 9절에 반영, `legal-documents.test.mjs`에 고정. 2026-11-01 시행 개정판이며 운영 배포 대기 묶음과 함께 나간다.
- [x] **`LEGAL-MAIL-ORDER-REGISTRATION`**: 2026-10-19 정부24 접수 → 2026-10-21 이천시 신고증 발급(제 2026-경기이천-0718 호). 2026-10-27 `apps/consumer/src/lib/publicBusinessInfo.ts`의 `mailOrderRegistrationNumber`에 번호를 채웠다(footer 칸 자동 노출, consumer 배포 뒤 운영 반영).
- [x] **`LEGAL-DRIVER-KAKAOMAP-NOTICE`**: 2026-10-10 사용자 결정(고지)으로 `/privacy` 4절에 반영.
- [x] **`LEGAL-LATE-PAYMENT-REFUND-TERMS`**: `/terms` 제7조에 반영(2026-11-01 시행).
- [x] **`LEGAL-REVISION-EFFECTIVE-DATE`**: 2026-10-12 `55ed02d9` 운영 배포로 개정판이 시행일(2026-11-01) 전에 게시됐다.
- [x] `OPS-ALERT-NO-PII-TEST`: 2026-10-12 `apps/api/src/ops-alerts/ops-alert.spec.ts`에 고정. 알림 payload에 주문·결제 ID와 스냅샷의 이름·전화·주소가 없음을 확인하고, 운영 기록을 만드는 모든 호출의 `title`·`message`가 고정 문자열(또는 고정 문자열 두 개 중 하나를 고르는 조건식)인지 소스에서 검사한다.
- [x] Pilot `MARKETING_NOT_USED_IN_PILOT` 정책과 공개 legal/source wording 정합화 — 2026-10-10 대조(위 DOC_DELTA)
- [ ] exact release SHA와 필요한 release verification

---

## LATER

### RETENTION-DELETE-ISSUE-ROUTING

`RESOLVED` — 배송 사진 retention metadata에 non-PII `storeId`를 보존하고, Storage 삭제 3회 실패 시
생성되는 `RETENTION_DELETE_FAILED` issue가 실제 storeId로 store-scoped 운영 목록에 노출되며 재실행에도
멱등하다. 보관 metadata는 non-PII `storeId` 외 개인정보 필드를 거부한다.

- [x] non-PII `storeId` 보존으로 store issue route 보장
- [x] retry·resolve·record 보존 관계와 동일 실패 멱등성 직접 회귀
- [x] issue와 보관 metadata에 주소·전화번호·Storage 서명 URL·비밀값 미기록

legacy record처럼 `storeId`가 없는 기록은 이번 계약의 신규 기록 범위가 아니며, 필요하면 별도
migration·visibility Task로 다룬다.

직접 회귀: `apps/api/src/retention/delivery-photo-store-routing.spec.ts`,
`apps/api/src/retention/retention.service.spec.ts`.

정본 routing: LATER summary는 이 항목, 보관 계약은
`docs/specs/mvp-sales-round-direct-delivery.md`, 현재 운영 중단·전달 규칙은
`docs/specs/ops/mvp-sales-round-runbook.md`에 둔다.

### OPERATION-ACTION-CLAIM-FENCING

`RESOLVED` — `runAction()`이 외부 action dispatch 전에 transaction에서 fresh `actionClaim.token`을
확인하고, 현재 claim이 아니면 side effect·상태 write 없이 종료한다. lease 만료 takeover 뒤 stale
success/failure는 새 claimant의 claim·status·audit를 덮지 않는다.

- [x] 외부 action 직전 fresh token 확인, 비소유자 side effect·write 0
- [x] lease 만료 takeover에서 RETRY_REFUND·RESEND_SMS 외부 side effect 0
- [x] stale success/failure가 최신 claim·status·audit를 보존
- [x] 기존 action mapping·정상 동시 claim 회귀 유지

직접 회귀: `apps/api/src/operations/operations-action-claim-lease-expiry.spec.ts`,
`apps/api/src/operations/operations-action-claim-occ-retry.spec.ts`.

정본 routing: LATER summary는 이 항목, operation issue 기술 계약은
`docs/specs/mvp-sales-round-direct-delivery.md`, 수동 조치 중단 규칙은
`docs/specs/ops/mvp-sales-round-runbook.md`에 둔다.

### LEGACY-GROUP-CANCEL-NOTIFICATION

`RESOLVED` — legacy 목표 미달 공동구매에서 consumer `GROUP_CANCELLED_LACK` 알림이 누락되던 문제를 해소했다.

`cancelGroupBuyLack()`는 상태 변경 전에 취소 대상 participant snapshot을 확정하고, `CANCELLED` 전환 뒤 해당 명시적 recipient 집합에 consumer `GROUP_CANCELLED_LACK`를 정확히 1회 직접 전달한다. `sendToGroupParticipants()`의 terminal filtering은 다른 template에 그대로 유지하고 판매자 `SELLER_GROUP_CANCELLED_LACK` 알림도 유지한다.

- [x] 취소 대상 participant snapshot 또는 동등 명시적 recipient 집합 사용
- [x] consumer 목표미달 취소 알림 1회 직접 회귀
- [x] 판매자 취소 알림 정상 유지
- [x] 다른 template의 terminal filtering 의미 유지

정본: `docs/specs/api/notifications.md`. 회귀: `apps/api/src/notifications/legacy-group-cancel-notification.spec.ts`.

### NOTIFICATION-RETRY-POLICY

`RESOLVED` — 알림톡/SMS 전달 경로가 provider 응답을 재시도 가능·rate-limit·영구·불확실로 분류하고, `NOTIFICATION_RETRY_BACKOFF_POLICY`에 따라 시도 사이 bounded backoff와 rate-limit 지연을 적용한다. `UNKNOWN`에서는 blind 중복 SMS를 시도하지 않는다. 3회 알림톡 상한·1회 SMS fallback·설정 오류 fail-closed·delivery idempotency는 유지한다. 채널별 provider 오류 분류 counter와 재시도 사이 적용 지연 값은 `NOTIFICATION_RETRY_METRICS` in-process 관측 recorder로 기록·노출하며 전화번호·본문·receipt 등 PII는 기록하지 않는다.

- [x] backoff·오류 분류·rate limit·중복 SMS
- [x] 관측 지표(분류·지연 metric 노출)

정본: `docs/specs/api/notifications.md`. 회귀: `apps/api/src/notifications/notification-retry-policy.spec.ts`, `apps/api/src/notifications/notification-retry-metrics.spec.ts`.

### API-LINT-BASELINE
- [ ] **2026-10-13 #516 병합**: API ESLint 오류를 1건까지 줄였다(`main` `b48a22b1`, 남은 1건은 `apps/api/src/payments/payments.service.spec.ts:311` `no-unnecessary-type-assertion`). **2026-10-18 ① 완료**: 그 1건(불필요한 `as jest.Mock` 캐스트)을 고쳐 API ESLint 오류를 0으로 만들고, CI `lint · typecheck` job에 `pnpm --filter api exec eslint "{src,apps,libs,test}/**/*.ts" --quiet` 단계를 넣었다(오류만 실패, `lint` 스크립트는 `--fix`라 CI·검증에 쓰지 않는다). 처음에는 #426 병합 뒤 고치기로 했으나 #426은 #540으로 대체돼 닫혔고, #540은 LIVE 채널이 생길 때까지 병합 보류라 main에서 먼저 고쳤다(#540은 이 spec의 다른 줄만 바꾼다). 남은 일: ② 경고로 남긴 동작 관련 지적 `require-await` 8건, `no-base-to-string` 25건, `no-floating-promises` 1건을 하나씩 판정한다. 타입 관련 `no-unsafe-*` 경고 약 2,240건은 `any` 정리 때 함께 줄인다. 이전 기록: auth `any`, spec mock 타입, lint command 분리

### LOCAL-DEV-FULLSTACK
- [ ] API/consumer/seller/driver launcher·CORS·`dev.bat` 정책

### LOAD-TEST-FORMAL
- [ ] staging/equivalent, 재개 트리거, baseline→soak, k6 plan

### Seller/Admin
- [ ] ADMIN-STORES-T7/T8, 준비 물량 공동구매 재설계, 필요 시 정산 UX

### Driver/배송
- [ ] Kakao Maps·밀크런 preview 재평가, 플랫폼형 전 GPS 보류

### 인프라/확장
- [ ] Railway contingency(2026-10-23 결정: Cloud Run 서울 이전 진행, `docs/specs/ops/api-hosting-cloud-run-plan.md`), 다중 판매자, hub_staff, 외부 driver 정산, 결제수단 확장

### AUTH-LOGOUT-SERVER-REVOCATION
- [ ] 세 앱 Auth.js 로그아웃 시 API `POST /auth/logout`도 호출해 서버 refresh token을 폐기한다. **2026-10-10 재대조: 구현됨**(#415·#429·#431 병합, 세 앱 `events.signOut` → `revokeApiSession`, 단위 테스트 있음). **2026-10-12 갱신**: #474가 로그아웃·관리자 정지에 `users/{uid}.sessionsRevokedAt`을 기록해 그 이전 `iat`의 access token을 `JwtStrategy`가 401로 거부하고, 로그아웃 때 Firebase refresh token도 폐기한다(`jwt.strategy.spec.ts`, `auth.service.spec.ts`). 남은 일: 배포 전 회차 E2E로 런타임 확인, 다른 기기 동시 로그아웃은 2026-10-15 #526의 기기별 세션으로 해결(`AUTH-MULTI-DEVICE-SESSION`). 이전 기록: 쿠키만 삭제되어 로그아웃 전에 복사된 쿠키가 refresh 만료(30일)까지 재사용될 수 있다. `refreshTokens/{sub}`가 사용자당 1개라 같은 계정의 다른 기기도 함께 로그아웃되는 영향을 설계에 포함한다. 2026-09-28 결정(D2)으로 출시 후 과제. **2026-10-10 결정: 지금 한다**(아래 `AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE`의 경쟁 상태 확인).

### PREVIEW-GENERIC-ENV-ALIGNMENT
- [ ] exact Preview(브랜치 없는 배포)는 Vercel의 브랜치 미지정 Preview env를 쓴다. 판매자 앱은 이 env에서 API=스테이징, Firebase=운영(`green-e4fe3`, 운영·Preview·개발 공통 항목)으로 어긋나 Firebase 클라이언트 로그인이 실패한다. 세 앱의 브랜치 미지정 Preview Firebase 설정을 비운영 프로젝트로 분리할지 결정한다.

### LEGACY-E2E-WORKFLOW-VARS
- [ ] (2026-10-09: `sync-preview`의 자동 디스패치를 끄고 수동 실행만 남김) 일반 E2E `e2e.yml`은 저장소 수준 `vars.ROUND_DIRECT_E2E_*`를 읽지만 값이 `round-direct-e2e` 환경에만 있어 대상 확인 단계에서 매번 실패한다(최근 100회 성공 없음). legacy 판매 재도입 전에 설정 출처를 고치고 legacy 흐름을 새 코드로 검증한다.

### EXACT-PREVIEW-WORKFLOW-CREDENTIALS
- [ ] `create-exact-preview-deployment.yml`은 앱별 Vercel 토큰(`VERCEL_EXACT_PREVIEW_{CONSUMER,SELLER,DRIVER}_TOKEN`) 미등록으로 성공한 적이 없다. 현재 exact Preview는 로컬 Vercel CLI 권한으로 `preview-exact/<scope>/<sha>` ref를 사용해 만든다. 워크플로 경로로 옮길지 결정한다.

### SELLER-SETTLEMENT-KST
- [x] 셀러 정산 탭 정산일시가 timeZone 미지정 `toLocaleDateString`으로 표시되고, CSV는 UTC(`Z`) ISO로 기록되어 KST 자정 전후 정산이 전날로 읽힌다. 수정 PR #320(화면 Asia/Seoul 고정·CSV `+09:00`)과 어드민 정산 #316 병합, 2026-09-30 운영 반영(`389066c8`). 2026-09-28 발견.

### ADMIN-CANCELLED-REFUND-RETRY
- [x] 서버 강제환불은 이미 취소된 주문도 재시도를 허용한다(일반: `cancellation.status` LOCAL_PENDING·LOCAL_FAILED·REFUND_FAILED·만료 claim·취소 상태 기록 없음, 회차: 결제가 아직 PAID). 어드민 주문 탭은 취소 주문에 버튼이 없다(#318 이후에도 동일). 결과 불명확 환불은 운영 이슈 `AUTO_REFUND_FAILED`→`RETRY_REFUND`로, 취소 전 주문은 기존 버튼으로 복구할 수 있어 급하지 않다. 취소 주문용 "환불 재시도" 버튼을 둘지 사람이 결정한다. 2026-09-28 발견. **2026-10-04 결정: 만들지 않는다.** 기존 복구 경로(운영 이슈 `RETRY_REFUND`, 취소 전 주문 강제환불 버튼)로 충분하고, 버튼 추가는 중복 환불 실수 위험만 늘린다. 파일럿에서 실제로 필요해지면 다시 연다.

### SELLER-ORDER-LIST-BUYER-INFO
- [x] 2026-10-04 사용자 결정으로 해결: 목록 카드에 손님 이름을 보이고 이름·전화 통합 검색을 넣는다. 목록 API `LIST_FIELDS`에는 상세와 같은 `buyerName`만 더하고 전화는 싣지 않는다. 전화 검색은 서버(`?phone=` 숫자 4자리 이상)가 판매자에게 보이는 연락처 숫자만 비교해 자기 매장의 맞는 주문만 돌려준다(`seller-orders-customer-info-plan.md` T1·T4). 이전 기록: 목록 API에 손님 정보가 없어 개인정보 최소화 계약을 넓힐지 결정 대기였다. 상세 화면 표시는 #314. 2026-09-28 발견.

### ADMIN-DESKTOP-TABLE-IN-480-SHELL
- [x] 2026-10-03 해결: 사용자 결정(어드민만 넓은 레이아웃)대로 `AppShell`이 `/admin`에서 폭 제한을 풀고 판매자 하단 탭을 숨긴다. 이전 기록: 셀러 앱 루트 레이아웃이 폭 480px로 고정돼 있다. 그런데 어드민 탭은 Mantine `visibleFrom="sm"`(창 폭 기준)으로 데스크톱 표를 고른다. 그래서 PC에서도 카드 폭 446px 안에 표가 들어가고 `overflow:hidden`으로 오른쪽이 잘린다. 어드민 주문 표(489px)는 강제환불 버튼이 "강제환"까지만 보인다. 기존 결함이다(#318과 무관). 어드민을 넓은 레이아웃으로 뺄지, 표 기준을 컨테이너 폭으로 바꿀지 결정한다. #317은 표를 4칸으로 유지해 피했다. 2026-09-28 로컬 하네스 검증에서 발견.

### DRIVER-MANTINE-CSS-AUDIT
- [x] 2026-10-03 대조 완료: 세 앱의 사용 컴포넌트와 import를 대조한 결과 드라이버는 누락 없음, 소비자(Checkbox·Image·Modal 계열)와 셀러(ActionIcon·NumberInput)는 채움. 이전 기록: 드라이버 `globals.css`는 Mantine CSS를 골라 import한다. 알림 스타일 누락은 #323으로 고쳤지만, `Modal.css` 같은 다른 사용 컴포넌트 CSS도 빠졌을 수 있다. 실제 사용 컴포넌트와 import 목록을 대조한다. 2026-09-28 발견.

### AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE
- [ ] 2026-10-03 원격 회차 E2E run `37108803974` 1차에서 `auth-session-lifecycle` mobile seller "로그아웃하면 사라진다"가 실패했다. 로그아웃 뒤 세션 쿠키는 없었는데 바로 이은 `/api/auth/session`이 `seller`를 돌려줬다. 같은 Preview 재실행에서는 통과했고, 직전 실행들도 통과했다. 로그아웃 순간 화면이 보낸 다른 요청의 응답이 갱신된 세션 쿠키를 다시 써 넣는 경쟁 상태로 추정한다(#333 proxy 쿠키 반영과 관련 가능). 실제로 로그아웃이 되돌려질 수 있는지 로컬에서 재현해 확인한다. 2026-10-10 코드 대조로 원인을 확인했다: JWT 세션 조회 응답이 세션 쿠키를 다시 쓰고(#333 proxy 반영), 로그아웃은 서버 토큰을 폐기하지 않아 늦게 도착한 응답이 유효한 쿠키를 되살린다. 같은 날 로컬 에뮬레이터(dev:local)로 세션 스펙을 돌려 6건 중 가끔 1건이 같은 방식으로 실패하는 것도 재현했다(`page.goto(base)`가 연 화면의 세션 조회가 로그아웃과 겹칠 때). 테스트에서 화면을 비워 피하지 않고 `AUTH-LOGOUT-SERVER-REVOCATION`으로 고친다. **2026-10-10 재대조**: 서버 폐기가 들어가 늦게 온 응답이 쿠키를 되살려도 다음 조회에서 `GET /auth/session`·refresh가 401이 되어 세션이 사라진다. 다만 서버 폐기 호출이 실패(5초 초과·5xx)하면 같은 현상이 남고 경쟁 상태 재현 테스트는 없다. **2026-10-12 갱신**: #474 뒤로는 로그아웃 호출이 성공하면 되살아난 쿠키의 access token도 `sessionsRevokedAt`보다 이른 `iat`라 거부된다. 남는 경우는 여전히 서버 폐기 호출 실패뿐이다. 배포 전 회차 E2E가 반복 통과하면 닫는다. **2026-10-27 재관측**: 운영 배포 전 회차 E2E run `40454750738` 1차에서 chromium seller "로그아웃하면 사라진다"가 같은 방식으로 실패했다(로그아웃 직후 쿠키 없음 확인 뒤 `/api/auth/session`이 `seller`), 재실행 통과. #627(같은 access token의 세션 검증 성공 60초 재사용) 이후에는 되살아난 쿠키가 다음 조회에서 바로 끊기지 않고 재사용 구간(최대 60초) 동안 남는다. 서버 세션은 이미 폐기돼 API 데이터 요청은 즉시 401이고, 화면은 API 거절 때 재검증으로 로그인 화면으로 간다(#634·#640). 2026-10-23 결정(앱 세션 최대 60초)에 맞춰 로그아웃 시험도 60초+여유 안에 세션이 끊기는지 확인하도록 바꿨다. 경쟁 상태 자체(늦은 세션 응답의 쿠키 재기록)는 남아 있다. **2026-10-27 오후 추가**: 배포 전 run `40466056694` 1차(consumer·seller chromium)·2차(consumer chromium)가 연속 실패했다. 역할 null 대기는 통과한 뒤 바로 이은 쿠키 검사에서 쿠키가 남아 있었다(약 60초 뒤 역할은 비었는데 쿠키는 있음). 역할과 쿠키를 따로 보면 늦은 응답이 쿠키를 되살리는 틈에 걸리므로, 세션 조회와 쿠키 확인을 한 조건으로 묶어 함께 만족할 때까지 기다리도록 시험을 바꿨다. 경쟁 상태 자체는 그대로다.

### HOME-BANNER-OVERLAP-AND-LEGACY-CTA
- [x] 2026-10-03 해결: 배너를 글자 칸과 사진 칸(40%)을 나란히 두는 배치로 바꾸고 한글을 낱말 단위로 줄바꿈했다(#365, `53f8e374` 운영 배포). 운영 배너 문서 `banners/main_hero`의 cta2("공구 참여하기 " → `/groupbuy`)는 어드민 화면에서 비운 것과 같은 `{label:"", href:""}`로 바꿨다. 이어서 운영에서 cta1 "지금인기 호접란" 링크가 이미 없는 상품(404)이고, 배너가 현재 회차에서 팔지 않는 호접란과 "할인"을 알리는 것을 확인했다. 사용자 결정으로 배너를 `isActive:false`로 내렸다(내용은 보존). 다시 켤 때는 특정 상품 대신 서비스 안내 문구와 404가 날 수 없는 링크를 쓴다. 같은 날 소비자 앱에 한국어 404 화면을 추가했다(#367). 이전 기록: 운영 소비자 홈 캡처에서 관리자 배너(`HeroBanner`)의 긴 제목이 오른쪽 절반 사진 위로 겹쳐 읽기 어렵다(모바일 390px). 또 배너 버튼에 예전 판매용 "공구 참여하기"가 떠 있는데 회차 직배송에서는 공동구매 진입을 숨긴다. 배너 레이아웃(사진을 배경으로 깔거나 제목 폭 제한)과 배너 내용(어드민 배너 탭에서 버튼 정리)을 함께 정리한다.

### BRAND-APP-ICON-REDESIGN
- [ ] 2026-10-03 앱 아이콘 상징(두 잎 하트)은 사용자가 "일단 이렇게" 정한 임시안이다. 잎사귀 하트·"그" 글자·손글씨 G·새싹·붓선 하트·꽃·화분·난초·gl·G+잎 시안을 봤지만 마음에 드는 것이 없었다. 나중에 아이콘 디자인을 다시 정한다. 로고(Nunito "Green Love" 글자만)와 앱별 구성(소비자=상징만, 판매자=+Seller, 기사=+Driver)은 확정. 원본은 `packages/ui/brand/`, 기준은 `docs/specs/frontend/design-standard.md` §7.

### ADMIN-TAB-PLANS-STALE-PROGRESS
- [x] 2026-10-10 해결: PR #391의 어드민 탭 계획서 진행표 갱신(2026-10-04 코드 대조)을 옮겼다. 인용 커밋 12개가 `main`에 있고 그 뒤 어드민 코드 변경은 문구·안내 수준이라 판정이 바뀌지 않았다. 이전 기록: 어드민 탭 계획서(`docs/specs/frontend/admin-tabs-improve-plan.md`와 `admin/admin-tab-*-plan.md`) 진행표가 현재 코드보다 뒤처져 있다. stores는 T7·T8을 빼고 구현을 마쳤고, 6개 탭 공통 조회 실패 표시와 users D1·banner T1·T3도 끝났는데 표에는 "미착수"로 남아 있다. 문서 정합성 작업으로 정리한다. 2026-09-28 코드 대조로 확인.

### DRIVER-SELLER-PHONE-BEFORE-PICKUP
- [ ] 기사 IA(`docs/design/드라이버-2단계-IA.md` §4)는 수거 전 화면에 판매자 연락처를 두지만, 코드(`2e2c0b50` 최소 노출)와 테스트는 미배정 주문의 `sellerPhone`을 숨긴다. **2026-10-04 결정: 파일럿 동안 현재 동작(숨김)을 유지한다.** 파일럿은 판매자와 기사가 같은 사람이라 필요가 없다. 외부 기사를 쓰기 시작할 때 노출 범위를 다시 정하고 IA 또는 테스트를 맞춘다.

### ROUND-PAYMENT-RETRY-DOUBLE-HOLD
- [ ] 소비자가 결제창을 닫고 새 결제 시도 ID로 다시 결제하면(#328), 이전 시도의 `PENDING` 주문·`HELD` 예약이 결제 실패 웹훅 또는 15분 만료 정리(1분 주기)까지 최대 약 16분 동안 회차 배송지·수량·상품 한도를 함께 차지한다. **2026-10-04 결정: 파일럿 동안 유지한다.** 즉시 해제하려면 늦게 도착한 이전 결제(늦은 결제 재확보·자동 환불) 흐름까지 다시 맞춰야 해서 위험이 이득보다 크다. 주문 오픈 날 '한도 마감'이 비정상적으로 빨리 나오면 우선 대응한다.
- 2026-10-10 결정: 이전 예약 유지는 그대로 두고, 같은 회차에서 고객 한 명이 동시에 가질 수 있는 만료 전 결제 예약을 3건으로 제한한다(4번째 시도는 409 안내). 구현: `OrderCapacityService` `MAX_ACTIVE_CHECKOUT_HOLDS_PER_USER_ROUND`. 2026-10-24 코드 대조: #546의 품목별 1인 상한도 만료 전 `HELD` 예약을 합산하므로, 재시도 수량이 상한에 걸리면 이전 예약이 만료(15분)될 때까지 409를 받을 수 있다.
- 2026-11-07 소비자 UX 감사(C-02): 로컬(결제 실패 웹훅 없음)에서 결제창 취소·뒤로가기 3회 뒤 네 번째 결제가 막히는 것을 재현했다. #826에서 막힐 때 '최대 15분' 안내와 주문 내역 버튼만 넣었다. 같은 결제 시도 ID 재사용은 API가 취소된 주문에도 같은 응답을 돌려줘 '결제 승인 → 자동 환불'이 될 수 있어 하지 않았다. 남은 판단: 운영에서 결제창을 닫을 때 `Transaction.Failed`가 와서 예약이 바로 반환되는지 실기기로 확인한다(`docs/ux-audit/consumer/plan.md` 10절 시나리오 H). 오지 않으면 같은 절의 API 변경안을 검토한다.

### CI-REQUIRED-CHECK
- [x] **2026-10-24 사용자 지정 완료**: `main` branch protection 필수 검사가 `verify`, `lint · typecheck`, `unit tests`, `Firebase rules (emulator)`, `build`(모두 GitHub Actions)다. 최신 main 반영 필수와 우회 금지는 그대로다. 이전 기록: **2026-10-09 결정: 지정한다.** `.github/workflows/ci.yml`이 GitHub에서 실제로 통과하는 것을 확인한 뒤 lint·unit·rules·build를 branch protection 필수 검사로 건다. 지정하면 에이전트 PR 자동 병합도 이 검사를 기다린다. 2026-10-09 CI 추가(#417) 뒤 PR마다 통과한다. 남은 일은 branch protection 필수 검사 지정(사용자)이다.

### STORE-COMMISSION-RATE-UNUSED
- [x] **2026-10-21 결정 ②로 반영(2026-10-23 `951044f2` 운영 반영)**: 정산 생성이 같은 transaction에서 가게 `commissionRate`(0~1)를 쓰고, 없으면 `PLATFORM_FEE_RATE`(기본 5%)를 쓴다. 이미 만든 정산은 다시 계산하지 않는다. 어드민 판매자 탭은 % 단위로 받고 "다음 정산부터 적용"을 안내한다. 이전 기록: 어드민이 가게별 수수료(`stores.commissionRate`)를 저장하지만 정산 생성은 전역 `PLATFORM_FEE_RATE`만 쓴다(`apps/api/src/settlements/settlements.service.ts`). **2026-10-09 결정: 파일럿 동안 그대로 둔다**(가게가 하나). 어드민 판매자 목록에 "정산은 공통 수수료율" 안내만 표시한다. 가게가 늘면 다시 정한다.

### SILENT-REFUND-CUSTOMER-NOTICE
- [x] **2026-10-15 사용자 결정: 현재 문구로 확정**(`apps/api/src/notifications/refund-notice-reasons.ts`의 `ROUND_CANCELLED`·`ADMIN_REFUND`·`LATE_PAYMENT`, 코드 변경 없음). 이전 기록: 회차 전체 취소, 관리자 강제 환불, 늦은 결제 자동 환불은 환불만 하고 고객 알림톡을 보내지 않는다. **2026-10-09 결정: 보낸다.** 승인된 `ORDER_CANCELLED`에 상황별 고정 사유를 싣는다. 사유 문구는 파일럿 개시 전에 사용자가 최종 확정한다. 2026-10-09 코드 반영(#420, 운영 반영). 남은 일은 `apps/api/src/notifications/refund-notice-reasons.ts` 문구 확정이다.

### OPS-ALERTING
- [x] **2026-10-24 확인**: `OPS_TELEGRAM_BOT_TOKEN`·`OPS_TELEGRAM_CHAT_ID`를 Railway 운영과 GitHub Actions 비밀값에 넣었고, 2026-10-24 08:30 KST 아침 운영 요약이 사용자 텔레그램 봇에 실제로 도착했다(Railway API 경로 동작 확인). GitHub 가동 확인 실패 알림은 실패가 있을 때만 보내므로 실발송은 아직 보지 못했다. 이전 기록: 운영 이슈 생성·ALIGO 계정 오류(잔액 부족·IP 미허용·발신번호)·PortOne 서명/금액 이상·정기 작업 실패를 사람에게 알리는 채널이 없다. `/operations` 화면과 홈 "운영 확인 N건"(2026-10-09)은 들어와서 봐야 보인다. **2026-10-09 결정: 도입한다.** 휴대폰 푸시 채널과 GitHub 정기 가동 확인(실패 시 소유자 이메일)으로 시작한다. 2026-10-09 코드 반영(#421, 텔레그램 봇과 GitHub 15분 가동 확인, 운영 반영). 남은 일은 `OPS_TELEGRAM_BOT_TOKEN`·`OPS_TELEGRAM_CHAT_ID`를 Railway 운영과 GitHub Actions 비밀값에 넣는 것이다(`docs/specs/ops/ops-alerts.md` §2).

### FIRESTORE-MANAGED-BACKUP
- [x] **2026-10-24 복구 연습 완료(사용자 수행)**: 2026-10-24 02:29 KST 일일 백업을 새 데이터베이스 `restore-drill-1024`(asia-northeast3)로 복원(1분 내외 완료)하고, 주요 컬렉션과 `orders` 문서 필드(주소·금액·상태·중첩 `deliveryAddress`)를 Firestore Studio에서 확인한 뒤 삭제했다. `(default)`는 건드리지 않았다. 복원된 데이터베이스는 삭제 보호가 켜진 채 만들어지므로 연습 정리 때 `gcloud firestore databases update --no-delete-protection` 뒤 삭제한다. 이때 PITR 가장 이른 버전은 10/17 15:52 KST, 일일 백업은 10/11~10/24가 있었다.
- [x] **2026-10-15 사용자 콘솔 확인: 켜져 있다.** 운영 `green-e4fe3` `(default)` 재해 복구 화면: PITR 사용 설정, 보관 7일, 가장 이른 버전 2026-10-08 23:46 KST. 예약 백업 일일, 보관 14일(주간 백업 없음). 같은 날 Google Cloud 콘솔 백업 목록 확인: 2026-10-09부터 10-15까지 매일 새벽(약 00:30~01:20 KST) 백업 7개가 생성돼 있고 각각 14일 뒤 만료된다. 남은 일: 비운영 프로젝트(또는 새 데이터베이스)로 복구 연습 1회. 이전 기록: 운영 Firestore 백업은 손으로 돌리는 `scripts/backup-firestore.mjs`(로컬 JSON)뿐이었다. **2026-10-09 결정: 켠다.** PITR과 일일 관리형 백업을 GCP 콘솔에서 사용자가 켠다(이 저장소 작업 환경에는 GCP 권한이 없다). 켠 뒤 비운영 프로젝트 복구 연습을 한 번 한다.

### ROUND-HOLD-ABUSE-LIMITS
- [x] **2026-10-10 결정**: 결제 없이 자리를 묶어 두지 못하게 상한을 건다. **2026-10-12 구현 완료(2026-10-13 운영 반영)**: 주문 요청 수량·회차 품목 수 입력 상한(#422), 같은 고객의 같은 회차 활성 결제 예약 최대 3건(#427, `ROUND-PAYMENT-RETRY-DOUBLE-HOLD`의 이전 예약 유지는 그대로, `checkout-hold-per-user.spec.ts`), 운영에서 판매자 초대 가입 외 `POST /auth/register` 403(#474, `auth.service.ts` `register`). **2026-10-18 결정으로 운영은 판매자 초대 가입을 포함한 이메일 가입과 이메일 로그인을 모두 403으로 거부하도록 바뀌었다**(`docs/specs/api/auth.md` §7, 2026-10-20 `71085566` 운영 반영). 운영 외 환경의 register·login은 그대로 열려 있다.

### OPERATION-ISSUE-MANUAL-RESOLVE
- [x] **2026-10-13 #510 구현(2026-10-13 `098affbc` 운영 반영)**: 판매자·관리자가 메모와 함께 운영 기록을 `RESOLVED`로 닫는다. 정산 보류·환불 미확정 유형 3종은 관리자만 닫는다(판매자 운영 화면 `ResolveIssueModal`, 계약은 `docs/specs/mvp-sales-round-direct-delivery.md` `operationIssues`). 이전 기록: 환불 재시도·문자 재발송 외의 운영 기록은 닫을 방법이 없어 홈 경고와 아침 텔레그램 요약에 계속 남는다. **2026-10-10 결정**: 판매자·관리자가 메모를 남기고 닫는다. 운영 기록 API를 고치는 병행 PR #436 병합 뒤 구현한다.

### CHECKOUT-DELIVERY-PHONE-CLIENT-CHECK
- [x] 받는 분 연락처는 휴대폰 번호만 받는다(**2026-10-10 결정**). 서버 검사는 #445로 들어갔다. **2026-10-13**: 소비자 회차 결제 화면도 같은 규칙(`apps/consumer/src/lib/korean-mobile-phone.ts`)으로 결제 버튼을 막고 칸을 벗어나면 서버와 같은 안내 문구를 보여 준다(2026-10-13 `098affbc` 운영 반영).

### REDELIVERY-PAID-REQUEST-RESEND
- [x] **2026-10-13 재대조: #448로 해결(운영 반영)** — 연결 결제가 PAID면 결제 요청 알림톡을 건너뛰고 판매자 확인 창 문구·런북도 맞췄다(`orders-lifecycle.service.ts`, `redelivery-resume-gate.spec.ts`). 이전 기록: 재배송비를 이미 결제한 보류 주문을 판매자가 "재배송 준비로 돌리기"(`DELIVERY_HELD → PREPARING`)하면 서버가 `ORDER_REDELIVERY_PAYMENT_REQUESTED`를 한 번 더 보낸다(연결 결제 PAID 여부를 보지 않음). 판매자 확인 창은 이 사실을 알린다(#446). 병행 PR #448이 연결 결제가 PAID면 건너뛰게 고치고, 판매자 확인 창 문구·런북도 함께 맞춘다. 2026-10-10 발견.

### AUTH-MULTI-DEVICE-SESSION
- [x] **2026-10-15 사용자 결정: 기기별 세션으로 바꾼다. 구현 병합(#526, `030f4c1e`), 2026-10-15 운영 반영(Production deploy run `38712474480`, 배포 SHA `030f4c1e`, smoke 9/9).** 로그인마다 세션 ID(`sid`)를 만들어 `refreshTokens/{sub}.sessions`와 `users/{sub}.activeSessionIds`에 기록한다(최대 10개, 가장 오래 쓰이지 않은 것부터 축출). 다른 기기 로그인은 재사용으로 판정하지 않고, 로그아웃은 그 기기 세션만 끊는다(Firebase 폐기·`sessionsRevokedAt` 없음). 재사용 감지·관리자 정지는 계속 모든 세션을 끊는다(`sessionsRevokedAt`·Firebase 폐기·`auth.token.stolen`). `sid` 없는 이전 refresh token은 401로 다시 로그인하게 한다(배포 직후 기존 로그인 사용자는 access token 만료 뒤 한 번 다시 로그인). 직접 근거: `apps/api/src/auth/auth.per-device-sessions.spec.ts`, `auth.service.spec.ts`, `strategies/jwt.strategy.spec.ts`. `docs/specs/api/auth.md` §6 반영. 남은 일: 배포 전 회차 E2E로 런타임 확인. 이전 기록: **DECISION REQUIRED** (2026-10-10 재대조 발견): `refreshTokens/{sub}`가 사용자당 문서 1개다. 같은 계정으로 두 번째 기기에서 로그인하면 문서를 덮어써(`apps/api/src/auth/auth.service.ts` `issueTokens`) 첫 기기의 다음 refresh(최대 약 55분 뒤)가 재사용으로 판정된다. 그러면 문서 삭제·Firebase 세션 폐기·`auth.token.stolen` 기록으로 두 기기 모두 끊기고 거짓 탈취 기록이 남는다. 한 기기 로그아웃도 모든 기기를 끊는다. 판매자가 휴대폰과 PC를 함께 쓰면 파일럿에서 겪을 수 있다. 사용자당 단일 세션을 계약으로 확정할지, 기기별 refresh 문서로 바꿀지 정한다. **2026-10-12**: #474 병합 뒤에도 refresh 문서는 사용자당 1개(해시 저장)이고, 로그아웃이 기록하는 `sessionsRevokedAt`이 사용자 단위라 한 기기 로그아웃이 다른 기기의 access token까지 즉시 끊는다. 기기별 문서로 바꾸면 로그아웃 폐기 범위(사용자 단위 `sessionsRevokedAt`)도 함께 정해야 한다.

### CHARGE-REFUND-ISSUE-ROUTING
- [x] **2026-10-10 수정(운영 반영)**: 기록을 charge의 `storeId`·`paymentId: null`·`chargeId`로 남기고, `RETRY_REFUND`가 `chargeId` 기록이면 `orderCharges` 문서를 대상으로 재배송비 환불을 다시 부른 뒤 `REFUNDED`일 때만 해결한다. 직접 회귀: `order-charge-refund-provider-ambiguity.spec.ts` C8, `operations.service.spec.ts` "재배송비 환불 기록은 orderCharges를 대상으로 재시도한다". 남은 일: 수정 전에 빈 `storeId`로 생긴 운영 기록이 있는지 운영 데이터 확인(사용자 승인 필요, 파일럿 전이라 없을 가능성이 크다). 이전 기록 — **IMPLEMENTATION FINDING** (2026-10-10 재대조 발견, 돈이 잘못 빠지는 문제는 아니고 운영 복구 문제): 재배송비 환불 결과가 불명확하면(PortOne 504 등) `AUTO_REFUND_FAILED`를 `storeId: ''`, `paymentId: chargeId`로 남긴다(`apps/api/src/payments/order-charge-payment.service.ts` `persistUncertainRefund`). 판매자 운영 화면은 매장 범위로만 보여 이 기록이 안 보이고, `RETRY_REFUND`는 `payments/<chargeId>`를 읽어 늘 `PAYMENT_NOT_FOUND`(409)로 끝난다. 남은 신호는 텔레그램 알림·아침 요약의 critical 건수뿐이다. 완료 조건: 주문의 실제 `storeId`로 기록하고, 재배송비 환불 재시도가 `orderCharges`를 대상으로 동작하며, 직접 회귀 테스트가 있다.

### PORTONE-CHANNEL-CHECK
- [ ] **2026-10-13 파일럿 전 필수(사용자 PortOne 콘솔 확인)**: 운영 상점(대표상점)에 실연동(LIVE) 채널이 없고 테스트 채널 "카카오페이_테스트"만 있다. #426은 운영에서 LIVE 채널을 요구하므로(`requireLiveChannel: true`, #426 브랜치 `apps/api/src/payments/portone-payment-context.ts`) LIVE 채널 없이 배포하면 테스트 채널 결제가 모두 확정되지 않고 환불·취소된다. 그래서 #426은 LIVE 채널이 생긴 뒤 병합한다. 반대로 #426 없이 지금 상태로 파일럿을 열면 테스트 결제로 주문이 확정된다. 순서:
  - **2026-10-15 사용자 확인**: 카카오페이 가맹점 심사는 8/31 신청(결제수단 카카오페이머니·카드) 뒤 지금도 "심사중"이다(카카오페이 가맹점센터 전화 확인). PortOne에서 "PG 계약 지연 안내" 메일을 받았다: 접수일부터 90일 안에 계약이 진행되지 않으면 자동 철회(기한 약 11/29). 진행 단계는 PG 계약 → 포트원 결제 연동 → 카드사 심사 → 서비스 오픈이라 카카오페이 승인 뒤에도 카드사 심사가 남는다. 카카오페이 답변: 통신판매업 신고는 심사에 영향이 없지만 나중에 필요하니 미리 신청한다. PortOne 실연동 탭에는 아직 채널이 없고, 이용료 결제 카드는 등록을 마쳤다.
  - **2026-10-27 사용자 확인(결정 기한)**: 카카오페이 가맹점 심사가 아직 "심사중"이라 LIVE 채널이 없다. 11/1 10:00 KST 자동 오픈 전에 첫 회차 일정을 옮기도록 권했고 새 날짜는 사용자 답을 기다린다. 판매자 앱 회차 수정 화면에서 `SCHEDULED`이면서 주문이 없는 회차는 일정을 바꿀 수 있다(`apps/api/src/sale-rounds/sale-rounds.service.ts` `assertRoundEditable`). #540과 결제 정합성 브랜치는 계속 보류한다.
  - **2026-10-28 사용자 결정·적용**: 첫 회차 "11월 10일 배송 회차"를 21일 미뤄 **"12월 1일 배송 회차"**(주문 11/22(일) 10:00~11/30(월) 00:00, 경매 11/30(월) 07:00, 배송 12/1(화) 00:00~09:00 KST, 상품·한도 불변)로 바꿨다. 판매자 앱은 카카오 로그인 계정이라 운영자가 대신 바꿀 수 없어 owner 전용 워크플로 `ops-reschedule-round.yml`(#671, 7일 배수로 밀어 일요일 개방·월요일 경매·화요일 배송 구조 유지)로 적용했다. 카카오페이 연동 심사는 심사용 "11월 특별 회차"(10/28~11/11)와 심사용 이메일 계정으로 진행 중이며, 심사 뒤 LIVE 채널·운영 배포·실결제 확인이 11/22 전에 끝나지 않으면 같은 도구로 다시 미룬다.
  - **2026-10-30 카드 PG 신청과 테스트 카드 채널 운영 반영(사용자 실행)**: 카카오페이가 10/29 메일로 연동 심사 전에 사이트에서 일반 카드결제창(PG)을 확인해야 한다며, 카드결제 선택지가 없다고 PG 심사 완료 여부 회신을 요청했다. PortOne 신청 내역에는 카카오페이(간편결제 일반결제)만 있어 카드 PG 계약이 없었다. 10/30 PortOne "전자결제 직접 신청"으로 토스페이먼츠 신용카드 일반결제를 신청했다(가입비 20만 원, 사이트 사전 점검 6항목 통과, 상점아이디 `im_greenl5dnn`, 토스 심사중). 온라인 플랫폼 사업자는 "아니요"로 답했다: 지금은 디어 오키드 자사 상품만 판다. 외부 판매자를 입점시키기 전에 토스페이먼츠·카카오페이 계약을 플랫폼 형태로 바꿔야 한다. 같은 날 PortOne 대표상점 테스트 탭에 "토스페이먼츠_카드_테스트" 채널(신모듈 V2, 공용 MID `iamporttest_3`)을 만들었다. Vercel consumer Production에 `NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY`(Config)를 넣고 직전 Production 배포(`747808a`)를 Redeploy해 빌드했다. 사용자가 운영 결제 화면에서 "신용·체크카드" 선택지와 토스페이먼츠 테스트 결제창을 확인했다(결제는 진행하지 않음). **지금 운영 consumer의 카카오페이·카드 채널 키는 모두 TEST다.** 남은 일: 카카오페이 회신, 토스 계약 서류와 카드사 심사(공개 안내 기준 약 2~3주), 심사용 "11월 특별 회차"가 11/11에 닫히므로 11/8쯤 연장 여부 판단, 카드사 심사 뒤 실연동 탭에 `im_greenl5dnn` 토스 채널 추가 → 카드 키 LIVE 교체 → Redeploy.
  - **위험과 결정 필요(2026-10-28 해소)**: 11/1 10:00 첫 회차 자동 오픈 때 실연동 채널이 없으면 소비자 결제가 TEST 채널로 들어가 실제 돈 없이 주문이 확정된다. LIVE 전환이 늦으면 자동 오픈 전에 회차 일정을 옮긴다(사용자 결정, 제안 기한 10/27).
  1. (사용자) PortOne 콘솔 "전자결제 신청"으로 PG 계약 → 심사 → 실연동 채널 추가. 실연동은 이용료 결제 카드 등록도 필요하다(월 매출 5천만 원 미만 무과금). PG 심사에 기간이 걸리므로 11/1 파일럿 기준으로 일찍 신청한다.
  2. (사용자) Vercel consumer의 결제 채널 키 공개 환경 변수(카카오페이·카드 둘 다)를 LIVE 채널 키로 교체한다. 공개 변수는 빌드 때 굳으므로 Redeploy에서 "Use project's Ignore Build Step"을 꺼야 새 키로 빌드된다.
  3. ~~운영 설정 점검 재실행~~ **완료**: 사용자가 2026-10-13 Railway에 `PORTONE_STORE_ID`를 넣었고, run `38407326491`(main `1c703a5b`)에서 `portone_store_id_set`·`portone_store_id_matches_consumer`를 포함한 전 항목 PASS(success).
  4. (보안 세션) #426과 결제 정합성 PR 병합 → 배포. 이어서 `payments.service.spec.ts:311` ESLint 1건 수정과 CI eslint 단계 추가(`API-LINT-BASELINE`).
  5. 파일럿 시작 직후 실제 결제·환불 1건 시험(NEXT 항목).
  이전 기록: 2026-10-13 운영 설정 점검(#503, run `38386740268`)에서 Railway API에 `PORTONE_STORE_ID`가 없었다(FAIL). 그 전 기록: 결제 확정은 PortOne 결제의 상태와 금액만 확인한다. 상점·통화·채널 확인 PR #426은 아직 병합되지 않았다(2026-10-10 기준 열림). 소비자 앱은 `channelKey`를 공개 환경 변수에서 넘기므로, 운영 PortOne 상점에 TEST 채널이 함께 있으면 테스트 결제로 금액만 맞춘 `PAID`가 실제 주문을 확정할 수 있다. 파일럿 전에 PortOne 콘솔에서 운영 상점의 TEST 채널 유무를 확인하고(사용자), #426 병합 여부를 정한다. #426(보안 세션)이 이 항목을 소유한다. 병합 전 조건: 운영 결제 채널 키가 LIVE, API `PORTONE_STORE_ID`와 consumer `NEXT_PUBLIC_PORTONE_STORE_ID` 일치, `RAILWAY_ENVIRONMENT_NAME=production`(아니면 결제가 자동 환불·취소된다).

### RATE-LIMIT-CLIENT-IP
- [x] **2026-10-13 #404·#488 병합(2026-10-13 `098affbc` 운영 반영)**: 요청 한도를 서명 검증된 토큰의 사용자(`sub`) 또는 신뢰 프록시 홉(`TRUST_PROXY_HOPS`, Railway 기본 1 → 2026-10-18부터 2)으로 정한 클라이언트 IP 단위로 세고(`apps/api/src/common/guards/client-throttler.guard.ts`·`.spec.ts`), `login`은 IP+이메일 단위와 IP 단위 1분 60회 상한을 함께 둔다. `firebase-token`은 사용자당 1분 60회, `refresh` 본문은 DTO로 검증한다(#488). 운영 API는 `JWT_SECRET`·`JWT_REFRESH_SECRET`이 같으면 기동하지 않는다. 운영 Railway 값은 운영 설정 점검 workflow(#503, run `38386740268`)에서 둘 다 설정·서로 다름·32바이트 이상으로 PASS다. `CORS_ALLOW_VERCEL_PREVIEWS`는 운영에 두지 않는다(Preview origin 거부). 2026-10-18 스테이징·운영 실측: 1홉은 접속자가 아니라 Railway 중계 노드 주소로 집계해 같은 접속자도 연결마다 버킷이 갈렸다. 2홉은 접속자마다 한 버킷이고 클라이언트가 보낸 X-Forwarded-For로 버킷을 바꿀 수 없었다. 그래서 스테이징·운영 Railway에 `TRUST_PROXY_HOPS=2`를 두었고, 코드 기본값과 `prod-config-check` 기준도 2로 맞췄다. 확인 방법: `/health` 응답의 `X-RateLimit-Remaining`이 새 연결을 반복해도 1씩 줄고, 위조 X-Forwarded-For를 보내도 이어서 주는지 본다. 이전 기록: 인증 요청 한도(10회/분·120회/분)는 직접 테스트가 없고, API에 `trust proxy`·클라이언트 IP 추적 설정이 없다. Railway 앞단 프록시 주소가 `req.ip`로 잡히면 한도가 모든 손님에게 공유될 수 있다. 집계 기준을 고치는 PR #404(보안 세션)가 이 항목을 소유한다. #404는 `JWT_SECRET`·`JWT_REFRESH_SECRET`이 같으면 API가 기동하지 않으므로 병합 전 운영 Railway 값 확인이 필요했다.

### LEGACY-ORDER-REDELIVERY-GAPS
- [ ] 2026-10-13 #505 조사 중 발견(코드 미변경, 파일럿은 회차 주문만 쓴다). ① `roundId`가 있는 schemaVersion 1 주문을 관리자가 `PREPARING → DELIVERING`으로 재개하면 회차 `heldOrderCount`가 줄지 않는다고 보고됐다(현재 주문 생성 경로로는 이 형태가 생기지 않음, 감사 세션 미검증). ② schemaVersion 1 주문은 `OrderChargesService.createRedeliveryFeeCharge()`가 schemaVersion 2만 받아 고객 책임 유료 보류에서 재배송비를 결제할 경로가 없고 취소만 가능하다(fail closed, `apps/api/src/orders/order-charges.service.ts`). 레거시 주문을 다시 받기 전에 정한다.

### FIRESTORE-INDEX-DRIFT-ORDERS-PREPAREDAT
- [ ] 2026-10-13 운영 설정 점검(run `38407326491`) 인덱스 비교: 운영 composite index 45개, `firestore.indexes.json` 44개. 운영에만 `orders`(COLLECTION) `[status ASC, deliveryMethod ASC, preparedAt ASC]`가 있다(fieldOverrides는 일치). 예전 기사 discovery 쿼리(`orderBy('preparedAt')`)용 잔재로 보이며 현재 `apps/api/src/driver/driver.service.ts`는 `status ==`·`deliveryMethod in`으로 읽고 메모리에서 정렬하므로 쓰지 않는다. 위험이 낮아 LATER: 운영에서 지우거나(운영 변경, 사용자 승인) 그대로 두고 점검의 drift 경고를 감수한다.

### STORAGE-CORS-APPLY
- [ ] #402가 `cors.json`의 허용 메서드를 GET·HEAD로 줄였지만 `firebase deploy`로 반영되지 않고 버킷에 따로 적용해야 한다. 적용 절차 문서와 확인 테스트가 없다. Firebase SDK 업로드는 다른 엔드포인트를 쓰므로 영향이 없을 가능성이 크지만 확인이 필요하다. 적용 여부와 절차를 정해 런북에 적는다. **2026-10-12**: 절차는 `docs/specs/ops/mvp-sales-round-runbook.md` §10에 적었다(적용 전 현재 값 보관 → 적용 → 업로드 확인 → 막히면 되돌리기). 남은 일: 운영 버킷에 적용할지 결정하고 실행(사용자, GCP 권한 필요).

### OPS-TEST-SELLER-ACCOUNTS-LOCKED
- [x] **2026-10-15 잠금 완료, 실제 매장 무관 확인.** 보안 감사(SEC-02 운영 테스트 판매자 계정)에서 같은 테스트 이메일로 운영 판매자 계정이 2개 발견됐다. 사용자 결정: 판매자 앱은 카카오 로그인만 쓰므로 이메일 계정은 폐기한다. `Ops lock account` workflow(`.github/workflows/ops-lock-account.yml`, #527·#531·#533) run `38717140324`·`38739558760`(lock, 둘 다 success)으로 두 계정 모두 비밀번호 해시 무작위 교체·`suspended: true`·세션 폐기·Firebase Auth disabled. check run `38742460503`(main `068d271e`, success) 결과: fingerprint `58c6b2338d`는 테스트 매장 「테스트 꽃 농장」(주문 0·상품 0), `acaa8d90e7`는 테스트 매장 「테스트 상점」(주문 6·상품 2)에 연결돼 있고 두 매장 모두 `ownerId`가 그 계정 본인이며 판매자 사용자는 1명이다. 두 계정 모두 providers=email, 활성 세션 0. 디어 오키드 매장(`stores/80189070-…`)과는 연결되지 않아 실제 매장 영향은 없다. 테스트 계정·매장·주문 기록은 삭제하지 않고 잠금 상태로 둔다(되돌릴 수 없고 실익이 적음). 남은 일(LATER): `scripts/diagnose-test-account.mjs` 등 스크립트에 남은 테스트 이메일 문자열 정리(계정이 잠겨 위험 없음).

### DEAR-ORCHID-STORE-OWNER-LINK
- [x] **2026-10-15 완료(사용자 승인: "연결해주고, 동시에 어드민 계정이기도해").** owner 전용 `Ops link store owner` workflow(`.github/workflows/ops-link-store-owner.yml`, #537). check run `38757362950`: 디어 오키드 매장(`stores/80189070-…`)의 이전 `ownerId` `7ec0e26b-…`는 사용자 문서가 없었고, 이 매장에 연결된 사용자는 카카오 로그인 `admin` 1명(fingerprint `20bad34db8`, uid `6c176cb5…`, `users.storeId`가 이미 이 매장인 겸직 계정)뿐이었다. link run `38757569432`(success, main `1c7d93a7`): `stores.ownerId`를 이 계정으로 바꿨고 `users.storeId`·role은 바꾸지 않았다(재로그인 불필요). audit `store.owner_linked_by_owner_maintenance`(이전 `ownerId` 포함). 이전 기록: 매장 `ownerId`가 삭제된 `seller_test`를 가리켜 판매자 권한 판정(`orders-query`·`orders-lifecycle`·상품·회차·정산·매장·허브·이미지 업로드·`firestore.rules`)과 판매자 알림(`sendToStoreOwner`) 대상이 없었다.

### DEAR-ORCHID-OWNER-PHONE
- [ ] 2026-10-15 발견(보안 세션 check): 디어 오키드 소유자 계정(uid `6c176cb5…`)의 `users.phone`이 비어 있다. 판매자 앱에는 본인 전화번호 입력 화면이 없다(API `PATCH /auth/me`는 `phone`을 받는다). 해결 방식은 사용자에게 묻는 중. **영향 범위(2026-10-15 코드 대조)**: 소유자 `users.phone`을 쓰는 곳은 `NotificationsService.sendToStoreOwner` → `sendToUser`(`resolveRecipientPhone`)뿐이고, 호출처는 legacy 공동구매의 `SELLER_GROUP_CONFIRMED`·`SELLER_GROUP_CANCELLED_LACK` 두 곳이다(`apps/api/src/notifications/notifications.service.ts`). 회차 직접 판매(파일럿 `round_direct`) 흐름에는 판매자 알림톡·문자 호출이 없고(`SELLER_ORDER_BATCH`는 registry에만 있고 호출처 없음), 회차 주문의 기사용 판매자 연락처는 매장 문서 `stores.phone`에서 가져온다(`apps/api/src/orders/round-order-create.service.ts`). 따라서 현재 코드에서 이 빈 값은 파일럿 회차 흐름의 알림을 막지 않는다. 회차 파일럿에서 판매자가 신규 주문 알림을 받아야 하는지는 정해진 계약이 없다(지금은 판매자 앱 주문 화면으로 확인한다). 매장 문서 `stores.phone` 값은 이번에 확인하지 않았다. 필요하면 별도 제품 결정으로 다룬다.

### POT-OPTION-SHEET-PROD-ENABLE
- [x] **2026-10-23 확인: 이미 켜져 있어 변경·재배포하지 않았다.** 사용자 결정: 파일럿 동안 화분을 회차 상품의 옵션으로 판다. 판매자 옵션 입력(`apps/seller/src/app/products/_components/ProductExtrasSection.tsx`)과 소비자 옵션 시트(`apps/consumer/src/app/products/[id]/_components/RoundDirectProductActions.tsx`)가 `option-sheet` 토글 뒤에 있고, API 옵션 가격 계산(`apps/api/src/orders/_lib/round-order-extras.ts`)은 토글과 무관하다. Vercel API 직접 조회: consumer(`greenhubconsumer`)·seller(`greenhub-seller`) Production `NEXT_PUBLIC_GREENHUB_FEATURES`에 `option-sheet`가 있고 마지막 변경은 2026-10-18 13:58~13:59 UTC다. 현재 운영 배포(consumer `dpl_fu7qRhX5wMaZoA24BkJvvV4h9xmU`, seller `dpl_6p7H8f1tBgHb9aEKRk3B8YP6fxgn`, 둘 다 2026-10-23 `951044f2`)는 그 뒤에 빌드됐다. 운영 consumer 페이지 `<meta name="greenhub-features">`에도 `option-sheet`가 있다(seller는 이 meta가 없다). 남은 일: `apps/e2e`에 옵션 시트 E2E가 없다. 옵션 등록(상품당 묶음 3개·선택지 6개, 추가 금액 20만 원 이하)은 코드 변경 없이 판매자 앱에서 한다.

### POT-OPTION-STOCK
2026-10-23 사용자 결정: 화분은 사용자가 직접 출력해 수량을 갱신하는 방식으로 재고를 관리한다. 같은 화분을 여러 식물 상품의 옵션으로 붙이므로 재고는 매장 단위 품목(`optionStocks/{id}`, `OptionStock` in `packages/shared/src/benchmark.types.ts`)에 두고 옵션 선택지가 `stockId`로 가리킨다. 수량은 회차 상품처럼 넣은 수량·결제 중·결제 완료로 센다(남은 수량 = `stockQuantity - reservedQuantity - orderedQuantity`).

- [x] API(2026-10-23): 판매자 재고 품목 목록·추가·수량 조정(`apps/api/src/option-stocks/`, 새로 출력한 개수 더하기 `addQuantity` 또는 실제 남은 개수 맞추기 `remainingQuantity`, 행동 기록 `store.option_stock.*`). 상품 저장 때 같은 매장 품목만 연결. 회차 주문 예약이 옵션 재고를 회차 한도와 같은 트랜잭션에서 잡고(`apps/api/src/orders/order-capacity.service.ts`), 결제 확정·결제 전 만료·취소·환불·늦은 결제 재확보 전이를 회차 품목 카운터와 똑같이 따른다. 부족하면 남은 개수를 알려 주며 거절하고, 늦은 결제는 회차 한도처럼 환불로 간다. 근거: `apps/api/src/orders/option-stock-reservation.flow.spec.ts`, `apps/api/src/option-stocks/option-stocks.spec.ts`.
- [x] 판매자 화면(2026-10-23): 설정 → 옵션 재고(`apps/seller/src/app/settings/option-stocks/`, `option-sheet`가 켜졌을 때 메뉴에 보임)에서 품목 추가·새로 출력한 개수 더하기·실제 남은 개수 맞추기. 상품 등록·수정 옵션 선택지마다 "재고 연결" 칸(`ProductExtrasSection.tsx`). 실제 판매자 로그인 화면에서의 확인은 아직 하지 않았다(단위 테스트·운영 빌드만).
- [x] 소비자 화면(2026-10-23): 옵션 시트를 열 때 공개 조회 `GET /products/:productId/option-availability`(실제 재고 수는 숨기고 99까지만 알림)로 남은 수량을 받아, 품절 선택지는 고를 수 없고 5개 이하면 "N개 남음"을 보이며 남은 수량보다 많이 담지 못하게 한다(`apps/consumer/src/lib/option-availability.ts`, `OptionSheet.tsx`). 로컬 가짜 API + `next dev`로 화면 동작을 확인했다. 최종 판단은 여전히 주문 때 서버가 한다.

### POT-TOPPER-PACKAGE-LABEL
토퍼·라벨 질문에 답할 때 이 항목을 요약해 쓴다. 정한 것과 아직 정하지 않은 것을 함께 둔다.

**시장 관행(2026-10-30 조사, 업체 홍보 글 중심이라 참고용)**: 동양란 축하 선물은 리본 두 줄이 표준이다. 왼쪽 리본은 보내는 분(회사·직책·이름), 오른쪽 리본은 경조사어(`祝 昇進`·`祝 開業`·`祝 榮轉` 등)이고 한 줄 15~20자, 리본 제작은 무료다(코스트코 동양란은 좌우 각 20자). 보내는 분이 빠지면 "누가 보냈는지 모른다"가 대표 불만이다. 화분 꽂이 토퍼·포장 라벨을 쓰는 동양란 판매처는 찾지 못했다.

**사용자 결정(2026-10-30)**
- 문구를 두 칸으로 나눈다. 축하 문구는 자유 입력이 아니라 **미리 출력해 둔 3D 토퍼를 옵션으로 고른다**(상품 옵션 묶음 "축하 토퍼" + 문구별 선택지, "토퍼 없음" 선택지 필요, 선택지마다 옵션 재고 `stockId` 연결). 판매자 앱에서 등록하며 코드 변경이 필요 없다. 묶음당 선택지는 6개까지다.
- 보내는 분 문구는 **포장 라벨**로 받는다. 주문마다 한 장, **무료**, **화분 포장 겉면**에 붙인다. 한 줄 20자까지이며 넘치면 잘라 내지 않고 막는다.
- 선물하기의 보내는 분과 **합친다**. 선물이면 보내는 분 이름이 곧 라벨 문구다(라벨 "넣기" 고정).
- 직접 사는 손님도 있으므로 선물이 아니면 "없음(기본)/문구 넣기"를 고르고, 넣기면 문구 칸이 열린다. 보내는 분 이름이 아니어도 된다. 토퍼를 골라도 라벨은 필수가 아니다.
- 라벨 출력은 주문마다 즉시가 아니라 **회차 마감 뒤 일괄 출력**이다(마감 전에는 손님이 취소할 수 있다).
- 보내는 분을 3D 명판으로 뽑는 방식은 지금 하지 않는다. 주문마다 새 모델·슬라이스가 필요해 "검증된 출력 파일 재출력" 원칙과 맞지 않고, 마감 다음 날 배송이라 실패하면 다시 뽑을 시간이 없다. 팜이 안정되면 회차 마감 뒤 명판을 한 판에 모아 출력하는 유료 고급 옵션으로 다시 검토한다.

- [x] 2026-10-30 코드 반영: 주문 `packageLabel`(`packages/shared` `PACKAGE_LABEL_MAX_LENGTH`, API `resolvePackageLabel`, 결제 화면 `PackageLabelFields`, 판매자 주문 상세 "포장 라벨"). 상품 선택지 `needsText`와 품목별 `optionText`를 없앴다(옛 앱의 `optionText`는 받기만 하고 버린다). 계약: `docs/specs/mvp-sales-round-direct-delivery.md` 포장 라벨 항목. 소비자 화면은 `option-sheet`가 켜졌을 때 보인다.
- [x] **운영 배포 완료**(#705 `834832c5`, 2026-10-30 병합): 2026-11-01 전체 배포 `4f80ce03`(Release `prod-20261101-4f80ce03`, 범위 `all`)에 들어갔다. API·판매자·소비자 앱이 같은 배포로 나가 예전 판매자 앱이 `needsText` 상품 저장에서 400이 되는 공백은 없었다. 2026-11-07 Release 기록과 `git merge-base --is-ancestor`로 확인(직전 배포 `7b22d9ab`에는 없음). 2026-11-07 #817이 적은 "운영 미배포"는 이 배포를 놓친 기록이라 고쳤다.
- [ ] 배포 뒤 남은 확인(운영, 읽기 전용):
  1. 운영 상품 문서에 `needsText` 선택지가 남아 있는지 확인한다. 남아 있으면 그 선택지는 문구 칸 없이 보이고, 예전 앱이 보낸 `optionText`는 버려진다.
  2. 운영 결제 화면의 포장 라벨 칸(없음/문구 넣기, 선물이면 숨김)과 판매자 주문 상세 "포장 라벨"을 직접 본다. 배포 전에는 단위 테스트·빌드로만 확인했다. 카카오페이 심사(`PORTONE-CHANNEL-CHECK`)가 진행 중이므로 결제 화면에 이 칸이 있다는 점을 심사 대응 때 참고한다.
- [ ] 판매자 앱 **회차 라벨 일괄 출력 화면**(라벨 크기 인쇄 화면 + 데이터 CSV 내보내기). 막힘: 라벨 프린터 모델·라벨 크기 미정. 출력은 사무실 미니 PC(FIREBAT F1, Windows 11) 브라우저에서 하는 방식을 권장했다. 미니 PC가 API에서 주문을 자동으로 받아오는 방식은 기계용 인증을 새로 만들어야 해 보류.
- [ ] 미정: 축하 토퍼 문구 목록과 개수(6개 넘는지), 토퍼 가격, 토퍼 재고 품목 등록.
- [ ] 미정: 토퍼에 라벨 붙일 자리를 둘지(토퍼 디자인). 현재 결정은 포장 겉면.
- [ ] 미정: 3D 보내는 분 명판 고급 옵션(A2L 팜 시험 뒤).

### SUPPLIES-ALWAYS-ON-SALES
2026-10-23 사용자 결정: 파일럿(회차 식물 판매) 뒤 화분 자재를 상시 택배로 판다. 예전 상시 판매 흐름(`salesMode=legacy`: 택배·거점·날짜 지정 직배송·공동구매, `docs/discussions/DISCUSS_mvp_sales_focus.md`에서 숨김)을 다시 쓴다. 판매 방식은 매장마다 하나라서(`packages/shared/src/store.types.ts`, `apps/api/src/orders/orders-create.service.ts`의 `round_direct` 분기) 자재는 별도 `legacy` 매장에 두고, **판매자 한 명이 두 매장을 함께 관리**한다(사용자 결정: 별도 판매자 계정 아님). 순서: 2-B·2-F 결정과 택배사 계약 → 2-A·2-C·2-D·2-E → 2-G.

- [ ] 2-A 소비자 앱 다중 매장: 홈·분류 화면은 노출 상품의 매장이 하나일 때만 그 매장의 판매 방식을 쓰고, 둘 이상이면 `storeId=null`로 `legacy` 화면이 된다(`apps/consumer/src/app/category/page.tsx` `findSingleStoreId`, `apps/consumer/src/components/home-store-selection.ts`). 자재 매장 상품을 공개하는 순간 디어 오키드 회차 화면이 무너질 수 있으므로 공개 전에 매장(판매 방식)별 진입·구역을 나눈다. 장바구니·결제도 매장별로 나눈다(`apps/consumer/src/lib/cartValidation.ts`).
- [ ] 2-B 판매자 한 명의 다중 매장: 지금은 계정당 매장 1개다(`users.storeId` 하나, 기존 매장이 있으면 생성 409 `apps/api/src/stores/stores.service.ts`, 토큰 `storeId` 클레임 `apps/api/src/auth/auth.service.ts`, `firestore.rules`·`storage.rules`도 토큰 `storeId`로 판정). 권장안: 판매자 앱 매장 전환. 전환하면 그 매장 `storeId`로 토큰을 다시 발급하고 소유는 `stores.ownerId`로 확인한다. 기존 매장 단위 권한 경계(주문·상품·회차·정산·Rules)를 그대로 둘 수 있다. 대안(한 매장에서 상품별 판매 방식)은 주문 분기·장바구니·화면이 섞여 비권장. 설계 확정 필요.
- [ ] 2-C 자재 상품 분류: `Category`가 `cut_flower`·`orchid`·`foliage`뿐이다(`packages/shared/src/product.types.ts`). 자재 분류, 판매자 등록 화면, 자재용 상품 정보(크기·재질·색)를 추가한다. 상품정보제공고시 원산지 기본값 "국내산(경기도 이천)"(`benchmark.types.ts` `PRODUCT_NOTICE_DEFAULT_ORIGIN`)은 자재에 맞지 않는다.
- [ ] 2-D 택배 발송: 주문에 송장번호·택배사 칸이 없다(`packages/shared/src/order.types.ts`). 송장 입력(판매자), 배송 조회(소비자), 발송 알림이 필요하다. 알림톡 템플릿을 추가하면 ALIGO 심사가 필요하다.
- [ ] 2-E legacy 흐름 재검증: `LEGACY-E2E-WORKFLOW-VARS`를 해결하고 택배 주문 → 결제 → 발송 → 취소·환불을 현재 코드로 확인한다. 자재 매장 택배 배송비(`deliveryFeeConfig/{storeId}`)를 정한다.
- [ ] 2-F 법적 문서. 2026-10-23 공개 `/terms`·`/privacy` 코드 대조 결과 바꿀 곳:
  - 이용약관 제3조(현재 제공 서비스)·제7조가 이천시 회차 직배송만 적는다 → 상시 택배 판매를 범위에 넣는다.
  - 제8조 소비자 취소가 "회차 주문 마감 전" 기준이다 → 상시 주문의 취소 기준(예: 발송 전)을 둔다.
  - 제8조 청약철회는 강행규정을 따른다고만 하고 제한 예시는 신선화훼뿐이다 → 자재의 반품 방법·반품 배송비 부담·반품 주소를 약관과 거래 화면에 둔다(법적 판단은 사람 확인).
  - 제9조는 직배송 보류·재배송만 다룬다 → 택배 배송기간·배송비·분실·파손 처리를 넣는다.
  - 개인정보처리방침 3절은 외부 배송 수행자를 "실제 도입 전에" 제공받는 자·목적·항목·보유기간과 함께 안내한다고 이미 약속했고, 4절 처리위탁 목록에 배송업체가 없다. `docs/specs/legal/README.md`는 존재하지 않는 배송업체를 현재 사실로 적지 않게 한다 → 택배사 계약 뒤에 쓴다.
  - 통신판매업 신고번호(`docs/specs/legal/README.md` `DECISION REQUIRED`)는 전국 택배 상시 판매 전에 결정한다.
  - **막힘(2026-10-23)**: 택배사 계약 없음. 계약 뒤 고지 문구·시행일을 정하고 출시 묶음과 함께 배포한다.
- [ ] 2-G 출시: 자재 매장 생성(`salesMode=legacy`)·상품 등록, 묶음 최종 `main` SHA로 원격 E2E 1회, 운영 배포(사용자 승인).

### ADMIN-ROLE-GRANT-AND-STAFF-PERMISSIONS
- [ ] **2026-10-30 결정: 지금은 만들지 않는다. 첫 직원을 들일 때 다시 연다.** 현재 운영 관리자는 사용자 본인의 카카오 겸직 계정(관리자 + 디어 오키드 매장) 1개뿐이다. 앱 안에서 관리자 권한을 주거나 회수하는 방법이 없다. 회원가입은 `consumer`·`seller`·`driver`만 받고(`apps/api/src/auth/dto/register.dto.ts`), 관리자 "초대" 탭은 판매자 초대 전용이다. 운영 스크립트(`scripts/ops/`)에도 역할을 바꾸는 것이 없다. 남은 수단은 Firestore `users/{uid}.role` 직접 수정뿐이다. 이 경우 바꾼 뒤 재로그인이 필요하고(`JwtStrategy`가 요청마다 현재 role과 토큰 role을 비교), 누가 권한을 줬는지는 audit에 남지 않는다. `docs/specs/api/admin.md`는 이 방식을 현행 정식 절차로 쓰지 않는다고 적지만, 정식 절차는 아직 정의되지 않았다. 직원이 생기면 먼저 맡을 일을 정한다. (가) 전권 관리자가 필요하면 `lock-account.mjs`·`link-store-owner.mjs` 방식(check/apply 분리, audit 기록)의 관리자 권한 부여·회수 운영 스크립트를 만든다. (나) 조회·일부 기능만 필요하면 권한 분리를 설계한다. 지금 서버는 관리자 API 전체를 `@Roles('admin')` 하나로 막고 있으므로(`apps/api/src/admin/admin.controller.ts`) 엔드포인트별 권한으로 바꿔야 한다. 매장 일을 돕는 직원이면 관리자가 아니라 한 매장의 판매자 직원 여러 명 기능이 필요하다(계정당 매장 1개 구조는 `SUPPLIES-ALWAYS-ON-SALES` 2-B 참고).

---

## STALE_OR_SUPERSEDED

- 네이버페이 과거 승인 대기 전제
- 과거 BUG-03 공개 read/Custom Token 가정
- 운영 DB reset/visual cleanup 지시
- 2026-05 Railway outage 상태
- PR #11 OPEN/Draft 표현
- ALIGO 8종 “미등록” 표현
- `main` merge가 auto-production이어야 한다는 전제

## 관리 원칙

1. 완료 이력을 장문 누적하지 않는다.
2. 현재 행동 가능한 미완료만 유지한다.
3. 외부 상태는 직접 재조회 뒤 갱신한다.
4. 체크박스는 production 승인 아님.
5. 우선순위 충돌 시 memory + 활성 HANDOFF/PLAN 우선.
6. repository 변경은 branch+PR.
7. `VERIFIED` 승격은 `docs/DOCUMENT_CONSISTENCY.md` 기준.

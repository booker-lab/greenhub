<!-- Language: ko -->

# REPORT — Settlements / Notifications / Legal / Ops 정합성 감사

> 날짜: 2026-08-24 KST
> 기준 `main`: `d6185bd676d79214ccd4949209162900e4a69bc0`
> 범위: settlements → notifications → legal/ops Spec·Code·Test 삼각 검증
> 판정 기준: `docs/DOCUMENT_CONSISTENCY.md`

## 요약 판정

| 영역 | 판정 | 결과 |
|---|---|---|
| Settlement core lifecycle | `IMPLEMENTED / PARTIALLY VERIFIED` + P0 `COVERAGE GAP` | transaction 구현은 있으나 핵심 상태·동시성 직접 assertion 부족 |
| Admin settlement pay | 기존 P0 유지 | `ADMIN-PRIVILEGED-MUTATION-COVERAGE`가 소유 |
| ALIGO retry/fallback | direct unit/service evidence 존재 | 3회 알림톡 + 1회 SMS, fail-closed, idempotency를 직접 검증 |
| ALIGO actual provider | 외부/운영 미검증 | 8종 심사와 실제 격리 발송은 별도 출시 게이트 |
| Marketing consent lifecycle | P0 `IMPLEMENTATION FINDING` | checkout consent, user preference, withdrawal, retention evidence가 단일 lifecycle로 수렴하지 않음 |
| Legacy group cancellation notice | LATER `IMPLEMENTATION FINDING` | `CANCELLED` 전환 뒤 participant sender가 CANCELLED를 제외해 알림 누락 가능 |
| Legal current facts | L1 문서 불일치 | 마케팅 발송은 미운영이지만 consent UI/storage는 이미 존재 |
| Ops redelivery contract | intended contract 유지 | 기존 `ORDER-REDELIVERY-PAID-RESUME-GATE` 구현 finding이 소유 |

## 1. Settlement core lifecycle

`SettlementsService`는 다음을 구현한다.

- 완료 주문에서 `settlements/{orderId}` 1건 생성
- transaction 안에서 중복 존재 재확인
- `pending` 초기 상태와 fee/net snapshot
- 04:00 KST cron의 due `pending → confirmed`
- confirm transaction fresh-read로 cancelled race 보호
- `cancelSettlement()`의 pending/confirmed → cancelled
- cancelled 멱등 no-op
- paid settlement 역전 방지

그러나 현재 `apps/api/src/settlements`에는 전용 `*.spec.ts`가 없다. 회차 API E2E fixture는 실제 `SettlementsService`를 주입하지만 현재 전체 흐름 테스트에서 settlement 생성·중복·confirm·cancel·paid 보존을 직접 assertion하지 않는다.

따라서 코드 존재를 전체 financial lifecycle의 `VERIFIED`로 확장하지 않는다.

### 판정

새 P0 `SETTLEMENT-LIFECYCLE-COVERAGE`:

- 구현: `IMPLEMENTED`
- 일부 간접 통합 경로: 존재
- 핵심 금전 상태·race 직접 증거: 부족
- 최종: `PARTIALLY VERIFIED + P0 COVERAGE GAP`

`ADMIN-PRIVILEGED-MUTATION-COVERAGE`는 admin `confirmed → paid` authorization/status 경계를 계속 소유하고, 이 P0는 settlement 생성·confirm·cancel의 core lifecycle을 소유한다.

## 2. Notifications delivery

현재 `notifications-delivery.spec.ts`는 다음을 직접 고정한다.

- 알림톡 1회 성공 시 추가 시도 없음
- 실패 시 최대 3회 시도
- 3회 실패 후 동일 본문 SMS 1회 fallback
- credential/template mapping/required variable 오류는 외부 요청 전 fail-closed
- 실제 성공 channel·attempt count 기록
- 주문 배송 연락처 우선 및 허용 fallback
- 최종 실패 `CUSTOMER_NOTICE_FAILED`
- 동일 운영 예외 중복 방지
- 명시적 SMS resend 기록
- notification delivery idempotency key의 단일 발송

따라서 위 isolated delivery contract는 직접 테스트 근거가 있다. 다만 ALIGO provider 승인 상태와 실제 provider 발송 성공은 이 증거로 대체하지 않는다.

## 3. Marketing consent lifecycle

의도된 계약은 선택 마케팅과 주문·결제·배송 정보성 연락을 분리하고, 선택 동의·철회를 감사 가능한 증거로 남기는 것이다.

현재 구현은 다음처럼 분리돼 있다.

### checkout consent

- round checkout은 선택 마케팅 checkbox를 제공한다.
- 동의 시 order request에 `marketingConsent`를 넣는다.
- `RoundOrderCreateService`는 order snapshot에 consent를 저장한다.
- 동시에 `marketingConsentLogs`에 `recordType: CONSENT` retention record를 저장한다.

### user preference

- MY 마케팅 설정은 `users/{userId}.notificationPreferences`의 `alimtalk/sms` pair를 읽는다.
- 철회는 `/notifications/me/preferences`로 해당 bool을 false로 바꾼다.
- Auth 신규 사용자 생성은 이 preference pair를 기본 초기화하지 않는다.
- checkout consent는 user preference를 동기화하지 않는다.

### withdrawal evidence

- 현재 preference 철회는 `users.notificationPreferences`만 갱신한다.
- `MARKETING_CONSENT` retention의 withdrawal record를 생성하지 않는다.
- current round-direct spec은 동의·철회 증거를 `marketingConsentLogs`에 보관한다고 규정한다.

따라서 사용자가 checkout에서 동의한 뒤 MY 설정이 같은 상태를 반드시 보여준다는 보장이 없고, “즉시 철회”가 retention evidence로 남는다는 계약도 충족되지 않는다.

### 판정

새 P0 `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY` = `IMPLEMENTATION FINDING`.

완료 방식은 제품 결정을 허용한다.

1. MVP에서 실제 마케팅 발송을 하지 않을 계획이면 consent 수집/설정 노출을 출시 전 비활성화하거나 제거하고 불필요한 consent 처리를 중단한다.
2. consent 기능을 유지한다면 user-level SSOT, checkout 동기화, 철회 기록, idempotency, 실제 marketing sender gating을 하나의 lifecycle로 구현한다.

어느 선택이든 주문·결제·배송 정보성 연락은 마케팅 opt-out과 별개로 유지한다. 거래 알림을 marketing preference로 차단하는 방식으로 해결하지 않는다.

## 4. Legacy group cancellation notification

`cancelGroupBuyLack()`는 RECRUITING 주문을 환불한 뒤 먼저 `CANCELLED`로 batch update하고, 이후 `sendToGroupParticipants(..., 'GROUP_CANCELLED_LACK')`를 호출한다.

그러나 `sendToGroupParticipants()`는 `PENDING`, `CANCELLED`, `REVIEWED`를 terminal status로 제외한다.

따라서 목표 미달로 방금 취소된 참여자는 consumer `GROUP_CANCELLED_LACK` 대상에서 빠질 수 있다.

이 경로는 `round_direct` 출시의 active notification 8종 경로가 아니라 legacy 공동구매 경로이므로 새 출시 P0로 올리지 않고 `LEGACY-GROUP-CANCEL-NOTIFICATION` LATER implementation finding으로 추적한다.

## 5. Legal current-fact drift

`docs/specs/legal/consumer-legal-documents.md`의 2026-08-19 snapshot은 consumer에 마케팅 수신 동의 기능이 없다고 기록한다.

2026-08-24 현재 코드는:

- round checkout 선택 마케팅 consent UI
- order `marketingConsent`
- `marketingConsentLogs` consent retention
- MY 마케팅 알림 설정 화면
- `users.notificationPreferences`
- 철회 PATCH endpoint

를 가지고 있다.

반면 실제 marketing message sender는 이번 감사에서 확인되지 않았고, 현재 정보성 주문 알림은 marketing consent와 별개다.

따라서 정확한 현재 표현은 **“마케팅 발송은 미운영이지만 선택 동의·설정/저장 기능은 존재하며 lifecycle consistency P0가 남아 있다”**이다.

공개 `/privacy`, `/terms`를 이번 docs-only 감사에서 판매 활성화 문구로 선반영하지 않는다. 최종 public legal 개정은 P0 결과와 ALIGO 실제 검증 후 별도 release gate에서 수행한다.

## 6. Ops runbook

runbook은 고객 책임 유료 재배송에서 `결제 전 재배송 금지`를 명시한다. 이는 intended operational contract로 유지한다.

현재 code가 이 계약을 완전히 강제하지 않는 문제는 기존 `ORDER-REDELIVERY-PAID-RESUME-GATE` P0 implementation finding이 소유한다. runbook을 현재 code에 맞춰 완화하지 않는다.

## 문서 전파

- Settlement contract: `docs/specs/api/settlements.md`
- Notifications contract: `docs/specs/api/notifications.md`
- Legal launch gate/current-fact errata: `docs/specs/legal/README.md`
- Backlog: `docs/BACKLOG.md`
- Current state: `docs/memory.md`
- Execution/resume: active PLAN/HANDOFF

## 범위 경계

이번 감사에서 코드, 테스트, provider, production, Firebase Rules, 운영 데이터, 실제 알림·결제·환불은 변경하지 않았다.

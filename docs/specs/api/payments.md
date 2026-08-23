<!-- Language: ko -->

# Payments API / Domain Spec

> **최종 정합화**: 2026-08-24 KST
> **상태**: Current
> **공통 타입 정본**: `packages/shared/src/payment.types.ts`
> **서버 구현 정본**: `apps/api/src/payments/**`
> **주문 연계**: `docs/specs/api/orders.md`

## 1. 소유권

- 결제 검증·최종화·환불·재배송비 결제는 NestJS API가 소유한다.
- consumer의 PortOne SDK 성공 반환만으로 주문을 확정하지 않는다.
- 본 결제는 주문 ID를 PortOne `paymentId`로 사용한다.
- 재배송비는 본 결제와 분리된 `orderCharges`를 사용한다.
- webhook은 중요한 수렴 경로지만 유일한 수렴 경로가 아니며, 장기 `PENDING` 주문은 scheduler가 PortOne 원격 상태를 재조회한다.

## 2. 서버 비밀 설정

- `PORTONE_V2_SECRET`
- `PORTONE_WEBHOOK_SECRET`

비밀값 원문은 Git·문서·로그에 기록하지 않는다. 실제 결제수단·채널의 외부 상태는 작업 직전에 PortOne에서 재조회한다.

## 3. Webhook 보안 계약

Endpoint:

```text
POST /payments/webhook/portone
```

JWT는 사용하지 않지만 공개 무인증 endpoint가 아니다.

`PaymentsController`는 다음을 요구한다.

```text
raw request body
webhook-id
webhook-timestamp
webhook-signature
```

`PortoneClient.verifyWebhookSignature()`의 현재 구현:

- `PORTONE_WEBHOOK_SECRET` 없으면 fail-closed
- raw body 또는 필수 header 누락 시 fail-closed
- timestamp ±5분 초과 시 거부
- `webhookId.webhookTimestamp.rawBody`에 HMAC SHA-256 적용
- `vN,<base64 signature>` 후보를 timing-safe 비교
- 검증 실패 시 `UnauthorizedException`
- controller는 invalid signature를 audit에 기록

`apps/api/src/main.ts`는 `NestFactory.create(AppModule, { rawBody: true })`를 사용한다.

### 검증 상태 — `IMPLEMENTED / PARTIALLY VERIFIED` + P0 `COVERAGE GAP`

구현과 일부 직접 증거는 존재한다.

- `portone.client.spec.ts`: missing signature, missing secret, stale timestamp 거부
- `mvp-sales-round.e2e-spec.ts`: webhook header 없는 요청 401
- 같은 E2E fixture는 `rawBody: true`로 controller를 실제 HTTP 경계에서 실행

그러나 현재 테스트에서 확인되지 않은 핵심 암호학적 양방향 회귀가 있다.

- 알려진 raw body/id/timestamp/secret으로 만든 **정상 HMAC signature가 실제 `PortoneClient` verifier를 통과**하는 테스트
- 필수 header가 모두 존재하지만 **non-empty 잘못된 HMAC signature가 실제 verifier에서 거부**되는 테스트
- raw body를 1 byte라도 변경하거나 webhook id/timestamp를 바꿨을 때 동일 signature가 거부되는 테스트
- 실제 controller + real verifier 조합에서 invalid signature가 `PaymentsService.handleWebhook()`에 도달하지 않는 통합 테스트

현재 회차 E2E fixture의 `PortoneClient.verifyWebhookSignature`는 mock이므로, `v1,contract-signature` 성공은 cryptographic verification 성공 증거가 아니다.

금융 상태를 변경하는 인증 경계이므로 위 핵심 양방향 증거 전에는 webhook signature contract 전체를 `VERIFIED`로 승격하지 않는다.

추적: `docs/BACKLOG.md`의 `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE`.

## 4. Webhook 이벤트 처리

본 결제의 현재 흐름:

1. `paymentId`가 `order-charge-`이면 재배송비 결제로 분기한다.
2. `Transaction.Ready`는 상태 변경 없이 무시한다.
3. 그 외 non-`Paid` 이벤트는 아직 `PENDING`인 주문에 대해서만 `payment_failed` 취소/release를 적용한다.
4. `Transaction.Paid`이면 webhook body의 금액·상태를 최종값으로 신뢰하지 않고 PortOne `GET /payments/{paymentId}`를 재조회한다.
5. 중복 처리는 주문 상태 검사와 transaction으로 수렴한다.

`cancelPendingOrder()`는 fresh order가 `PENDING`일 때만 적용하므로 이미 확정·완료된 주문을 non-paid webhook으로 역전하지 않는다.

## 5. 본 결제 finalization — P0 구현 finding

`PaymentFinalizationService.finalizePaidOrder()`는 현재 다음을 검사한다.

- 주문 존재/처리 가능 상태
- provider 금액과 주문 금액
- 회차 reservation/capacity

그러나 전달된 `paymentData.status === 'PAID'`를 boundary 자체에서 직접 강제하지 않는다.

현재 caller 방어:

- scheduler는 원격 `PAID`일 때만 finalization 호출
- webhook은 `Transaction.Paid` 이벤트에서 provider 결제를 재조회

하지만 `PENDING` 주문의 webhook 경로에서 재조회 결과의 status를 finalization boundary가 최종 강제하지 않으므로 독립 불변식은 미완료다.

추적: `PAYMENT-FINALIZATION-PAID-GUARD`.

완료 전에는 `finalizePaidOrder()`를 독립적인 PAID 보안 경계로 문서화하지 않는다.

## 6. 금액 검증·정상 확정

```text
PortOne payment.amount.total === orders.totalAmount
```

불일치 시 audit → provider 환불 시도 → 주문 취소/capacity 반환으로 수렴한다.

정상 확정은:

- normal → `ACCEPTED`
- group → `RECRUITING`
- `payments/{orderId}` `PAID` 기록
- 회차 주문 reservation consume
- 법정 retention record
- 고객 알림 요청

을 수행한다.

## 7. `PENDING` timeout·늦은 결제

15분 이상 `PENDING` 주문은 scheduler가 provider를 재조회한다.

| 원격 결과 | 처리 |
|---|---|
| `PAID` | finalization 시도 |
| 명확한 비결제 상태 | timeout 취소 |
| `404 PAYMENT_NOT_FOUND` | timeout 취소 |
| 인증/네트워크/기타 조회 오류 | 상태 추측 없이 `PAYMENT_LOOKUP_FAILED` 운영 이슈 |

회차 timeout 뒤 늦은 실제 결제는 capacity 재확보를 시도하고, 실패하면 provider 전액 환불로 수렴한다.

## 8. 본 결제 환불 — `VERIFIED`

`PaymentRefundService`는 refund claim으로 동시/재시도 중복 provider 환불을 차단한다.

직접 테스트가 다음을 고정한다.

- `PAID` 미환불 결제만 claim
- 동시 호출·완료 후 재시도에서 provider refund 1회
- 성공 뒤 `CANCELLED` + 환불 금액/시각/사유
- provider 실패 시 claim 해제 + `AUTO_REFUND_FAILED`

이 하위 계약이 `VERIFIED`라는 사실은 admin 강제 환불 전체 lifecycle이 안전하다는 뜻이 아니다. 그 문제는 `ADMIN-FORCE-REFUND-CONSISTENCY`가 소유한다.

## 9. 재배송비 charge — 하위 결제 계약 `VERIFIED`

PortOne payment ID:

```text
order-charge-{chargeId}
```

지원 type:

```text
REDELIVERY_FEE
```

`OrderChargePaymentService`는 현재:

- charge 존재·`PENDING`
- `REDELIVERY_FEE`
- stored payment ID 일치
- provider 원격 `PAID`
- 금액 일치
- order의 current `redeliveryChargeId`, storeId, userId 일치

를 확인한다. 환불 멱등성도 직접 회귀가 있다.

그러나 charge 하위 계약 `VERIFIED`를 **결제 전 배송 재개 차단이 보장된다는 의미로 확장하지 않는다.** 재배송 전체 상태머신은 `ORDER-REDELIVERY-PAID-RESUME-GATE`가 소유한다.

## 10. 현재 금융 P0 요약

| 항목 | 판정 |
|---|---|
| webhook signature 구현 | 구현됨 |
| webhook signature 핵심 양방향 회귀 | **P0 COVERAGE GAP** |
| finalization `PAID` boundary | **P0 IMPLEMENTATION FINDING** |
| 본 결제 refund claim 멱등성 | `VERIFIED` |
| 재배송비 charge 결제/환불 | `VERIFIED` |
| 재배송비 payment→resume 상태머신 | 별도 P0 IMPLEMENTATION FINDING |
| admin force-refund 전체 lifecycle | 별도 P0 IMPLEMENTATION FINDING |

## 11. 검증 진입점

- `apps/api/src/main.ts`
- `apps/api/src/payments/payments.controller.ts`
- `apps/api/src/payments/portone.client.ts`
- `apps/api/src/payments/payment-finalization.service.ts`
- `apps/api/src/payments/payment-refund.service.ts`
- `apps/api/src/payments/order-charge-payment.service.ts`
- `apps/api/src/payments/*.spec.ts`
- `apps/api/test/mvp-sales-round*.e2e-spec.ts`
- `apps/api/test/helpers/mvp-sales-round-fixture.ts`
- `docs/specs/api/orders.md`

금융 P0는 구현 존재만으로 완료 처리하지 않고 정상·거부·동시성·실패 경로의 직접 증거를 요구한다.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-24 | webhook signature 구현과 실제 증거를 분리하고 valid/invalid cryptographic path 미검증을 P0 COVERAGE GAP으로 등록 |
| 2026-08-24 | finalization PAID boundary current gap 정합화 |
| 2026-08-23 | PortOne V2·환불·재배송비 현행 계약 정합화 |

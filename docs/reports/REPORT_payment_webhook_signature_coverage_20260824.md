<!-- Language: ko -->

# REPORT — PortOne webhook signature coverage audit

> 날짜: 2026-08-24 KST
> 범위: read-only code/test evidence audit
> 판정 기준: `docs/DOCUMENT_CONSISTENCY.md`

## 판정

- Webhook signature 구현: `IMPLEMENTED`
- 현재 직접 증거: `PARTIALLY VERIFIED`
- 출시 위험 분류: P0 `COVERAGE GAP`
- 구현 결함으로 단정하지 않는다.

## 직접 확인한 구현

- `apps/api/src/main.ts`: Nest `rawBody: true`.
- `PaymentsController`: raw body와 `webhook-id`, `webhook-timestamp`, `webhook-signature`를 요구하고 검증 실패를 audit에 기록한다.
- `PortoneClient.verifyWebhookSignature()`: `PORTONE_WEBHOOK_SECRET`, timestamp 허용창, HMAC SHA-256, timing-safe compare를 사용한다.

## 현재 직접 테스트 증거

- missing signature 거부.
- missing secret 거부.
- stale timestamp 거부.
- HTTP E2E에서 webhook header 없는 요청 401.
- 회차 E2E fixture는 controller webhook 경로를 실행하지만 `verifyWebhookSignature`를 mock한다.

## 미검증 핵심 경로

다음은 금융 상태 변경 인증 경계에 필요한 직접 회귀가 현재 확인되지 않았다.

1. known secret/id/timestamp/raw body로 만든 valid HMAC의 real verifier 성공.
2. 필수 header를 모두 채운 non-empty invalid HMAC 거부.
3. 동일 signature에서 raw body 1 byte 변조 거부.
4. webhook id 변조 거부.
5. signed timestamp 변조 및 허용창 경계 거부/허용.
6. actual controller + real verifier 조합에서 invalid request가 `PaymentsService.handleWebhook()`에 도달하지 않음.
7. invalid request의 주문/payment/orderCharge/capacity side effect 0.
8. 기존 duplicate webhook 멱등 회귀 유지.

## 문서 정합성 결론

`docs/specs/api/payments.md`의 현재 구현 계약 자체는 유지한다. 이 보고서는 구현 계약을 축약하거나 대체하지 않고, 그 구현이 어느 수준까지 직접 검증됐는지에 대한 evidence만 분리한다.

미완료 작업은 `docs/BACKLOG.md`의 `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE`가 소유하며, 현재 출시 상태 요약은 `docs/memory.md`, 실행 순서는 활성 PLAN/HANDOFF가 소유한다.

<!-- Language: ko -->

# Task 2.10 PortOne staging 실제 결제 검증 보고서

## 범위

- 검증일: 2026-07-17 KST
- 브랜치: `codex/mvp-sales-round-direct`
- Railway staging API: deployment `187e2ba9-e589-4dff-bee9-21fff9e17f7c`, health 200
- Vercel branch Preview: deployment `dpl_8cyvKwafAaUbytqndvtJL2vKP2Tm`
- Firebase: `green-staging-74557`
- PortOne: V2 테스트 채널, 카카오페이, 건당 100원
- 운영 Railway·Vercel Production·Firebase·PortOne·Kakao 설정은 변경하지 않았다.

## 코드 보정

| 커밋 | 내용 |
| :--- | :--- |
| `1aa56c3` | `404 PAYMENT_NOT_FOUND`에서만 timeout 주문을 취소하고 주문별 scheduler 오류를 격리 |
| `eb73250` | 결제 주문에 필수 배송 연락처 전달 |
| `d9edf6e` | 늦은 결제 자동 환불을 로컬 결제 문서에 기록하고 V2 취소 웹훅 `cancellationId` 허용 |

## 게이트 결과

### 1. 정상 100원 PAID와 금액 일치

- 주문·PortOne payment ID: `6e9a1e92-5f1f-49fa-8469-df3af7fb6a36`
- 주문번호: `20260717-000001`
- PortOne: `PAID`, 100원
- Firestore: 주문 `ACCEPTED`, 결제 `PAID`, 100원, PortOne 거래 ID 존재
- legacy 배송 한도: `usedSlots` 0 → 1

### 2. 중복 PAID 웹훅

- PortOne 공식 `resend-webhook` API로 동일 `PAID` 웹훅을 재발송했다.
- 응답: HTTP 200, `SUCCEEDED`, `MANUAL`
- 재발송 후 주문 `ACCEPTED`, 결제 문서 1건, 배송 한도 1, 환불 0건을 유지했다.

### 3. timeout 후 예약 재확보 성공

- 주문·PortOne payment ID: `c1e7e41f-dad5-42e7-ba66-ac4a390f2f27`
- 주문번호: `20260717-000002`
- 초기 예약: `dd2930edae5047a2cd59bcae139c4425`, `EXPIRED`
- timeout 결과: 주문 `CANCELLED`, `cancelReason=timeout`, 예약·상품 예약 수량 0
- 늦은 100원 결제 후 새 예약 `36df3106b05a15f8cfdb88d6719a2f7b`가 `CONSUMED`
- 최종 주문 `ACCEPTED`, 회차 확정 주소·수량 각 1, 상품 `orderedQuantity=1`, 환불 없음

### 4. 예약 재확보 실패와 전액 환불

- 최종 검증 주문·PortOne payment ID: `37e66aba-c702-49aa-80bf-6c688ac031bc`
- 주문번호: `20260717-000004`
- 초기 예약: `6837823cfe9ccf334e43a2dab8a87bbc`, `EXPIRED`
- staging fixture 한도를 기존 확정 수량 1로 잠시 고정해 재확보 실패를 만들었다.
- PortOne: `CANCELLED`, 결제 100원, 취소액 100원, 취소 요청 정확히 1건
- Firestore: 주문 `CANCELLED/timeout`, `latePaymentRefundedAt` 존재
- Firestore 결제: 문서 1건, `CANCELLED`, 결제액 100원, 환불액 100원, 거래 ID 존재
- 회차 예약·상품 예약 수량은 0이며 기존 확정 수량 1은 변하지 않았다.
- 테스트 후 회차 한도와 상품 판매 한도를 원래 값 10으로 복원했다.

### 5. 취소 웹훅과 최종 멱등성

- 최초 실측에서 V2 취소 웹훅의 `data.cancellationId`가 DTO에서 차단돼 HTTP 400을 발견했다.
- `d9edf6e` 배포 후 기존 취소 웹훅 재발송이 HTTP 200으로 통과했다.
- 최종 주문의 `READY`, `PAID`, `CANCELLED` 웹훅은 모두 `SUCCEEDED`, 응답 200이다.
- 최종 상태에서 `PAID`와 `CANCELLED` 웹훅을 각각 다시 재발송했다.
- 재발송 후에도 PortOne 취소 1건, 결제 문서 1건, 환불액 100원, 회차 확정 수량 1을 유지했다.
- scheduler timeout 처리와 후속 PAID 웹훅의 경계 순서를 두 성공·실패 시나리오에서 실측했고, 최종 상태 재처리로 수량·환불 중복이 발생하지 않았다.

## 자동 검증

- `pnpm --filter api test -- portone.client.spec.ts payments.service.spec.ts mvp-order-flow.spec.ts portone-webhook.dto.spec.ts --runInBand`
  - 4개 스위트, 31개 테스트 통과
- `pnpm --filter api build` 통과
- 변경 파일 Biome 오류 수준 검사 통과
- `git diff --check` 통과
- 변경·커밋·문서에 Secret, 토큰, Authorization 헤더, 서비스 계정 JSON을 기록하지 않았다.

## 판정

- Task 2.10: `done`
- Task 2.11: `todo`, 미착수

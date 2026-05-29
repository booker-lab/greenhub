# 어드민 주문 세션β — 취소 경로 전수 조사 (#CL-55)

> 출처: `admin-tab-orders-plan.md` T3.
> 목적: 어드민 강제환불 T2에서 정한 두 단계 정책이 다른 `CANCELLED` 전환 경로에도 필요한지 확인한다.

## 1. 조사 명령

아래 명령으로 API, 셀러, 소비자, 드라이버, shared 모델의 `CANCELLED` 전환과 환불 호출 지점을 확인했다.

```powershell
rg -n "CANCELLED|cancel|Cancel|refund|forceRefund|status\s*[:=].*CANCELLED" apps packages docs\specs -g "*.ts" -g "*.tsx" -g "*.md"
rg -n "refundOrder\(|processRefundByOrderId\(|cancelOrderWithSlotRecovery\(|cancelGroupBuyLack\(|forceRefund\(" apps\api\src -g "*.ts"
rg -n "CANCELLED|cancel|handleCancel|/cancel|updateStatus\('CANCELLED'" apps\seller\src apps\consumer\src apps\driver\src packages\shared\src -g "*.ts" -g "*.tsx"
```

## 2. 전환 경로 표

| # | 경로 | 트리거 | 현재 허용 상태 | 사유 정책 | 환불·정산 부작용 | 필요 가드 |
|---|------|--------|----------------|-----------|------------------|-----------|
| 1 | `AdminService.forceRefund()` | `POST /admin/orders/:orderId/refund` | `CANCELLED` 제외 전체. T2 이후 위험 단계는 사유 5자 이상 필요 | 일반 단계는 빈 사유 허용, 위험 단계는 5자 이상 필수 | `processRefundByOrderId()` 후 주문 `CANCELLED` | 완료. 세션α T2 대상 |
| 2 | `OrdersLifecycleService.updateStatus()` | 셀러·어드민 `PATCH /stores/:storeId/orders/:orderId/status { status: 'CANCELLED' }` | 셀러·어드민 모두 `ACCEPTED`, `CONFIRMED`, `PREPARING`만 허용 | 프론트 셀러 모달은 5자 이상 요구. 백엔드는 빈 사유면 `판매자 취소`로 환불 사유 대체 | 환불 가능 상태면 `processRefundByOrderId()`, 항상 `cancelSettlement()` | 추가 없음. 위험 단계는 FSM에서 이미 차단 |
| 3 | `OrdersLifecycleService.cancelOrder()` | 소비자 `PATCH /stores/:storeId/orders/:orderId/cancel` | 본인 주문 + `RECRUITING`만 허용 | 사유 없으면 `소비자 취소` | `processRefundByOrderId()`, 공동구매 수량 차감, `cancelSettlement()`, `GROUP_CANCELLED_SELF` 알림 | 추가 없음. 위험 단계 진입 불가 |
| 4 | `PaymentsService.handleWebhook()` | Portone 웹훅 `Transaction.Paid` 외 실패 | `PENDING` 주문만 처리 | `payment_failed` 고정 | `cancelOrderWithSlotRecovery()`로 주문 `CANCELLED`, 슬롯 복구 | 추가 없음. 결제 전 실패 보정 경로 |
| 5 | `PaymentsService.handleWebhook()` | 결제 금액 위변조 감지 | `PENDING` 주문만 처리 | `amount_mismatch` 고정 | Portone 환불 후 `cancelOrderWithSlotRecovery()` | 추가 없음. 결제 검증 실패 보정 경로 |
| 6 | `PaymentsService.cleanupPendingOrders()` | 15분 초과 `PENDING` 주문 cron | `PENDING`만 조회 | `timeout` 고정 | `cancelOrderWithSlotRecovery()`로 주문 `CANCELLED`, 슬롯 복구 | 추가 없음. 결제 미완료 만료 경로 |
| 7 | `NotificationsService.cancelGroupBuyLack()` | 공동구매 마감 시 최소 수량 미달 | `RECRUITING` 주문만 조회 | `목표 수량 미달성으로 취소` 고정 | 참여 주문 전액 환불, 배치 `CANCELLED`, 소비자·판매자 알림 | 추가 없음. 위험 단계 진입 불가 |

## 3. 프론트 진입점 확인

| 앱 | 화면 | 진입점 | 현재 제한 |
|----|------|--------|-----------|
| 셀러 | `apps/seller/src/app/orders/[id]/page.tsx` | `강제 취소` 버튼 → `updateStatus('CANCELLED')` | `CANCELLABLE_STATUSES = ACCEPTED, CONFIRMED, PREPARING`일 때만 버튼 노출 |
| 셀러 | `apps/seller/src/app/orders/[id]/_components/CancelOrderModal.tsx` | 취소 사유 입력 | 사유 5자 미만이면 확인 비활성화 |
| 소비자 | `apps/consumer/src/app/mypage/orders/[id]/_client.tsx` | `공동구매 참여 취소` 버튼 → `/cancel` | `RECRUITING`일 때만 버튼 노출 |
| 어드민 | `apps/seller/src/app/admin/orders/_client.tsx` | 강제환불 버튼 → `/admin/orders/:id/refund` | 세션α 기준 기존 버튼 범위는 일반 단계 4종. 위험 단계는 직접 호출만 백엔드에서 허용하되 사유 필수 |

## 4. 결론

**가드 보강 경로는 0개다.** 어드민 강제환불만 위험 단계 주문을 의도적으로 처리하는 예외 경로이고, 나머지 사용자 취소 경로는 `RECRUITING` 또는 `ACCEPTED`·`CONFIRMED`·`PREPARING`에서만 `CANCELLED`로 전환된다.

**세션β 커밋 4는 생략 가능하다.** 새 단위테스트를 추가할 가드 변경이 없으며, 다음 구현 진입점은 세션γ의 필터·새로고침 UX다.

## 5. 후속 검증 관찰점

- 셀러 주문 상세에서 위험 단계(`DELIVERING`, `HUB_ARRIVED`, `PICKED_UP`, `DELIVERED`, `REVIEWED`)는 읽기 전용 안내만 보이고 `강제 취소` 버튼이 보이지 않아야 한다.
- 소비자 주문 상세에서 `RECRUITING` 이외 상태는 `공동구매 참여 취소` 버튼이 보이지 않아야 한다.
- 결제 실패·타임아웃·공동구매 미달 자동 취소 주문은 소비자 주문 상세와 셀러 주문 상세에서 `CANCELLED` 상태와 취소 사유가 표시되어야 한다.

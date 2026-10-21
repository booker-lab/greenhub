import { OrderNoticeDispatcher } from '../../src/orders/order-notice-dispatcher';
import { OrdersLifecycleService } from '../../src/orders/orders-lifecycle.service';

/**
 * 상태 전이 고객 알림은 응답 뒤에 보내므로(OrderNoticeDispatcher), 알림을 단언하는 스펙은 명령이
 * 끝난 뒤 알림 처리까지 끝났는지 기다려야 한다. 이 헬퍼로 만든 서비스는 updateStatus·
 * reconcileDeliveryCompletion이 성공·실패 어느 쪽으로 끝나도 맡긴 알림을 모두 처리한 뒤 돌아온다.
 * "알림을 보내지 않았다"는 단언이 아직 실행 전인 알림 때문에 거짓으로 통과하지 않게 한다.
 */
export function createSettledOrdersLifecycle(
  ...args: ConstructorParameters<typeof OrdersLifecycleService>
): OrdersLifecycleService {
  const [firestore, notifications, payments, settlements, capacity, roundLifecycle, driverScope] =
    args;
  const notices = args[7] ?? new OrderNoticeDispatcher();
  const lifecycle = new OrdersLifecycleService(
    firestore,
    notifications,
    payments,
    settlements,
    capacity,
    roundLifecycle,
    driverScope,
    notices,
  );
  for (const method of ['updateStatus', 'reconcileDeliveryCompletion'] as const) {
    const original = lifecycle[method].bind(lifecycle) as (...input: unknown[]) => Promise<unknown>;
    (lifecycle as unknown as Record<string, unknown>)[method] = async (...input: unknown[]) => {
      try {
        return await original(...input);
      } finally {
        await notices.drain();
      }
    };
  }
  return lifecycle;
}

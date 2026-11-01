'use client';

import type { Order } from '@greenhub/shared';
import type { GroupHeaderMeta } from '../_constants';
import { OrderCard } from './OrderCard';

// ① 외형 유지(UI 교체 P4): Mantine Stack(gap sm = 12px)·Text(p, 여백 0, 줄 높이 1.55)와 같은 값.
const TEXT = 'm-0 p-0 text-base';

export function DateSection({ meta, orders }: { meta: GroupHeaderMeta; orders: Order[] }) {
  const danger = meta.urgency === 'overdue' || meta.urgency === 'today';

  return (
    <div className="flex flex-col gap-3">
      <div
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          backgroundColor: danger ? 'var(--color-danger-surface)' : 'transparent',
        }}
      >
        <p
          className={TEXT}
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: danger ? 'var(--color-danger)' : 'var(--color-text-disabled)',
          }}
        >
          {meta.label} · {orders.length}건
        </p>
      </div>

      {orders.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}

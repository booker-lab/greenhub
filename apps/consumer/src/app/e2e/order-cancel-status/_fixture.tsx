'use client';

import { SessionProvider } from 'next-auth/react';
import OrderDetailPage from '../../mypage/orders/[id]/_client';

const FIXTURE_SESSION = {
  user: {
    id: 'e2e-consumer',
    role: 'consumer',
    accessToken: 'e2e-consumer-access-token',
    refreshToken: 'e2e-consumer-refresh-token',
  },
  expires: '2099-12-31T23:59:59.999Z',
};

export function OrderCancelStatusFixture() {
  return (
    <SessionProvider session={FIXTURE_SESSION}>
      <OrderDetailPage params={Promise.resolve({ id: 'e2e-consumer-cancel-status' })} />
    </SessionProvider>
  );
}

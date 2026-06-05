import { notFound } from 'next/navigation';
import { OrderCancelStatusFixture } from './_fixture';

export default function OrderCancelStatusFixturePage() {
  if (process.env.ENABLE_E2E_FIXTURES !== 'true') notFound();

  return <OrderCancelStatusFixture />;
}

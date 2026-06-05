import { notFound } from 'next/navigation';
import { OrderPriorityAlertFixture } from './_fixture';

export default function OrderPriorityAlertFixturePage() {
  if (process.env.ENABLE_E2E_FIXTURES !== 'true') notFound();

  return <OrderPriorityAlertFixture />;
}

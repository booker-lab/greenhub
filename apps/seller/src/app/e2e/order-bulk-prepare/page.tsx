import { notFound } from 'next/navigation';
import { OrderBulkPrepareFixture } from './_fixture';

export default function OrderBulkPrepareFixturePage() {
  if (process.env.ENABLE_E2E_FIXTURES !== 'true') notFound();

  return <OrderBulkPrepareFixture />;
}

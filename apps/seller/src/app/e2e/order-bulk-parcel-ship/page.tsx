import { notFound } from 'next/navigation';
import { OrderBulkParcelShipFixture } from './_fixture';

export default function OrderBulkParcelShipFixturePage() {
  if (process.env.ENABLE_E2E_FIXTURES !== 'true') notFound();

  return <OrderBulkParcelShipFixture />;
}

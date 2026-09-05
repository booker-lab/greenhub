export type GenericPreviewFixture = {
  runId: string
  namespace: string
  storeId: string
  normalProductId: string
  groupProductId: string
  normalOrderId: string
  groupOrderId: string
  parcelOrderId: string
}

export function genericPreviewFixture(): GenericPreviewFixture {
  const runId = process.env['ROUND_DIRECT_E2E_RUN_ID']?.trim()
  if (!runId) {
    return {
      runId: 'legacy-shared',
      namespace: 'e2e',
      storeId: '9b2cb652-ff77-46b9-a773-e1efa78fb763',
      normalProductId: 'e2e-normal-product-001',
      groupProductId: 'e2e-group-product-001',
      normalOrderId: 'e2e-normal-order-001',
      groupOrderId: 'e2e-group-order-001',
      parcelOrderId: 'e2e-parcel-order-001',
    }
  }
  const namespace = `preview-e2e-${runId}-generic`
  return {
    runId,
    namespace,
    storeId: `${namespace}-store`,
    normalProductId: `${namespace}-normal-product`,
    groupProductId: `${namespace}-group-product`,
    normalOrderId: `${namespace}-normal-order`,
    groupOrderId: `${namespace}-group-order`,
    parcelOrderId: `${namespace}-parcel-order`,
  }
}

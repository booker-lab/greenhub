export function resolveHomeStoreId(
  products: Array<{ storeId: string }>,
  requestedStoreId?: string | null,
) {
  if (requestedStoreId && products.some((product) => product.storeId === requestedStoreId)) {
    return requestedStoreId;
  }
  const storeIds = new Set(
    products.map((product) => product.storeId).filter((storeId) => storeId.length > 0),
  );
  return storeIds.size === 1 ? [...storeIds][0] : null;
}

export const API_BASE_URL = (__ENV.K6_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const PROFILE = __ENV.K6_PROFILE || 'smoke';
export const ENABLE_WRITES = __ENV.K6_ENABLE_WRITES === 'true';

export function targetIds() {
  return {
    storeId: __ENV.K6_STORE_ID || 'replace-store-id',
    productId: __ENV.K6_PRODUCT_ID || 'replace-product-id',
    orderId: __ENV.K6_ORDER_ID || 'replace-order-id',
  };
}

export function credentials(role) {
  const prefix = `K6_${role.toUpperCase()}`;
  return {
    email: __ENV[`${prefix}_EMAIL`],
    password: __ENV[`${prefix}_PASSWORD`],
  };
}

export function hasCredentials(role) {
  const account = credentials(role);
  return Boolean(account.email && account.password);
}

export function authHeaders(token, extra = {}) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...extra,
  };
}

export function jsonHeaders(extra = {}) {
  return {
    headers: {
      'Content-Type': 'application/json',
    },
    ...extra,
  };
}

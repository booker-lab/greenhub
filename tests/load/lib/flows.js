import { check, group } from 'k6';
import http from 'k6/http';
import {
  API_BASE_URL,
  ENABLE_WRITES,
  authHeaders,
  targetIds,
} from './env.js';

function tagged(flow) {
  return { tags: { flow } };
}

export function publicReadFlow() {
  const ids = targetIds();

  group('public read', () => {
    check(http.get(`${API_BASE_URL}/banner`, tagged('public_read')), {
      'public banner ok': (r) => r.status === 200,
    });
    check(http.get(`${API_BASE_URL}/products`, tagged('public_read')), {
      'public products ok': (r) => r.status === 200,
    });
    check(http.get(`${API_BASE_URL}/products/${ids.productId}`, tagged('public_read')), {
      'public product detail ok': (r) => r.status === 200,
    });
    check(http.get(`${API_BASE_URL}/stores/${ids.storeId}/products`, tagged('public_read')), {
      'store products ok': (r) => r.status === 200,
    });
  });
}

export function checkoutReadFlow(token) {
  const ids = targetIds();

  group('checkout', () => {
    check(http.get(`${API_BASE_URL}/products/${ids.productId}`, tagged('checkout')), {
      'checkout product ok': (r) => r.status === 200,
    });
    check(http.get(`${API_BASE_URL}/stores/${ids.storeId}/delivery-config`, tagged('checkout')), {
      'checkout delivery config ok': (r) => r.status === 200,
    });

    if (ENABLE_WRITES && token) {
      const payload = {
        productId: ids.productId,
        quantity: 1,
        saleType: 'normal',
        deliveryMethod: 'direct',
        deliveryAddress: {
          address: 'load-test-address',
          addressDetail: '101',
          zipCode: '00000',
        },
        requestedDeliveryDate: '2026-07-10',
      };

      const response = http.post(
        `${API_BASE_URL}/stores/${ids.storeId}/orders`,
        JSON.stringify(payload),
        authHeaders(token, { tags: { flow: 'checkout_write' } }),
      );
      check(response, {
        'checkout order create ok': (r) => r.status === 201 || r.status === 200,
      });
    }
  });
}

export function sellerOpsFlow(token) {
  if (!token) {
    return;
  }

  const ids = targetIds();
  const params = authHeaders(token, { tags: { flow: 'seller_ops' } });

  group('seller ops', () => {
    check(http.get(`${API_BASE_URL}/stores/${ids.storeId}/orders`, params), {
      'seller orders ok': (r) => r.status === 200 || r.status === 403 || r.status === 404,
    });
    check(http.get(`${API_BASE_URL}/stores/${ids.storeId}/orders/${ids.orderId}`, params), {
      'seller order detail ok': (r) => r.status === 200 || r.status === 403 || r.status === 404,
    });
  });
}

export function adminOpsFlow(token) {
  if (!token) {
    return;
  }

  const params = authHeaders(token, { tags: { flow: 'admin_ops' } });

  group('admin ops', () => {
    check(http.get(`${API_BASE_URL}/admin/orders`, params), {
      'admin orders ok': (r) => r.status === 200 || r.status === 403,
    });
    check(http.get(`${API_BASE_URL}/admin/settlements`, params), {
      'admin settlements ok': (r) => r.status === 200 || r.status === 403,
    });
    check(http.get(`${API_BASE_URL}/admin/stores`, params), {
      'admin stores ok': (r) => r.status === 200 || r.status === 403,
    });
    check(http.get(`${API_BASE_URL}/admin/users`, params), {
      'admin users ok': (r) => r.status === 200 || r.status === 403,
    });
  });
}

export function driverOpsFlow(token) {
  if (!token) {
    return;
  }

  const response = http.get(
    `${API_BASE_URL}/driver/orders?status=PREPARING,DELIVERING`,
    authHeaders(token, { tags: { flow: 'driver_ops' } }),
  );
  check(response, {
    'driver orders ok': (r) => r.status === 200 || r.status === 403,
  });
}

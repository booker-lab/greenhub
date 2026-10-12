import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedBuckets, evaluate, isOwnStorageUrl, summarize } from './pre-deploy-check.mjs';

const buckets = allowedBuckets('green-e4fe3');
const own =
  'https://firebasestorage.googleapis.com/v0/b/green-e4fe3.appspot.com/o/products%2Fs1%2Fa.jpg?alt=media';

test('자사 bucket 다운로드·GCS URL만 자사 이미지로 본다', () => {
  assert.equal(isOwnStorageUrl(own, buckets), true);
  assert.equal(
    isOwnStorageUrl(
      'https://storage.googleapis.com/green-e4fe3.firebasestorage.app/products/s1/a.jpg',
      buckets,
    ),
    true,
  );
  assert.equal(
    isOwnStorageUrl('https://firebasestorage.googleapis.com/v0/b/other.appspot.com/o/x', buckets),
    false,
  );
  assert.equal(isOwnStorageUrl('https://cdn.example.com/a.jpg', buckets), false);
  assert.equal(
    isOwnStorageUrl(
      'http://firebasestorage.googleapis.com/v0/b/green-e4fe3.appspot.com/o/x',
      buckets,
    ),
    false,
  );
  assert.equal(isOwnStorageUrl(42, buckets), false);
});

test('정상 데이터는 모든 점검을 통과한다', () => {
  const result = summarize(
    evaluate(
      {
        orders: [
          { id: 'o1', data: { status: 'CANCELLED', cancellation: { status: 'COMPLETED' } } },
          { id: 'o2', data: { deliveryHold: { redeliveryFee: 3000 } } },
          { id: 'o3', data: { deliveryHold: { redeliveryFee: null } } },
        ],
        stores: [{ id: 's1', data: { ownerId: 'u1' } }],
        users: [{ id: 'u1', data: { role: 'seller', storeId: 's1' } }],
        products: [
          { id: 'p1', data: { images: [own] } },
          { id: 'p2', data: {} },
        ],
      },
      { buckets },
    ),
  );
  assert.equal(result.ok, true);
  assert.ok(result.checks.every((check) => check.count === 0));
});

test('각 위험 데이터를 해당 점검에 문서 ID로 잡는다', () => {
  const findings = evaluate(
    {
      orders: [
        { id: 'cancelling', data: { cancellation: { status: 'REFUND_FAILED' } } },
        { id: 'fee-big', data: { deliveryHold: { redeliveryFee: 50_001 } } },
        { id: 'fee-frac', data: { deliveryHold: { redeliveryFee: 3000.5 } } },
        { id: 'fee-negative', data: { deliveryHold: { redeliveryFee: -1 } } },
      ],
      stores: [
        { id: 's1', data: { ownerId: 'admin-1' } },
        { id: 's2', data: { ownerId: 'u2' } },
        { id: 's3', data: { ownerId: 'u2' } },
        { id: 's4', data: {} },
      ],
      users: [
        { id: 'admin-1', data: { role: 'admin' } },
        { id: 'u2', data: { role: 'seller', storeId: 's2' } },
        { id: 'u3', data: { role: 'seller', storeId: 's1' } },
      ],
      products: [{ id: 'p-ext', data: { images: [own, 'https://cdn.example.com/a.jpg'] } }],
    },
    { buckets },
  );
  assert.deepEqual(findings.cancellationInProgress, ['cancelling']);
  assert.deepEqual(findings.invalidRedeliveryFee, ['fee-big', 'fee-frac', 'fee-negative']);
  assert.deepEqual(findings.storeOwnerNotSeller, ['s1', 's4']);
  assert.deepEqual(findings.ownerWithMultipleStores, ['u2']);
  assert.deepEqual(findings.sellerStoreOwnerMismatch, ['u3']);
  assert.deepEqual(findings.productImageNotOwnBucket, ['p-ext']);
  assert.equal(summarize(findings).ok, false);
});

test('요약은 걸린 ID를 20개까지만 싣는다', () => {
  const ids = Array.from({ length: 25 }, (_, index) => `o${index}`);
  const result = summarize({ cancellationInProgress: ids });
  assert.equal(result.checks[0].count, 25);
  assert.equal(result.checks[0].ids.length, 20);
});

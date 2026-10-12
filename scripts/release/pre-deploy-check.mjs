#!/usr/bin/env node
/**
 * 배포 전 데이터 점검(읽기 전용). 2026-10 배포 묶음(#402·#406·#409·#413·#414)이 새로 거부하거나
 * 다르게 다루는 운영 데이터가 있는지 한 번에 센다. 하나라도 걸리면 배포 전에 사람이 정리한다.
 *
 *   FIREBASE_SERVICE_ACCOUNT_JSON='…' node scripts/release/pre-deploy-check.mjs
 *   node scripts/release/pre-deploy-check.mjs              # apps/api/firebase-adminsdk.json 사용
 *   node scripts/release/pre-deploy-check.mjs --bucket=green-e4fe3.appspot.com
 *
 * Firestore 읽기(get)만 한다. 이름·전화·주소는 출력하지 않고 문서 ID와 건수만 낸다.
 * 하나라도 걸리면 exit 1.
 */
import { fileURLToPath } from 'node:url';

export const CANCELLATION_IN_PROGRESS_STATUSES = [
  'REFUNDING',
  'LOCAL_PENDING',
  'LOCAL_FAILED',
  'REFUND_FAILED',
];
export const MAX_REDELIVERY_FEE_KRW = 50_000;

/** 프로젝트 기본 bucket 두 이름과 지정 bucket. API `resolveAllowedImageBuckets`와 같은 규칙. */
export function allowedBuckets(projectId, extraBucket) {
  const buckets = new Set();
  if (projectId) {
    buckets.add(`${projectId}.appspot.com`);
    buckets.add(`${projectId}.firebasestorage.app`);
  }
  if (extraBucket) buckets.add(extraBucket);
  return buckets;
}

/** 자사 bucket의 Firebase 다운로드 URL 또는 GCS 공개 URL인지. */
export function isOwnStorageUrl(value, buckets) {
  if (typeof value !== 'string') return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const segments = url.pathname.split('/');
  if (url.host === 'firebasestorage.googleapis.com') {
    return segments.length === 6 && segments[1] === 'v0' && buckets.has(segments[3]);
  }
  if (url.host === 'storage.googleapis.com') {
    return segments.length >= 3 && buckets.has(segments[1]);
  }
  return false;
}

/**
 * 순수 판정. 입력은 `{ id, data }` 배열들이고 결과는 점검별 걸린 문서 ID 목록이다.
 */
export function evaluate({ orders, stores, users, products }, { buckets }) {
  const usersById = new Map(users.map((user) => [user.id, user.data]));
  const storesById = new Map(stores.map((store) => [store.id, store.data]));

  const cancellationInProgress = orders
    .filter((order) => CANCELLATION_IN_PROGRESS_STATUSES.includes(order.data?.cancellation?.status))
    .map((order) => order.id);

  const invalidRedeliveryFee = orders
    .filter((order) => {
      const fee = order.data?.deliveryHold?.redeliveryFee;
      if (fee === null || fee === undefined) return false;
      return !Number.isInteger(fee) || fee < 0 || fee > MAX_REDELIVERY_FEE_KRW;
    })
    .map((order) => order.id);

  const storeOwnerNotSeller = stores
    .filter((store) => usersById.get(store.data?.ownerId)?.role !== 'seller')
    .map((store) => store.id);

  const storesByOwner = new Map();
  for (const store of stores) {
    const owner = store.data?.ownerId;
    if (!owner) continue;
    storesByOwner.set(owner, [...(storesByOwner.get(owner) ?? []), store.id]);
  }
  const ownerWithMultipleStores = [...storesByOwner.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([owner]) => owner);

  const sellerStoreOwnerMismatch = users
    .filter((user) => user.data?.role === 'seller' && user.data?.storeId)
    .filter((user) => storesById.get(user.data.storeId)?.ownerId !== user.id)
    .map((user) => user.id);

  const productImageNotOwnBucket = products
    .filter((product) => {
      const images = Array.isArray(product.data?.images) ? product.data.images : [];
      return images.some((image) => !isOwnStorageUrl(image, buckets));
    })
    .map((product) => product.id);

  return {
    cancellationInProgress,
    invalidRedeliveryFee,
    storeOwnerNotSeller,
    ownerWithMultipleStores,
    sellerStoreOwnerMismatch,
    productImageNotOwnBucket,
  };
}

export const CHECK_LABELS = Object.freeze({
  cancellationInProgress: '취소가 진행 중인 주문(cancellation.status 진행 상태)',
  invalidRedeliveryFee: `재배송비가 정수가 아니거나 0~${MAX_REDELIVERY_FEE_KRW}원 밖인 보류 주문`,
  storeOwnerNotSeller: '소유자가 판매자 계정이 아닌 매장',
  ownerWithMultipleStores: '매장을 2개 이상 가진 계정',
  sellerStoreOwnerMismatch:
    '판매자 계정의 storeId 매장 ownerId가 본인이 아님(상품 이미지 업로드 막힘)',
  productImageNotOwnBucket: '자사 Storage bucket이 아닌 이미지를 가진 상품',
});

export function summarize(findings) {
  const checks = Object.entries(findings).map(([key, ids]) => ({
    key,
    label: CHECK_LABELS[key] ?? key,
    count: ids.length,
    ok: ids.length === 0,
    ids: ids.slice(0, 20),
  }));
  return { ok: checks.every((check) => check.ok), checks };
}

async function loadFirestore() {
  const [{ initializeApp, cert }, { getFirestore }, { createRequire }, { dirname, join }] =
    await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
      import('node:module'),
      import('node:path'),
    ]);
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  let account;
  if (envJson) {
    account = JSON.parse(envJson.charCodeAt(0) === 0xfeff ? envJson.slice(1) : envJson);
  } else {
    const require = createRequire(import.meta.url);
    const here = dirname(fileURLToPath(import.meta.url));
    account = require(join(here, '../../apps/api/firebase-adminsdk.json'));
  }
  initializeApp({ credential: cert(account) });
  return { db: getFirestore(), projectId: account.project_id };
}

async function readAll(db, name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
}

async function main() {
  const bucketArg = process.argv.find((arg) => arg.startsWith('--bucket='))?.slice(9);
  const { db, projectId } = await loadFirestore();
  const [orders, stores, users, products] = await Promise.all(
    ['orders', 'stores', 'users', 'products'].map((name) => readAll(db, name)),
  );
  const result = summarize(
    evaluate(
      { orders, stores, users, products },
      { buckets: allowedBuckets(projectId, bucketArg) },
    ),
  );
  console.log(JSON.stringify({ projectId, ...result }, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`pre-deploy-check 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 2;
  });
}

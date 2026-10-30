#!/usr/bin/env node
/**
 * 결제사(카카오페이·PG·카드사) 연동 심사의 구매 테스트용 회차 1개를 운영 매장에 만든다(owner 수동 실행 전용 유지보수 도구).
 *
 * 배경(2026-10-28 결정): 판매자 앱은 카카오 로그인 계정이라 운영자가 대신 로그인해 회차를 만들 수 없다.
 * 심사 담당자가 결제창까지 가 보려면 주문이 열린 회차가 필요하므로, API `SaleRoundsService.createRound`가 쓰는
 * 것과 같은 문서 모양으로 `saleRounds`·`saleRoundItems`를 한 트랜잭션에 쓴다. 상태는 바로 SCHEDULED
 * (판매자 앱의 "판매 예정으로 예약"과 같은 기록: status·closeReason null·updatedAt)이고, 주문 시작 시각이 지나면
 * API의 자동 상태 계산이 OPEN으로 본다. 배송 지역은 그 매장의 가장 최근 회차에서 복사한다(판매자 앱 복사 기능과 같다).
 *
 * 입력(env):
 *   ROUND_STORE_ID    매장 id(UUID)
 *   ROUND_MODE        check(그 매장의 회차 목록만 조회, 기본) | create(생성)
 *   ROUND_NAME        create 필수. 회차 이름(40자 이하, 제어문자 금지)
 *   ROUND_PRODUCT_ID  create 필수. 회차에 넣을 상품 id(UUID) 1~5개를 ,로 구분(적은 순서가 진열 순서). 이 매장 상품이어야
 *                     하고 공동구매(group) 상품은 받지 않는다. PG·카드사 입점 심사는 배송 상품 3개 이상을 요구한다.
 *   ROUND_PRICE       선택. 회차 가격(원, 정수). 비우면 상품의 현재 가격. 상품이 여럿이면 같은 순서로 ,로 구분하고
 *                     빈 칸은 그 상품의 현재 가격
 *   ROUND_SCHEDULE    create 필수. 한국 시간 5개를 |로 구분: 주문시작|주문마감|경매|배송시작|배송종료
 *                     (각 'YYYY-MM-DD HH:mm'). API와 같은 순서 규칙: 시작 < 마감 <= 경매 <= 배송시작 < 배송종료.
 *                     주문 기간은 30일 이하(심사용이므로).
 *   ROUND_LIMITS      선택. '상품별 한도,배송지 한도,판매 수량 한도'(기본 2,2,2 · 각 1~10)
 *   GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 키 경로. project_id가 운영(green-e4fe3)이 아니면 거부한다.
 *
 * 인자: --detail  로컬 실행 전용 상세 출력(회차 id 앞 8자). GITHUB_ACTIONS·CI 환경에서는 거부한다.
 *
 * 출력 범위: 기본 출력은 공개 Actions 로그에 남지만 회차 이름·일정·한도·상품 이름은 소비자 공개 API로도 보이는 값이라
 *   그대로 낸다. 회차·상품 id 원문은 내지 않는다(--detail은 앞 8자만).
 *
 * check: 매장의 회차를 주문 시작 최신순으로 이름·상태·주문 기간과 함께 낸다(읽기 전용).
 * create: 같은 이름의 살아 있는 회차(취소·완료가 아닌)가 있으면 아무것도 바꾸지 않고 exit 1. 아니면 한 트랜잭션으로
 *   saleRounds/{uuid}(status SCHEDULED)와 saleRoundItems/{uuid}(상품마다 1개, displayOrder는 적은 순서)를 만들고 auditLogs에
 *   sale_round.review_created_by_owner_maintenance를 남긴다.
 * 정리: 심사가 끝나면 판매자 앱 회차 상세의 "회차 취소"로 정리한다(테스트 결제라 실제 환불은 없다).
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createLinePrinter,
  describeError,
  detailLine,
  EXPECTED_PROJECT_ID,
  idPrefix,
  OpsOutputError,
  readOutputOptions,
} from './lock-account.mjs';

export const AUDIT_ACTION = 'sale_round.review_created_by_owner_maintenance';
export const MODES = Object.freeze(['check', 'create']);
export const DEFAULT_LIMITS = Object.freeze({
  itemLimit: 2,
  maxDeliveryAddresses: 2,
  maxItemQuantity: 2,
});
export const MAX_LIMIT = 10;
export const NAME_MAX_LENGTH = 40;
export const MAX_ORDER_WINDOW_DAYS = 30;
export const MAX_PRICE = 10_000_000;
export const MAX_PRODUCTS = 5;
export const ROUND_QUERY_LIMIT = 50;
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_KEYS = Object.freeze([
  'orderOpenAt',
  'orderCloseAt',
  'auctionAt',
  'deliveryStartAt',
  'deliveryEndAt',
]);
const LIVE_ROUND_STATUSES = Object.freeze(['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KST_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

export class CreateReviewRoundError extends Error {}

/** 'YYYY-MM-DD HH:mm'(한국 시간)을 UTC ISO 문자열로 바꾼다. 존재하지 않는 날짜·시각은 거부한다. */
export function parseKstDateTime(text, label = '시각') {
  const matched = KST_DATETIME_PATTERN.exec(String(text ?? '').trim());
  if (!matched) {
    throw new CreateReviewRoundError(`${label}은 'YYYY-MM-DD HH:mm'(한국 시간) 형식이어야 합니다.`);
  }
  const [year, month, day, hour, minute] = matched.slice(1).map(Number);
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS;
  const check = new Date(utcMillis + KST_OFFSET_MS);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    throw new CreateReviewRoundError(`${label}이 달력에 없는 날짜·시각입니다.`);
  }
  return new Date(utcMillis).toISOString();
}

/** '주문시작|주문마감|경매|배송시작|배송종료'를 API와 같은 순서 규칙으로 검증해 schedule 객체로 만든다. */
export function parseSchedule(text) {
  const parts = String(text ?? '')
    .split('|')
    .map((part) => part.trim());
  if (parts.length !== SCHEDULE_KEYS.length || parts.some((part) => !part)) {
    throw new CreateReviewRoundError(
      'ROUND_SCHEDULE은 주문시작|주문마감|경매|배송시작|배송종료 5개를 |로 구분해 적어야 합니다.',
    );
  }
  const labels = ['주문 시작', '주문 마감', '경매 시각', '배송 시작', '배송 종료'];
  const iso = parts.map((part, index) => parseKstDateTime(part, labels[index]));
  const [open, close, auction, deliveryStart, deliveryEnd] = iso.map((value) => Date.parse(value));
  if (
    !(open < close && close <= auction && auction <= deliveryStart && deliveryStart < deliveryEnd)
  ) {
    throw new CreateReviewRoundError(
      '회차 일정 순서가 올바르지 않습니다(주문 시작 < 주문 마감 <= 경매 <= 배송 시작 < 배송 종료).',
    );
  }
  if (close - open > MAX_ORDER_WINDOW_DAYS * DAY_MS) {
    throw new CreateReviewRoundError(
      `심사용 회차의 주문 기간은 ${MAX_ORDER_WINDOW_DAYS}일 이하여야 합니다.`,
    );
  }
  return {
    orderOpenAt: iso[0],
    orderCloseAt: iso[1],
    auctionAt: iso[2],
    deliveryStartAt: iso[3],
    deliveryEndAt: iso[4],
    timezone: 'Asia/Seoul',
  };
}

/** '상품별 한도,배송지 한도,판매 수량 한도'. 비우면 기본 2,2,2. 각 1~10 정수. */
export function parseLimits(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ...DEFAULT_LIMITS };
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length !== 3) {
    throw new CreateReviewRoundError(
      'ROUND_LIMITS는 상품별 한도,배송지 한도,판매 수량 한도 3개여야 합니다.',
    );
  }
  const values = parts.map(Number);
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > MAX_LIMIT)) {
    throw new CreateReviewRoundError(`ROUND_LIMITS 값은 각각 1~${MAX_LIMIT} 사이 정수여야 합니다.`);
  }
  return { itemLimit: values[0], maxDeliveryAddresses: values[1], maxItemQuantity: values[2] };
}

export function readInputs(env) {
  const mode = String(env.ROUND_MODE ?? 'check').trim();
  if (!MODES.includes(mode)) {
    throw new CreateReviewRoundError(`ROUND_MODE는 ${MODES.join('|')} 중 하나여야 합니다.`);
  }
  const storeId = String(env.ROUND_STORE_ID ?? '').trim();
  if (!UUID_PATTERN.test(storeId)) {
    throw new CreateReviewRoundError('ROUND_STORE_ID가 비었거나 UUID 형식이 아닙니다.');
  }
  if (mode === 'check') return { mode, storeId };

  const name = String(env.ROUND_NAME ?? '').trim();
  if (!name || name.length > NAME_MAX_LENGTH || /\p{Cc}/u.test(name)) {
    throw new CreateReviewRoundError(
      `ROUND_NAME은 1~${NAME_MAX_LENGTH}자이고 제어문자를 포함할 수 없습니다.`,
    );
  }
  const productIds = String(env.ROUND_PRODUCT_ID ?? '')
    .split(',')
    .map((id) => id.trim());
  if (productIds.length > MAX_PRODUCTS || productIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new CreateReviewRoundError(
      `ROUND_PRODUCT_ID는 UUID 1~${MAX_PRODUCTS}개를 ,로 구분해 적어야 합니다.`,
    );
  }
  if (new Set(productIds).size !== productIds.length) {
    throw new CreateReviewRoundError('ROUND_PRODUCT_ID에 같은 상품을 두 번 적을 수 없습니다.');
  }
  const priceRaw = String(env.ROUND_PRICE ?? '').trim();
  const priceParts = priceRaw ? priceRaw.split(',').map((part) => part.trim()) : [];
  if (priceRaw && priceParts.length !== productIds.length) {
    throw new CreateReviewRoundError('ROUND_PRICE는 비우거나 상품 수만큼 ,로 구분해 적어야 합니다.');
  }
  const items = productIds.map((productId, index) => {
    const part = priceParts[index] ?? '';
    if (!part) return { productId, price: null };
    const price = Number(part);
    if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) {
      throw new CreateReviewRoundError(`ROUND_PRICE는 1~${MAX_PRICE} 사이 정수(원)여야 합니다.`);
    }
    return { productId, price };
  });
  return {
    mode,
    storeId,
    name,
    items,
    schedule: parseSchedule(env.ROUND_SCHEDULE),
    limits: parseLimits(env.ROUND_LIMITS),
  };
}

/** API `createRound`가 만드는 회차 문서와 같은 필드. 상태만 SCHEDULED로 바로 둔다. */
export function buildRoundDocument({
  roundId,
  storeId,
  name,
  schedule,
  deliveryRegion,
  limits,
  now,
}) {
  return {
    id: roundId,
    storeId,
    name,
    status: 'SCHEDULED',
    closeReason: null,
    cancellation: null,
    schedule,
    deliveryRegion,
    limits: {
      maxDeliveryAddresses: limits.maxDeliveryAddresses,
      maxItemQuantity: limits.maxItemQuantity,
    },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    },
    carrotLandingUrl: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** API `buildItemDocsInTransaction`이 만드는 회차 상품 문서와 같은 필드. */
export function buildItemDocument({
  itemId,
  roundId,
  storeId,
  productId,
  product,
  roundPrice,
  saleLimitQuantity,
  displayOrder = 0,
  now,
}) {
  return {
    id: itemId,
    roundId,
    storeId,
    productId,
    productNameSnapshot: product.name,
    productImageUrlSnapshot: Array.isArray(product.images) ? (product.images[0] ?? null) : null,
    roundPrice,
    saleLimitQuantity,
    reservedQuantity: 0,
    orderedQuantity: 0,
    displayOrder,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

function millisOf(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? 0 : millis;
  }
  return 0;
}

/** 매장의 가장 최근(createdAt) 회차에서 배송 지역을 복사한다. 쓸 만한 값이 없으면 null. */
export function pickDeliveryRegion(rounds) {
  const candidates = rounds
    .filter((round) => {
      const region = round?.deliveryRegion;
      return (
        region &&
        typeof region === 'object' &&
        typeof region.id === 'string' &&
        typeof region.city === 'string' &&
        region.city
      );
    })
    .sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt));
  const region = candidates[0]?.deliveryRegion;
  if (!region) return null;
  return {
    id: region.id,
    label: typeof region.label === 'string' ? region.label : region.city,
    province: typeof region.province === 'string' ? region.province : '',
    city: region.city,
    enabled: true,
  };
}

function scheduleLine(round) {
  const schedule = round?.schedule ?? {};
  return `${schedule.orderOpenAt ?? 'n/a'} ~ ${schedule.orderCloseAt ?? 'n/a'}`;
}

async function readServiceAccount(env, loadFile) {
  const path = String(env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim();
  if (!path) throw new CreateReviewRoundError('GOOGLE_APPLICATION_CREDENTIALS가 없습니다.');
  let parsed;
  try {
    parsed = JSON.parse(await loadFile(path));
  } catch {
    throw new CreateReviewRoundError('서비스 계정 키를 읽지 못했습니다.');
  }
  if (parsed?.project_id !== EXPECTED_PROJECT_ID) {
    throw new CreateReviewRoundError(
      `서비스 계정 프로젝트가 운영(${EXPECTED_PROJECT_ID})이 아니어서 거부합니다.`,
    );
  }
  return parsed;
}

async function defaultConnect(serviceAccount) {
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const app = initializeApp(
    { credential: cert(serviceAccount), projectId: serviceAccount.project_id },
    'ops-create-review-round',
  );
  return { db: getFirestore(app), Timestamp };
}

async function listStoreRounds(db, storeId) {
  const snap = await db
    .collection('saleRounds')
    .where('storeId', '==', storeId)
    .limit(ROUND_QUERY_LIMIT)
    .get();
  return snap.docs
    .map((doc) => doc.data())
    .sort((a, b) => millisOf(b?.schedule?.orderOpenAt) - millisOf(a?.schedule?.orderOpenAt));
}

export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  write = (line) => console.log(line),
  loadFile = (path) => readFile(path, 'utf8'),
  connect = defaultConnect,
  now = () => Date.now(),
} = {}) {
  let detail = false;
  const print = createLinePrinter({ isDetail: () => detail, emit: (line) => write(String(line)) });

  try {
    ({ detail } = readOutputOptions(argv, env));
    const inputs = readInputs(env);
    const serviceAccount = await readServiceAccount(env, loadFile);
    const { db, Timestamp } = await connect(serviceAccount);
    const nowMillis = now();

    print(`mode: ${inputs.mode}`);
    const rounds = await listStoreRounds(db, inputs.storeId);
    print(`rounds: ${rounds.length}`);
    for (const round of rounds) {
      print(
        `- ${round.name ?? '(이름 없음)'} | ${round.status ?? 'unknown'} | ${scheduleLine(round)}`,
      );
      print(detailLine(`  roundIdPrefix: ${idPrefix(round.id)}`));
    }
    if (inputs.mode === 'check') return 0;

    const duplicate = rounds.find(
      (round) => round.name === inputs.name && LIVE_ROUND_STATUSES.includes(round.status),
    );
    if (duplicate) {
      print(
        `result: already-exists (같은 이름의 ${duplicate.status} 회차가 있어 만들지 않았습니다)`,
      );
      return 1;
    }

    const deliveryRegion = pickDeliveryRegion(rounds);
    if (!deliveryRegion) {
      throw new CreateReviewRoundError('배송 지역을 복사할 기존 회차가 없어 만들지 않습니다.');
    }

    const roundId = randomUUID();
    const itemIds = inputs.items.map(() => randomUUID());
    const nowTimestamp = Timestamp.fromMillis(nowMillis);
    const roundRef = db.doc(`saleRounds/${roundId}`);
    let created = null;

    await db.runTransaction(async (tx) => {
      // 트랜잭션은 읽기를 모두 마친 뒤 쓴다.
      const products = [];
      for (const [index, { productId }] of inputs.items.entries()) {
        const productSnap = await tx.get(db.doc(`products/${productId}`));
        const label = `${index + 1}번째 상품`;
        if (!productSnap.exists || productSnap.data()?.storeId !== inputs.storeId) {
          throw new CreateReviewRoundError(
            `회차 상품을 찾을 수 없습니다(${label}: 없거나 다른 매장 상품).`,
          );
        }
        const product = productSnap.data();
        if (product.saleType === 'group') {
          throw new CreateReviewRoundError(
            `공동구매(group) 상품은 회차 상품으로 넣지 않습니다(${label}).`,
          );
        }
        products.push(product);
      }
      const items = inputs.items.map(({ productId, price }, index) => {
        const roundPrice = price ?? products[index].price;
        if (!Number.isInteger(roundPrice) || roundPrice < 1) {
          throw new CreateReviewRoundError(
            `회차 가격을 정할 수 없습니다(${index + 1}번째 상품). ROUND_PRICE를 지정하세요.`,
          );
        }
        return buildItemDocument({
          itemId: itemIds[index],
          roundId,
          storeId: inputs.storeId,
          productId,
          product: products[index],
          roundPrice,
          saleLimitQuantity: inputs.limits.itemLimit,
          displayOrder: index,
          now: nowTimestamp,
        });
      });
      const round = buildRoundDocument({
        roundId,
        storeId: inputs.storeId,
        name: inputs.name,
        schedule: inputs.schedule,
        deliveryRegion,
        limits: inputs.limits,
        now: nowTimestamp,
      });
      tx.create(roundRef, round);
      for (const item of items) tx.create(db.doc(`saleRoundItems/${item.id}`), item);
      created = { round, items };
    });

    const auditId = randomUUID();
    await db.doc(`auditLogs/${auditId}`).set({
      id: auditId,
      action: AUDIT_ACTION,
      userId: null,
      ip: null,
      detail: {
        storeId: inputs.storeId,
        roundId,
        items: created.items.map((item) => ({
          roundItemId: item.id,
          productId: item.productId,
          roundPrice: item.roundPrice,
        })),
        status: 'SCHEDULED',
        schedule: inputs.schedule,
        limits: created.round.limits,
        saleLimitQuantity: inputs.limits.itemLimit,
      },
      createdAt: nowTimestamp,
    });

    print('result: created');
    print(`name: ${created.round.name}`);
    print('status: SCHEDULED');
    for (const key of SCHEDULE_KEYS) print(`${key}: ${created.round.schedule[key]}`);
    print(`deliveryRegion: ${created.round.deliveryRegion.city}`);
    print(
      `limits: item ${inputs.limits.itemLimit}, addresses ${created.round.limits.maxDeliveryAddresses}, quantity ${created.round.limits.maxItemQuantity}`,
    );
    for (const item of created.items) {
      print(`product: ${item.productNameSnapshot} (${item.roundPrice}원)`);
    }
    print(detailLine(`roundIdPrefix: ${idPrefix(roundId)}`));
    return 0;
  } catch (error) {
    const message =
      error instanceof CreateReviewRoundError || error instanceof OpsOutputError
        ? error.message
        : describeError(error, { detail });
    write(message);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await run());
}

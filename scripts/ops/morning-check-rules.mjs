/**
 * 아침 운영 점검 판정 규칙(순수 함수). 설계: docs/specs/ops/morning-ops-check.md §2.
 *
 * 입력은 수집기(morning-check.mjs)가 허용 목록 필드만 읽어 만든 결과이고, 출력은 항목별 수준(🔴/🟡/🟢)과
 * 주문번호·가게 이름·금액·건수 목록이다. 네트워크·파일·시계에 손대지 않는다(now는 입력으로 받는다).
 * 보고에는 손님 정보·계정 이메일·사용자 id를 넣지 않는다. 문서 id도 넣지 않고 주문번호·가게 이름으로 가리킨다.
 */

export const RED = '🔴';
export const YELLOW = '🟡';
export const GREEN = '🟢';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

/** 끝난 주문 상태. 이 상태가 아니면 미완료다(§2-2 O1). */
export const DONE_ORDER_STATUSES = Object.freeze(['DELIVERED', 'PICKED_UP', 'REVIEWED', 'CANCELLED']);
/** 결제 전 주문. 손님이 결제를 끝내지 않은 주문이라 배송 지연으로 보지 않는다. */
export const UNPAID_ORDER_STATUS = 'PENDING';
/** 회차 없는 미완료 주문 조회에 쓰는 진행 중 상태(결제 전·끝난 상태 제외). */
export const IN_PROGRESS_ORDER_STATUSES = Object.freeze([
  'RECRUITING',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'DELIVERING',
  'DELIVERY_HELD',
  'HUB_ARRIVED',
]);
/** 준비 시작 전 상태(§2-2 O2). */
export const NOT_PREPARED_STATUSES = Object.freeze(['ACCEPTED', 'CONFIRMED']);

export const SECURITY_ACTIONS = Object.freeze([
  'payment.amount_tampered',
  'payment.webhook.invalid_sig',
  'auth.token.stolen',
]);
export const LOGIN_FAILED_ACTION = 'auth.login.failed';

export const THRESHOLDS = Object.freeze({
  /** O1: 날짜 없는 주문이 이 시간 넘게 그대로면 짐작으로 올린다. */
  staleOrderMs: 48 * HOUR_MS,
  /** O4: 보류가 이 시간을 넘으면 올린다. */
  heldOrderMs: 24 * HOUR_MS,
  /** P2: 만료가 이 시간 안이면 올린다. */
  inviteExpiryMs: 24 * HOUR_MS,
  /** S1·S2: 최근 구간. */
  recentWindowMs: 24 * HOUR_MS,
  /** S2: 비교 기준 구간(최근 구간 바로 앞 7일). */
  baselineDays: 7,
  /** S2: 최근 24시간 로그인 실패 최소 건수. */
  loginFailedMin: 10,
  /** S2: 직전 7일 하루 평균 대비 배수. */
  loginFailedRatio: 3,
  /** O1·O2·O3: 회차를 볼 범위(배송 마감이 이 기간 안). */
  roundLookbackMs: 7 * DAY_MS,
  /** S0: 열쇠를 만든 뒤 이 일수를 넘으면 교체 경고. */
  keyRotationWarnDays: 80,
  /** M2: 수수료율이 다르다고 보는 최소 차이. */
  rateEpsilon: 1e-9,
});

const LEVEL_RANK = { [GREEN]: 0, [YELLOW]: 1, [RED]: 2 };

// ── 시각 ─────────────────────────────────────────────────────────────────────

/**
 * Firestore Timestamp·Date·ISO 문자열·밀리초 숫자를 밀리초로 바꾼다. 해석할 수 없으면 null.
 * 날짜만 있는 'YYYY-MM-DD'는 KST 그날 0시로 본다.
 */
export function toMillis(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00+09:00`);
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return toMillis(value.toMillis());
    // JSON으로 한 번 오간 Timestamp 모양({_seconds,_nanoseconds} 또는 {seconds,nanoseconds})
    const seconds = value.seconds ?? value._seconds;
    const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
    if (typeof seconds === 'number') return seconds * 1000 + Math.floor(nanos / 1e6);
  }
  return null;
}

/** 밀리초를 KST 날짜 'YYYY-MM-DD'로. */
export function kstDate(millis) {
  return new Date(millis + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 값(날짜·시각)을 KST 날짜로. 해석할 수 없으면 null. */
export function kstDateOf(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = toMillis(value);
  return ms === null ? null : kstDate(ms);
}

// ── 공통 ─────────────────────────────────────────────────────────────────────

function list(value) {
  return Array.isArray(value) ? value : [];
}

function storeNameOf(storeNames, storeId) {
  const name = storeId ? storeNames[storeId] : undefined;
  return typeof name === 'string' && name.trim() ? name.trim() : '(가게 이름 없음)';
}

function amountOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function orderNumberOf(order) {
  return typeof order?.orderNumber === 'string' && order.orderNumber ? order.orderNumber : '(주문번호 없음)';
}

function isDone(status) {
  return DONE_ORDER_STATUSES.includes(status);
}

/** 보고에 남길 주문 항목. 주문번호·가게 이름·금액·메모만 담는다. */
function orderEntry(order, storeNames, level, note, amount = null) {
  const orderNumber = orderNumberOf(order);
  const entry = { key: orderNumber, level, orderNumber, storeName: storeNameOf(storeNames, order?.storeId) };
  if (amount !== null) entry.amount = amount;
  if (note) entry.note = note;
  return entry;
}

function maxLevel(levels) {
  let best = GREEN;
  for (const level of levels) {
    if (LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

/**
 * 항목 하나를 만든다. entries가 있으면 수준은 entries 중 가장 높은 것, 없으면 fallbackLevel.
 * sources 중 하나라도 읽기에 실패했으면 판정하지 않는다(level=null, checked=false). 추측으로 🟢을 채우지 않는다.
 */
function makeItem(def, { entries = [], count, fallbackLevel = GREEN, failedSources = [], extra = {} }) {
  const failed = def.sources.filter((source) => failedSources.includes(source));
  if (failed.length > 0) {
    return {
      id: def.id,
      title: def.title,
      level: null,
      checked: false,
      note: `확인 못 함(읽기 실패: ${failed.join(', ')})`,
      count: 0,
      entries: [],
      decision: def.decision,
    };
  }
  const level = entries.length > 0 ? maxLevel(entries.map((entry) => entry.level)) : fallbackLevel;
  return {
    id: def.id,
    title: def.title,
    level,
    checked: true,
    count: count ?? entries.length,
    entries,
    decision: def.decision,
    ...extra,
  };
}

export const ITEM_DEFS = Object.freeze({
  M1: {
    id: 'M1',
    title: '지급 후 환불',
    sources: ['settlements.paid', 'orders.byId', 'payments.byId', 'stores'],
    decision: '판매자에게 돌려받은 뒤 관리자 회수 완료 처리(회수 필요 표시·운영 기록, #592)',
  },
  M2: {
    id: 'M2',
    title: '수수료율 차이',
    sources: ['stores', 'settlements.recent'],
    decision: '요율 변경 전에 만든 정산이면 그대로 둔다. 변경 뒤 정산인데 다르면 기술 확인',
  },
  O1: {
    id: 'O1',
    title: '배송 마감 지남',
    sources: ['saleRounds', 'orders.byRound', 'orders.openWithoutRound', 'stores'],
    decision: '판매자·기사에게 연락할지, 손님에게 안내할지, 필요하면 어드민에서 강제 환불할지',
  },
  O2: {
    id: 'O2',
    title: '오늘 배송인데 준비 전',
    sources: ['saleRounds', 'orders.byRound', 'stores'],
    decision: '판매자에게 확인 연락을 할지',
  },
  O3: {
    id: 'O3',
    title: '기사 미배정',
    sources: ['saleRounds', 'orders.byRound', 'stores'],
    decision: '기사에게 배정을 요청하거나 직접 연락할지',
  },
  O4: {
    id: 'O4',
    title: '배송 보류 장기화',
    sources: ['orders.held', 'stores'],
    decision: '재배송 일정을 잡을지, 취소할지',
  },
  P1: {
    id: 'P1',
    title: '기사 승인 대기',
    sources: ['users.drivers'],
    decision: '어드민 기사 탭에서 승인할지, 정지할지',
  },
  P2: {
    id: 'P2',
    title: '초대 만료 임박',
    sources: ['invites'],
    decision: '다시 보낼지, 그냥 둘지',
  },
  S1: {
    id: 'S1',
    title: '보안 사건',
    sources: ['auditLogs'],
    decision: '해당 결제·계정을 확인할지(토큰 도난은 서버가 이미 그 계정 세션을 끊음)',
  },
  S2: {
    id: 'S2',
    title: '로그인 실패 급증',
    sources: ['auditLogs'],
    decision: '지켜볼지, 계정 잠금 도구를 쓸지',
  },
  S3: {
    id: 'S3',
    title: '운영 확인 기록',
    sources: ['operationIssues', 'stores'],
    decision: '판매자 앱 "운영 확인"에서 처리할지',
  },
  S0: {
    id: 'S0',
    title: '점검 실패',
    sources: [],
    decision: '열쇠·PC 상태를 확인할지',
  },
});

export const ITEM_ORDER = Object.freeze(['S0', 'M1', 'M2', 'O1', 'O2', 'O3', 'O4', 'P1', 'P2', 'S1', 'S2', 'S3']);

// ── 판정 ─────────────────────────────────────────────────────────────────────

/** M1: 지급된 정산인데 주문이 취소됐거나 결제에 환불 시각이 있음. 정산 문서 id = 주문 id = 결제 문서 id. */
export function evaluateM1(input) {
  const storeNames = input.storeNames ?? {};
  const orders = input.ordersById ?? {};
  const payments = input.paymentsById ?? {};
  const entries = [];
  for (const settlement of list(input.paidSettlements)) {
    if (settlement?.status !== 'paid') continue;
    const order = orders[settlement.id];
    const payment = payments[settlement.id];
    const cancelled = order?.status === 'CANCELLED';
    const refunded = payment?.refundedAt !== null && payment?.refundedAt !== undefined;
    if (!cancelled && !refunded) continue;
    const reason = [cancelled ? '주문 취소' : null, refunded ? '결제 환불' : null].filter(Boolean).join(' · ');
    const ref = {
      orderNumber: settlement.orderNumber ?? order?.orderNumber,
      storeId: settlement.storeId ?? order?.storeId,
    };
    entries.push(orderEntry(ref, storeNames, RED, `지급 완료 후 ${reason}`, amountOf(settlement.netAmount)));
  }
  return makeItem(ITEM_DEFS.M1, { entries, failedSources: input.failedSources });
}

/** M2: 가게 수수료율이 있고 그 가게 최근 정산(30일)의 platformFeeRate와 다름. 최근 정산이 없으면 비교하지 않는다. */
export function evaluateM2(input) {
  const latestByStore = {};
  for (const settlement of list(input.recentSettlements)) {
    const settledAt = toMillis(settlement?.settledAt);
    const storeId = settlement?.storeId;
    if (!storeId || settledAt === null || typeof settlement.platformFeeRate !== 'number') continue;
    const prev = latestByStore[storeId];
    if (!prev || settledAt > prev.settledAt) {
      latestByStore[storeId] = { settledAt, rate: settlement.platformFeeRate };
    }
  }
  const entries = [];
  for (const store of list(input.stores)) {
    if (typeof store?.commissionRate !== 'number') continue;
    const latest = latestByStore[store.id];
    if (!latest) continue;
    if (Math.abs(store.commissionRate - latest.rate) <= THRESHOLDS.rateEpsilon) continue;
    const storeName = storeNameOf(input.storeNames ?? {}, store.id);
    entries.push({
      key: `${storeName}|${store.commissionRate}|${latest.rate}`,
      level: YELLOW,
      storeName,
      note: `화면 ${formatRate(store.commissionRate)} · 정산 ${formatRate(latest.rate)}`,
    });
  }
  return makeItem(ITEM_DEFS.M2, {
    entries,
    failedSources: input.failedSources,
    extra: entries.length > 0 ? { summary: `${entries.length}곳 · 정책 결정 대기` } : {},
  });
}

function formatRate(rate) {
  return `${Math.round(rate * 10000) / 100}%`;
}

/** 볼 회차: 배송 마감이 최근 7일 안(now-7일 ≤ 마감 < now)이거나 배송 시작이 오늘(KST). */
export function selectRounds(rounds, now) {
  const today = kstDate(now);
  return list(rounds).filter((round) => {
    const end = toMillis(round?.schedule?.deliveryEndAt);
    const startDate = kstDateOf(round?.schedule?.deliveryStartAt);
    const endedRecently = end !== null && end < now && end >= now - THRESHOLDS.roundLookbackMs;
    return endedRecently || startDate === today;
  });
}

/**
 * O1: 배송 마감 지남.
 * - 회차 주문: 회차 deliveryEndAt < now 이고 미완료(결제 전 제외) → 🔴
 * - 회차 없는 주문: requestedDeliveryDate(KST 날짜)가 오늘보다 앞 → 🔴
 * - 회차 없는 주문인데 날짜가 없음: updatedAt이 48시간 넘게 그대로 → 🟡 "짐작"(보류 주문은 O4가 본다)
 */
export function evaluateO1(input) {
  const now = input.now;
  const today = kstDate(now);
  const storeNames = input.storeNames ?? {};
  const roundsById = {};
  for (const round of list(input.rounds)) roundsById[round.id] = round;
  const entries = [];
  const seen = {};
  const push = (entry) => {
    if (seen[entry.key]) return;
    seen[entry.key] = true;
    entries.push(entry);
  };

  for (const order of list(input.roundOrders)) {
    if (isDone(order?.status) || order?.status === UNPAID_ORDER_STATUS) continue;
    const end = toMillis(roundsById[order.roundId]?.schedule?.deliveryEndAt);
    if (end === null || end >= now) continue;
    push(orderEntry(order, storeNames, RED, '회차 배송 마감 지남', amountOf(order.totalAmount)));
  }

  for (const order of list(input.openOrdersWithoutRound)) {
    if (order?.roundId) continue;
    if (isDone(order?.status) || order?.status === UNPAID_ORDER_STATUS) continue;
    const date = kstDateOf(order.requestedDeliveryDate);
    if (date !== null) {
      if (date < today) push(orderEntry(order, storeNames, RED, `희망 배송일 ${date} 지남`));
      continue;
    }
    // 날짜 없는 보류 주문은 보류 시각이 있는 O4가 더 정확히 본다(같은 주문을 짐작으로 두 번 올리지 않는다).
    if (order.status === 'DELIVERY_HELD') continue;
    const updatedAt = toMillis(order.updatedAt);
    if (updatedAt !== null && now - updatedAt > THRESHOLDS.staleOrderMs) {
      push(orderEntry(order, storeNames, YELLOW, '짐작: 배송일 없음 · 48시간 넘게 그대로'));
    }
  }
  return makeItem(ITEM_DEFS.O1, { entries, failedSources: input.failedSources });
}

function todayRoundIds(rounds, now) {
  const today = kstDate(now);
  return list(rounds)
    .filter((round) => kstDateOf(round?.schedule?.deliveryStartAt) === today)
    .map((round) => round.id);
}

/** O2: 오늘(KST) 배송 시작 회차의 주문이 아직 ACCEPTED·CONFIRMED. */
export function evaluateO2(input) {
  const ids = todayRoundIds(input.rounds, input.now);
  const entries = list(input.roundOrders)
    .filter((order) => ids.includes(order?.roundId) && NOT_PREPARED_STATUSES.includes(order.status))
    .map((order) => orderEntry(order, input.storeNames ?? {}, YELLOW, '준비 시작 전', amountOf(order.totalAmount)));
  return makeItem(ITEM_DEFS.O2, { entries, failedSources: input.failedSources });
}

/** O3: O2와 같은 회차에서 직배송(direct)·PREPARING인데 driverId가 없음. */
export function evaluateO3(input) {
  const ids = todayRoundIds(input.rounds, input.now);
  const entries = list(input.roundOrders)
    .filter(
      (order) =>
        ids.includes(order?.roundId) &&
        order.status === 'PREPARING' &&
        order.deliveryMethod === 'direct' &&
        !order.driverId,
    )
    .map((order) => orderEntry(order, input.storeNames ?? {}, YELLOW, '준비 끝 · 기사 없음', amountOf(order.totalAmount)));
  return makeItem(ITEM_DEFS.O3, { entries, failedSources: input.failedSources });
}

/** O4: DELIVERY_HELD이고 보류가 풀리지 않았으며 heldAt이 24시간을 넘음. */
export function evaluateO4(input) {
  const now = input.now;
  const entries = [];
  for (const order of list(input.heldOrders)) {
    if (order?.status !== 'DELIVERY_HELD') continue;
    const hold = order.deliveryHold ?? {};
    if (hold.resolvedAt !== null && hold.resolvedAt !== undefined) continue;
    const heldAt = toMillis(hold.heldAt);
    if (heldAt === null || now - heldAt <= THRESHOLDS.heldOrderMs) continue;
    const hours = Math.floor((now - heldAt) / HOUR_MS);
    const reason = typeof hold.reasonCode === 'string' && hold.reasonCode ? ` · ${hold.reasonCode}` : '';
    entries.push(orderEntry(order, input.storeNames ?? {}, YELLOW, `보류 ${hours}시간${reason}`));
  }
  return makeItem(ITEM_DEFS.O4, { entries, failedSources: input.failedSources });
}

/** P1: 기사 role이고 driverApproved가 false이며 정지되지 않음. 사람을 가리키는 값 없이 인원수만 낸다. */
export function evaluateP1(input) {
  const waiting = list(input.drivers).filter(
    (user) => user?.role === 'driver' && user.driverApproved !== true && user.suspended !== true,
  ).length;
  return makeItem(ITEM_DEFS.P1, {
    count: waiting,
    fallbackLevel: waiting > 0 ? YELLOW : GREEN,
    failedSources: input.failedSources,
    extra: waiting > 0 ? { summary: `${waiting}명` } : {},
  });
}

/** P2: 쓰지도 취소하지도 않은 초대가 now < 만료 ≤ now+24시간. 받는 사람 정보 없이 만료 시각만 낸다. */
export function evaluateP2(input) {
  const now = input.now;
  const entries = [];
  for (const invite of list(input.invites)) {
    const usedAt = invite?.usedAt;
    const revokedAt = invite?.revokedAt;
    if ((usedAt !== null && usedAt !== undefined) || (revokedAt !== null && revokedAt !== undefined)) continue;
    const expiresAt = toMillis(invite.expiresAt);
    if (expiresAt === null || expiresAt <= now || expiresAt > now + THRESHOLDS.inviteExpiryMs) continue;
    const hours = Math.max(0, Math.floor((expiresAt - now) / HOUR_MS));
    entries.push({
      key: new Date(expiresAt).toISOString(),
      level: YELLOW,
      note: `${hours}시간 뒤 만료`,
    });
  }
  return makeItem(ITEM_DEFS.P2, { entries, failedSources: input.failedSources });
}

function inWindow(millis, from, to) {
  return millis !== null && millis > from && millis <= to;
}

/** S1: 최근 24시간(now-24h < createdAt ≤ now)에 보안 사건 기록이 1건이라도 있음. 종류별 건수. */
export function evaluateS1(input) {
  const now = input.now;
  const counts = {};
  for (const log of list(input.auditLogs)) {
    if (!SECURITY_ACTIONS.includes(log?.action)) continue;
    if (!inWindow(toMillis(log.createdAt), now - THRESHOLDS.recentWindowMs, now)) continue;
    counts[log.action] = (counts[log.action] ?? 0) + 1;
  }
  const entries = SECURITY_ACTIONS.filter((action) => counts[action]).map((action) => ({
    key: action,
    level: RED,
    note: action,
    count: counts[action],
  }));
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return makeItem(ITEM_DEFS.S1, { entries, count: total, failedSources: input.failedSources });
}

/**
 * S2: 최근 24시간 auth.login.failed가 10건 이상이면서 직전 7일(now-8일 < t ≤ now-24h) 하루 평균의 3배 이상.
 */
export function evaluateS2(input) {
  const now = input.now;
  const recentFrom = now - THRESHOLDS.recentWindowMs;
  const baselineFrom = recentFrom - THRESHOLDS.baselineDays * DAY_MS;
  let recent = 0;
  let baseline = 0;
  for (const log of list(input.auditLogs)) {
    if (log?.action !== LOGIN_FAILED_ACTION) continue;
    const at = toMillis(log.createdAt);
    if (inWindow(at, recentFrom, now)) recent += 1;
    else if (inWindow(at, baselineFrom, recentFrom)) baseline += 1;
  }
  const dailyAverage = baseline / THRESHOLDS.baselineDays;
  const surge = recent >= THRESHOLDS.loginFailedMin && recent >= THRESHOLDS.loginFailedRatio * dailyAverage;
  return makeItem(ITEM_DEFS.S2, {
    count: recent,
    fallbackLevel: surge ? YELLOW : GREEN,
    failedSources: input.failedSources,
    extra: {
      summary: `최근 24시간 ${recent}건 · 직전 7일 하루 평균 ${Math.round(dailyAverage * 10) / 10}건`,
    },
  });
}

/** S3: OPEN인 운영 확인 기록. critical → 🔴, warning → 🟡, 그 밖 등급은 보지 않는다. */
export function evaluateS3(input) {
  const entries = [];
  for (const issue of list(input.operationIssues)) {
    const level = issue?.severity === 'critical' ? RED : issue?.severity === 'warning' ? YELLOW : null;
    if (!level) continue;
    const storeName = storeNameOf(input.storeNames ?? {}, issue.storeId);
    const createdAt = toMillis(issue.createdAt);
    const type = typeof issue.type === 'string' && issue.type ? issue.type : '(종류 없음)';
    entries.push({
      key: `${type}|${storeName}|${createdAt ?? ''}`,
      level,
      storeName,
      note: `${type} · ${issue.severity}`,
    });
  }
  return makeItem(ITEM_DEFS.S3, { entries, failedSources: input.failedSources });
}

/**
 * S0: 점검 자체의 실패와 열쇠 교체 시기.
 * - stop(차단 장치가 멈춤)이나 읽기 실패가 있으면 🔴
 * - 열쇠를 만든 날(KST 날짜)로부터 80일이 지나면 🟡. 만든 날을 모르면 🟡로 알린다.
 */
export function evaluateS0(input) {
  const entries = [];
  if (input.stop) {
    entries.push({ key: `stop|${input.stop.code}`, level: RED, note: input.stop.message });
  }
  for (const failure of list(input.failures)) {
    entries.push({ key: `read|${failure.source}`, level: RED, note: `${failure.source} 읽기 실패: ${failure.message}` });
  }
  if (!input.stop) {
    const age = keyAgeDays(input.keyCreatedAt, input.now);
    if (age === null) {
      entries.push({ key: 'key-age|unknown', level: YELLOW, note: '열쇠 만든 날을 알 수 없음(config.json keyCreatedAt)' });
    } else if (age > THRESHOLDS.keyRotationWarnDays) {
      entries.push({ key: 'key-age', level: YELLOW, note: `열쇠를 만든 지 ${age}일 · 90일 전에 교체` });
    }
  }
  return makeItem(ITEM_DEFS.S0, { entries });
}

/** 열쇠를 만든 날(KST 'YYYY-MM-DD' 또는 시각)로부터 오늘(KST)까지 지난 일수. 모르면 null. */
export function keyAgeDays(keyCreatedAt, now) {
  const created = kstDateOf(keyCreatedAt);
  if (created === null) return null;
  const today = kstDate(now);
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${created}T00:00:00Z`)) / DAY_MS);
}

// ── 보고 ─────────────────────────────────────────────────────────────────────

/**
 * 수집 결과 전체를 판정해 보고 한 덩어리를 만든다.
 * collected: { now, stores(가게 이름의 출처), paidSettlements, ordersById, paymentsById, recentSettlements, rounds,
 *   roundOrders, openOrdersWithoutRound, heldOrders, drivers, invites, auditLogs, operationIssues,
 *   failures: [{source, message}], stop: {code, message} | null, keyCreatedAt }
 */
export function evaluateAll(collected) {
  const now = toMillis(collected?.now);
  if (now === null) throw new TypeError('now가 필요합니다.');
  const failures = list(collected.failures);
  const storeNames = {};
  for (const store of list(collected.stores)) {
    if (store?.id) storeNames[store.id] = store.name;
  }
  const input = {
    ...collected,
    storeNames: collected.storeNames ?? storeNames,
    now,
    failedSources: failures.map((failure) => failure.source),
  };

  const items = collected.stop
    ? [evaluateS0(input)]
    : [
        evaluateS0(input),
        evaluateM1(input),
        evaluateM2(input),
        evaluateO1(input),
        evaluateO2(input),
        evaluateO3(input),
        evaluateO4(input),
        evaluateP1(input),
        evaluateP2(input),
        evaluateS1(input),
        evaluateS2(input),
        evaluateS3(input),
      ];

  return {
    date: kstDate(now),
    generatedAt: new Date(now).toISOString(),
    ...summarize(items),
    ...(collected.excludedStoreCount > 0 ? { excludedStores: collected.excludedStoreCount } : {}),
    items,
  };
}

/**
 * 점검에서 뺄 가게(로컬 config.json의 excludeStoreIds)의 기록을 수집 결과에서 덜어낸다.
 * E2E 고정 데이터가 사는 테스트 가게가 매일 같은 이상으로 뜨지 않게 한다. 가게와 묶이지 않은 기사·초대·
 * 행동 기록은 그대로 둔다. 보고에는 뺀 가게 수만 남기고 가게 id는 넣지 않는다.
 */
export function excludeStores(collected, storeIds) {
  const excluded = new Set(list(storeIds));
  if (excluded.size === 0) return collected;
  const keep = (item) => !excluded.has(item?.storeId);
  const paidSettlements = list(collected.paidSettlements).filter(keep);
  const keptSettlementIds = new Set(paidSettlements.map((settlement) => settlement.id));
  const pickKept = (byId) =>
    Object.fromEntries(Object.entries(byId ?? {}).filter(([id]) => keptSettlementIds.has(id)));
  return {
    ...collected,
    stores: list(collected.stores).filter((store) => !excluded.has(store?.id)),
    paidSettlements,
    ordersById: pickKept(collected.ordersById),
    paymentsById: pickKept(collected.paymentsById),
    recentSettlements: list(collected.recentSettlements).filter(keep),
    rounds: list(collected.rounds).filter(keep),
    roundOrders: list(collected.roundOrders).filter(keep),
    openOrdersWithoutRound: list(collected.openOrdersWithoutRound).filter(keep),
    heldOrders: list(collected.heldOrders).filter(keep),
    operationIssues: list(collected.operationIssues).filter(keep),
    excludedStoreCount: excluded.size,
  };
}

/**
 * 건수·전체 수준. 🔴/🟡 건수는 항목 안 entries의 수준별 개수이고, entries 없이 건수만 있는 항목(P1·S2)은
 * 그 항목 수준으로 1건을 센다(P1은 사람 수로 센다).
 */
export function summarize(items) {
  let red = 0;
  let yellow = 0;
  for (const item of items) {
    if (!item.checked) continue;
    if (item.entries.length > 0) {
      for (const entry of item.entries) {
        const n = typeof entry.count === 'number' ? entry.count : 1;
        if (entry.level === RED) red += n;
        else if (entry.level === YELLOW) yellow += n;
      }
    } else if (item.level === YELLOW) {
      yellow += item.id === 'P1' ? item.count : 1;
    } else if (item.level === RED) {
      red += 1;
    }
  }
  const overall = red > 0 ? RED : yellow > 0 ? YELLOW : GREEN;
  return { overall, counts: { red, yellow } };
}

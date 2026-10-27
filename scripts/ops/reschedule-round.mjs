#!/usr/bin/env node
/**
 * 아직 열리지 않은 운영 회차 1개의 일정을 뒤로 미룬다(owner 수동 실행 전용 유지보수 도구).
 *
 * 배경(2026-10-28 결정): 결제사 LIVE 채널이 없는 상태에서 첫 실제 회차("11월 10일 배송 회차")가 11/1 10:00에
 * 자동으로 열리면 안 되는데, 판매자 앱은 카카오 로그인 계정이라 운영자가 대신 로그인해 일정을 바꿀 수 없다.
 * API `SaleRoundsService.updateRound`가 schedule·name을 바꿀 때 쓰는 것과 같은 필드(schedule·name·updatedAt)만
 * 한 트랜잭션에 갱신한다. 상품·한도·지역은 건드리지 않는다.
 *
 * 입력(env):
 *   ROUND_ID          회차 id(UUID)
 *   ROUND_MODE        check(회차 1개를 읽어 이름·상태·일정만 보여준다, 기본) | reschedule(일정 변경)
 *   ROUND_SHIFT_DAYS  reschedule에서 ROUND_SCHEDULE과 둘 중 하나만. 일정 5개를 모두 이 일수만큼 뒤로 민다(1~90 정수).
 *                     요일 구조(예: 일요일 개방·월요일 경매·화요일 배송)를 지키려면 7의 배수를 쓴다.
 *   ROUND_SCHEDULE    reschedule에서 ROUND_SHIFT_DAYS와 둘 중 하나만. 한국 시간 5개를 |로 구분:
 *                     주문시작|주문마감|경매|배송시작|배송종료(각 'YYYY-MM-DD HH:mm'). API와 같은 순서 규칙.
 *   ROUND_NAME        선택. 새 회차 이름(40자 이하). 이름에 배송 날짜가 들어 있을 때 같이 바꾼다.
 *   GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 키 경로. project_id가 운영(green-e4fe3)이 아니면 거부한다.
 *
 * 인자: --detail  로컬 실행 전용 상세 출력(매장·회차 id 앞 8자). GITHUB_ACTIONS·CI 환경에서는 거부한다.
 *
 * 출력 범위: 기본 출력은 공개 Actions 로그에 남지만 회차 이름·상태·일정은 소비자 공개 API로도 보이는 값이라 그대로 낸다.
 *   회차·매장 id 원문은 내지 않는다(--detail은 앞 8자만).
 *
 * reschedule 거부 조건(아무것도 바꾸지 않고 exit 1):
 *   - 회차가 없거나, 상태가 DRAFT·SCHEDULED가 아니거나, 취소 처리 중(API `assertRoundEditable`과 같음)
 *   - 주문 시작 시각이 이미 지났음(API 자동 상태 계산이 OPEN으로 보는 회차는 미루지 않는다)
 *   - 예약·주문 사용량이 있음(손님이 본 일정을 뒤에서 바꾸지 않는다)
 *   - 새 주문 시작이 지금 이전이거나 기존 주문 시작보다 이르면(미루기 도구이지 앞당기기 도구가 아니다)
 *   - 새 이름이 같은 매장의 살아 있는 다른 회차 이름과 같음
 * 성공하면 auditLogs에 sale_round.rescheduled_by_owner_maintenance(변경 전·후 일정·이름)를 남긴다.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { KST_OFFSET_MS, NAME_MAX_LENGTH, parseKstDateTime } from './create-review-round.mjs';
import {
  createLinePrinter,
  describeError,
  detailLine,
  EXPECTED_PROJECT_ID,
  idPrefix,
  OpsOutputError,
  readOutputOptions,
} from './lock-account.mjs';

export const AUDIT_ACTION = 'sale_round.rescheduled_by_owner_maintenance';
export const MODES = Object.freeze(['check', 'reschedule']);
export const MAX_SHIFT_DAYS = 90;
export const ROUND_QUERY_LIMIT = 50;
export const SCHEDULE_KEYS = Object.freeze([
  'orderOpenAt',
  'orderCloseAt',
  'auctionAt',
  'deliveryStartAt',
  'deliveryEndAt',
]);
const SCHEDULE_LABELS = Object.freeze([
  '주문 시작',
  '주문 마감',
  '경매 시각',
  '배송 시작',
  '배송 종료',
]);
const DAY_MS = 24 * 60 * 60 * 1000;
const EDITABLE_STATUSES = Object.freeze(['DRAFT', 'SCHEDULED']);
const LIVE_ROUND_STATUSES = Object.freeze(['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RescheduleRoundError extends Error {}

/** Firestore Timestamp·ISO 문자열 어느 쪽이든 밀리초로. 읽을 수 없으면 NaN. */
export function scheduleMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string' && value) {
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? Number.NaN : millis;
  }
  return Number.NaN;
}

/** ISO/Timestamp를 사람이 읽는 한국 시간 'YYYY-MM-DD HH:mm'으로. 읽을 수 없으면 'n/a'. */
export function formatKst(value) {
  const millis = scheduleMillis(value);
  if (!Number.isFinite(millis)) return 'n/a';
  const kst = new Date(millis + KST_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
}

/** API `assertScheduleOrder`와 같은 규칙: 시작 < 마감 <= 경매 <= 배송 시작 < 배송 종료. */
export function assertScheduleOrder(schedule) {
  const [open, close, auction, deliveryStart, deliveryEnd] = SCHEDULE_KEYS.map((key) =>
    scheduleMillis(schedule?.[key]),
  );
  if (
    ![open, close, auction, deliveryStart, deliveryEnd].every(Number.isFinite) ||
    !(open < close && close <= auction && auction <= deliveryStart && deliveryStart < deliveryEnd)
  ) {
    throw new RescheduleRoundError(
      '회차 일정 순서가 올바르지 않습니다(주문 시작 < 주문 마감 <= 경매 <= 배송 시작 < 배송 종료).',
    );
  }
}

/** 기존 일정 5개를 모두 days일 뒤로 민 새 schedule(ISO 문자열, timezone 유지). */
export function shiftSchedule(schedule, days) {
  const next = {};
  for (const key of SCHEDULE_KEYS) {
    const millis = scheduleMillis(schedule?.[key]);
    if (!Number.isFinite(millis)) {
      throw new RescheduleRoundError(`기존 회차의 ${key} 시각을 읽을 수 없어 밀 수 없습니다.`);
    }
    next[key] = new Date(millis + days * DAY_MS).toISOString();
  }
  next.timezone = typeof schedule?.timezone === 'string' ? schedule.timezone : 'Asia/Seoul';
  return next;
}

/** '주문시작|주문마감|경매|배송시작|배송종료'(한국 시간)를 schedule 객체로. 순서 규칙도 검증한다. */
export function parseExplicitSchedule(text) {
  const parts = String(text ?? '')
    .split('|')
    .map((part) => part.trim());
  if (parts.length !== SCHEDULE_KEYS.length || parts.some((part) => !part)) {
    throw new RescheduleRoundError(
      'ROUND_SCHEDULE은 주문시작|주문마감|경매|배송시작|배송종료 5개를 |로 구분해 적어야 합니다.',
    );
  }
  const schedule = { timezone: 'Asia/Seoul' };
  parts.forEach((part, index) => {
    try {
      schedule[SCHEDULE_KEYS[index]] = parseKstDateTime(part, SCHEDULE_LABELS[index]);
    } catch (error) {
      throw new RescheduleRoundError(error.message);
    }
  });
  assertScheduleOrder(schedule);
  return schedule;
}

export function readInputs(env) {
  const mode = String(env.ROUND_MODE ?? 'check').trim();
  if (!MODES.includes(mode)) {
    throw new RescheduleRoundError(`ROUND_MODE는 ${MODES.join('|')} 중 하나여야 합니다.`);
  }
  const roundId = String(env.ROUND_ID ?? '').trim();
  if (!UUID_PATTERN.test(roundId)) {
    throw new RescheduleRoundError('ROUND_ID가 비었거나 UUID 형식이 아닙니다.');
  }
  if (mode === 'check') return { mode, roundId };

  const shiftRaw = String(env.ROUND_SHIFT_DAYS ?? '').trim();
  const scheduleRaw = String(env.ROUND_SCHEDULE ?? '').trim();
  if ((shiftRaw && scheduleRaw) || (!shiftRaw && !scheduleRaw)) {
    throw new RescheduleRoundError('ROUND_SHIFT_DAYS와 ROUND_SCHEDULE 중 하나만 적어야 합니다.');
  }
  let shiftDays = null;
  let schedule = null;
  if (shiftRaw) {
    shiftDays = Number(shiftRaw);
    if (!Number.isInteger(shiftDays) || shiftDays < 1 || shiftDays > MAX_SHIFT_DAYS) {
      throw new RescheduleRoundError(
        `ROUND_SHIFT_DAYS는 1~${MAX_SHIFT_DAYS} 사이 정수(일)여야 합니다.`,
      );
    }
  } else {
    schedule = parseExplicitSchedule(scheduleRaw);
  }

  const nameRaw = String(env.ROUND_NAME ?? '').trim();
  let name = null;
  if (nameRaw) {
    if (nameRaw.length > NAME_MAX_LENGTH || /\p{Cc}/u.test(nameRaw)) {
      throw new RescheduleRoundError(
        `ROUND_NAME은 ${NAME_MAX_LENGTH}자 이하이고 제어문자를 포함할 수 없습니다.`,
      );
    }
    name = nameRaw;
  }
  return { mode, roundId, shiftDays, schedule, name };
}

/**
 * 기존 회차와 새 일정을 대조해 바꿔도 되는지 판정한다(순수 함수). 거부면 RescheduleRoundError.
 * 돌려주는 값은 트랜잭션에 쓸 update 필드(schedule·name 변경분).
 */
export function planReschedule({ round, inputs, nowMillis }) {
  if (!EDITABLE_STATUSES.includes(round?.status) || round?.cancellation != null) {
    throw new RescheduleRoundError(
      '작성 중 또는 판매 예정인 회차만 미룰 수 있습니다(취소 처리 중이면 안 됩니다).',
    );
  }
  const currentOpen = scheduleMillis(round.schedule?.orderOpenAt);
  if (!Number.isFinite(currentOpen)) {
    throw new RescheduleRoundError('기존 회차의 주문 시작 시각을 읽을 수 없습니다.');
  }
  if (nowMillis >= currentOpen) {
    throw new RescheduleRoundError('주문 시작 시각이 이미 지난(열린) 회차는 미루지 않습니다.');
  }
  const counters = round.counters ?? {};
  const used =
    (counters.reservedDeliveryAddresses ?? 0) > 0 ||
    (counters.reservedItemQuantity ?? 0) > 0 ||
    (counters.orderedDeliveryAddresses ?? 0) > 0 ||
    (counters.orderedItemQuantity ?? 0) > 0 ||
    (counters.heldOrderCount ?? 0) > 0;
  if (used) {
    throw new RescheduleRoundError('예약 또는 주문이 있는 회차는 미루지 않습니다.');
  }

  const schedule = inputs.schedule ?? shiftSchedule(round.schedule, inputs.shiftDays);
  assertScheduleOrder(schedule);
  // 지금 < 기존 주문 시작 < 새 주문 시작이므로 새 일정은 자연히 미래다.
  const nextOpen = scheduleMillis(schedule.orderOpenAt);
  if (nextOpen <= currentOpen) {
    throw new RescheduleRoundError('새 주문 시작이 기존보다 늦어야 합니다(미루기만 합니다).');
  }

  const update = { schedule };
  if (inputs.name && inputs.name !== round.name) update.name = inputs.name;
  return update;
}

async function readServiceAccount(env, loadFile) {
  const path = String(env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim();
  if (!path) throw new RescheduleRoundError('GOOGLE_APPLICATION_CREDENTIALS가 없습니다.');
  let parsed;
  try {
    parsed = JSON.parse(await loadFile(path));
  } catch {
    throw new RescheduleRoundError('서비스 계정 키를 읽지 못했습니다.');
  }
  if (parsed?.project_id !== EXPECTED_PROJECT_ID) {
    throw new RescheduleRoundError(
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
    'ops-reschedule-round',
  );
  return { db: getFirestore(app), Timestamp };
}

function printRound(print, round, label) {
  print(`${label}name: ${round.name ?? '(이름 없음)'}`);
  print(`${label}status: ${round.status ?? 'unknown'}`);
  for (const key of SCHEDULE_KEYS) {
    print(`${label}${key}: ${formatKst(round.schedule?.[key])} KST`);
  }
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
    const roundRef = db.doc(`saleRounds/${inputs.roundId}`);
    const snap = await roundRef.get();
    if (!snap.exists) {
      print('result: not-found');
      return 1;
    }
    const round = snap.data();
    printRound(print, round, '');
    print(detailLine(`storeIdPrefix: ${idPrefix(round.storeId)}`));
    print(detailLine(`roundIdPrefix: ${idPrefix(round.id ?? inputs.roundId)}`));
    if (inputs.mode === 'check') return 0;

    // 새 이름이 같은 매장의 살아 있는 다른 회차와 겹치면 거부한다(create-review-round.mjs와 같은 규칙).
    if (inputs.name && inputs.name !== round.name) {
      const siblings = await db
        .collection('saleRounds')
        .where('storeId', '==', round.storeId)
        .limit(ROUND_QUERY_LIMIT)
        .get();
      const duplicate = siblings.docs
        .map((doc) => doc.data())
        .find(
          (other) =>
            other.id !== inputs.roundId &&
            other.name === inputs.name &&
            LIVE_ROUND_STATUSES.includes(other.status),
        );
      if (duplicate) {
        print(`result: name-taken (같은 이름의 ${duplicate.status} 회차가 있어 바꾸지 않았습니다)`);
        return 1;
      }
    }

    const nowTimestamp = Timestamp.fromMillis(nowMillis);
    let applied = null;
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(roundRef);
      if (!fresh.exists) throw new RescheduleRoundError('회차를 찾을 수 없습니다.');
      const current = fresh.data();
      const update = planReschedule({ round: current, inputs, nowMillis });
      tx.update(roundRef, { ...update, updatedAt: nowTimestamp });
      applied = { before: current, update };
    });

    const auditId = randomUUID();
    await db.doc(`auditLogs/${auditId}`).set({
      id: auditId,
      action: AUDIT_ACTION,
      userId: null,
      ip: null,
      detail: {
        storeId: applied.before.storeId,
        roundId: inputs.roundId,
        shiftDays: inputs.shiftDays,
        before: { name: applied.before.name ?? null, schedule: applied.before.schedule ?? null },
        after: {
          name: applied.update.name ?? applied.before.name ?? null,
          schedule: applied.update.schedule,
        },
      },
      createdAt: nowTimestamp,
    });

    print('result: rescheduled');
    printRound(print, { ...applied.before, ...applied.update }, 'after.');
    return 0;
  } catch (error) {
    const message =
      error instanceof RescheduleRoundError || error instanceof OpsOutputError
        ? error.message
        : describeError(error, { detail });
    write(message);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await run());
}

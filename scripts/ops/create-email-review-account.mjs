#!/usr/bin/env node
/**
 * 결제사(카카오페이) 연동 심사용 이메일 로그인 계정 1개를 운영에 만든다(owner 수동 실행 전용 유지보수 도구).
 *
 * 배경(2026-10-27 결정): 운영 화면은 카카오 로그인만 쓰고 운영 API는 이메일 가입·로그인을 받지 않는다.
 * 결제사 연동 심사는 심사 담당자가 사이트에 ID·비밀번호로 로그인해 결제창까지 가 보는 구매 테스트를
 * 요구하므로, 심사 허용 만료 시각(`emailLoginAllowedUntil`)이 남은 계정에 한해 운영 API가 이메일 로그인을
 * 받는다(`apps/api/src/auth/email-login-admission.ts`). 이 스크립트가 그 표식을 가진 계정을 만드는 유일한 경로다.
 *
 * 입력(env):
 *   REVIEW_EMAIL          계정 이메일(로그인 ID). 소문자로 정규화해 저장한다.
 *   REVIEW_MODE           check(조회만, 기본) | create(생성)
 *   REVIEW_PASSWORD_HASH  create 필수. 로컬에서 만든 bcrypt 해시($2b$12$…, cost 10 이상). 평문 비밀번호는 받지 않는다.
 *   REVIEW_NAME           선택. 표시 이름(기본 '결제 심사 담당자', 20자 이하, 제어문자·링크 금지).
 *   REVIEW_ALLOWED_DAYS   선택. 심사 허용 기간(일, 기본 30, 1~90). 지나면 운영 API가 자동으로 거부한다.
 *   GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 키 경로. project_id가 운영(green-e4fe3)이 아니면 거부한다.
 *
 * 인자: --detail  로컬 실행 전용 상세 출력(마스킹 이메일·uid 앞 8자). GITHUB_ACTIONS·CI 환경에서는 거부한다.
 *
 * 출력 범위: 기본 출력은 공개 Actions 로그에 남으므로 모드·결과·role·허용 일수·만료 시각 같은 범주 값만 낸다.
 *   이메일 원문·uid 원문·비밀번호 해시는 어느 쪽에서도 내지 않는다.
 *
 * check: 같은 이메일(users.email 또는 emailIdentities)의 계정 유무와 role·정지 여부·심사 허용 여부·만료 시각을 낸다.
 * create: 계정이 없을 때만 다음을 한 트랜잭션으로 만든다(이미 있으면 아무것도 바꾸지 않고 exit 1).
 *   - users/{uuid}: API 이메일 가입(`AuthService.register`)과 같은 필드 + `emailLoginAllowedUntil`(Timestamp)
 *     + `emailLoginAllowedReason: 'payment-gateway-review'`. role은 consumer 고정.
 *   - emailIdentities/{sha256(email)}: { userId, email, createdAt } (가입 중복 방지 연결 문서)
 *   - auditLogs: account.email_review_created_by_owner_maintenance(이메일 원문 없음)
 * 회수: 만료를 기다리거나 `ops-lock-account.yml`(lock, expected_role=consumer)로 잠근다.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createLinePrinter,
  describeError,
  detailLine,
  EXPECTED_PROJECT_ID,
  emailIdentityKey,
  idPrefix,
  maskEmail,
  normalizeEmail,
  OpsOutputError,
  readOutputOptions,
} from './lock-account.mjs';

export const AUDIT_ACTION = 'account.email_review_created_by_owner_maintenance';
export const MODES = Object.freeze(['check', 'create']);
export const REVIEW_REASON = 'payment-gateway-review';
export const DEFAULT_NAME = '결제 심사 담당자';
export const DEFAULT_ALLOWED_DAYS = 30;
export const MAX_ALLOWED_DAYS = 90;
export const MIN_BCRYPT_COST = 10;
export const NAME_MAX_LENGTH = 20;
const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/;
const DAY_MILLIS = 86_400_000;

export class CreateReviewAccountError extends Error {}

export function readInputs(env) {
  const mode = String(env.REVIEW_MODE ?? 'check').trim();
  if (!MODES.includes(mode))
    throw new CreateReviewAccountError(`REVIEW_MODE는 ${MODES.join('|')} 중 하나여야 합니다.`);

  const rawEmail = String(env.REVIEW_EMAIL ?? '').trim();
  if (!rawEmail || rawEmail.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(rawEmail))
    throw new CreateReviewAccountError('REVIEW_EMAIL이 비었거나 이메일 형식이 아닙니다.');
  const email = normalizeEmail(rawEmail);

  const daysRaw = String(env.REVIEW_ALLOWED_DAYS ?? '').trim();
  const allowedDays = daysRaw === '' ? DEFAULT_ALLOWED_DAYS : Number(daysRaw);
  if (!Number.isInteger(allowedDays) || allowedDays < 1 || allowedDays > MAX_ALLOWED_DAYS)
    throw new CreateReviewAccountError(
      `REVIEW_ALLOWED_DAYS는 1~${MAX_ALLOWED_DAYS} 사이 정수여야 합니다.`,
    );

  const name = String(env.REVIEW_NAME ?? '').trim() || DEFAULT_NAME;
  if (name.length > NAME_MAX_LENGTH || /\p{Cc}/u.test(name) || /https?:\/\/|www\./i.test(name))
    throw new CreateReviewAccountError(
      `REVIEW_NAME은 ${NAME_MAX_LENGTH}자 이하이고 제어문자·링크를 포함할 수 없습니다.`,
    );

  let passwordHash = null;
  if (mode === 'create') {
    passwordHash = String(env.REVIEW_PASSWORD_HASH ?? '').trim();
    const matched = BCRYPT_HASH_PATTERN.exec(passwordHash);
    if (!matched)
      throw new CreateReviewAccountError(
        'REVIEW_PASSWORD_HASH는 bcrypt 해시($2b$12$…)여야 합니다. 평문 비밀번호는 받지 않습니다.',
      );
    if (Number(matched[1]) < MIN_BCRYPT_COST)
      throw new CreateReviewAccountError(`bcrypt cost는 ${MIN_BCRYPT_COST} 이상이어야 합니다.`);
  }

  return { email, mode, allowedDays, name, passwordHash };
}

/** API `AuthService.register`가 만드는 사용자 문서와 같은 필드에 심사 허용 표식을 더한다. */
export function buildUserDocument({
  userId,
  email,
  name,
  passwordHash,
  allowedDays,
  nowMillis,
  Timestamp,
}) {
  const now = Timestamp.fromMillis(nowMillis);
  return {
    id: userId,
    email,
    name,
    phone: null,
    role: 'consumer',
    storeId: null,
    providers: ['email'],
    passwordHash,
    savedAddresses: [],
    fcmToken: null,
    createdAt: now,
    updatedAt: now,
    emailLoginAllowedUntil: Timestamp.fromMillis(nowMillis + allowedDays * DAY_MILLIS),
    emailLoginAllowedReason: REVIEW_REASON,
  };
}

/** 사용자 문서의 심사 허용 만료 시각(ms). Timestamp·Date 외의 값은 없음으로 본다. */
export function allowedUntilMillis(user) {
  const value = user?.emailLoginAllowedUntil;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value?.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

async function readServiceAccount(env, loadFile) {
  const path = String(env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim();
  if (!path) throw new CreateReviewAccountError('GOOGLE_APPLICATION_CREDENTIALS가 없습니다.');
  let parsed;
  try {
    parsed = JSON.parse(await loadFile(path));
  } catch {
    throw new CreateReviewAccountError('서비스 계정 키를 읽지 못했습니다.');
  }
  if (parsed?.project_id !== EXPECTED_PROJECT_ID) {
    throw new CreateReviewAccountError(
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
    'ops-create-email-review-account',
  );
  return { db: getFirestore(app), Timestamp };
}

function roleOf(user) {
  return typeof user?.role === 'string' ? user.role : 'unknown';
}

/** 정규식 메타문자를 이스케이프한다(입력 이메일 마스킹용). */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
}

/** users.email 또는 emailIdentities로 같은 이메일의 계정을 찾는다. 연결 문서만 남은 경우도 구분한다. */
async function findExisting(db, email, identityKey) {
  const [byEmail, identity] = await Promise.all([
    db.collection('users').where('email', '==', email).limit(1).get(),
    db.doc(`emailIdentities/${identityKey}`).get(),
  ]);
  if (!byEmail.empty) return { user: byEmail.docs[0].data(), identityOnly: false };
  if (!identity.exists) return null;
  const userId = identity.data()?.userId;
  if (typeof userId === 'string' && userId) {
    const snap = await db.doc(`users/${userId}`).get();
    if (snap.exists) return { user: snap.data(), identityOnly: false };
  }
  return { user: null, identityOnly: true };
}

export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  write = (line) => console.log(line),
  loadFile = (path) => readFile(path, 'utf8'),
  connect = defaultConnect,
  now = () => Date.now(),
} = {}) {
  // 출력 직전에 입력 이메일 원문이 섞여 있으면 마스킹한다(오류 메시지 포함).
  const rawEmail = String(env.REVIEW_EMAIL ?? '').trim();
  let detail = false;
  const out = (line) => {
    let text = String(line);
    if (rawEmail) {
      text = text.replace(new RegExp(escapeRegExp(rawEmail), 'gi'), maskEmail(rawEmail));
    }
    write(text);
  };
  const print = createLinePrinter({ isDetail: () => detail, emit: out });

  try {
    ({ detail } = readOutputOptions(argv, env));
    const inputs = readInputs(env);
    const serviceAccount = await readServiceAccount(env, loadFile);
    const { db, Timestamp } = await connect(serviceAccount);
    const nowMillis = now();
    const identityKey = emailIdentityKey(inputs.email);

    print(`mode: ${inputs.mode}`);
    print(detailLine(`email: ${maskEmail(inputs.email)}`));

    const existing = await findExisting(db, inputs.email, identityKey);
    if (existing?.identityOnly) {
      print('found: identity-only');
      print(
        'result: blocked (emailIdentities 연결 문서만 남아 있어 만들지 않습니다. 먼저 정리하세요)',
      );
      return 1;
    }
    if (existing) {
      const until = allowedUntilMillis(existing.user);
      print('found: 1');
      print(`role: ${roleOf(existing.user)}`);
      print(`suspended: ${existing.user.suspended === true ? 'yes' : 'no'}`);
      print(`emailLoginAllowed: ${until !== null && until > nowMillis ? 'yes' : 'no'}`);
      print(`allowedUntil: ${until === null ? 'n/a' : new Date(until).toISOString()}`);
      print(detailLine(`uidPrefix: ${idPrefix(existing.user.id)}`));
      if (inputs.mode === 'create') {
        print(
          'result: already-exists (아무것도 바꾸지 않았습니다. 회수는 ops-lock-account로 합니다)',
        );
        return 1;
      }
      return 0;
    }

    print('found: 0');
    if (inputs.mode === 'check') return 0;

    const userId = randomUUID();
    const userDoc = buildUserDocument({
      userId,
      email: inputs.email,
      name: inputs.name,
      passwordHash: inputs.passwordHash,
      allowedDays: inputs.allowedDays,
      nowMillis,
      Timestamp,
    });
    const userRef = db.doc(`users/${userId}`);
    const identityRef = db.doc(`emailIdentities/${identityKey}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(identityRef);
      if (snap.exists)
        throw new CreateReviewAccountError(
          '같은 이메일의 연결 문서가 그 사이 생겼습니다. 다시 확인하세요.',
        );
      tx.create(identityRef, { userId, email: inputs.email, createdAt: userDoc.createdAt });
      tx.set(userRef, userDoc);
    });

    const auditId = randomUUID();
    await db.doc(`auditLogs/${auditId}`).set({
      id: auditId,
      action: AUDIT_ACTION,
      userId,
      ip: null,
      detail: {
        role: 'consumer',
        reason: REVIEW_REASON,
        allowedDays: inputs.allowedDays,
        allowedUntil: userDoc.emailLoginAllowedUntil.toMillis(),
      },
      createdAt: userDoc.createdAt,
    });

    print('result: created');
    print('role: consumer');
    print(`allowedDays: ${inputs.allowedDays}`);
    print(`allowedUntil: ${new Date(userDoc.emailLoginAllowedUntil.toMillis()).toISOString()}`);
    print(detailLine(`uidPrefix: ${idPrefix(userId)}`));
    return 0;
  } catch (error) {
    const message =
      error instanceof CreateReviewAccountError || error instanceof OpsOutputError
        ? error.message
        : describeError(error, { detail });
    out(message);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await run());
}

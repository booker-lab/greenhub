#!/usr/bin/env node
/**
 * Cloud Run 비밀값·일반 환경 변수 옮기기 도구(docs/specs/ops/api-cloud-run-runbook.md R6).
 * 사용자가 자기 터미널에서 실행한다. Claude·CI는 실행하지 않는다.
 *
 *   node scripts/deploy/cloud-run-env.mjs list
 *   node scripts/deploy/cloud-run-env.mjs secrets [--project=green-e4fe3] [--only=JWT_SECRET,PORTONE_V2_SECRET]
 *   node scripts/deploy/cloud-run-env.mjs env [--project=green-e4fe3] [--out=<YAML 경로>]
 *   node scripts/deploy/cloud-run-env.mjs from-railway [--project=green-e4fe3] [--out=<YAML 경로>] [--service-id=<ID>]
 *
 * - secrets: 비밀값을 하나씩 화면에 보이지 않게 입력받아 gcloud 표준 입력으로만 Secret Manager에 넣고,
 *   런타임 서비스 계정에 그 비밀값 읽기 권한을 준다. 값은 파일·명령 인자·로그에 남기지 않는다.
 * - env: 비밀이 아닌 값을 입력받아 `gcloud run deploy --env-vars-file`용 YAML을 저장소 밖에 쓴다.
 * - list: 옮길 이름과 옮기지 않는 이름을 이유와 함께 보여 준다.
 * - from-railway: 교체가 끝난 Railway에서 값을 직접 읽어 secrets·env와 같은 곳에 쓴다(붙여 넣기 없음).
 *   project token을 가려서 입력받고, 토큰의 환경이 프로젝트와 맞는지(운영=production) 먼저 확인한다.
 * 새 비밀값 버전을 넣으면 그 전의 켜진 버전은 끈다(삭제 아님, 되돌릴 수 있음).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECTS = Object.freeze({
  'green-e4fe3': {
    label: '운영',
    runtimeServiceAccount: 'greenhub-api-runtime@green-e4fe3.iam.gserviceaccount.com',
    environmentName: 'production',
  },
  'greenhub-round-direct-e2e': {
    label: '시험',
    runtimeServiceAccount: 'greenhub-api-runtime@greenhub-round-direct-e2e.iam.gserviceaccount.com',
    environmentName: 'staging',
  },
});
export const SECRET_LOCATION = 'asia-northeast3';

/** Secret Manager로 옮기는 비밀값. hint는 값을 어디서 찾는지만 적는다. */
export const SECRET_KEYS = Object.freeze([
  { key: 'JWT_SECRET', hint: 'Railway 운영 변수(32바이트 이상)', minBytes: 32 },
  {
    key: 'JWT_REFRESH_SECRET',
    hint: 'Railway 운영 변수(32바이트 이상, JWT_SECRET과 달라야 함)',
    minBytes: 32,
  },
  { key: 'PORTONE_V2_SECRET', hint: 'Railway 운영 변수(PortOne V2 API Secret)' },
  { key: 'PORTONE_WEBHOOK_SECRET', hint: 'Railway 운영 변수(PortOne 웹훅 시크릿)' },
  { key: 'KAKAO_ADMIN_KEY', hint: 'Railway 운영 변수(카카오 Admin 키)' },
  { key: 'ALIGO_API_KEY', hint: 'Railway 운영 변수(알리고 API 키)' },
  { key: 'ALIGO_SENDER_KEY', hint: 'Railway 운영 변수(알림톡 발신 프로필 키)' },
  {
    key: 'ALIGO_OUTBOUND_PROXY_URL',
    hint: 'Railway 운영 변수(Fixie 고정 IP 주소, 계정 정보 포함). 고정 IP(R7)를 알리고가 받아들인 뒤 C8에서 지운다',
  },
  { key: 'GEMINI_API_KEY', hint: 'Railway 운영 변수(Gemini API 키)' },
  { key: 'OPS_TELEGRAM_BOT_TOKEN', hint: 'Railway 운영 변수(운영 알림 텔레그램 봇 토큰)' },
]);

/** Cloud Run 일반 환경 변수. value가 있으면 고정값, 없으면 입력받는다. */
export const PLAIN_KEYS = Object.freeze([
  { key: 'NODE_ENV', value: 'production' },
  { key: 'GREENHUB_ENVIRONMENT_NAME', fromProject: 'environmentName' },
  {
    key: 'GREENHUB_SCHEDULES_ENABLED',
    value: 'false',
    note: '전환(C7) 전까지 false. 두 서버가 함께 정기 작업을 돌리지 않게 한다',
  },
  {
    key: 'TRUST_PROXY_HOPS',
    hint: 'R8·R10 실측값. 모르면 비워 두고 R9 전에 채운다(없으면 Cloud Run이 기동을 거부)',
  },
  { key: 'FIREBASE_PROJECT_ID', hint: 'Railway 운영 변수(운영은 green-e4fe3)' },
  {
    key: 'FIREBASE_STORAGE_BUCKET',
    hint: 'Railway 운영 변수(운영 버킷은 green-e4fe3.firebasestorage.app)',
  },
  { key: 'CORS_ORIGIN', hint: 'Railway 운영 변수(쉼표로 구분한 앱 주소)' },
  {
    key: 'CORS_ALLOW_VERCEL_PREVIEWS',
    hint: 'Railway 운영 변수(운영은 보통 비움)',
    optional: true,
  },
  { key: 'VERCEL_PREVIEW_PROJECTS', hint: 'Railway 운영 변수', optional: true },
  { key: 'VERCEL_PREVIEW_TEAM', hint: 'Railway 운영 변수', optional: true },
  { key: 'JWT_EXPIRES_IN', hint: 'Railway 운영 변수', optional: true },
  { key: 'JWT_REFRESH_EXPIRES_IN', hint: 'Railway 운영 변수', optional: true },
  { key: 'KAKAO_APP_ID', hint: 'Railway 운영 변수' },
  { key: 'ALIGO_USER_ID', hint: 'Railway 운영 변수(알리고 아이디)' },
  { key: 'ALIGO_SENDER_PHONE', hint: 'Railway 운영 변수(발신 번호)' },
  { key: 'ALIGO_TEMPLATE_CODES_JSON', hint: 'Railway 운영 변수(한 줄 JSON)' },
  { key: 'OPS_TELEGRAM_CHAT_ID', hint: 'Railway 운영 변수' },
  { key: 'PORTONE_STORE_ID', hint: 'Railway 운영 변수(운영 설정 점검이 소비자 앱 값과 비교)' },
  { key: 'PLATFORM_FEE_RATE', hint: 'Railway 운영 변수', optional: true },
  { key: 'SETTLEMENT_CONFIRM_DELAY_DAYS', hint: 'Railway 운영 변수', optional: true },
  { key: 'AI_DAILY_GENERATION_LIMIT', hint: 'Railway 운영 변수', optional: true },
  { key: 'GREENHUB_FEATURES', hint: 'Railway 운영 변수(기능 토글)', optional: true },
]);

/** API 코드가 읽지만 Cloud Run 운영으로 옮기지 않는 이름과 이유. */
export const EXCLUDED_KEYS = Object.freeze({
  RAILWAY_ENVIRONMENT_NAME: 'Railway 전용(GREENHUB_ENVIRONMENT_NAME으로 대체)',
  RAILWAY_GIT_COMMIT_SHA: 'Railway 전용(배포 도구가 GREENHUB_COMMIT_SHA를 넣음)',
  GREENHUB_COMMIT_SHA: '배포 도구가 리비전마다 넣음',
  PORT: 'Cloud Run이 넣음',
  FIREBASE_SERVICE_ACCOUNT_JSON: '키 파일 대신 런타임 서비스 계정(ADC)',
  GOOGLE_APPLICATION_CREDENTIALS: '키 파일 대신 런타임 서비스 계정(ADC)',
  GOOGLE_CLOUD_PROJECT: 'ADC가 정함',
  GCLOUD_PROJECT: 'ADC가 정함',
  FIRESTORE_EMULATOR_HOST: '로컬 전용',
  FIREBASE_AUTH_EMULATOR_HOST: '로컬 전용',
  GREENHUB_LOCAL_RUNTIME: '로컬 전용',
  GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY: '로컬 전용',
  GREENHUB_API_UNIT_TEST: '단위 테스트 전용',
  VERCEL_ENV: 'Vercel 전용',
  ROUND_DIRECT_E2E_ENABLED: '비운영 E2E 전용(운영에 두지 않음)',
  ROUND_DIRECT_E2E_ENV: '비운영 E2E 전용',
  ROUND_DIRECT_E2E_PROVIDER_MODE: '비운영 E2E 전용',
  ROUND_DIRECT_E2E_RUN_ID: '비운영 E2E 전용',
  ROUND_DIRECT_E2E_SHARED_SECRET: '비운영 E2E 전용',
  ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: '비운영 E2E 전용',
  ROUND_DIRECT_E2E_PORTONE_FIXTURES_JSON: '비운영 E2E 전용',
});

const NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,254}$/;

export function resolveProject(value = 'green-e4fe3') {
  const config = PROJECTS[value];
  if (!config) {
    throw new Error(`--project는 ${Object.keys(PROJECTS).join(' 또는 ')} 중 하나여야 합니다.`);
  }
  return { project: value, ...config };
}

export function selectSecretKeys(only) {
  if (!only) return SECRET_KEYS;
  const wanted = only
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = wanted.filter((name) => !SECRET_KEYS.some((entry) => entry.key === name));
  if (unknown.length > 0) throw new Error(`비밀값 목록에 없는 이름입니다: ${unknown.join(', ')}`);
  return SECRET_KEYS.filter((entry) => wanted.includes(entry.key));
}

/**
 * 가려서 입력받는 중 들어온 키 입력 조각을 반영한다. Enter에서 끝나고 Ctrl+C·Ctrl+D는 중단이다.
 * 붙여넣기는 여러 글자가 한 조각으로 들어오고, 끝에 줄바꿈이 붙으면 거기서 끝난다.
 */
export function applyKeystrokes(buffer, chunk) {
  let next = buffer;
  for (const char of chunk) {
    if (char === '\u0003' || char === '\u0004') return { buffer: '', done: true, aborted: true };
    if (char === '\r' || char === '\n') return { buffer: next, done: true, aborted: false };
    if (char === '\u007f' || char === '\b') {
      next = Array.from(next).slice(0, -1).join('');
      continue;
    }
    if (char < ' ') continue;
    next += char;
  }
  return { buffer: next, done: false, aborted: false };
}

/** 화면에 아무것도 보이지 않게 한 줄을 입력받는다. 터미널이 아니면 거부한다. */
export function readHidden(label, { input = process.stdin, output = process.stderr } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('비밀값은 터미널에서 직접 입력해야 합니다(파이프 입력 거부).'));
  }
  output.write(`${label}: `);
  return new Promise((resolve, reject) => {
    let buffer = '';
    const finish = (error, value) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (data) => {
      const result = applyKeystrokes(buffer, data.toString('utf8'));
      buffer = result.buffer;
      if (result.aborted) finish(new Error('입력을 중단했습니다.'));
      else if (result.done) finish(null, buffer);
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

/** 화면에 보이게 한 줄을 입력받는다(비밀이 아닌 값·예/아니오). */
export function readVisible(label, { input = process.stdin, output = process.stderr } = {}) {
  output.write(`${label}: `);
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (data) => {
      buffer += data.toString('utf8');
      const end = buffer.search(/\r?\n/);
      if (end === -1) return;
      input.off('data', onData);
      input.pause();
      resolve(buffer.slice(0, end));
    };
    input.resume();
    input.on('data', onData);
  });
}

// gcloud 인자에 허용하는 글자. 셸이 해석하는 글자(공백·따옴표·&|<>^%! 등)는 받지 않는다.
const SAFE_ARG = /^[A-Za-z0-9_@.:=/,()[\]-]+$/;

/**
 * Windows에서는 gcloud가 .cmd라 셸로 실행해야 한다. 인자를 배열로 넘기면 셸이 이어 붙이기만 하므로,
 * 허용 글자만 있는지 검사한 뒤 큰따옴표로 감싼 명령 한 줄을 만든다.
 */
export function gcloudCommandLine(args) {
  for (const arg of args) {
    if (!SAFE_ARG.test(arg)) throw new Error(`gcloud 인자에 허용하지 않는 글자가 있습니다: ${arg}`);
  }
  return ['gcloud', ...args.map((arg) => `"${arg}"`)].join(' ');
}

/** gcloud를 실행한다. 인자는 검사한 이름·플래그만 넣고, 비밀값은 표준 입력으로만 넘긴다. */
export function runGcloud(args, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(gcloudCommandLine(args), { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn('gcloud', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });
}

function assertName(name) {
  if (!NAME_PATTERN.test(name)) throw new Error(`이름 형식이 올바르지 않습니다: ${name}`);
  return name;
}

export function secretArgs({ action, name, project, serviceAccount, version }) {
  assertName(name);
  const scope = `--project=${project}`;
  switch (action) {
    case 'describe':
      return ['secrets', 'describe', name, scope, '--format=value(name)'];
    case 'enabled-version':
      return [
        'secrets',
        'versions',
        'list',
        name,
        scope,
        '--filter=state:ENABLED',
        '--limit=1',
        '--format=value(name)',
      ];
    case 'create':
      return [
        'secrets',
        'create',
        name,
        scope,
        '--replication-policy=user-managed',
        `--locations=${SECRET_LOCATION}`,
      ];
    case 'add-version':
      return ['secrets', 'versions', 'add', name, scope, '--data-file=-', '--format=value(name)'];
    case 'enabled-versions':
      return [
        'secrets',
        'versions',
        'list',
        name,
        scope,
        '--filter=state:ENABLED',
        '--format=value(name)',
      ];
    case 'disable-version':
      if (!/^[0-9]+$/.test(String(version)))
        throw new Error(`버전 형식이 올바르지 않습니다: ${version}`);
      return ['secrets', 'versions', 'disable', String(version), `--secret=${name}`, scope];
    case 'grant':
      return [
        'secrets',
        'add-iam-policy-binding',
        name,
        scope,
        `--member=serviceAccount:${serviceAccount}`,
        '--role=roles/secretmanager.secretAccessor',
      ];
    default:
      throw new Error(`알 수 없는 동작: ${action}`);
  }
}

/** 입력값을 정리하고 문제를 알려 준다. 앞뒤 공백은 지우지 않고 알리기만 한다. */
export function inspectSecretValue(entry, raw) {
  const value = raw.replace(/[\r\n]+$/, '');
  const warnings = [];
  if (/[\r\n]/.test(value))
    return { value: null, error: '값 중간에 줄바꿈이 있습니다. 한 줄로 넣어 주세요.' };
  if (value !== value.trim()) warnings.push('앞이나 뒤에 공백이 있습니다. 그대로 저장합니다.');
  if (entry.minBytes && Buffer.byteLength(value, 'utf8') < entry.minBytes) {
    warnings.push(`${entry.minBytes}바이트보다 짧습니다(운영 권장 최소).`);
  }
  return { value, warnings };
}

async function gcloudOk(gcloud, args, options) {
  const result = await gcloud(args, options);
  if (result.code !== 0) {
    throw new Error(
      `gcloud ${args.slice(0, 3).join(' ')} 실패: ${result.stderr.trim().split('\n').pop()}`,
    );
  }
  return result;
}

/** gcloud가 돌려준 버전 경로(`projects/…/secrets/X/versions/3`)나 번호에서 번호만 뽑는다. */
export function versionNumber(value) {
  const match = /(?:^|\/)([0-9]+)\s*$/.exec(String(value).trim());
  return match ? match[1] : null;
}

/**
 * 비밀값 하나를 새 버전으로 넣고 런타임 계정에 읽기 권한을 준 뒤, 그 전의 켜진 버전은 끈다.
 * 끄기는 삭제가 아니어서 되돌릴 수 있다(`gcloud secrets versions enable`). 값을 바꾼 뒤에는 옛 값이
 * 계속 읽히지 않게 한다.
 */
export async function storeSecret({ gcloud, target, name, value, exists }) {
  if (!exists) {
    await gcloudOk(gcloud, secretArgs({ action: 'create', name, project: target.project }));
  }
  const added = await gcloudOk(
    gcloud,
    secretArgs({ action: 'add-version', name, project: target.project }),
    { stdin: value },
  );
  const created = versionNumber(added.stdout);
  if (!created) throw new Error(`${name}의 새 버전 번호를 확인하지 못했습니다.`);
  await gcloudOk(
    gcloud,
    secretArgs({
      action: 'grant',
      name,
      project: target.project,
      serviceAccount: target.runtimeServiceAccount,
    }),
  );
  const listed = await gcloudOk(
    gcloud,
    secretArgs({ action: 'enabled-versions', name, project: target.project }),
  );
  const disabled = [];
  for (const line of listed.stdout.split(/\r?\n/)) {
    const version = versionNumber(line);
    if (!version || version === created) continue;
    await gcloudOk(
      gcloud,
      secretArgs({ action: 'disable-version', name, project: target.project, version }),
    );
    disabled.push(version);
  }
  return { version: created, disabled };
}

export async function runSecrets({
  project,
  keys,
  gcloud = runGcloud,
  hidden = readHidden,
  visible = readVisible,
  log = (line) => process.stderr.write(`${line}\n`),
}) {
  const target = resolveProject(project);
  log(
    `[${target.label} ${target.project}] 비밀값 ${keys.length}개. 값은 화면에 보이지 않습니다. 비우고 Enter면 건너뜁니다.`,
  );
  const summary = { stored: [], skipped: [] };
  for (const entry of keys) {
    const name = entry.key;
    log('');
    log(`■ ${name} — ${entry.hint}`);
    const exists =
      (await gcloud(secretArgs({ action: 'describe', name, project: target.project }))).code === 0;
    if (exists) {
      const version = await gcloud(
        secretArgs({ action: 'enabled-version', name, project: target.project }),
      );
      if (version.code === 0 && version.stdout.trim()) {
        const answer = (await visible('  이미 값이 있습니다. 새 값으로 바꿀까요? (y/N)')).trim();
        if (!/^y(es)?$/i.test(answer)) {
          summary.skipped.push(name);
          log('  건너뜀(기존 값 유지)');
          continue;
        }
      }
    }
    const raw = await hidden('  값');
    if (raw === '') {
      summary.skipped.push(name);
      log('  건너뜀');
      continue;
    }
    const inspected = inspectSecretValue(entry, raw);
    if (inspected.value === null) {
      summary.skipped.push(name);
      log(`  건너뜀: ${inspected.error}`);
      continue;
    }
    for (const warning of inspected.warnings) log(`  주의: ${warning}`);
    const stored = await storeSecret({ gcloud, target, name, value: inspected.value, exists });
    summary.stored.push(name);
    log(
      `  저장됨(버전 ${stored.version}, 런타임 계정 읽기 권한 포함)${disabledNote(stored.disabled)}`,
    );
  }
  log('');
  log(`저장 ${summary.stored.length}개: ${summary.stored.join(', ') || '없음'}`);
  log(`건너뜀 ${summary.skipped.length}개: ${summary.skipped.join(', ') || '없음'}`);
  return summary;
}

function disabledNote(disabled) {
  return disabled.length > 0 ? ` · 이전 버전 ${disabled.join(', ')} 끔` : '';
}

/** `gcloud run deploy --env-vars-file`용 YAML. 값은 JSON 문자열(유효한 YAML 큰따옴표 문자열)로 쓴다. */
export function renderEnvYaml(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${assertName(key)}: ${JSON.stringify(String(value))}`)
    .join('\n')}\n`;
}

export function defaultEnvFile(project) {
  return path.join(os.homedir(), '.greenhub', `cloud-run-${project}.env.yaml`);
}

function writeEnvFile(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
}

export async function runEnv({
  project,
  out,
  visible = readVisible,
  write = writeEnvFile,
  log = (line) => process.stderr.write(`${line}\n`),
}) {
  const target = resolveProject(project);
  const file = out || defaultEnvFile(target.project);
  log(
    `[${target.label} ${target.project}] 일반 환경 변수. 비밀값은 여기 넣지 않습니다. 비우고 Enter면 건너뜁니다.`,
  );
  const values = {};
  const missing = [];
  for (const entry of PLAIN_KEYS) {
    if (entry.value !== undefined || entry.fromProject) {
      values[entry.key] = entry.value ?? target[entry.fromProject];
      log(`■ ${entry.key} = ${values[entry.key]}${entry.note ? ` (${entry.note})` : ''}`);
      continue;
    }
    const answer = (await visible(`■ ${entry.key} — ${entry.hint}`)).trim();
    if (answer) values[entry.key] = answer;
    else if (!entry.optional) missing.push(entry.key);
  }
  write(file, renderEnvYaml(values));
  log('');
  log(`저장: ${file}`);
  if (missing.length > 0) log(`비어 있는 필수 값(R9 전에 채움): ${missing.join(', ')}`);
  return { file, values, missing };
}

export const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2';

// Cloud Run은 앞단 구성이 Railway와 달라 홉 수를 그대로 옮기지 않는다(R8·R10 실측값을 쓴다).
const NOT_COPIED_FROM_RAILWAY = new Set(['TRUST_PROXY_HOPS']);

async function railwayQuery({ token, query, variables, fetchImpl, label }) {
  const response = await fetchImpl(RAILWAY_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Project-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Railway ${label} HTTP ${response.status}`);
  const body = await response.json();
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    throw new Error(`Railway ${label} 오류: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return body?.data;
}

/**
 * project token이 가리키는 환경이 기대한 환경인지 확인하고, API 서비스의 변수(공유 변수 포함)를 읽는다.
 * 서비스 변수가 같은 이름의 공유 변수보다 우선한다.
 */
export async function readRailwayApiVariables({
  token,
  expectedEnvironment,
  serviceId,
  chooseService,
  fetchImpl = fetch,
}) {
  const scope = await railwayQuery({
    token,
    fetchImpl,
    label: '토큰 확인',
    query: 'query { projectToken { projectId environmentId } }',
  });
  const projectId = scope?.projectToken?.projectId;
  const environmentId = scope?.projectToken?.environmentId;
  if (!projectId || !environmentId) {
    throw new Error(
      'project token이 아닙니다. Railway 프로젝트 설정 → Tokens에서 만든 토큰이 필요합니다.',
    );
  }
  const project = await railwayQuery({
    token,
    fetchImpl,
    label: '프로젝트 조회',
    query:
      'query ($id: String!) { project(id: $id) { services { edges { node { id name } } } environments { edges { node { id name } } } } }',
    variables: { id: projectId },
  });
  const environments = project?.project?.environments?.edges?.map((edge) => edge.node) ?? [];
  const environmentName = environments.find((env) => env.id === environmentId)?.name;
  if (environmentName !== expectedEnvironment) {
    throw new Error(
      `토큰은 "${environmentName ?? '알 수 없음'}" 환경용입니다. "${expectedEnvironment}" 환경 토큰이 필요합니다.`,
    );
  }
  const services = project?.project?.services?.edges?.map((edge) => edge.node) ?? [];
  let service = serviceId ? services.find((entry) => entry.id === serviceId) : null;
  if (serviceId && !service) throw new Error(`서비스 ${serviceId}가 이 프로젝트에 없습니다.`);
  if (!service) {
    const apiLike = services.filter((entry) => /api/i.test(entry.name));
    service = apiLike.length === 1 ? apiLike[0] : await chooseService(services);
  }
  if (!service) throw new Error('API 서비스를 고르지 않았습니다.');

  const query =
    'query ($projectId: String!, $environmentId: String!, $serviceId: String) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }';
  const read = async (id, label) =>
    (
      await railwayQuery({
        token,
        fetchImpl,
        label,
        query,
        variables: { projectId, environmentId, serviceId: id },
      })
    )?.variables ?? {};
  const shared = await read(null, '공유 변수 조회');
  const own = await read(service.id, '서비스 변수 조회');
  return { service, environmentName, variables: { ...shared, ...own } };
}

/** Railway 변수에서 옮길 비밀값·일반 값을 고른다. 값은 돌려주지만 로그에는 이름만 쓴다. */
export function planFromRailway(variables, target) {
  const present = (key) => typeof variables[key] === 'string' && variables[key] !== '';
  const secrets = SECRET_KEYS.filter((entry) => present(entry.key));
  const missingSecrets = SECRET_KEYS.filter((entry) => !present(entry.key)).map(
    (entry) => entry.key,
  );
  const plain = {};
  const missingPlain = [];
  for (const entry of PLAIN_KEYS) {
    if (entry.value !== undefined || entry.fromProject) {
      plain[entry.key] = entry.value ?? target[entry.fromProject];
    } else if (!NOT_COPIED_FROM_RAILWAY.has(entry.key) && present(entry.key)) {
      plain[entry.key] = variables[entry.key];
    } else if (!entry.optional) {
      missingPlain.push(entry.key);
    }
  }
  return { secrets, missingSecrets, plain, missingPlain };
}

async function chooseServiceInteractively(services, visible, log) {
  log('API 서비스를 고르세요.');
  for (const [index, entry] of services.entries()) log(`  ${index + 1}. ${entry.name}`);
  const answer = Number.parseInt((await visible('  번호')).trim(), 10);
  return services[answer - 1] ?? null;
}

/**
 * 교체가 끝난 Railway에서 새 값을 읽어 Secret Manager(비밀값)와 env YAML(일반 값)로 옮긴다.
 * 값은 화면·인자·로그에 남기지 않고, 이름 목록을 보여 준 뒤 프로젝트 이름을 직접 입력해야 쓴다.
 */
export async function runFromRailway({
  project,
  out,
  serviceId,
  fetchImpl = fetch,
  gcloud = runGcloud,
  hidden = readHidden,
  visible = readVisible,
  write = writeEnvFile,
  log = (line) => process.stderr.write(`${line}\n`),
}) {
  const target = resolveProject(project);
  const file = out || defaultEnvFile(target.project);
  log(
    `[${target.label} ${target.project}] Railway "${target.environmentName}" 환경 값을 옮깁니다.`,
  );
  log('⚠️ Railway 값을 먼저 최신으로 바꾼 뒤에 실행하세요. 아직이면 지금 Ctrl+C로 멈추세요.');
  const token = await hidden('Railway project token');
  if (!token) throw new Error('토큰을 넣지 않아 멈춥니다.');
  const read = await readRailwayApiVariables({
    token,
    expectedEnvironment: target.environmentName,
    serviceId,
    chooseService: (services) => chooseServiceInteractively(services, visible, log),
    fetchImpl,
  });
  const plan = planFromRailway(read.variables, target);
  log(`✅ Railway ${read.environmentName} / 서비스 ${read.service.name}`);
  log(
    `비밀값 → Secret Manager ${plan.secrets.length}개: ${plan.secrets.map((e) => e.key).join(', ') || '없음'}`,
  );
  log(`Railway에 없는 비밀값: ${plan.missingSecrets.join(', ') || '없음'}`);
  log(`일반 값 → ${file}: ${Object.keys(plan.plain).join(', ')}`);
  if (plan.missingPlain.length > 0) {
    log(`비어 있는 필수 일반 값(R9 전에 env로 채움): ${plan.missingPlain.join(', ')}`);
  }
  const confirm = (await visible(`계속하려면 프로젝트 이름(${target.project})을 입력`)).trim();
  if (confirm !== target.project) {
    log('입력이 달라 아무것도 쓰지 않았습니다.');
    return { stored: [], skipped: plan.secrets.map((e) => e.key), file: null };
  }

  const summary = { stored: [], skipped: [], file };
  for (const entry of plan.secrets) {
    const inspected = inspectSecretValue(entry, read.variables[entry.key]);
    if (inspected.value === null) {
      summary.skipped.push(entry.key);
      log(`■ ${entry.key} 건너뜀: ${inspected.error}`);
      continue;
    }
    const exists =
      (await gcloud(secretArgs({ action: 'describe', name: entry.key, project: target.project })))
        .code === 0;
    const stored = await storeSecret({
      gcloud,
      target,
      name: entry.key,
      value: inspected.value,
      exists,
    });
    summary.stored.push(entry.key);
    for (const warning of inspected.warnings) log(`  주의(${entry.key}): ${warning}`);
    log(`■ ${entry.key} 저장됨(버전 ${stored.version})${disabledNote(stored.disabled)}`);
  }
  write(file, renderEnvYaml(plan.plain));
  log('');
  log(
    `비밀값 저장 ${summary.stored.length}개, 건너뜀 ${summary.skipped.length}개. 일반 값 저장: ${file}`,
  );
  return summary;
}

export function describeKeys() {
  const lines = ['비밀값 → Secret Manager'];
  for (const entry of SECRET_KEYS) lines.push(`  ${entry.key} — ${entry.hint}`);
  lines.push('', '일반 값 → Cloud Run 환경 변수');
  for (const entry of PLAIN_KEYS) {
    const detail = entry.value ?? (entry.fromProject ? '(프로젝트에 따라 자동)' : entry.hint);
    lines.push(`  ${entry.key}${entry.optional ? '(선택)' : ''} — ${detail}`);
  }
  lines.push('', '옮기지 않음');
  for (const [key, reason] of Object.entries(EXCLUDED_KEYS)) lines.push(`  ${key} — ${reason}`);
  return lines.join('\n');
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (const arg of rest) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`알 수 없는 인자: ${arg}`);
    options[match[1]] = match[2];
  }
  return { command, options };
}

export async function main(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case 'list':
      process.stdout.write(`${describeKeys()}\n`);
      return;
    case 'secrets':
      await runSecrets({ project: options.project, keys: selectSecretKeys(options.only) });
      return;
    case 'env':
      await runEnv({ project: options.project, out: options.out });
      return;
    case 'from-railway':
      await runFromRailway({
        project: options.project,
        out: options.out,
        serviceId: options['service-id'],
      });
      return;
    default:
      throw new Error('명령은 list|secrets|env|from-railway 중 하나여야 합니다.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`실패: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

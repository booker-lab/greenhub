#!/usr/bin/env node
/**
 * Railway API 변수(JSON)를 Cloud Run용으로 옮긴다. 절차서: docs/specs/ops/api-cloud-run-runbook.md R6(운영)·R8(시험).
 *
 * 실행(Cloud Shell):
 *   node cloud-run-import-env.mjs --project=green-e4fe3 --source=<Railway 변수 JSON> --out=<일반 값 YAML>
 *
 * - 비밀값은 Secret Manager에 새 버전으로 넣고(라벨 greenhub-api=env), 런타임 계정에 읽기 권한을 준다.
 * - 일반 값은 `gcloud run deploy --env-vars-file`용 YAML로 쓴다. 쉼표가 든 값(CORS_ORIGIN·JSON)도 그대로 간다.
 * - 배포 명령이 넣는 값, ADC로 대체하는 키 파일, 운영에 있으면 안 되는 E2E 값은 옮기지 않는다.
 * - 목록에 없는 키는 옮기지 않고 이름만 알린다(사람이 분류를 정한 뒤 다시 실행한다).
 * - 값은 출력·오류 어디에도 싣지 않는다. 보고에는 키 이름만 있다.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 옮길 수 있는 프로젝트. 다른 프로젝트는 거부한다. */
export const TARGETS = Object.freeze({
  'green-e4fe3': 'production',
  'greenhub-round-direct-e2e': 'staging',
});

export const SECRET_KEYS = Object.freeze([
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'PORTONE_V2_SECRET',
  'PORTONE_WEBHOOK_SECRET',
  'ALIGO_API_KEY',
  'ALIGO_SENDER_KEY',
  // Fixie 프록시 주소에는 접속 비밀번호가 들어 있다(apps/api/src/notifications/aligo.client.ts).
  'ALIGO_OUTBOUND_PROXY_URL',
  'OPS_TELEGRAM_BOT_TOKEN',
  'KAKAO_ADMIN_KEY',
  'GEMINI_API_KEY',
]);

export const PLAIN_KEYS = Object.freeze([
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'CORS_ORIGIN',
  'CORS_ALLOW_VERCEL_PREVIEWS',
  'VERCEL_PREVIEW_PROJECTS',
  'PORTONE_STORE_ID',
  'ALIGO_USER_ID',
  'ALIGO_SENDER_PHONE',
  'ALIGO_TEMPLATE_CODES_JSON',
  'OPS_TELEGRAM_CHAT_ID',
  'KAKAO_APP_ID',
  'PLATFORM_FEE_RATE',
  'SETTLEMENT_CONFIRM_DELAY_DAYS',
  'GREENHUB_FEATURES',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
]);

/** 시험 서비스만 쓰는 회차 E2E 값. 운영에 있으면 옮기지 않고 알린다. */
export const E2E_SECRET_KEYS = Object.freeze(['ROUND_DIRECT_E2E_SHARED_SECRET']);
export const E2E_PLAIN_KEYS = Object.freeze([
  'ROUND_DIRECT_E2E_ENABLED',
  'ROUND_DIRECT_E2E_ENV',
  'ROUND_DIRECT_E2E_PROVIDER_MODE',
  'ROUND_DIRECT_E2E_RUN_ID',
  'ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS',
  'ROUND_DIRECT_E2E_PORTONE_FIXTURES_JSON',
]);

/** 배포 명령(R9)이 넣거나 Cloud Run이 넣거나 ADC(R3)로 대체하는 값. */
export const SKIPPED_KEYS = Object.freeze([
  'PORT',
  'NODE_ENV',
  'GREENHUB_ENVIRONMENT_NAME',
  'GREENHUB_COMMIT_SHA',
  'TRUST_PROXY_HOPS',
  'GREENHUB_SCHEDULES_ENABLED',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'FIRESTORE_EMULATOR_HOST',
  'FIREBASE_AUTH_EMULATOR_HOST',
  'VERCEL_ENV',
]);
const SKIPPED_PREFIXES = ['RAILWAY_', 'GREENHUB_LOCAL_'];

export const SECRET_LABEL_KEY = 'greenhub-api';
export const SECRET_LABEL = `${SECRET_LABEL_KEY}=env`;
const SECRET_LOCATION = 'asia-northeast3';

/**
 * 변수를 분류한다. 값이 빈 키는 옮기지 않는다(API는 빈 값과 없는 값을 같게 읽는다).
 * @returns {{ secrets: [string, string][], plain: [string, string][], skipped: string[],
 *   empty: string[], unknown: string[], e2eInProduction: string[] }}
 */
export function classifyVariables(variables, target) {
  const plan = { secrets: [], plain: [], skipped: [], empty: [], unknown: [], e2eInProduction: [] };
  const e2eKeys = new Set([...E2E_SECRET_KEYS, ...E2E_PLAIN_KEYS]);
  const secretKeys = new Set([...SECRET_KEYS, ...(target === 'staging' ? E2E_SECRET_KEYS : [])]);
  const plainKeys = new Set([...PLAIN_KEYS, ...(target === 'staging' ? E2E_PLAIN_KEYS : [])]);
  for (const key of Object.keys(variables).sort()) {
    const raw = variables[key];
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (SKIPPED_KEYS.includes(key) || SKIPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      plan.skipped.push(key);
    } else if (
      target === 'production' &&
      (e2eKeys.has(key) || key.startsWith('ROUND_DIRECT_E2E_'))
    ) {
      plan.e2eInProduction.push(key);
    } else if (!value.trim()) {
      plan.empty.push(key);
    } else if (secretKeys.has(key)) {
      plan.secrets.push([key, value]);
    } else if (plainKeys.has(key)) {
      plan.plain.push([key, value]);
    } else {
      plan.unknown.push(key);
    }
  }
  return plan;
}

/** `--env-vars-file`용 YAML. JSON 문자열은 YAML 큰따옴표 문자열로도 같게 읽힌다(앞자리 0·쉼표 보존). */
export function toEnvVarsYaml(entries) {
  return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join('');
}

function defaultRunGcloud(args, input) {
  const result = spawnSync('gcloud', [...args, '--quiet'], { input, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stderr: result.error ? String(result.error) : result.stderr,
  };
}

/**
 * 비밀값을 Secret Manager에 넣는다. 값은 표준 입력으로만 넘기고 명령 인자에 싣지 않는다.
 * gcloud 오류 문구에 값이 섞여 있으면 가린 뒤 알린다.
 */
export function importVariables({ project, variables, runGcloud = defaultRunGcloud }) {
  const target = TARGETS[project];
  if (!target) {
    throw new Error(
      `허용하지 않은 프로젝트입니다: ${project} (${Object.keys(TARGETS).join(', ')} 중 하나)`,
    );
  }
  const plan = classifyVariables(variables, target);
  const runtime = `greenhub-api-runtime@${project}.iam.gserviceaccount.com`;
  const scope = `--project=${project}`;
  for (const [key, value] of plan.secrets) {
    const mustRun = (args, input) => {
      const result = runGcloud([...args, scope], input);
      if (result.status !== 0) {
        const detail = String(result.stderr ?? '')
          .split(value)
          .join('[값 숨김]')
          .trim()
          .slice(-400);
        throw new Error(`gcloud ${args.slice(0, 3).join(' ')} 실패\n${detail}`);
      }
    };
    const exists =
      runGcloud(['secrets', 'describe', key, scope, '--format=value(name)']).status === 0;
    if (exists) {
      mustRun(['secrets', 'update', key, `--update-labels=${SECRET_LABEL}`]);
    } else {
      mustRun([
        'secrets',
        'create',
        key,
        '--replication-policy=user-managed',
        `--locations=${SECRET_LOCATION}`,
        `--labels=${SECRET_LABEL}`,
      ]);
    }
    mustRun(['secrets', 'versions', 'add', key, '--data-file=-'], value);
    mustRun([
      'secrets',
      'add-iam-policy-binding',
      key,
      `--member=serviceAccount:${runtime}`,
      '--role=roles/secretmanager.secretAccessor',
    ]);
  }
  return { target, ...plan };
}

export function formatReport(result, out) {
  const names = (keys) => (keys.length ? keys.join(', ') : '-');
  const lines = [
    `대상: ${result.target}`,
    `비밀값 ${result.secrets.length}개(Secret Manager): ${names(result.secrets.map(([key]) => key))}`,
    `일반 값 ${result.plain.length}개(${out}): ${names(result.plain.map(([key]) => key))}`,
    `옮기지 않음 ${result.skipped.length}개(배포 명령·ADC가 대신함): ${names(result.skipped)}`,
    `빈 값 ${result.empty.length}개: ${names(result.empty)}`,
  ];
  if (result.e2eInProduction.length) {
    lines.push(
      `경고: 운영에 회차 E2E 값이 있습니다(옮기지 않음): ${names(result.e2eInProduction)}`,
    );
  }
  if (result.unknown.length) {
    lines.push(
      `모르는 키 ${result.unknown.length}개(옮기지 않음, 분류를 정한 뒤 다시 실행): ${names(result.unknown)}`,
    );
  }
  return lines.join('\n');
}

export function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const match = /^--(project|source|out)=(.+)$/.exec(arg);
    if (!match) throw new Error(`알 수 없는 인자입니다: ${arg}`);
    options[match[1]] = match[2];
  }
  for (const name of ['project', 'source', 'out']) {
    if (!options[name]) throw new Error(`--${name}=…가 필요합니다.`);
  }
  return options;
}

export function main(
  argv,
  { readFile = (path) => readFileSync(path, 'utf8'), writeFile = writeFileSync, runGcloud } = {},
) {
  const options = parseArgs(argv);
  let variables;
  try {
    variables = JSON.parse(readFile(options.source).replace(/^﻿/, ''));
  } catch {
    // 내용 일부라도 오류에 싣지 않는다.
    throw new Error('Railway 변수 파일이 JSON이 아닙니다. Raw Editor의 JSON 형식으로 복사하세요.');
  }
  if (typeof variables !== 'object' || variables === null || Array.isArray(variables)) {
    throw new Error('Railway 변수 파일은 {"KEY": "값", ...} 모양이어야 합니다.');
  }
  const result = importVariables({ project: options.project, variables, runGcloud });
  writeFile(options.out, toEnvVarsYaml(result.plain), { mode: 0o600 });
  return formatReport(result, options.out);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

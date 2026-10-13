#!/usr/bin/env node
/**
 * 운영 Firestore 인덱스와 `firestore.indexes.json`의 차이를 모양(이름·필드)으로만 비교한다(읽기 전용).
 * `.github/workflows/prod-config-check.yml`의 index-drift job이 부른다.
 *
 *   npx -y firebase-tools@14.11.1 firestore:indexes --project green-e4fe3 --json > prod.json
 *   node scripts/release/firestore-index-drift.mjs --production=prod.json [--file=firestore.indexes.json]
 *
 * 비교 대상:
 * - composite index: collectionGroup + queryScope + fields(fieldPath와 order/arrayConfig/vectorConfig)
 * - fieldOverrides: collectionGroup + fieldPath + ttl + 단일 필드 index 설정
 * 문서 데이터는 읽지 않는다. 출력에는 인덱스 모양만 들어간다.
 *
 * 정규화 규칙(firebase-tools 14.11.1 firestore:indexes·deploy 비교와 맞춘다):
 * - 목록 안 인덱스 순서와 객체 key 순서는 비교에 쓰지 않는다. 한 인덱스 안 필드 순서는 의미가 있어 그대로 둔다.
 * - order·arrayConfig·vectorConfig가 모두 없는 필드는 ASCENDING으로 본다. queryScope가 없으면 COLLECTION.
 * - 마지막 `__name__` 필드가 암묵 방향(앞 필드의 order, 없으면 ASCENDING)과 같으면 지운다.
 * - fieldOverrides의 ttl이 없으면 false, 단일 필드 index 목록은 순서 없이 비교한다.
 *
 * 차이는 WARN으로만 보고하고 exit 0. 입력을 읽거나 해석하지 못하면 exit 1(fail closed).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PASS = 'PASS';
export const WARN = 'WARN';

const ORDERS = new Set(['ASCENDING', 'DESCENDING']);
const ARRAY_CONFIGS = new Set(['CONTAINS']);
const QUERY_SCOPES = new Set(['COLLECTION', 'COLLECTION_GROUP']);
const ERROR_MESSAGE_LIMIT = 300;

export class DriftInputError extends Error {}

function fail(message) {
  throw new DriftInputError(message);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

function normalizeQueryScope(value, where) {
  const scope = value ?? 'COLLECTION';
  if (!QUERY_SCOPES.has(scope)) fail(`${where}: 알 수 없는 queryScope`);
  return scope;
}

function normalizeIndexField(field, where) {
  if (!field || typeof field !== 'object') fail(`${where}: 필드 형식이 올바르지 않습니다.`);
  if (!nonEmptyString(field.fieldPath)) fail(`${where}: fieldPath가 없습니다.`);
  const kinds = ['order', 'arrayConfig', 'vectorConfig'].filter(
    (key) => field[key] !== undefined && field[key] !== null,
  );
  if (kinds.length > 1)
    fail(`${where}: ${field.fieldPath}에 order·arrayConfig·vectorConfig가 겹칩니다.`);
  const kind = kinds[0] ?? 'order';
  if (kind === 'order') {
    const order = field.order ?? 'ASCENDING';
    if (!ORDERS.has(order)) fail(`${where}: ${field.fieldPath}의 order가 올바르지 않습니다.`);
    return { fieldPath: field.fieldPath, order };
  }
  if (kind === 'arrayConfig') {
    if (!ARRAY_CONFIGS.has(field.arrayConfig)) {
      fail(`${where}: ${field.fieldPath}의 arrayConfig가 올바르지 않습니다.`);
    }
    return { fieldPath: field.fieldPath, arrayConfig: field.arrayConfig };
  }
  const dimension = field.vectorConfig?.dimension;
  if (!Number.isInteger(dimension))
    fail(`${where}: ${field.fieldPath}의 vectorConfig가 올바르지 않습니다.`);
  return { fieldPath: field.fieldPath, vectorConfig: { dimension } };
}

/** 마지막 `__name__`이 Firestore가 붙이는 암묵 방향과 같으면 지운다. */
function dropImplicitName(fields) {
  if (fields.length < 2) return fields;
  const last = fields.at(-1);
  if (last.fieldPath !== '__name__' || last.order === undefined) return fields;
  const implicit = fields.at(-2).order ?? 'ASCENDING';
  return last.order === implicit ? fields.slice(0, -1) : fields;
}

/** composite index 한 개를 비교용 모양으로 바꾼다. 형식이 맞지 않으면 DriftInputError. */
export function normalizeIndex(index, where = 'index') {
  if (!index || typeof index !== 'object') fail(`${where}: 형식이 올바르지 않습니다.`);
  const collectionGroup = index.collectionGroup ?? index.collectionId;
  if (!nonEmptyString(collectionGroup)) fail(`${where}: collectionGroup이 없습니다.`);
  if (!Array.isArray(index.fields) || index.fields.length === 0)
    fail(`${where}: fields가 없습니다.`);
  const fields = index.fields.map((field, i) =>
    normalizeIndexField(field, `${where}.fields[${i}]`),
  );
  return {
    collectionGroup,
    queryScope: normalizeQueryScope(index.queryScope, where),
    fields: dropImplicitName(fields),
  };
}

function describeField(field) {
  if (field.arrayConfig) return `${field.fieldPath} ${field.arrayConfig}`;
  if (field.vectorConfig) return `${field.fieldPath} VECTOR(${field.vectorConfig.dimension})`;
  return `${field.fieldPath} ${field.order === 'DESCENDING' ? 'DESC' : 'ASC'}`;
}

/** 정규화된 index를 한 줄로 쓴다. 예: `orders (COLLECTION) [userId ASC, createdAt DESC]` */
export function describeIndex(index) {
  return `${index.collectionGroup} (${index.queryScope}) [${index.fields.map(describeField).join(', ')}]`;
}

function normalizeOverrideIndex(entry, where) {
  if (!entry || typeof entry !== 'object') fail(`${where}: 형식이 올바르지 않습니다.`);
  const hasOrder = entry.order !== undefined && entry.order !== null;
  const hasArray = entry.arrayConfig !== undefined && entry.arrayConfig !== null;
  if (hasOrder === hasArray) fail(`${where}: order와 arrayConfig 중 하나만 있어야 합니다.`);
  if (hasOrder && !ORDERS.has(entry.order)) fail(`${where}: order가 올바르지 않습니다.`);
  if (hasArray && !ARRAY_CONFIGS.has(entry.arrayConfig)) {
    fail(`${where}: arrayConfig가 올바르지 않습니다.`);
  }
  return `${hasOrder ? entry.order : entry.arrayConfig} ${normalizeQueryScope(entry.queryScope, where)}`;
}

/** fieldOverride 한 개를 비교용 모양으로 바꾼다. */
export function normalizeFieldOverride(override, where = 'fieldOverride') {
  if (!override || typeof override !== 'object') fail(`${where}: 형식이 올바르지 않습니다.`);
  if (!nonEmptyString(override.collectionGroup)) fail(`${where}: collectionGroup이 없습니다.`);
  if (!nonEmptyString(override.fieldPath)) fail(`${where}: fieldPath가 없습니다.`);
  if (!Array.isArray(override.indexes)) fail(`${where}: indexes가 없습니다.`);
  if (override.ttl !== undefined && typeof override.ttl !== 'boolean') {
    fail(`${where}: ttl이 boolean이 아닙니다.`);
  }
  const indexes = [
    ...new Set(
      override.indexes.map((entry, i) => normalizeOverrideIndex(entry, `${where}.indexes[${i}]`)),
    ),
  ].sort();
  return {
    collectionGroup: override.collectionGroup,
    fieldPath: override.fieldPath,
    ttl: override.ttl === true,
    indexes,
  };
}

export function describeFieldOverride(override) {
  return `${override.collectionGroup}.${override.fieldPath} ttl=${override.ttl} indexes=[${override.indexes.join(', ')}]`;
}

/**
 * firebase-tools 14.11.1은 마지막 `__name__`을 앞 필드의 order와 같을 때만 지운다.
 * 앞 필드가 arrayConfig·vectorConfig면 `__name__`이 남아 deploy가 파일에 없는 인덱스로 셀 수 있다.
 * 이 스크립트는 이런 인덱스를 같은 모양으로 보되, 원인을 알 수 있게 따로 표시한다.
 */
export function keepsNameInFirebaseTools(index) {
  const fields = Array.isArray(index?.fields) ? index.fields : [];
  if (fields.length < 2) return false;
  const last = fields.at(-1);
  const prev = fields.at(-2);
  return (
    last?.fieldPath === '__name__' && (last.order ?? 'ASCENDING') === 'ASCENDING' && !prev?.order
  );
}

/** index 파일 형식(`{ indexes, fieldOverrides? }`)을 정규화한다. */
export function normalizeSpec(spec, label) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec))
    fail(`${label}: 형식이 올바르지 않습니다.`);
  if (!Array.isArray(spec.indexes)) fail(`${label}: indexes 배열이 없습니다.`);
  const overrides = spec.fieldOverrides ?? [];
  if (!Array.isArray(overrides)) fail(`${label}: fieldOverrides가 배열이 아닙니다.`);
  const indexes = spec.indexes.map((index, i) => normalizeIndex(index, `${label}.indexes[${i}]`));
  return {
    indexes,
    trailingNameAfterNonOrder: indexes.filter((_, i) => keepsNameInFirebaseTools(spec.indexes[i])),
    fieldOverrides: overrides.map((entry, i) =>
      normalizeFieldOverride(entry, `${label}.fieldOverrides[${i}]`),
    ),
  };
}

function oneLine(value) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, ERROR_MESSAGE_LIMIT);
}

/**
 * `firebase firestore:indexes --json` 출력(`{ status, result }`)이나 index 파일 형식 JSON을 읽는다.
 * status가 error면 CLI 오류 메시지(한 줄, 길이 제한)를 담아 DriftInputError.
 */
export function parseProductionOutput(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail('운영 인덱스 출력이 JSON이 아닙니다.');
  }
  if (body && typeof body === 'object' && 'status' in body) {
    if (body.status !== 'success') {
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      fail(`운영 인덱스 조회 실패${message ? `: ${oneLine(message)}` : ''}`);
    }
    return body.result;
  }
  return body;
}

function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { item, count: 1 });
  }
  return counts;
}

function surplus(left, right) {
  const result = [];
  for (const [key, { item, count }] of left) {
    const extra = count - (right.get(key)?.count ?? 0);
    for (let i = 0; i < extra; i += 1) result.push(item);
  }
  return result;
}

const indexKey = (index) => JSON.stringify(index);
const overrideKey = (override) => `${override.collectionGroup}\u0000${override.fieldPath}`;

/**
 * 정규화된 운영·파일 spec을 비교한다.
 * - indexes: 모양이 같은 것끼리 짝짓고(중복은 개수로) 남는 것을 운영에만/파일에만으로 나눈다.
 * - fieldOverrides: collectionGroup+fieldPath로 짝짓고 설정이 다르면 different에 넣는다.
 */
export function diffSpecs({ production, file }) {
  const prodIndexes = countBy(production.indexes, indexKey);
  const fileIndexes = countBy(file.indexes, indexKey);
  const byDescription = (a, b) => describeIndex(a).localeCompare(describeIndex(b));

  const prodOverrides = new Map(production.fieldOverrides.map((o) => [overrideKey(o), o]));
  const fileOverrides = new Map(file.fieldOverrides.map((o) => [overrideKey(o), o]));
  const onlyInProduction = [];
  const different = [];
  for (const [key, prod] of prodOverrides) {
    const local = fileOverrides.get(key);
    if (!local) onlyInProduction.push(prod);
    else if (JSON.stringify(local) !== JSON.stringify(prod))
      different.push({ production: prod, file: local });
  }
  const onlyInFile = [...fileOverrides]
    .filter(([key]) => !prodOverrides.has(key))
    .map(([, o]) => o);
  const byOverride = (a, b) => describeFieldOverride(a).localeCompare(describeFieldOverride(b));

  return {
    indexes: {
      production: production.indexes.length,
      file: file.indexes.length,
      onlyInProduction: surplus(prodIndexes, fileIndexes).sort(byDescription),
      onlyInFile: surplus(fileIndexes, prodIndexes).sort(byDescription),
      trailingNameAfterNonOrder: [...(production.trailingNameAfterNonOrder ?? [])].sort(
        byDescription,
      ),
    },
    fieldOverrides: {
      production: production.fieldOverrides.length,
      file: file.fieldOverrides.length,
      onlyInProduction: onlyInProduction.sort(byOverride),
      onlyInFile: onlyInFile.sort(byOverride),
      different: different.sort((a, b) => byOverride(a.production, b.production)),
    },
  };
}

export function hasDrift(diff) {
  return (
    diff.indexes.onlyInProduction.length > 0 ||
    diff.indexes.onlyInFile.length > 0 ||
    diff.fieldOverrides.onlyInProduction.length > 0 ||
    diff.fieldOverrides.onlyInFile.length > 0 ||
    diff.fieldOverrides.different.length > 0
  );
}

export function summarizeDiff(diff) {
  return {
    drift: hasDrift(diff),
    indexes: {
      production: diff.indexes.production,
      file: diff.indexes.file,
      onlyInProduction: diff.indexes.onlyInProduction.length,
      onlyInFile: diff.indexes.onlyInFile.length,
      trailingNameAfterNonOrder: diff.indexes.trailingNameAfterNonOrder.length,
    },
    fieldOverrides: {
      production: diff.fieldOverrides.production,
      file: diff.fieldOverrides.file,
      onlyInProduction: diff.fieldOverrides.onlyInProduction.length,
      onlyInFile: diff.fieldOverrides.onlyInFile.length,
      different: diff.fieldOverrides.different.length,
    },
  };
}

export function formatDiff(diff) {
  const lines = [];
  const indexDrift = diff.indexes.onlyInProduction.length + diff.indexes.onlyInFile.length > 0;
  lines.push(
    `composite_indexes: ${indexDrift ? WARN : PASS} - 운영 ${diff.indexes.production}, 파일 ${diff.indexes.file}`,
  );
  for (const index of diff.indexes.onlyInProduction)
    lines.push(`  운영에만: ${describeIndex(index)}`);
  for (const index of diff.indexes.onlyInFile) lines.push(`  파일에만: ${describeIndex(index)}`);
  for (const index of diff.indexes.trailingNameAfterNonOrder) {
    lines.push(
      `  참고(배열·벡터 필드 뒤 __name__ ASC, firebase deploy는 차이로 셀 수 있음): ${describeIndex(index)}`,
    );
  }

  const fo = diff.fieldOverrides;
  const overrideDrift = fo.onlyInProduction.length + fo.onlyInFile.length + fo.different.length > 0;
  lines.push(
    `field_overrides: ${overrideDrift ? WARN : PASS} - 운영 ${fo.production}, 파일 ${fo.file}`,
  );
  for (const o of fo.onlyInProduction) lines.push(`  운영에만: ${describeFieldOverride(o)}`);
  for (const o of fo.onlyInFile) lines.push(`  파일에만: ${describeFieldOverride(o)}`);
  for (const { production, file } of fo.different) {
    lines.push(`  다름(운영): ${describeFieldOverride(production)}`);
    lines.push(`  다름(파일): ${describeFieldOverride(file)}`);
  }
  lines.push(JSON.stringify(summarizeDiff(diff)));
  return `${lines.join('\n')}\n`;
}

export function parseArgs(argv) {
  const args = { file: 'firestore.indexes.json' };
  for (const arg of argv) {
    const match = /^--(production|file)=(.+)$/.exec(arg);
    if (!match) fail(`알 수 없는 인자: ${oneLine(arg)}`);
    args[match[1]] = match[2];
  }
  if (!args.production) fail('--production=<firestore:indexes --json 출력 파일>이 필요합니다.');
  return args;
}

function readText(readFile, path, label) {
  try {
    return readFile(path);
  } catch {
    fail(`${label}을(를) 읽지 못했습니다.`);
  }
}

function defaultAppendSummary(env) {
  const file = env.GITHUB_STEP_SUMMARY;
  return file ? (text) => appendFileSync(file, text) : () => {};
}

/** 비교를 실행한다. 반환값 ok=false는 입력을 읽거나 해석하지 못한 경우뿐이다. */
export function run({
  argv = process.argv.slice(2),
  env = process.env,
  readFile = (path) => readFileSync(path, 'utf8'),
  write = (text) => process.stdout.write(text),
  appendSummary = defaultAppendSummary(env),
} = {}) {
  const title = '## Firestore 인덱스 비교(운영 ↔ firestore.indexes.json)\n\n';
  let report;
  let diff;
  try {
    const args = parseArgs(argv);
    const productionSpec = parseProductionOutput(
      readText(readFile, args.production, '운영 인덱스 출력'),
    );
    let fileSpec;
    try {
      fileSpec = JSON.parse(readText(readFile, args.file, 'index 파일'));
    } catch (error) {
      if (error instanceof DriftInputError) throw error;
      fail('index 파일이 JSON이 아닙니다.');
    }
    diff = diffSpecs({
      production: normalizeSpec(productionSpec, 'production'),
      file: normalizeSpec(fileSpec, 'file'),
    });
    report = formatDiff(diff);
  } catch (error) {
    const message =
      error instanceof DriftInputError ? error.message : (error?.name ?? '알 수 없는 오류');
    const text = `error: ${message}\n`;
    write(text);
    appendSummary(`${title}\`\`\`\n${text}\`\`\`\n`);
    return { ok: false };
  }
  write(report);
  if (env.GITHUB_ACTIONS === 'true' && hasDrift(diff)) {
    write(
      '::warning title=Firestore 인덱스 차이::운영과 firestore.indexes.json의 인덱스가 다릅니다. Step summary를 확인하세요.\n',
    );
  }
  appendSummary(`${title}\`\`\`\n${report}\`\`\`\n`);
  return { ok: true, ...summarizeDiff(diff) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = run();
  process.exit(result.ok ? 0 : 1);
}

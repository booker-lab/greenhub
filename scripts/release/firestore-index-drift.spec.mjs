import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DriftInputError,
  describeIndex,
  diffSpecs,
  formatDiff,
  normalizeFieldOverride,
  normalizeIndex,
  normalizeSpec,
  parseProductionOutput,
  run,
} from './firestore-index-drift.mjs';

const ORDERS_INDEX = {
  collectionGroup: 'orders',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'userId', order: 'ASCENDING' },
    { fieldPath: 'createdAt', order: 'DESCENDING' },
  ],
};

const diff = (production, file) =>
  diffSpecs({
    production: normalizeSpec(production, 'production'),
    file: normalizeSpec(file, 'file'),
  });

test('object key 순서와 인덱스 목록 순서는 비교에 영향을 주지 않는다', () => {
  const other = {
    collectionGroup: 'products',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'storeId', order: 'ASCENDING' },
      { fieldPath: 'isActive', order: 'ASCENDING' },
    ],
  };
  const reordered = {
    fields: [
      { order: 'ASCENDING', fieldPath: 'userId' },
      { order: 'DESCENDING', fieldPath: 'createdAt' },
    ],
    queryScope: 'COLLECTION',
    collectionGroup: 'orders',
  };
  const result = diff({ indexes: [other, reordered] }, { indexes: [ORDERS_INDEX, other] });
  assert.deepEqual(result.indexes.onlyInProduction, []);
  assert.deepEqual(result.indexes.onlyInFile, []);
});

test('한 인덱스 안 필드 순서는 의미가 있어 바뀌면 차이로 본다', () => {
  const swapped = { ...ORDERS_INDEX, fields: [...ORDERS_INDEX.fields].reverse() };
  const result = diff({ indexes: [swapped] }, { indexes: [ORDERS_INDEX] });
  assert.equal(result.indexes.onlyInProduction.length, 1);
  assert.equal(result.indexes.onlyInFile.length, 1);
  assert.equal(
    describeIndex(result.indexes.onlyInProduction[0]),
    'orders (COLLECTION) [createdAt DESC, userId ASC]',
  );
});

test('order가 없는 필드는 ASCENDING, queryScope가 없으면 COLLECTION으로 본다', () => {
  assert.deepEqual(
    normalizeIndex({
      collectionGroup: 'orders',
      fields: [{ fieldPath: 'userId' }, { fieldPath: 'createdAt', order: 'DESCENDING' }],
    }),
    normalizeIndex(ORDERS_INDEX),
  );
});

test('마지막 __name__은 앞 필드와 방향이 같을 때만 지운다', () => {
  const implicit = {
    ...ORDERS_INDEX,
    fields: [...ORDERS_INDEX.fields, { fieldPath: '__name__', order: 'DESCENDING' }],
  };
  assert.deepEqual(normalizeIndex(implicit), normalizeIndex(ORDERS_INDEX));

  const explicit = {
    ...ORDERS_INDEX,
    fields: [...ORDERS_INDEX.fields, { fieldPath: '__name__', order: 'ASCENDING' }],
  };
  assert.equal(normalizeIndex(explicit).fields.length, 3);
  const result = diff({ indexes: [explicit] }, { indexes: [ORDERS_INDEX] });
  assert.equal(
    describeIndex(result.indexes.onlyInProduction[0]),
    'orders (COLLECTION) [userId ASC, createdAt DESC, __name__ ASC]',
  );
  assert.equal(
    describeIndex(result.indexes.onlyInFile[0]),
    'orders (COLLECTION) [userId ASC, createdAt DESC]',
  );
});

test('배열 필드 뒤 __name__ ASC는 같은 모양으로 보고 참고로 표시한다', () => {
  const fileIndex = {
    collectionGroup: 'products',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'storeId', order: 'ASCENDING' },
      { fieldPath: 'tags', arrayConfig: 'CONTAINS' },
    ],
  };
  const prodIndex = {
    ...fileIndex,
    fields: [...fileIndex.fields, { fieldPath: '__name__', order: 'ASCENDING' }],
  };
  const result = diff({ indexes: [prodIndex] }, { indexes: [fileIndex] });
  assert.deepEqual(result.indexes.onlyInProduction, []);
  assert.deepEqual(result.indexes.onlyInFile, []);
  assert.equal(result.indexes.trailingNameAfterNonOrder.length, 1);
  assert.match(
    formatDiff(result),
    /composite_indexes: PASS[\s\S]*참고\(.*\): products \(COLLECTION\) \[storeId ASC, tags CONTAINS\]/,
  );
});

test('arrayConfig와 order는 서로 다른 모양이다', () => {
  const contains = {
    collectionGroup: 'users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'tokenPrefixes', arrayConfig: 'CONTAINS' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  };
  const ordered = {
    ...contains,
    fields: [{ fieldPath: 'tokenPrefixes', order: 'ASCENDING' }, contains.fields[1]],
  };
  const result = diff({ indexes: [contains] }, { indexes: [ordered] });
  assert.equal(
    describeIndex(result.indexes.onlyInProduction[0]),
    'users (COLLECTION) [tokenPrefixes CONTAINS, createdAt DESC]',
  );
  assert.equal(
    describeIndex(result.indexes.onlyInFile[0]),
    'users (COLLECTION) [tokenPrefixes ASC, createdAt DESC]',
  );
});

test('queryScope가 다르면 다른 인덱스다', () => {
  const group = { ...ORDERS_INDEX, queryScope: 'COLLECTION_GROUP' };
  const result = diff({ indexes: [group] }, { indexes: [ORDERS_INDEX] });
  assert.equal(
    describeIndex(result.indexes.onlyInProduction[0]),
    'orders (COLLECTION_GROUP) [userId ASC, createdAt DESC]',
  );
  assert.equal(
    describeIndex(result.indexes.onlyInFile[0]),
    'orders (COLLECTION) [userId ASC, createdAt DESC]',
  );
});

test('중복 인덱스는 개수로 짝짓는다', () => {
  const result = diff({ indexes: [ORDERS_INDEX] }, { indexes: [ORDERS_INDEX, ORDERS_INDEX] });
  assert.equal(result.indexes.onlyInProduction.length, 0);
  assert.equal(result.indexes.onlyInFile.length, 1);
});

test('형식이 맞지 않는 인덱스는 fail closed', () => {
  assert.throws(
    () => normalizeIndex({ queryScope: 'COLLECTION', fields: [{ fieldPath: 'a' }] }),
    DriftInputError,
  );
  assert.throws(() => normalizeIndex({ collectionGroup: 'a', fields: [] }), DriftInputError);
  assert.throws(
    () =>
      normalizeIndex({
        collectionGroup: 'a',
        queryScope: 'DATABASE',
        fields: [{ fieldPath: 'a' }],
      }),
    DriftInputError,
  );
  assert.throws(
    () => normalizeIndex({ collectionGroup: 'a', fields: [{ fieldPath: 'a', order: 'UP' }] }),
    DriftInputError,
  );
  assert.throws(
    () =>
      normalizeIndex({ collectionGroup: 'a', fields: [{ fieldPath: 'a', arrayConfig: 'ANY' }] }),
    DriftInputError,
  );
  assert.throws(
    () =>
      normalizeIndex({
        collectionGroup: 'a',
        fields: [{ fieldPath: 'a', order: 'ASCENDING', arrayConfig: 'CONTAINS' }],
      }),
    DriftInputError,
  );
  assert.throws(() => normalizeSpec({ fieldOverrides: [] }, 'x'), DriftInputError);
});

test('fieldOverrides: ttl 기본값 false, index 순서 무시, 설정이 다르면 different', () => {
  const prod = {
    collectionGroup: 'orders',
    fieldPath: 'items',
    ttl: false,
    indexes: [
      { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' },
      { order: 'ASCENDING', queryScope: 'COLLECTION' },
    ],
  };
  const same = {
    collectionGroup: 'orders',
    fieldPath: 'items',
    indexes: [{ order: 'ASCENDING' }, { arrayConfig: 'CONTAINS' }],
  };
  assert.deepEqual(normalizeFieldOverride(same), normalizeFieldOverride(prod));

  const changed = { ...same, indexes: [{ order: 'ASCENDING' }] };
  const ttl = { collectionGroup: 'sessions', fieldPath: 'expiresAt', ttl: true, indexes: [] };
  const local = { collectionGroup: 'products', fieldPath: 'description', indexes: [] };
  const result = diff(
    { indexes: [], fieldOverrides: [prod, ttl] },
    { indexes: [], fieldOverrides: [changed, local] },
  );
  assert.deepEqual(
    result.fieldOverrides.onlyInProduction.map((o) => `${o.collectionGroup}.${o.fieldPath}`),
    ['sessions.expiresAt'],
  );
  assert.deepEqual(
    result.fieldOverrides.onlyInFile.map((o) => `${o.collectionGroup}.${o.fieldPath}`),
    ['products.description'],
  );
  assert.equal(result.fieldOverrides.different.length, 1);
  assert.throws(() => normalizeFieldOverride({ ...prod, ttl: 'yes' }), DriftInputError);
  assert.throws(
    () => normalizeFieldOverride({ ...prod, indexes: [{ queryScope: 'COLLECTION' }] }),
    DriftInputError,
  );
});

test('firebase --json 출력: success는 result를 쓰고 error는 한 줄 메시지로 실패한다', () => {
  const spec = { indexes: [ORDERS_INDEX], fieldOverrides: [] };
  assert.deepEqual(
    parseProductionOutput(JSON.stringify({ status: 'success', result: spec })),
    spec,
  );
  assert.deepEqual(parseProductionOutput(JSON.stringify(spec)), spec);
  assert.throws(
    () =>
      parseProductionOutput(
        JSON.stringify({ status: 'error', error: 'HTTP Error: 403,\n permission denied' }),
      ),
    { name: 'Error', message: '운영 인덱스 조회 실패: HTTP Error: 403, permission denied' },
  );
  assert.throws(() => parseProductionOutput('not json'), DriftInputError);
});

function runWith(files, { argv = ['--production=prod.json', '--file=file.json'], env = {} } = {}) {
  let out = '';
  let summary = '';
  const result = run({
    argv,
    env,
    readFile: (path) => {
      if (!(path in files)) throw new Error('ENOENT');
      return files[path];
    },
    write: (text) => {
      out += text;
    },
    appendSummary: (text) => {
      summary += text;
    },
  });
  return { result, out, summary };
}

test('run: 차이는 WARN으로 보고하고 ok를 유지한다', () => {
  const extra = { ...ORDERS_INDEX, collectionGroup: 'notifications' };
  const { result, out, summary } = runWith(
    {
      'prod.json': JSON.stringify({
        status: 'success',
        result: { indexes: [ORDERS_INDEX, extra], fieldOverrides: [] },
      }),
      'file.json': JSON.stringify({ indexes: [ORDERS_INDEX], fieldOverrides: [] }),
    },
    { env: { GITHUB_ACTIONS: 'true' } },
  );
  assert.equal(result.ok, true);
  assert.equal(result.drift, true);
  assert.equal(result.indexes.onlyInProduction, 1);
  assert.match(
    out,
    /composite_indexes: WARN - 운영 2, 파일 1\n {2}운영에만: notifications \(COLLECTION\) \[userId ASC, createdAt DESC\]/,
  );
  assert.match(out, /field_overrides: PASS/);
  assert.match(out, /::warning title=Firestore 인덱스 차이::/);
  assert.doesNotMatch(summary, /::warning/);
  assert.match(summary, /운영에만: notifications/);
});

test('run: 차이가 없으면 PASS, Actions 밖에서는 경고 명령을 쓰지 않는다', () => {
  const spec = JSON.stringify({ indexes: [ORDERS_INDEX] });
  const { result, out } = runWith({ 'prod.json': spec, 'file.json': spec });
  assert.equal(result.ok, true);
  assert.equal(result.drift, false);
  assert.match(out, /composite_indexes: PASS - 운영 1, 파일 1/);
  assert.doesNotMatch(out, /::warning/);
});

test('run: 읽거나 해석하지 못하면 ok=false', () => {
  assert.equal(runWith({ 'file.json': '{"indexes":[]}' }).result.ok, false);
  assert.equal(runWith({ 'prod.json': '{"indexes":[]}', 'file.json': '{' }).result.ok, false);
  const failed = runWith({
    'prod.json': JSON.stringify({ status: 'error', error: 'Failed to authenticate' }),
    'file.json': '{"indexes":[]}',
  });
  assert.equal(failed.result.ok, false);
  assert.match(failed.out, /error: 운영 인덱스 조회 실패: Failed to authenticate/);
  assert.match(failed.summary, /운영 인덱스 조회 실패/);
  assert.equal(runWith({}, { argv: ['--file=file.json'] }).result.ok, false);
});

test('저장소 firestore.indexes.json은 형식 검사를 통과한다', () => {
  const spec = JSON.parse(
    readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'),
  );
  const normalized = normalizeSpec(spec, 'file');
  assert.equal(normalized.indexes.length, spec.indexes.length);
  const self = diffSpecs({ production: normalized, file: normalized });
  assert.deepEqual(self.indexes.onlyInProduction, []);
});

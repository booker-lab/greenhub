import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyKeystrokes,
  EXCLUDED_KEYS,
  gcloudCommandLine,
  inspectSecretValue,
  PLAIN_KEYS,
  readHidden,
  renderEnvYaml,
  resolveProject,
  runEnv,
  runSecrets,
  SECRET_KEYS,
  secretArgs,
  selectSecretKeys,
} from './cloud-run-env.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function apiSourceFiles(dir = path.join(REPO_ROOT, 'apps/api/src')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return apiSourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/** API 코드가 환경 변수를 읽는 형태들에서 이름을 뽑는다. */
function apiEnvKeys() {
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g,
    /\.get(?:OrThrow)?(?:<[^>]*>)?\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /readString\(\s*\w+\s*,\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /values\.([A-Z][A-Z0-9_]+)/g,
    /const [A-Z_]+_ENV = ['"]([A-Z][A-Z0-9_]+)['"]/g,
  ];
  const keys = new Set();
  for (const file of apiSourceFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) keys.add(match[1]);
  }
  return keys;
}

describe('옮길 환경 변수 분류', () => {
  it('API 코드가 읽는 환경 변수는 모두 비밀값·일반 값·제외 중 하나로 분류돼 있다', () => {
    const classified = new Set([
      ...SECRET_KEYS.map((entry) => entry.key),
      ...PLAIN_KEYS.map((entry) => entry.key),
      ...Object.keys(EXCLUDED_KEYS),
    ]);
    const keys = apiEnvKeys();
    assert.ok(keys.has('JWT_SECRET') && keys.has('CORS_ORIGIN'), '추출 패턴이 동작해야 한다');
    const unclassified = [...keys].filter((key) => !classified.has(key)).sort();
    assert.deepEqual(unclassified, [], '새 환경 변수는 cloud-run-env.mjs에 분류를 추가한다');
  });

  it('한 이름은 한 분류에만 있다', () => {
    const all = [
      ...SECRET_KEYS.map((entry) => entry.key),
      ...PLAIN_KEYS.map((entry) => entry.key),
      ...Object.keys(EXCLUDED_KEYS),
    ];
    assert.equal(new Set(all).size, all.length);
  });

  it('운영 보호에 필요한 고정값을 넣는다', () => {
    const byKey = Object.fromEntries(PLAIN_KEYS.map((entry) => [entry.key, entry]));
    assert.equal(byKey.NODE_ENV.value, 'production');
    assert.equal(byKey.GREENHUB_SCHEDULES_ENABLED.value, 'false');
    assert.equal(byKey.GREENHUB_ENVIRONMENT_NAME.fromProject, 'environmentName');
    assert.equal(resolveProject().environmentName, 'production');
    assert.equal(resolveProject('greenhub-round-direct-e2e').environmentName, 'staging');
    assert.throws(() => resolveProject('other-project'), /--project/);
  });

  it('--only는 비밀값 목록 안의 이름만 받는다', () => {
    assert.deepEqual(
      selectSecretKeys('JWT_SECRET, PORTONE_V2_SECRET').map((entry) => entry.key),
      ['JWT_SECRET', 'PORTONE_V2_SECRET'],
    );
    assert.throws(() => selectSecretKeys('JWT_SECRET,NODE_ENV'), /NODE_ENV/);
  });
});

describe('가려서 입력받기', () => {
  it('글자를 모으고 Backspace·제어 문자를 처리하며 Enter에서 끝난다', () => {
    let state = applyKeystrokes('', 'ab');
    assert.deepEqual(state, { buffer: 'ab', done: false, aborted: false });
    state = applyKeystrokes(state.buffer, 'c\u007f\u001bd');
    assert.equal(state.buffer, 'abd');
    state = applyKeystrokes(state.buffer, '\r');
    assert.deepEqual(state, { buffer: 'abd', done: true, aborted: false });
  });

  it('붙여넣은 값은 끝의 줄바꿈에서 끝나고 Ctrl+C는 중단한다', () => {
    assert.deepEqual(applyKeystrokes('', 'secret-값\r\n'), {
      buffer: 'secret-값',
      done: true,
      aborted: false,
    });
    assert.deepEqual(applyKeystrokes('abc', '\u0003'), { buffer: '', done: true, aborted: true });
  });

  it('터미널이 아니면 입력을 거부한다', async () => {
    await assert.rejects(
      readHidden('값', { input: { isTTY: false }, output: { write() {} } }),
      /터미널/,
    );
  });

  it('값 검사: 끝 줄바꿈만 지우고, 중간 줄바꿈은 거부, 짧은 JWT·앞뒤 공백은 알린다', () => {
    const jwt = SECRET_KEYS.find((entry) => entry.key === 'JWT_SECRET');
    assert.deepEqual(inspectSecretValue(jwt, `${'x'.repeat(32)}\r\n`), {
      value: 'x'.repeat(32),
      warnings: [],
    });
    assert.equal(inspectSecretValue(jwt, 'a\nb').value, null);
    assert.equal(inspectSecretValue(jwt, ' short').warnings.length, 2);
  });
});

describe('gcloud 호출', () => {
  it('비밀값은 인자에 들어가지 않고 표준 입력으로만 넘긴다', () => {
    assert.deepEqual(
      secretArgs({ action: 'add-version', name: 'JWT_SECRET', project: 'green-e4fe3' }),
      ['secrets', 'versions', 'add', 'JWT_SECRET', '--project=green-e4fe3', '--data-file=-'],
    );
    assert.deepEqual(
      secretArgs({ action: 'create', name: 'JWT_SECRET', project: 'green-e4fe3' }).slice(-2),
      ['--replication-policy=user-managed', '--locations=asia-northeast3'],
    );
    assert.throws(
      () => secretArgs({ action: 'describe', name: 'bad name; rm', project: 'p' }),
      /형식/,
    );
  });

  function fakeGcloud(existing = {}) {
    const calls = [];
    const impl = async (args, options = {}) => {
      calls.push({ args, stdin: options.stdin });
      const [, sub, name] = args;
      if (sub === 'describe') return { code: name in existing ? 0 : 1, stdout: '', stderr: '' };
      if (sub === 'versions' && args[2] === 'list') {
        return {
          code: 0,
          stdout: existing[args[3]] ? 'projects/p/secrets/x/versions/1\n' : '',
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    return { calls, impl };
  }

  it('없는 비밀값은 만들고 값을 넣고 런타임 계정에 읽기 권한을 준다', async () => {
    const gcloud = fakeGcloud();
    const logs = [];
    const summary = await runSecrets({
      project: 'green-e4fe3',
      keys: selectSecretKeys('JWT_SECRET'),
      gcloud: gcloud.impl,
      hidden: async () => 'y'.repeat(40),
      visible: async () => {
        throw new Error('묻지 않아야 함');
      },
      log: (line) => logs.push(line),
    });
    assert.deepEqual(summary, { stored: ['JWT_SECRET'], skipped: [] });
    const actions = gcloud.calls.map((call) => call.args.slice(0, 3).join(' '));
    assert.deepEqual(actions, [
      'secrets describe JWT_SECRET',
      'secrets create JWT_SECRET',
      'secrets versions add',
      'secrets add-iam-policy-binding JWT_SECRET',
    ]);
    assert.equal(gcloud.calls[2].stdin, 'y'.repeat(40));
    assert.ok(gcloud.calls.every((call) => !call.args.some((arg) => arg.includes('yyyy'))));
    assert.ok(
      gcloud.calls[3].args.includes(
        '--member=serviceAccount:greenhub-api-runtime@green-e4fe3.iam.gserviceaccount.com',
      ),
    );
    assert.ok(
      logs.every((line) => !line.includes('yyyy')),
      '로그에 값이 남지 않는다',
    );
  });

  it('이미 값이 있으면 기본으로 건너뛰고, 비운 입력도 건너뛴다', async () => {
    const gcloud = fakeGcloud({ JWT_SECRET: true });
    const summary = await runSecrets({
      project: 'green-e4fe3',
      keys: selectSecretKeys('JWT_SECRET,PORTONE_V2_SECRET'),
      gcloud: gcloud.impl,
      hidden: async () => '',
      visible: async () => '',
      log: () => {},
    });
    assert.deepEqual(summary, { stored: [], skipped: ['JWT_SECRET', 'PORTONE_V2_SECRET'] });
    assert.ok(!gcloud.calls.some((call) => call.args[1] === 'create' || call.args[2] === 'add'));
  });
});

describe('Windows gcloud 명령 줄', () => {
  it('허용 글자만 있는 인자를 큰따옴표로 감싸고, 셸 특수 글자는 거부한다', () => {
    assert.equal(
      gcloudCommandLine(['secrets', 'describe', 'JWT_SECRET', '--format=value(name)']),
      'gcloud "secrets" "describe" "JWT_SECRET" "--format=value(name)"',
    );
    for (const bad of ['a b', 'x&y', 'x|y', 'x"y', '%PATH%', 'a!b', 'a>b']) {
      assert.throws(() => gcloudCommandLine(['secrets', bad]), /허용하지 않는/, bad);
    }
  });

  it('도구가 만드는 모든 gcloud 인자는 허용 글자 검사를 통과한다', () => {
    for (const action of ['describe', 'enabled-version', 'create', 'add-version', 'grant']) {
      for (const entry of SECRET_KEYS) {
        gcloudCommandLine(
          secretArgs({
            action,
            name: entry.key,
            project: 'green-e4fe3',
            serviceAccount: resolveProject().runtimeServiceAccount,
          }),
        );
      }
    }
  });
});

describe('일반 환경 변수 파일', () => {
  it('YAML 문자열은 따옴표·JSON을 안전하게 감싼다', () => {
    assert.equal(
      renderEnvYaml({ A_B: 'x: "y"', ALIGO_TEMPLATE_CODES_JSON: '{"a":"b"}' }),
      'A_B: "x: \\"y\\""\nALIGO_TEMPLATE_CODES_JSON: "{\\"a\\":\\"b\\"}"\n',
    );
  });

  it('고정값을 넣고 입력값을 모아 저장하며, 비운 필수 값을 알려 준다', async () => {
    const written = {};
    const result = await runEnv({
      project: 'green-e4fe3',
      out: 'C:/tmp/cloud-run.yaml',
      visible: async (label) => (label.includes('CORS_ORIGIN') ? 'https://greenlove.co.kr' : ''),
      write: (file, text) => {
        written[file] = text;
      },
      log: () => {},
    });
    assert.equal(result.values.NODE_ENV, 'production');
    assert.equal(result.values.GREENHUB_ENVIRONMENT_NAME, 'production');
    assert.equal(result.values.GREENHUB_SCHEDULES_ENABLED, 'false');
    assert.equal(result.values.CORS_ORIGIN, 'https://greenlove.co.kr');
    assert.ok(result.missing.includes('TRUST_PROXY_HOPS'));
    assert.ok(!result.missing.includes('GREENHUB_FEATURES'), '선택 값은 필수 목록에 넣지 않는다');
    assert.match(written['C:/tmp/cloud-run.yaml'], /^NODE_ENV: "production"$/m);
  });
});

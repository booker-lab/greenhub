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
  planFromRailway,
  readHidden,
  readRailwayApiVariables,
  renderEnvYaml,
  resolveProject,
  runEnv,
  runFromRailway,
  runSecrets,
  SECRET_KEYS,
  secretArgs,
  selectSecretKeys,
  storeSecret,
  versionNumber,
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
      [
        'secrets',
        'versions',
        'add',
        'JWT_SECRET',
        '--project=green-e4fe3',
        '--data-file=-',
        '--format=value(name)',
      ],
    );
    assert.deepEqual(
      secretArgs({ action: 'create', name: 'JWT_SECRET', project: 'green-e4fe3' }).slice(-2),
      ['--replication-policy=user-managed', '--locations=asia-northeast3'],
    );
    assert.deepEqual(
      secretArgs({
        action: 'disable-version',
        name: 'JWT_SECRET',
        project: 'green-e4fe3',
        version: '1',
      }),
      ['secrets', 'versions', 'disable', '1', '--secret=JWT_SECRET', '--project=green-e4fe3'],
    );
    assert.throws(
      () => secretArgs({ action: 'describe', name: 'bad name; rm', project: 'p' }),
      /형식/,
    );
    assert.throws(
      () =>
        secretArgs({
          action: 'disable-version',
          name: 'JWT_SECRET',
          project: 'p',
          version: 'latest',
        }),
      /버전/,
    );
  });

  it('버전 경로나 번호에서 번호만 뽑는다', () => {
    assert.equal(versionNumber('projects/988412563635/secrets/JWT_SECRET/versions/12\n'), '12');
    assert.equal(versionNumber('3'), '3');
    assert.equal(versionNumber(''), null);
  });

  /** existing: 이름 → 켜진 버전 번호 목록. 새 버전 번호는 가장 큰 번호 + 1이다. */
  function fakeGcloud(existing = {}) {
    const calls = [];
    const versions = Object.fromEntries(
      Object.entries(existing).map(([name, list]) => [name, [...list]]),
    );
    const impl = async (args, options = {}) => {
      calls.push({ args, stdin: options.stdin });
      const [, sub, third, fourth] = args;
      if (sub === 'describe') return { code: third in versions ? 0 : 1, stdout: '', stderr: '' };
      if (sub === 'create') {
        versions[third] = [];
        return { code: 0, stdout: '', stderr: '' };
      }
      if (sub === 'versions' && third === 'add') {
        const list = versions[fourth] ?? [];
        const next = String(Math.max(0, ...list.map(Number)) + 1);
        versions[fourth] = [...list, next];
        return {
          code: 0,
          stdout: `projects/988412563635/secrets/${fourth}/versions/${next}\n`,
          stderr: '',
        };
      }
      if (sub === 'versions' && third === 'list') {
        const list = versions[fourth] ?? [];
        const shown = args.includes('--limit=1') ? list.slice(-1) : list;
        return {
          code: 0,
          stdout: shown
            .map((v) => `projects/988412563635/secrets/${fourth}/versions/${v}\n`)
            .join(''),
          stderr: '',
        };
      }
      if (sub === 'versions' && third === 'disable') {
        const name = args.find((arg) => arg.startsWith('--secret=')).slice('--secret='.length);
        versions[name] = versions[name].filter((v) => v !== fourth);
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    return { calls, impl, versions };
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
      'secrets versions list',
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
    const gcloud = fakeGcloud({ JWT_SECRET: ['1'] });
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

  it('새 값으로 바꾸면 새 버전만 켜 두고 이전 버전은 끈다(삭제하지 않음)', async () => {
    const gcloud = fakeGcloud({ JWT_SECRET: ['1'] });
    const logs = [];
    await runSecrets({
      project: 'green-e4fe3',
      keys: selectSecretKeys('JWT_SECRET'),
      gcloud: gcloud.impl,
      hidden: async () => 'n'.repeat(40),
      visible: async () => 'y',
      log: (line) => logs.push(line),
    });
    assert.deepEqual(gcloud.versions.JWT_SECRET, ['2']);
    assert.ok(!gcloud.calls.some((call) => call.args.includes('destroy')));
    assert.ok(logs.some((line) => line.includes('버전 2') && line.includes('이전 버전 1 끔')));
  });

  it('두 실행이 겹쳐도 켜진 버전이 0개가 되지 않는다(새 버전보다 낮은 번호만 끈다)', async () => {
    const gcloud = fakeGcloud({ JWT_SECRET: ['1'] });
    const target = resolveProject('green-e4fe3');
    let interleaved = false;
    // 실행 A가 버전 목록을 읽기 직전에 실행 B가 새 버전을 넣고 끝까지 돈다.
    const racing = async (args, options) => {
      if (!interleaved && args[1] === 'versions' && args[2] === 'list') {
        interleaved = true;
        await storeSecret({
          gcloud: gcloud.impl,
          target,
          name: 'JWT_SECRET',
          value: 'b'.repeat(40),
          exists: true,
        });
      }
      return gcloud.impl(args, options);
    };
    const a = await storeSecret({
      gcloud: racing,
      target,
      name: 'JWT_SECRET',
      value: 'a'.repeat(40),
      exists: true,
    });
    assert.equal(a.version, '2');
    assert.deepEqual(a.disabled, [], 'A는 B가 넣은 더 새 버전 3을 끄지 않는다');
    assert.deepEqual(gcloud.versions.JWT_SECRET, ['3'], '가장 새 버전은 켜진 채 남는다');
  });

  describe('교체가 끝난 Railway에서 옮기기', () => {
    const ROTATED = {
      JWT_SECRET: 'j'.repeat(64),
      JWT_REFRESH_SECRET: 'r'.repeat(64),
      PORTONE_V2_SECRET: 'portone-new-secret',
      KAKAO_APP_ID: '123456',
      CORS_ORIGIN: 'https://greenlove.co.kr',
      FIREBASE_PROJECT_ID: 'green-e4fe3',
      FIREBASE_STORAGE_BUCKET: 'green-e4fe3.firebasestorage.app',
      TRUST_PROXY_HOPS: '2',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    };

    function railwayFetch({
      environment = 'production',
      services,
      shared = {},
      own = ROTATED,
    } = {}) {
      const requests = [];
      const impl = async (url, init) => {
        const body = JSON.parse(init.body);
        requests.push({ url, token: init.headers['Project-Access-Token'], body });
        let data;
        if (body.query.includes('projectToken')) {
          data = { projectToken: { projectId: 'p1', environmentId: 'e1' } };
        } else if (body.query.includes('project(id')) {
          data = {
            project: {
              services: {
                edges: (
                  services ?? [
                    { id: 's-api', name: 'api' },
                    { id: 's-db', name: 'redis' },
                  ]
                ).map((node) => ({ node })),
              },
              environments: { edges: [{ node: { id: 'e1', name: environment } }] },
            },
          };
        } else {
          data = { variables: body.variables.serviceId ? own : shared };
        }
        return new Response(JSON.stringify({ data }), { status: 200 });
      };
      return { impl, requests };
    }

    it('새 값을 Secret Manager로, 일반 값을 YAML로 옮기고 값은 로그에 남기지 않는다', async () => {
      const gcloud = fakeGcloud({ JWT_SECRET: ['1'] });
      const railway = railwayFetch({ shared: { CORS_ORIGIN: 'https://old.example' } });
      const written = {};
      const logs = [];
      const summary = await runFromRailway({
        project: 'green-e4fe3',
        out: 'C:/tmp/out.yaml',
        railwayProjectId: 'p1',
        fetchImpl: railway.impl,
        gcloud: gcloud.impl,
        hidden: async () => 'railway-token',
        visible: async () => 'green-e4fe3',
        write: (file, text) => {
          written[file] = text;
        },
        log: (line) => logs.push(line),
      });
      assert.deepEqual(summary.stored, ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'PORTONE_V2_SECRET']);
      assert.ok(railway.requests.every((request) => request.token === 'railway-token'));
      assert.deepEqual(gcloud.versions.JWT_SECRET, ['2'], '옛 JWT 버전은 꺼진다');
      const stdins = gcloud.calls
        .filter((call) => call.stdin !== undefined)
        .map((call) => call.stdin);
      assert.deepEqual(stdins, [
        ROTATED.JWT_SECRET,
        ROTATED.JWT_REFRESH_SECRET,
        ROTATED.PORTONE_V2_SECRET,
      ]);
      const yaml = written['C:/tmp/out.yaml'];
      assert.match(
        yaml,
        /^CORS_ORIGIN: "https:\/\/greenlove\.co\.kr"$/m,
        '서비스 변수가 공유 변수보다 우선',
      );
      assert.match(yaml, /^GREENHUB_ENVIRONMENT_NAME: "production"$/m);
      assert.match(yaml, /^GREENHUB_SCHEDULES_ENABLED: "false"$/m);
      assert.doesNotMatch(yaml, /TRUST_PROXY_HOPS|RAILWAY_|JWT_SECRET|PORTONE_V2_SECRET/);
      const allLogs = logs.join('\n');
      for (const value of [ROTATED.JWT_SECRET, ROTATED.PORTONE_V2_SECRET, 'railway-token']) {
        assert.ok(!allLogs.includes(value), '로그에 값이 남지 않는다');
      }
      assert.match(allLogs, /비어 있는 필수 일반 값.*TRUST_PROXY_HOPS/);
    });

    it('프로젝트 이름을 다르게 입력하면 아무것도 쓰지 않는다', async () => {
      const gcloud = fakeGcloud();
      let wrote = false;
      const summary = await runFromRailway({
        project: 'green-e4fe3',
        railwayProjectId: 'p1',
        fetchImpl: railwayFetch().impl,
        gcloud: gcloud.impl,
        hidden: async () => 'railway-token',
        visible: async () => 'y',
        write: () => {
          wrote = true;
        },
        log: () => {},
      });
      assert.equal(summary.stored.length, 0);
      assert.equal(wrote, false);
      assert.deepEqual(gcloud.calls, []);
    });

    it('토큰 환경이 프로젝트와 다르면(운영 프로젝트에 staging 토큰) 멈춘다', async () => {
      await assert.rejects(
        runFromRailway({
          project: 'green-e4fe3',
          railwayProjectId: 'p1',
          fetchImpl: railwayFetch({ environment: 'staging' }).impl,
          gcloud: fakeGcloud().impl,
          hidden: async () => 'railway-token',
          visible: async () => 'green-e4fe3',
          write: () => {},
          log: () => {},
        }),
        /"staging" 환경용/,
      );
    });

    async function rejectsWithoutWrites(options, pattern) {
      const gcloud = fakeGcloud({ JWT_SECRET: ['1'] });
      let wrote = false;
      await assert.rejects(
        runFromRailway({
          project: 'green-e4fe3',
          gcloud: gcloud.impl,
          hidden: async () => 'railway-token',
          visible: async () => 'green-e4fe3',
          write: () => {
            wrote = true;
          },
          log: () => {},
          ...options,
        }),
        pattern,
      );
      assert.deepEqual(gcloud.calls, [], 'Secret Manager를 건드리지 않는다');
      assert.deepEqual(gcloud.versions.JWT_SECRET, ['1'], '기존 버전을 끄지 않는다');
      assert.equal(wrote, false);
    }

    it('원본 Railway 프로젝트 ID를 지정하지 않으면 토큰을 묻기 전에 멈춘다', async () => {
      let asked = false;
      await rejectsWithoutWrites(
        {
          fetchImpl: railwayFetch().impl,
          hidden: async () => {
            asked = true;
            return 'railway-token';
          },
        },
        /--railway-project-id/,
      );
      assert.equal(asked, false);
    });

    it('다른 Railway 프로젝트의 production 토큰이면 아무것도 쓰지 않고 멈춘다', async () => {
      await rejectsWithoutWrites(
        { railwayProjectId: 'p-greenhub-prod', fetchImpl: railwayFetch().impl },
        /다른 Railway 프로젝트\(p1\)/,
      );
    });

    it('읽은 FIREBASE_PROJECT_ID가 대상 GCP 프로젝트와 다르면 아무것도 쓰지 않고 멈춘다', async () => {
      await rejectsWithoutWrites(
        {
          railwayProjectId: 'p1',
          fetchImpl: railwayFetch({ own: { ...ROTATED, FIREBASE_PROJECT_ID: 'other-firebase' } }).impl,
        },
        /FIREBASE_PROJECT_ID가 "other-firebase"/,
      );
      await rejectsWithoutWrites(
        {
          railwayProjectId: 'p1',
          fetchImpl: railwayFetch({ own: { JWT_SECRET: ROTATED.JWT_SECRET } }).impl,
        },
        /FIREBASE_PROJECT_ID가 "없음"/,
      );
    });

    it('API 서비스가 하나로 정해지지 않으면 번호로 고르게 한다', async () => {
      const read = await readRailwayApiVariables({
        token: 't',
        expectedProjectId: 'p1',
        expectedEnvironment: 'production',
        expectedFirebaseProject: 'green-e4fe3',
        chooseService: async (services) => services.find((entry) => entry.name === 'backend'),
        fetchImpl: railwayFetch({
          services: [
            { id: 's1', name: 'backend' },
            { id: 's2', name: 'worker' },
          ],
        }).impl,
      });
      assert.equal(read.service.id, 's1');
      assert.equal(read.variables.KAKAO_APP_ID, '123456');
    });

    it('옮길 계획: 없는 비밀값과 비어 있는 필수 일반 값을 따로 알려 준다', () => {
      const plan = planFromRailway(
        { JWT_SECRET: 'x'.repeat(40), CORS_ORIGIN: '' },
        resolveProject(),
      );
      assert.deepEqual(
        plan.secrets.map((entry) => entry.key),
        ['JWT_SECRET'],
      );
      assert.ok(plan.missingSecrets.includes('PORTONE_V2_SECRET'));
      assert.ok(plan.missingPlain.includes('CORS_ORIGIN'));
      assert.ok(plan.missingPlain.includes('TRUST_PROXY_HOPS'));
    });
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
    for (const action of [
      'describe',
      'enabled-version',
      'enabled-versions',
      'create',
      'add-version',
      'grant',
    ]) {
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

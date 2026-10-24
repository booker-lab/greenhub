import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyVariables,
  formatReport,
  importVariables,
  main,
  parseArgs,
  SECRET_LABEL,
  toEnvVarsYaml,
} from './cloud-run-import-env.mjs';

const SECRET_VALUE = 'jwt-secret-value-should-not-leak';
const PROXY_VALUE = 'http://fixie:proxy-password@proxy.example.test:80'; // trufflehog:ignore

const railway = {
  JWT_SECRET: SECRET_VALUE,
  ALIGO_OUTBOUND_PROXY_URL: PROXY_VALUE,
  CORS_ORIGIN: 'https://a.example.test,https://b.example.test',
  ALIGO_SENDER_PHONE: '0212342104',
  ALIGO_TEMPLATE_CODES_JSON: '{"ORDER":"UK_1","CANCEL":"UK_2"}',
  GREENHUB_FEATURES: '',
  FIREBASE_SERVICE_ACCOUNT_JSON: '{"private_key":"-----BEGIN-----"}',
  RAILWAY_DOCKERFILE_PATH: 'Dockerfile',
  NODE_ENV: 'production',
  TRUST_PROXY_HOPS: '2',
  GREENHUB_SCHEDULES_ENABLED: 'true',
  GOOGLE_GEMINI_BASE_URL: 'https://example.test',
  ROUND_DIRECT_E2E_SHARED_SECRET: 'e2e-secret',
  ROUND_DIRECT_E2E_ENABLED: 'true',
};

function fakeGcloud({ existing = [], failOn } = {}) {
  const calls = [];
  const run = (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'secrets' && args[1] === 'describe') {
      return { status: existing.includes(args[2]) ? 0 : 1, stderr: 'NOT_FOUND' };
    }
    if (failOn && failOn(args)) return { status: 1, stderr: `ERROR: rejected ${input ?? ''}` };
    return { status: 0, stderr: '' };
  };
  return { calls, run };
}

describe('변수 분류', () => {
  test('운영은 비밀값·일반 값을 나누고 배포가 넣는 값·키 파일·E2E 값은 옮기지 않는다', () => {
    const plan = classifyVariables(railway, 'production');
    assert.deepEqual(
      plan.secrets.map(([key]) => key),
      ['ALIGO_OUTBOUND_PROXY_URL', 'JWT_SECRET'],
    );
    assert.deepEqual(
      plan.plain.map(([key]) => key),
      ['ALIGO_SENDER_PHONE', 'ALIGO_TEMPLATE_CODES_JSON', 'CORS_ORIGIN'],
    );
    assert.deepEqual(plan.skipped, [
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      'GREENHUB_SCHEDULES_ENABLED',
      'NODE_ENV',
      'RAILWAY_DOCKERFILE_PATH',
      'TRUST_PROXY_HOPS',
    ]);
    assert.deepEqual(plan.empty, ['GREENHUB_FEATURES']);
    assert.deepEqual(plan.unknown, ['GOOGLE_GEMINI_BASE_URL']);
    assert.deepEqual(plan.e2eInProduction, [
      'ROUND_DIRECT_E2E_ENABLED',
      'ROUND_DIRECT_E2E_SHARED_SECRET',
    ]);
  });

  test('시험 서비스는 회차 E2E 값을 옮긴다(공유 secret은 비밀값)', () => {
    const plan = classifyVariables(railway, 'staging');
    assert.ok(plan.secrets.some(([key]) => key === 'ROUND_DIRECT_E2E_SHARED_SECRET'));
    assert.ok(plan.plain.some(([key]) => key === 'ROUND_DIRECT_E2E_ENABLED'));
    assert.deepEqual(plan.e2eInProduction, []);
  });
});

describe('일반 값 YAML', () => {
  test('앞자리 0·쉼표·JSON 값을 그대로 보존한다', () => {
    const entries = classifyVariables(railway, 'production').plain;
    const yaml = toEnvVarsYaml(entries);
    const parsed = Object.fromEntries(
      yaml
        .trimEnd()
        .split('\n')
        .map((line) => {
          const index = line.indexOf(': ');
          return [line.slice(0, index), JSON.parse(line.slice(index + 2))];
        }),
    );
    assert.deepEqual(parsed, Object.fromEntries(entries));
    assert.match(yaml, /^ALIGO_SENDER_PHONE: "0212342104"$/m);
  });
});

describe('Secret Manager 넣기', () => {
  test('새 비밀값은 라벨과 서울 위치로 만들고, 값은 표준 입력으로만 넘기고, 런타임 계정에 읽기 권한을 준다', () => {
    const gcloud = fakeGcloud();
    importVariables({
      project: 'green-e4fe3',
      variables: { JWT_SECRET: SECRET_VALUE },
      runGcloud: gcloud.run,
    });
    const commands = gcloud.calls.map(({ args }) => args.slice(0, 3).join(' '));
    assert.deepEqual(commands, [
      'secrets describe JWT_SECRET',
      'secrets create JWT_SECRET',
      'secrets versions add',
      'secrets add-iam-policy-binding JWT_SECRET',
    ]);
    const create = gcloud.calls[1].args;
    assert.ok(create.includes(`--labels=${SECRET_LABEL}`));
    assert.ok(create.includes('--locations=asia-northeast3'));
    assert.equal(gcloud.calls[2].input, SECRET_VALUE);
    assert.ok(
      gcloud.calls[3].args.includes(
        '--member=serviceAccount:greenhub-api-runtime@green-e4fe3.iam.gserviceaccount.com',
      ),
    );
    for (const { args } of gcloud.calls) {
      assert.ok(args.includes('--project=green-e4fe3'));
      assert.ok(!args.some((arg) => arg.includes(SECRET_VALUE)));
    }
  });

  test('이미 있는 비밀값은 만들지 않고 라벨을 맞춘 뒤 새 버전을 더한다', () => {
    const gcloud = fakeGcloud({ existing: ['JWT_SECRET'] });
    importVariables({
      project: 'green-e4fe3',
      variables: { JWT_SECRET: SECRET_VALUE },
      runGcloud: gcloud.run,
    });
    assert.deepEqual(
      gcloud.calls.map(({ args }) => args.slice(0, 3).join(' ')),
      [
        'secrets describe JWT_SECRET',
        'secrets update JWT_SECRET',
        'secrets versions add',
        'secrets add-iam-policy-binding JWT_SECRET',
      ],
    );
  });

  test('gcloud 실패 문구에 값이 섞여도 오류에는 싣지 않는다', () => {
    const gcloud = fakeGcloud({ failOn: (args) => args[1] === 'versions' });
    assert.throws(
      () =>
        importVariables({
          project: 'green-e4fe3',
          variables: { ALIGO_OUTBOUND_PROXY_URL: PROXY_VALUE },
          runGcloud: gcloud.run,
        }),
      (error) => {
        assert.match(error.message, /gcloud secrets versions add 실패/);
        assert.ok(!error.message.includes(PROXY_VALUE));
        return true;
      },
    );
  });

  test('허용하지 않은 프로젝트는 gcloud를 부르기 전에 거부한다', () => {
    const gcloud = fakeGcloud();
    assert.throws(
      () =>
        importVariables({ project: 'other-project', variables: railway, runGcloud: gcloud.run }),
      /허용하지 않은 프로젝트/,
    );
    assert.equal(gcloud.calls.length, 0);
  });
});

describe('실행', () => {
  test('보고에는 키 이름만 있고 값은 없다', () => {
    const gcloud = fakeGcloud();
    const written = {};
    const report = main(
      ['--project=green-e4fe3', '--source=/fixture/railway.json', '--out=/fixture/env.yaml'],
      {
        readFile: () => JSON.stringify(railway),
        writeFile: (path, content) => {
          written[path] = content;
        },
        runGcloud: gcloud.run,
      },
    );
    assert.match(report, /비밀값 2개\(Secret Manager\): ALIGO_OUTBOUND_PROXY_URL, JWT_SECRET/);
    assert.match(report, /모르는 키 1개.*GOOGLE_GEMINI_BASE_URL/);
    assert.match(report, /경고: 운영에 회차 E2E 값이 있습니다/);
    for (const value of [
      SECRET_VALUE,
      PROXY_VALUE,
      railway.CORS_ORIGIN,
      railway.ALIGO_SENDER_PHONE,
      railway.ALIGO_TEMPLATE_CODES_JSON,
      railway.ROUND_DIRECT_E2E_SHARED_SECRET,
    ]) {
      assert.ok(!report.includes(value), '보고에 값이 실리면 안 된다');
    }
    assert.ok(!written['/fixture/env.yaml'].includes(SECRET_VALUE));
    assert.ok(!written['/fixture/env.yaml'].includes(PROXY_VALUE));
  });

  test('JSON이 아니면 내용을 싣지 않고 멈춘다', () => {
    assert.throws(
      () =>
        main(['--project=green-e4fe3', '--source=/f.json', '--out=/o.yaml'], {
          readFile: () => `JWT_SECRET="${SECRET_VALUE}"`,
          writeFile: () => assert.fail('쓰지 않아야 한다'),
          runGcloud: fakeGcloud().run,
        }),
      (error) => !error.message.includes(SECRET_VALUE),
    );
  });

  test('필수 인자가 빠지면 거부한다', () => {
    assert.throws(() => parseArgs(['--project=green-e4fe3']), /--source/);
    assert.throws(() => parseArgs(['--unknown=1']), /알 수 없는 인자/);
  });

  test('보고 형식', () => {
    const report = formatReport(
      {
        target: 'staging',
        secrets: [],
        plain: [],
        skipped: [],
        empty: [],
        unknown: [],
        e2eInProduction: [],
      },
      '/o.yaml',
    );
    assert.match(report, /^대상: staging$/m);
    assert.doesNotMatch(report, /모르는 키|경고/);
  });
});

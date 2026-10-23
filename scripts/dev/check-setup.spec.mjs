import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findMissingEnvKeys,
  findRepoPinProblems,
  isInstallCurrent,
  parseExactVersion,
  parsePackageManagerVersion,
  parsePlaywrightInstallLocations,
  parseUserAgentPnpmVersion,
} from './check-setup.mjs';

const DOCKERFILE = 'ARG NODE_IMAGE=node:22.23.3-alpine3.24@sha256:abc\nFROM scratch AS build\n';
const PINNED_WORKFLOW = [
  'steps:',
  '  - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  '    with:',
  '      node-version-file: .nvmrc',
  '      cache: pnpm',
].join('\n');

test('.nvmrc·Dockerfile·workflow가 한 버전을 가리키면 문제가 없다', () => {
  assert.deepEqual(
    findRepoPinProblems({
      nvmrc: '22.23.3\n',
      dockerfile: DOCKERFILE,
      workflows: [
        { file: 'a.yml', text: PINNED_WORKFLOW },
        { file: 'b.yml', text: 'steps:\n  - run: echo setup-node 없음\n' },
      ],
    }),
    [],
  );
});

test('주 버전만 적은 .nvmrc와 Dockerfile 불일치를 잡는다', () => {
  assert.equal(
    findRepoPinProblems({ nvmrc: '22\n', dockerfile: DOCKERFILE, workflows: [] }).length,
    1,
  );
  const [problem] = findRepoPinProblems({
    nvmrc: '22.23.4',
    dockerfile: DOCKERFILE,
    workflows: [],
  });
  assert.match(problem, /Dockerfile의 Node 이미지\(22\.23\.3\)가 \.nvmrc\(22\.23\.4\)와 다르다/);
});

test('workflow가 node-version을 직접 적거나 버전 입력 없이 setup-node를 쓰면 잡는다', () => {
  const problems = findRepoPinProblems({
    nvmrc: '22.23.3',
    dockerfile: DOCKERFILE,
    workflows: [
      {
        file: 'literal.yml',
        text: PINNED_WORKFLOW.replace('node-version-file: .nvmrc', "node-version: '22'"),
      },
      { file: 'bare.yml', text: '  - name: Node\n    uses: actions/setup-node@v7\n' },
    ],
  });
  assert.deepEqual(problems, [
    'literal.yml:4 node-version을 직접 적지 않고 node-version-file: .nvmrc를 쓴다.',
    'literal.yml: setup-node 1곳 중 0곳만 node-version-file: .nvmrc를 쓴다.',
    'bare.yml: setup-node 1곳 중 0곳만 node-version-file: .nvmrc를 쓴다.',
  ]);
});

test('env 예시의 주석 처리된 선택 키는 빼고, 실제 파일에 없는 키 이름만 돌려준다', () => {
  const example = [
    '# Firebase',
    'FIREBASE_PROJECT_ID=demo',
    '# GOOGLE_APPLICATION_CREDENTIALS=./sa.json',
    'JWT_SECRET=change-me',
    'PORT=3000',
  ].join('\n');
  const actual = 'FIREBASE_PROJECT_ID=greenhub-local\r\nexport PORT=3000\r\n';
  assert.deepEqual(findMissingEnvKeys(example, actual), ['JWT_SECRET']);
});

test('설치 기록 lockfile은 줄바꿈 차이만 무시하고 비교한다', () => {
  const lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n";
  assert.equal(isInstallCurrent(lock, lock.replace(/\n/g, '\r\n')), true);
  assert.equal(isInstallCurrent(lock, lock.replace('{}', '{ a: 1 }')), false);
  assert.equal(isInstallCurrent(lock, undefined), false);
});

test('버전 문자열을 해석한다', () => {
  assert.equal(parseExactVersion(' 22.23.3\n'), '22.23.3');
  assert.equal(parseExactVersion('v22.23.3'), undefined);
  assert.equal(parseExactVersion('22'), undefined);
  assert.equal(parsePackageManagerVersion('pnpm@10.32.1'), '10.32.1');
  assert.equal(parsePackageManagerVersion('pnpm@10.32.1+sha512.abc'), '10.32.1');
  assert.equal(parsePackageManagerVersion('yarn@4.0.0'), undefined);
  assert.equal(parseUserAgentPnpmVersion('pnpm/10.32.1 npm/? node/v22.23.3 win32 x64'), '10.32.1');
  assert.equal(parseUserAgentPnpmVersion('npm/10.9.0 node/v22.23.3'), undefined);
});

test('Playwright dry-run 출력에서 설치 위치를 중복 없이 뽑는다', () => {
  const output = [
    'Chrome for Testing 147.0.7727.15 (playwright chromium v1217)',
    '  Install location:    C:\\Users\\me\\AppData\\Local\\ms-playwright\\chromium-1217',
    '',
    'FFmpeg (playwright ffmpeg v1011)',
    '  Install location:    C:\\Users\\me\\AppData\\Local\\ms-playwright\\ffmpeg-1011',
    'Chrome Headless Shell 147.0.7727.15 (playwright chromium-headless-shell v1217)',
    '  Install location:    C:\\Users\\me\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1217',
    'FFmpeg (playwright ffmpeg v1011)',
    '  Install location:    C:\\Users\\me\\AppData\\Local\\ms-playwright\\ffmpeg-1011',
  ].join('\r\n');
  assert.deepEqual(parsePlaywrightInstallLocations(output), [
    'C:\\Users\\me\\AppData\\Local\\ms-playwright\\chromium-1217',
    'C:\\Users\\me\\AppData\\Local\\ms-playwright\\ffmpeg-1011',
    'C:\\Users\\me\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1217',
  ]);
});

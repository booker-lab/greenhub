import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';

import {
  buildCodexArgs,
  CODEX_EXECUTOR,
  defaultInvokeCodex,
  invokeAgent,
  OPENCODE_EXECUTOR,
  parseCodexJsonl,
  resolveAgentExecutor,
  resolveCodexCommand,
  validateAgentExecutorOptions,
} from './agent-executor.mjs';

function jsonl(text) {
  return [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started', turn_id: 'turn-1' },
    { type: 'item.started', item: { id: 'message-1', type: 'agent_message' } },
    { type: 'item.completed', item: { id: 'message-1', type: 'agent_message', text } },
    { type: 'turn.completed', turn_id: 'turn-1', status: 'completed' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

test('executor 선택은 CLI, 환경 변수, 기본값 순서이며 알 수 없는 값은 거부한다', () => {
  assert.deepEqual(resolveAgentExecutor({ baseEnv: {} }), {
    ok: true,
    backend: OPENCODE_EXECUTOR,
    source: 'DEFAULT',
  });
  assert.equal(
    resolveAgentExecutor({ explicitValue: 'CoDeX', baseEnv: { GREENHUB_AGENT_EXECUTOR: 'opencode' } })
      .backend,
    CODEX_EXECUTOR,
  );
  assert.equal(
    resolveAgentExecutor({ baseEnv: { GREENHUB_AGENT_EXECUTOR: 'codex' } }).source,
    'ENVIRONMENT',
  );
  assert.equal(resolveAgentExecutor({ explicitValue: 'other', baseEnv: {} }).ok, false);
  assert.equal(resolveAgentExecutor({ explicitValue: '', baseEnv: {} }).ok, false);
  assert.equal(
    validateAgentExecutorOptions({ selection: { ok: true, backend: CODEX_EXECUTOR }, agent: '' })
      .ok,
    false,
  );
});

test('Codex 인자는 selector read-only와 mutation workspace-write를 분리한다', () => {
  assert.deepEqual(
    buildCodexArgs({ taskText: 'selector prompt', model: 'gpt-test', sandboxMode: 'read-only', platform: 'linux' }),
    [
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--json',
      '--sandbox',
      'read-only',
      '--model',
      'gpt-test',
      'selector prompt',
    ],
  );
  assert.deepEqual(buildCodexArgs({ taskText: 'bounded task', platform: 'linux' }), [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--json',
    '--sandbox',
    'workspace-write',
    'bounded task',
  ]);
});

test('Windows Codex 인자는 elevated 설정을 exec 앞에 전달하고 sandbox 권한을 보존한다', () => {
  assert.deepEqual(
    buildCodexArgs({ taskText: 'selector prompt', sandboxMode: 'read-only', platform: 'win32' }),
    [
      '-c',
      'windows.sandbox="elevated"',
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--json',
      '--sandbox',
      'read-only',
      'selector prompt',
    ],
  );
  assert.deepEqual(
    buildCodexArgs({ taskText: 'bounded task', sandboxMode: 'workspace-write', platform: 'win32' }),
    [
      '-c',
      'windows.sandbox="elevated"',
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--json',
      '--sandbox',
      'workspace-write',
      'bounded task',
    ],
  );
});

test('Windows Codex resolver는 exe, cmd, bat 및 환경 변수 경로를 판별한다', () => {
  const directory = join(process.cwd(), 'codex-resolver-fixture');
  const executable = join(directory, 'codex.exe');
  const shim = join(directory, 'codex.cmd');
  const script = `${dirname(shim)}\\node_modules\\@openai\\codex\\bin\\codex.js`;
  assert.deepEqual(
    resolveCodexCommand({
      baseEnv: { PATH: directory },
      platform: 'win32',
      exists: (candidate) => candidate === executable,
    }),
    { command: executable, prefixArgs: [], source: 'path-exe' },
  );
  for (const extension of ['cmd', 'bat']) {
    const shimPath = join(directory, `codex.${extension}`);
    const target = `${dirname(shimPath)}\\node_modules\\@openai\\codex\\bin\\codex.js`;
    const resolved = resolveCodexCommand({
      baseEnv: { PATH: directory },
      platform: 'win32',
      exists: (candidate) => candidate === shimPath || candidate === target,
      readFile: () => '"%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\n',
    });
    assert.deepEqual(resolved, {
      command: process.execPath,
      prefixArgs: [target],
      source: 'windows-shim',
    });
  }
  assert.equal(
    resolveCodexCommand({
      explicitBin: null,
      baseEnv: { CODEX_BIN: executable, PATH: '' },
      platform: 'win32',
      exists: (candidate) => candidate === executable,
    }).source,
    'environment',
  );
  assert.throws(
    () => resolveCodexCommand({ explicitBin: 'missing.cmd', baseEnv: {}, platform: 'win32', exists: () => false }),
    /--codex-bin/,
  );
  assert.equal(script.endsWith('\\node_modules\\@openai\\codex\\bin\\codex.js'), true);
});

test('Codex JSONL에서 마지막 완료 agent_message만 추출한다', () => {
  const parsed = parseCodexJsonl(jsonl('최종 selector 결과'));
  assert.deepEqual(parsed, {
    ok: true,
    finalText: '최종 selector 결과',
    eventTypes: [
      'thread.started',
      'turn.started',
      'item.started',
      'item.completed',
      'turn.completed',
    ],
  });
});

test('Codex의 마지막 turn에 assistant 출력이 없으면 이전 turn의 문장을 재사용하지 않는다', () => {
  const output = [
    jsonl('이전 turn의 문장').trimEnd(),
    JSON.stringify({ type: 'turn.started', turn_id: 'turn-2' }),
    JSON.stringify({ type: 'turn.completed', turn_id: 'turn-2', status: 'completed' }),
  ].join('\n') + '\n';
  assert.match(parseCodexJsonl(output).reason, /최종 assistant 출력/);
});

test('잘못되거나 불완전하거나 예상 밖인 Codex JSONL은 닫힌 상태로 거부한다', () => {
  for (const output of ['', '{bad}\n', '{"type":"turn.started"}', '\n', '{"type":"unexpected"}\n']) {
    assert.equal(parseCodexJsonl(output).ok, false, JSON.stringify(output));
  }
  const missingMessage = [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started', turn_id: 'turn-1' },
    { type: 'turn.completed', turn_id: 'turn-1', status: 'completed' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n';
  assert.match(parseCodexJsonl(missingMessage).reason, /최종 assistant 출력/);
  assert.match(parseCodexJsonl(jsonl('ok').slice(0, -1)).reason, /마지막 줄/);
});

test('실행 wrapper는 JSONL을 검증하되 자식 종료 정보는 caller에 보존한다', () => {
  const called = {};
  const result = defaultInvokeCodex({
    resolvedCommand: { command: 'codex', prefixArgs: [] },
    args: ['exec', '--json'],
    cwd: 'C:\\task-workspace',
    env: { PATH: 'fake' },
    timeoutMs: 1234,
    spawn: (command, args, options) => {
      Object.assign(called, { command, args, options });
      return { status: 0, signal: null, stdout: jsonl('확인'), stderr: null };
    },
  });
  assert.deepEqual(called.args, ['exec', '--json']);
  assert.equal(called.options.cwd, 'C:\\task-workspace');
  assert.deepEqual(called.options.stdio, ['ignore', 'pipe', 'inherit']);
  assert.equal(result.exitCode, 0);

  const accepted = invokeAgent({
    backend: CODEX_EXECUTOR,
    invokeCodex: () => ({ exitCode: 0, stdout: jsonl('완료') }),
    resolvedCommand: { command: 'codex', prefixArgs: [] },
    args: [],
    cwd: '.',
    env: {},
    timeoutMs: 1,
  });
  assert.equal(accepted.finalText, '완료');
  assert.equal(accepted.outputError, null);
});

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export const AGENT_EXECUTOR_ENV = 'GREENHUB_AGENT_EXECUTOR';
export const OPENCODE_EXECUTOR = 'OPENCODE';
export const CODEX_EXECUTOR = 'CODEX';
export const DEFAULT_CODEX_TIMEOUT_MS = 60 * 60 * 1000;

const CODEX_JSONL_EVENT_TYPES = new Set([
  'thread.started',
  'turn.started',
  'turn.completed',
  'item.started',
  'item.updated',
  'item.completed',
]);

export function resolveAgentExecutor({ explicitValue = null, baseEnv = process.env } = {}) {
  const envValue = typeof baseEnv?.[AGENT_EXECUTOR_ENV] === 'string'
    ? baseEnv[AGENT_EXECUTOR_ENV].trim()
    : '';
  const value = explicitValue === null ? envValue : String(explicitValue).trim();
  const source = explicitValue !== null ? 'CLI' : envValue.length > 0 ? 'ENVIRONMENT' : 'DEFAULT';
  if (value.length === 0) {
    if (explicitValue !== null) {
      return {
        ok: false,
        backend: null,
        source,
        reason: 'CLI의 --executor 값은 비어 있을 수 없습니다',
      };
    }
    return { ok: true, backend: OPENCODE_EXECUTOR, source };
  }
  const normalized = value.toLowerCase();
  if (normalized === 'opencode') return { ok: true, backend: OPENCODE_EXECUTOR, source };
  if (normalized === 'codex') return { ok: true, backend: CODEX_EXECUTOR, source };
  return {
    ok: false,
    backend: null,
    source,
    reason: `알 수 없는 agent executor입니다: ${value}; opencode 또는 codex를 지정해 주세요`,
  };
}

export function validateAgentExecutorOptions({ selection, agent = null } = {}) {
  if (selection?.ok !== true) return { ok: false, reason: selection?.reason ?? 'executor 값이 올바르지 않습니다' };
  if (selection.backend === CODEX_EXECUTOR && agent !== null && agent !== undefined) {
    return {
      ok: false,
      reason: 'Codex CLI에는 대응 옵션이 없어 --agent는 executor=opencode에서만 사용할 수 있습니다',
    };
  }
  return { ok: true, reason: null };
}

export function extractWindowsShimTarget({ shimPath, exists = existsSync, readFile = readFileSync }) {
  let text;
  try {
    text = readFile(shimPath, 'utf8');
  } catch {
    return null;
  }
  const shimDirectory = dirname(shimPath);
  const tokens = [];
  const pattern = /"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"'=]+)/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const candidate = raw.replace(/%~?dp0%?/gi, shimDirectory);
    if (candidate.includes('\\') || candidate.includes('/')) tokens.push(candidate);
    match = pattern.exec(text);
  }
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (/\.(exe|com)$/i.test(token) && exists(token)) return { command: token, prefixArgs: [] };
    if (/\.(js|mjs|cjs)$/i.test(token) && exists(token)) {
      return { command: process.execPath, prefixArgs: [token] };
    }
  }
  return null;
}

export function resolveCodexCommand({
  explicitBin = null,
  baseEnv = process.env,
  platform = process.platform,
  exists = existsSync,
  readFile = readFileSync,
} = {}) {
  const resolveConfigured = (path, source, flag) => {
    if (!exists(path)) throw new Error(`${flag} 경로가 없습니다: ${path}`);
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(path)) {
      const target = extractWindowsShimTarget({ shimPath: path, exists, readFile });
      if (!target) {
        throw new Error(`Codex 실행 파일을 ${path}에서 찾지 못했습니다. --codex-bin에 codex.exe 경로를 지정해 주세요`);
      }
      return { ...target, source };
    }
    return { command: path, prefixArgs: [], source };
  };

  if (typeof explicitBin === 'string' && explicitBin.length > 0) {
    return resolveConfigured(explicitBin, 'explicit', '--codex-bin');
  }
  if (typeof baseEnv?.CODEX_BIN === 'string' && baseEnv.CODEX_BIN.length > 0) {
    return resolveConfigured(baseEnv.CODEX_BIN, 'environment', 'CODEX_BIN');
  }
  if (platform === 'win32') {
    const rawPath = baseEnv?.PATH ?? baseEnv?.Path ?? '';
    for (const fileName of ['codex.exe', 'codex.cmd', 'codex.bat']) {
      for (const directory of rawPath.split(';')) {
        if (directory.length === 0) continue;
        const candidate = join(directory, fileName);
        if (exists(candidate)) {
          return resolveConfigured(candidate, fileName.endsWith('.exe') ? 'path-exe' : 'windows-shim', fileName);
        }
      }
    }
  }
  return { command: 'codex', prefixArgs: [], source: 'path' };
}

export function buildCodexArgs({
  taskText,
  model = null,
  sandboxMode = 'workspace-write',
  platform = process.platform,
} = {}) {
  const args = platform === 'win32'
    ? [
        '-c',
        'windows.sandbox="elevated"',
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--json',
        '--sandbox',
        sandboxMode,
      ]
    : ['exec', '--ephemeral', '--ignore-user-config', '--json', '--sandbox', sandboxMode];
  if (model) args.push('--model', model);
  args.push(taskText);
  return args;
}

export function defaultInvokeCodex({ resolvedCommand, args, cwd, env, timeoutMs, spawn = spawnSync }) {
  const result = spawn(resolvedCommand.command, [...resolvedCommand.prefixArgs, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : null,
    signal: result.signal ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    startErrorCode: result.error && result.error.code !== 'ETIMEDOUT' ? result.error.code : null,
    stdout: result.stdout ?? '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

export function parseCodexJsonl(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) {
    return { ok: false, reason: 'Codex JSONL 출력이 비어 있습니다' };
  }
  if (!stdout.endsWith('\n')) {
    return { ok: false, reason: 'Codex JSONL 출력의 마지막 줄이 완성되지 않았습니다' };
  }
  const lines = stdout.split(/\r?\n/);
  lines.pop();
  const events = [];
  const messages = [];
  let turnStarted = false;
  let finalTurnCompleted = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0) return { ok: false, reason: `Codex JSONL ${index + 1}번째 줄이 비어 있습니다` };
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return { ok: false, reason: `Codex JSONL ${index + 1}번째 줄의 JSON 형식이 잘못됐습니다` };
    }
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      return { ok: false, reason: `Codex JSONL ${index + 1}번째 이벤트가 객체가 아닙니다` };
    }
    if (event.type === 'error' || event.type === 'turn.failed') {
      return { ok: false, reason: `Codex가 ${event.type} 이벤트를 보고했습니다` };
    }
    if (!CODEX_JSONL_EVENT_TYPES.has(event.type)) {
      return { ok: false, reason: `Codex JSONL에 예상하지 못한 이벤트가 있습니다 (${index + 1}번째 줄)` };
    }
    if (event.type === 'turn.started') {
      turnStarted = true;
      finalTurnCompleted = false;
      messages.length = 0;
    } else if (event.type === 'turn.completed') {
      if (!turnStarted) return { ok: false, reason: '시작되지 않은 Codex turn이 완료됐습니다' };
      finalTurnCompleted = true;
    } else if (event.type.startsWith('item.')) {
      if (event.item === null || typeof event.item !== 'object' || Array.isArray(event.item)) {
        return { ok: false, reason: `Codex ${event.type} 이벤트에 item 객체가 없습니다` };
      }
      if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        if (typeof event.item.text !== 'string') {
          return { ok: false, reason: 'Codex 최종 assistant 출력에 text가 없습니다' };
        }
        messages.push(event.item.text);
      }
    }
    events.push(event.type);
  }
  if (events.at(-1) !== 'turn.completed' || !finalTurnCompleted) {
    return { ok: false, reason: 'Codex JSONL에 마지막 turn의 완료 이벤트가 없습니다' };
  }
  const finalText = messages.at(-1);
  if (typeof finalText !== 'string' || finalText.trim().length === 0) {
    return { ok: false, reason: 'Codex JSONL에 최종 assistant 출력이 없습니다' };
  }
  return { ok: true, finalText, eventTypes: events };
}

export function invokeAgent({
  backend,
  invokeOpencode,
  invokeCodex = defaultInvokeCodex,
  resolvedCommand,
  args,
  cwd,
  env,
  timeoutMs,
}) {
  const execution = backend === CODEX_EXECUTOR
    ? invokeCodex({ resolvedCommand, args, cwd, env, timeoutMs })
    : invokeOpencode({ resolvedCommand, args, cwd, env, timeoutMs });
  if (backend !== CODEX_EXECUTOR) {
    return { ...execution, finalText: execution?.stdout ?? '', outputError: null, eventTypes: [] };
  }
  const parsed = parseCodexJsonl(execution?.stdout ?? '');
  return {
    ...execution,
    finalText: parsed.ok ? parsed.finalText : null,
    outputError: parsed.ok ? null : parsed.reason,
    eventTypes: parsed.ok ? parsed.eventTypes : [],
  };
}

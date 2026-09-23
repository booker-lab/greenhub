// Canonical owner: docs/specs/ops/development-authority.md sections 2, 6, 8
// (opt-in isolated workspace, outcome-relative publication, thin stateless
// automation).
//
// One foreground, operator-observed OpenCode TUI for live mutation sessions.
// This launcher is a transport/observation surface only:
//
//   - foreground process only; no background ownership and no supervision loop
//   - loopback bind only; there is no remote-host or LAN option
//   - no durable state, no task selection, no task registry, no work target
//   - no Git/GitHub authority and no publication credentials
//   - no automatic repository mutation
//
// It starts a headless `opencode serve` with the same sanitized environment the
// mutation executor uses (`buildChildEnv` from scripts/agent/run-once.mjs) and
// then attaches a real OpenCode TUI client to that server. Mutation tasks run as
// `opencode run --attach` sessions on the same server (run-once VISIBLE_TUI
// mode), so their tool execution happens inside this sanitized server process
// and the attached TUI only observes it.
//
// Temporary scratch (including the isolated empty GH_CONFIG_DIR) is removed
// when the TUI exits.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildChildEnv, OPENCODE_ATTACH_URL_ENV, resolveOpencodeCommand } from './run-once.mjs';

export const DEFAULT_VISIBLE_HOSTNAME = '127.0.0.1';
export const DEFAULT_VISIBLE_TUI_PORT = 4096;
export const DEFAULT_HEALTH_TIMEOUT_MS = 30000;
export const DEFAULT_HEALTH_POLL_INTERVAL_MS = 500;
export const HEALTH_REQUEST_TIMEOUT_MS = 4000;
export const PORT_PROBE_TIMEOUT_MS = 1000;

function messageOf(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

function defaultSleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function repositoryRootFromScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function visibleServerUrl({ port = DEFAULT_VISIBLE_TUI_PORT } = {}) {
  return `http://${DEFAULT_VISIBLE_HOSTNAME}:${port}`;
}

/**
 * True when something is already listening on the loopback port. The launcher
 * refuses to start when this is the case: attaching the TUI to a server this
 * launcher did not spawn (with the sanitized mutation environment) would break
 * the execution security boundary this mode depends on.
 */
export function probeTcpPort({
  host = DEFAULT_VISIBLE_HOSTNAME,
  port,
  timeoutMs = PORT_PROBE_TIMEOUT_MS,
} = {}) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (inUse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(inUse);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export function buildServerArgs({ port = DEFAULT_VISIBLE_TUI_PORT } = {}) {
  return ['serve', '--hostname', DEFAULT_VISIBLE_HOSTNAME, '--port', String(port)];
}

export function buildTuiArgs({ url, repositoryRoot }) {
  const args = ['attach', url];
  if (typeof repositoryRoot === 'string' && repositoryRoot.length > 0) {
    args.push('--dir', repositoryRoot);
  }
  return args;
}

/**
 * Compose the headless server invocation from the same primitives the mutation
 * executor uses. `--hostname` is intentionally not caller-selectable at the
 * CLI; the server stays on loopback and its environment is the sanitized child
 * environment (no publication/provider credentials, hardened Git).
 */
export function buildServerInvocation({
  opencodeBin = null,
  env = process.env,
  scratchDir,
  port = DEFAULT_VISIBLE_TUI_PORT,
  platform,
  exists,
  readFile,
} = {}) {
  const resolvedCommand = resolveOpencodeCommand({
    explicitBin: opencodeBin,
    baseEnv: env,
    ...(platform === undefined ? {} : { platform }),
    ...(exists === undefined ? {} : { exists }),
    ...(readFile === undefined ? {} : { readFile }),
  });
  return {
    resolvedCommand,
    args: buildServerArgs({ port }),
    env: buildChildEnv({ baseEnv: env, scratchDir }),
  };
}

/**
 * Compose the TUI client invocation. The TUI is a display/control client of the
 * already running server, so it keeps the operator environment; it never
 * executes mutation tools itself.
 */
export function buildTuiInvocation({
  opencodeBin = null,
  env = process.env,
  port = DEFAULT_VISIBLE_TUI_PORT,
  repositoryRoot,
  platform,
  exists,
  readFile,
} = {}) {
  const resolvedCommand = resolveOpencodeCommand({
    explicitBin: opencodeBin,
    baseEnv: env,
    ...(platform === undefined ? {} : { platform }),
    ...(exists === undefined ? {} : { exists }),
    ...(readFile === undefined ? {} : { readFile }),
  });
  return {
    resolvedCommand,
    args: buildTuiArgs({ url: visibleServerUrl({ port }), repositoryRoot }),
  };
}

export function parseArgs(argv) {
  const options = { port: DEFAULT_VISIBLE_TUI_PORT, opencodeBin: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--port') {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return { ok: false, error: '--port requires an integer between 1 and 65535' };
      }
      index += 1;
      options.port = parsed;
      continue;
    }
    if (arg === '--opencode-bin') {
      const value = argv[index + 1];
      if (value === undefined || value.length === 0) {
        return { ok: false, error: '--opencode-bin requires a value' };
      }
      index += 1;
      options.opencodeBin = value;
      continue;
    }
    return { ok: false, error: `unknown argument: ${arg}` };
  }
  return { ok: true, options };
}

export const USAGE = [
  'usage: node scripts/agent/open-visible-tui.mjs [--port <n>] [--opencode-bin <path>]',
  '',
  `  --port <n>                  loopback port to serve (default: ${DEFAULT_VISIBLE_TUI_PORT})`,
  '  --opencode-bin <path>       explicit OpenCode executable (default: resolved from PATH)',
  '',
  'Starts a headless OpenCode server on 127.0.0.1 with the same sanitized',
  'environment as the mutation executor, then attaches a foreground OpenCode TUI',
  'to it. Mutation tasks become visible as sessions once the executor runs with:',
  '',
  `  $env:${OPENCODE_ATTACH_URL_ENV}='${visibleServerUrl()}'`,
  '',
  'Stop the TUI normally; the launcher then stops the server and removes its',
  'temporary security scratch.',
].join('\n');

/**
 * Poll the loopback health endpoint until the server reports healthy or the
 * bounded deadline is reached. Never retries a non-loopback target: the URL is
 * built from the launcher's own constant hostname.
 */
export async function waitForHealthyServer({
  url,
  fetchFn = fetch,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  intervalMs = DEFAULT_HEALTH_POLL_INTERVAL_MS,
  sleepFn = defaultSleep,
  nowFn = Date.now,
} = {}) {
  const deadline = nowFn() + timeoutMs;
  let lastError = 'health check did not succeed';
  for (;;) {
    try {
      const response = await fetchFn(`${url}/global/health`, {
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        const body = await response.json();
        if (body && body.healthy === true) {
          return { ok: true, error: null, version: body.version ?? null };
        }
        lastError = 'health endpoint did not report a healthy server';
      } else {
        lastError = `health endpoint returned HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = messageOf(error);
    }
    if (nowFn() >= deadline) return { ok: false, error: lastError };
    await sleepFn(intervalMs);
  }
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    if (child.exitCode !== undefined && child.exitCode !== null) {
      resolveExit(typeof child.exitCode === 'number' ? child.exitCode : 1);
      return;
    }
    child.once('error', () => resolveExit(1));
    child.once('exit', (code) => resolveExit(typeof code === 'number' ? code : 1));
  });
}

function terminateChild(child) {
  if (!child) return;
  if (child.exitCode !== undefined && child.exitCode !== null) return;
  if (child.signalCode !== undefined && child.signalCode !== null) return;
  try {
    child.kill();
  } catch {
    // the child may already be gone; cleanup continues below
  }
}

/**
 * Run the visible TUI session in the foreground. Resolves with the TUI exit
 * code after the launcher-owned server is stopped and scratch is removed.
 */
export async function main(
  argv,
  {
    env = process.env,
    stderr = process.stderr,
    spawnFn = spawn,
    fetchFn = fetch,
    repositoryRoot = repositoryRootFromScript(),
    sleepFn = defaultSleep,
    healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    probePortFn = probeTcpPort,
  } = {},
) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`${parsed.error}\n${USAGE}\n`);
    return 1;
  }
  if (parsed.options.help) {
    stderr.write(`${USAGE}\n`);
    return 0;
  }

  const port = parsed.options.port;
  const url = visibleServerUrl({ port });
  const scratchDir = mkdtempSync(join(tmpdir(), 'greenhub-visible-tui-'));
  let server = null;
  let tui = null;
  let exitCode = 1;
  const forwardSignal = (signal) => {
    for (const child of [tui, server]) {
      if (child === null) continue;
      try {
        child.kill(signal);
      } catch {
        // the child may already be gone; the exit path still runs
      }
    }
  };

  try {
    const portInUse = await probePortFn({ port });
    if (portInUse) {
      stderr.write(
        `[visible-tui] VISIBILITY_UNAVAILABLE: port ${port} is already in use; ` +
          'refusing to attach the TUI to a server this launcher does not own\n',
      );
      return 1;
    }

    const serverInvocation = buildServerInvocation({
      opencodeBin: parsed.options.opencodeBin,
      env,
      scratchDir,
      port,
    });
    const tuiInvocation = buildTuiInvocation({
      opencodeBin: parsed.options.opencodeBin,
      env,
      port,
      repositoryRoot,
    });

    server = spawnFn(
      serverInvocation.resolvedCommand.command,
      [...serverInvocation.resolvedCommand.prefixArgs, ...serverInvocation.args],
      {
        cwd: scratchDir,
        env: serverInvocation.env,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
    if (server.stderr && typeof server.stderr.on === 'function') {
      server.stderr.on('data', (chunk) => stderr.write(`[visible-tui:server] ${String(chunk)}`));
    }
    const serverFailure = new Promise((resolveFailure) => {
      server.once('error', (error) =>
        resolveFailure(`server failed to start: ${messageOf(error)}`),
      );
      server.once('exit', (code) => resolveFailure(`server exited with code ${code}`));
    });

    const health = await Promise.race([
      waitForHealthyServer({ url, fetchFn, sleepFn, timeoutMs: healthTimeoutMs }),
      serverFailure.then((error) => ({ ok: false, error })),
    ]);
    if (!health.ok) {
      stderr.write(
        `[visible-tui] VISIBILITY_UNAVAILABLE: no healthy OpenCode server at ${url}: ${health.error}\n`,
      );
      return 1;
    }
    if (server.exitCode !== null || server.signalCode !== null) {
      stderr.write(
        '[visible-tui] VISIBILITY_UNAVAILABLE: the launcher server exited before the TUI attached\n',
      );
      return 1;
    }

    stderr.write(`[visible-tui] server ready: ${url}\n`);
    stderr.write(`[visible-tui] automation: $env:${OPENCODE_ATTACH_URL_ENV}='${url}'\n`);

    process.once('SIGINT', forwardSignal);
    process.once('SIGTERM', forwardSignal);
    tui = spawnFn(
      tuiInvocation.resolvedCommand.command,
      [...tuiInvocation.resolvedCommand.prefixArgs, ...tuiInvocation.args],
      {
        cwd: repositoryRoot,
        env,
        stdio: 'inherit',
        windowsHide: false,
      },
    );
    exitCode = await waitForExit(tui);
  } catch (error) {
    stderr.write(`[visible-tui] launch failed: ${messageOf(error)}\n`);
    exitCode = 1;
  } finally {
    process.removeListener('SIGINT', forwardSignal);
    process.removeListener('SIGTERM', forwardSignal);
    terminateChild(tui);
    terminateChild(server);
    try {
      rmSync(scratchDir, { recursive: true, force: true });
    } catch (error) {
      stderr.write(`[visible-tui] scratch cleanup failed: ${messageOf(error)}\n`);
      if (exitCode === 0) exitCode = 1;
    }
  }
  return exitCode;
}

const invokedAsMainScript =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

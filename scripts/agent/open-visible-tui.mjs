// Canonical owner: docs/specs/ops/development-authority.md sections 2, 6, 8
// (opt-in isolated workspace, outcome-relative publication, thin stateless
// automation).
//
// One foreground, operator-observed OpenCode TUI for live mutation sessions.
// The TUI process owns its own OpenCode server, so the operator sees exactly one
// process and there is no separate `serve` + `attach` pair:
//
//   opencode <repository-root> --hostname 127.0.0.1 --port <port>
//
// This launcher is a transport/observation surface only:
//
//   - foreground process only; no background ownership and no supervision loop
//   - loopback bind only; there is no remote-host or LAN option
//   - no durable state, no task selection, no task registry, no work target
//   - no Git/GitHub authority and no publication credentials
//   - no automatic repository mutation
//   - no `opencode web`, no browser, and no additional terminal window
//
// The TUI process is spawned with the same sanitized environment the mutation
// executor uses (`buildChildEnv` from scripts/agent/run-once.mjs). The TUI-owned
// server is what executes attached mutation sessions, so `opencode run --attach`
// tools inherit the hardened Git configuration and credential-free environment.
// Mutation tasks appear in this TUI as sessions (run-once VISIBLE_TUI mode) and
// the operator selects them with the normal session selector (Ctrl+X L /
// `/sessions`).
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
export const PORT_PROBE_TIMEOUT_MS = 1000;

function messageOf(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

export function repositoryRootFromScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function visibleServerUrl({ port = DEFAULT_VISIBLE_TUI_PORT } = {}) {
  return `http://${DEFAULT_VISIBLE_HOSTNAME}:${port}`;
}

/**
 * True when something is already listening on the loopback port. The launcher
 * refuses to start when this is the case: the operator must end up with exactly
 * one TUI-owned server, and silently joining or racing an unknown listener
 * would break the execution security boundary this mode depends on.
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

/**
 * Compose the single operator-visible TUI command. The project positional pins
 * the TUI to the repository root, and `--hostname`/`--port` make its owned
 * server bind an explicit loopback port that `run-once` can attach to. There is
 * deliberately no subcommand: `serve`, `attach`, and `web` must never appear in
 * this topology.
 */
export function buildOperatorArgs({
  repositoryRoot,
  port = DEFAULT_VISIBLE_TUI_PORT,
  hostname = DEFAULT_VISIBLE_HOSTNAME,
} = {}) {
  return [repositoryRoot, '--hostname', hostname, '--port', String(port)];
}

/**
 * Compose the operator TUI invocation from the same primitives the mutation
 * executor uses. `--hostname` is intentionally not caller-selectable at the
 * CLI; the TUI-owned server stays on loopback and runs under the sanitized
 * child environment (no publication/provider credentials, hardened Git), which
 * is the environment attached mutation sessions execute in.
 */
export function buildOperatorInvocation({
  opencodeBin = null,
  env = process.env,
  scratchDir,
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
    args: buildOperatorArgs({ repositoryRoot, port }),
    env: buildChildEnv({ baseEnv: env, scratchDir }),
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
  `  --port <n>                  loopback port for the TUI-owned server (default: ${DEFAULT_VISIBLE_TUI_PORT})`,
  '  --opencode-bin <path>       explicit OpenCode executable (default: resolved from PATH)',
  '',
  'Starts one foreground OpenCode TUI bound to the repository root. The TUI owns',
  'its own server on 127.0.0.1 with the same sanitized environment as the',
  'mutation executor, so it is the only operator-visible process: no separate',
  'serve + attach pair and no web UI. Mutation tasks become visible as sessions',
  'in this TUI once the executor runs with:',
  '',
  `  $env:${OPENCODE_ATTACH_URL_ENV}='${visibleServerUrl()}'`,
  '',
  'Select them with the normal session selector (Ctrl+X L or /sessions).',
  'Stop the TUI normally; the launcher then removes its temporary security',
  'scratch.',
].join('\n');

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
 * Run the operator TUI in the foreground. Resolves with the TUI exit code after
 * scratch is removed. Exactly one child process is spawned; it is the TUI that
 * owns the server.
 */
export async function main(
  argv,
  {
    env = process.env,
    stderr = process.stderr,
    spawnFn = spawn,
    repositoryRoot = repositoryRootFromScript(),
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
  let tui = null;
  let exitCode = 1;
  const forwardSignal = (signal) => {
    if (tui === null) return;
    try {
      tui.kill(signal);
    } catch {
      // the child may already be gone; the exit path still runs
    }
  };

  try {
    const portInUse = await probePortFn({ port });
    if (portInUse) {
      stderr.write(
        `[visible-tui] VISIBILITY_UNAVAILABLE: port ${port} is already in use; ` +
          'refusing to start a second operator TUI or join an unknown server\n',
      );
      return 1;
    }

    const invocation = buildOperatorInvocation({
      opencodeBin: parsed.options.opencodeBin,
      env,
      scratchDir,
      port,
      repositoryRoot,
    });

    stderr.write(`[visible-tui] operator TUI: ${url} (project: ${repositoryRoot})\n`);
    stderr.write(`[visible-tui] automation: $env:${OPENCODE_ATTACH_URL_ENV}='${url}'\n`);

    process.once('SIGINT', forwardSignal);
    process.once('SIGTERM', forwardSignal);
    tui = spawnFn(
      invocation.resolvedCommand.command,
      [...invocation.resolvedCommand.prefixArgs, ...invocation.args],
      {
        cwd: repositoryRoot,
        env: invocation.env,
        stdio: 'inherit',
        windowsHide: false,
      },
    );
    if (tui && typeof tui.once === 'function') {
      tui.once('error', (error) =>
        stderr.write(`[visible-tui] operator TUI failed to start: ${messageOf(error)}\n`),
      );
    }
    exitCode = await waitForExit(tui);
  } catch (error) {
    stderr.write(`[visible-tui] launch failed: ${messageOf(error)}\n`);
    exitCode = 1;
  } finally {
    process.removeListener('SIGINT', forwardSignal);
    process.removeListener('SIGTERM', forwardSignal);
    terminateChild(tui);
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

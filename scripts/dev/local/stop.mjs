import { request as nativeHttpRequest } from 'node:http';
import { default as nodeFs } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  LOCAL_RUNTIME_STACK_RESOURCE_KEY,
  LOCAL_SHUTDOWN_CONTROL_HOST,
  defaultIsOwnerAlive,
  readRuntimeLease,
  resolveLeaseDirectory,
} from './runtime-lease.mjs';
import { FIXED_PORTS, LOCAL_SHUTDOWN_CONTROL_PATH } from './launcher.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const STOP_RESULTS = Object.freeze({
  STOPPED: 'STOPPED',
  NO_ACTIVE_RUNTIME: 'NO_ACTIVE_RUNTIME',
  STALE_LEASE: 'STALE_LEASE',
  NOT_OWNER: 'NOT_OWNER',
  LEASE_MISMATCH: 'LEASE_MISMATCH',
  CONTROL_UNAVAILABLE: 'CONTROL_UNAVAILABLE',
});

export const STOP_EXIT_CODES = Object.freeze({
  STOPPED: 0,
  NO_ACTIVE_RUNTIME: 2,
  STALE_LEASE: 3,
  NOT_OWNER: 4,
  LEASE_MISMATCH: 4,
  CONTROL_UNAVAILABLE: 5,
});

export function classifyLeaseForStop(
  document,
  {
    resourceKey = LOCAL_RUNTIME_STACK_RESOURCE_KEY,
    isOwnerAlive = defaultIsOwnerAlive,
  } = {},
) {
  if (!document) return { outcome: STOP_RESULTS.NO_ACTIVE_RUNTIME, reason: 'missing' };
  if (document.resourceKey !== resourceKey) {
    return { outcome: STOP_RESULTS.LEASE_MISMATCH, reason: 'resource-mismatch' };
  }
  if (!Number.isInteger(document.ownerPid) || document.ownerPid <= 0) {
    return { outcome: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'invalid-owner-pid' };
  }
  if (typeof document.leaseId !== 'string' || !document.leaseId) {
    return { outcome: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'invalid-lease-id' };
  }

  let liveness;
  try {
    liveness = isOwnerAlive(document.ownerPid);
  } catch {
    liveness = undefined;
  }
  if (liveness === false) return { outcome: STOP_RESULTS.STALE_LEASE, reason: 'owner-dead' };
  if (liveness !== true) {
    return { outcome: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'owner-unknown' };
  }

  const control = document.control;
  if (!control || typeof control !== 'object') {
    return { outcome: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'no-control-endpoint' };
  }
  if (control.host !== LOCAL_SHUTDOWN_CONTROL_HOST) {
    return { outcome: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'non-loopback-control' };
  }
  if (!Number.isInteger(control.port) || control.port <= 0 || control.port > 65535) {
    return { outcome: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'invalid-control-port' };
  }
  if (typeof control.token !== 'string' || !control.token) {
    return { outcome: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'invalid-control-token' };
  }
  return { outcome: 'READY', reason: 'ready', control };
}

export function requestControlShutdown(
  { host, port, leaseId, token, resourceKey = LOCAL_RUNTIME_STACK_RESOURCE_KEY, timeoutMs = 5000 },
  { httpRequestImpl = nativeHttpRequest } = {},
) {
  if (host !== LOCAL_SHUTDOWN_CONTROL_HOST) {
    return Promise.resolve({ ok: false, result: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'non-loopback-control' });
  }
  const payload = JSON.stringify({ leaseId, token, resourceKey });
  return new Promise((resolveResult) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveResult(value);
    };
    let request;
    try {
      request = httpRequestImpl(
        {
          host,
          port,
          path: LOCAL_SHUTDOWN_CONTROL_PATH,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            connection: 'close',
          },
          timeout: timeoutMs,
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.once('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let body;
            try {
              body = raw ? JSON.parse(raw) : undefined;
            } catch {
              body = undefined;
            }
            if (response.statusCode === 200 && (body?.status === 'SHUTDOWN_ACCEPTED' || body?.status === 'ALREADY_STOPPING')) {
              settle({ ok: true, status: body.status, httpStatus: response.statusCode });
            } else if (response.statusCode === 403) {
              settle({ ok: false, result: STOP_RESULTS.NOT_OWNER, reason: body?.status || 'lease-mismatch', httpStatus: response.statusCode });
            } else {
              settle({ ok: false, result: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: body?.status || `http-${response.statusCode}`, httpStatus: response.statusCode });
            }
          });
          response.once('error', () => {
            settle({ ok: false, result: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'control-response-error' });
          });
        },
      );
    } catch {
      settle({ ok: false, result: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'control-request-failed' });
      return;
    }
    request.once('error', () => {
      settle({ ok: false, result: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'control-unreachable' });
    });
    request.once('timeout', () => {
      request.destroy?.();
      settle({ ok: false, result: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'control-timeout' });
    });
    try {
      request.end(payload);
    } catch {
      settle({ ok: false, result: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'control-request-failed' });
    }
    setTimeout(() => {
      settle({ ok: false, result: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'control-timeout' });
    }, timeoutMs + 1000).unref?.();
  });
}

export async function waitForShutdownCompletion(
  { leasePath, ownerPid, controlPort } = {},
  {
    fileSystem = nodeFs,
    isOwnerAlive = defaultIsOwnerAlive,
    timeoutMs = 30_000,
    pollIntervalMs = 250,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastState = {};
  while (Date.now() <= deadline) {
    let leaseMissing = false;
    try {
      fileSystem.readFileSync(leasePath, 'utf8');
      leaseMissing = false;
    } catch (error) {
      if (error?.code === 'ENOENT') leaseMissing = true;
      else leaseMissing = false;
    }
    let ownerAlive;
    try {
      ownerAlive = isOwnerAlive(ownerPid);
    } catch {
      ownerAlive = undefined;
    }
    lastState = { leaseMissing, ownerAlive };
    if (leaseMissing && ownerAlive === false) return { completed: true, ...lastState };
    // Lease release is the authoritative signal: launcher releases its own
    // leaseId-guarded lease only after owned cleanup. Owner death alone is
    // not enough (stale lease must remain for explicit reclaim contract).
    if (leaseMissing && ownerAlive !== true) {
      // Owner probe unknown but lease gone: treat as completed to avoid
      // hanging stop on EPERM/unknown probes, lease release already proves
      // launcher cleanup ran.
      return { completed: true, ...lastState };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, Math.min(pollIntervalMs, remaining)));
  }
  return { completed: false, ...lastState };
}

export async function stopLocalRuntime({
  directory,
  resourceKey = LOCAL_RUNTIME_STACK_RESOURCE_KEY,
  platform = process.platform,
  env = process.env,
  fileSystem = nodeFs,
  isOwnerAlive = defaultIsOwnerAlive,
  requestControlShutdownImpl = requestControlShutdown,
  waitForCompletionImpl = waitForShutdownCompletion,
  controlTimeoutMs = 5000,
  completionTimeoutMs = 30_000,
} = {}) {
  const read = readRuntimeLease({ directory, resourceKey, platform, env, fileSystem });
  if (read.state === 'missing') {
    return { result: STOP_RESULTS.NO_ACTIVE_RUNTIME, reason: 'missing', leasePath: read.leasePath };
  }
  if (read.state === 'corrupt') {
    return { result: STOP_RESULTS.CONTROL_UNAVAILABLE, reason: 'corrupt-lease', leasePath: read.leasePath };
  }
  const document = read.document;
  const classification = classifyLeaseForStop(document, { resourceKey, isOwnerAlive });
  if (classification.outcome !== 'READY') {
    return {
      result: classification.outcome,
      reason: classification.reason,
      leasePath: read.leasePath,
      ownerPid: document?.ownerPid,
    };
  }

  const control = classification.control;
  const requestResult = await requestControlShutdownImpl(
    {
      host: control.host,
      port: control.port,
      leaseId: document.leaseId,
      token: control.token,
      resourceKey,
      timeoutMs: controlTimeoutMs,
    },
  );
  if (!requestResult?.ok) {
    return {
      result: requestResult?.result || STOP_RESULTS.CONTROL_UNAVAILABLE,
      reason: requestResult?.reason || 'control-unavailable',
      leasePath: read.leasePath,
      ownerPid: document.ownerPid,
    };
  }

  const completion = await waitForCompletionImpl(
    { leasePath: read.leasePath, ownerPid: document.ownerPid, controlPort: control.port },
    { fileSystem, isOwnerAlive, timeoutMs: completionTimeoutMs },
  );
  if (!completion?.completed) {
    return {
      result: STOP_RESULTS.CONTROL_UNAVAILABLE,
      reason: 'shutdown-timeout',
      leasePath: read.leasePath,
      ownerPid: document.ownerPid,
      detail: completion,
    };
  }
  return {
    result: STOP_RESULTS.STOPPED,
    reason: requestResult.status === 'ALREADY_STOPPING' ? 'already-stopping' : 'shutdown-accepted',
    leasePath: read.leasePath,
    ownerPid: document.ownerPid,
  };
}

// ---------------------------------------------------------------------------
// 48H STOP_COMPLETION closure (additive, minimal diff).
//
// Legacy STOP_RESULTS / classifyLeaseForStop / waitForShutdownCompletion /
// stopLocalRuntime are intentionally preserved byte-for-byte for existing
// lifecycle regression. The closed surface below fixes the six 48D defects
// without re-designing lifecycle:
//
// 1. leaseMissing + ownerUnknown is NOT completion.
// 2. lease missing without canonical listener proof is NOT ALREADY_STOPPED.
// 3. control/taskkill success alone is NOT completion.
// 4. process + listener + lease postconditions are coupled.
// 5. immediate reuse is proven by test.
// 6. unknown / foreign / orphan are distinct results.
//
// Production canonical ports remain FIXED_PORTS. Tests inject bounded
// ephemeral ports via `canonicalPorts` / probe injection and MUST NOT
// rewrite the canonical set.
// ---------------------------------------------------------------------------

export const CLOSED_RESULTS = Object.freeze({
  STOP_COMPLETED: 'STOP_COMPLETED',
  ALREADY_STOPPED: 'ALREADY_STOPPED',
  ORPHAN_LISTENER_DETECTED: 'ORPHAN_LISTENER_DETECTED',
  OWNER_LIVENESS_UNKNOWN: 'OWNER_LIVENESS_UNKNOWN',
  FOREIGN_RUNTIME_PRESERVED: 'FOREIGN_RUNTIME_PRESERVED',
  STALE_LEASE: 'STALE_LEASE',
  NOT_OWNER: 'NOT_OWNER',
  CONTROL_UNAVAILABLE: 'CONTROL_UNAVAILABLE',
});

export const CLOSED_EXIT_CODES = Object.freeze({
  STOP_COMPLETED: 0,
  ALREADY_STOPPED: 2,
  ORPHAN_LISTENER_DETECTED: 6,
  OWNER_LIVENESS_UNKNOWN: 7,
  FOREIGN_RUNTIME_PRESERVED: 4,
  STALE_LEASE: 3,
  NOT_OWNER: 4,
  CONTROL_UNAVAILABLE: 5,
});

export const CANONICAL_STOP_PORTS = Object.freeze([...FIXED_PORTS]);

function defaultListenerFreeProbe(port, { host = LOCAL_SHUTDOWN_CONTROL_HOST } = {}) {
  return new Promise((resolveResult, rejectResult) => {
    const server = createNetServer();
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') settle(resolveResult, false);
      else settle(rejectResult, error);
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => {
        if (error) settle(rejectResult, error);
        else settle(resolveResult, true);
      });
    });
  });
}

export async function checkCanonicalListenersFree(
  ports = CANONICAL_STOP_PORTS,
  { host = LOCAL_SHUTDOWN_CONTROL_HOST, probe = defaultListenerFreeProbe } = {},
) {
  const list = [...ports];
  const results = [];
  for (const port of list) {
    let free;
    try {
      free = await probe(port, { host });
    } catch {
      // Fail closed: probe error means NOT proven free.
      free = false;
    }
    results.push({ port, free: free === true });
  }
  const occupied = results.filter((entry) => !entry.free).map((entry) => entry.port);
  return { free: occupied.length === 0, occupied, results };
}

export function classifyLeaseForStopClosed(
  document,
  {
    resourceKey = LOCAL_RUNTIME_STACK_RESOURCE_KEY,
    isOwnerAlive = defaultIsOwnerAlive,
  } = {},
) {
  if (!document) return { outcome: 'MISSING', reason: 'missing' };
  if (document.resourceKey !== resourceKey) {
    return { outcome: CLOSED_RESULTS.FOREIGN_RUNTIME_PRESERVED, reason: 'resource-mismatch' };
  }
  if (!Number.isInteger(document.ownerPid) || document.ownerPid <= 0) {
    return { outcome: CLOSED_RESULTS.CONTROL_UNAVAILABLE, reason: 'invalid-owner-pid' };
  }
  if (typeof document.leaseId !== 'string' || !document.leaseId) {
    return { outcome: CLOSED_RESULTS.CONTROL_UNAVAILABLE, reason: 'invalid-lease-id' };
  }

  let liveness;
  try {
    liveness = isOwnerAlive(document.ownerPid);
  } catch {
    liveness = undefined;
  }
  if (liveness === false) return { outcome: CLOSED_RESULTS.STALE_LEASE, reason: 'owner-dead' };
  if (liveness !== true) {
    return { outcome: CLOSED_RESULTS.OWNER_LIVENESS_UNKNOWN, reason: 'owner-unknown' };
  }

  const control = document.control;
  if (!control || typeof control !== 'object') {
    return { outcome: CLOSED_RESULTS.CONTROL_UNAVAILABLE, reason: 'no-control-endpoint' };
  }
  if (control.host !== LOCAL_SHUTDOWN_CONTROL_HOST) {
    return { outcome: CLOSED_RESULTS.CONTROL_UNAVAILABLE, reason: 'non-loopback-control' };
  }
  if (!Number.isInteger(control.port) || control.port <= 0 || control.port > 65535) {
    return { outcome: CLOSED_RESULTS.CONTROL_UNAVAILABLE, reason: 'invalid-control-port' };
  }
  if (typeof control.token !== 'string' || !control.token) {
    return { outcome: CLOSED_RESULTS.CONTROL_UNAVAILABLE, reason: 'invalid-control-token' };
  }
  return { outcome: 'READY', reason: 'ready', control };
}

function readLeaseMissing({ leasePath, fileSystem }) {
  try {
    fileSystem.readFileSync(leasePath, 'utf8');
    return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    // Non-ENOENT read error: NOT proven missing (fail closed).
    return false;
  }
}

function probeOwnerAlive({ ownerPid, isOwnerAlive }) {
  try {
    return isOwnerAlive(ownerPid);
  } catch {
    return undefined;
  }
}

export async function waitForStopCompletionClosed(
  { leasePath, ownerPid, ports = CANONICAL_STOP_PORTS } = {},
  {
    fileSystem = nodeFs,
    isOwnerAlive = defaultIsOwnerAlive,
    listenerProbe = defaultListenerFreeProbe,
    listenerHost = LOCAL_SHUTDOWN_CONTROL_HOST,
    timeoutMs = 30_000,
    pollIntervalMs = 250,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastState = { leaseMissing: false, ownerAlive: undefined, listenersFree: false, occupied: [] };
  while (Date.now() <= deadline) {
    const leaseMissing = readLeaseMissing({ leasePath, fileSystem });
    const ownerAlive = probeOwnerAlive({ ownerPid, isOwnerAlive });
    let listenersFree = false;
    let occupied = [];
    try {
      const checked = await checkCanonicalListenersFree(ports, {
        host: listenerHost,
        probe: listenerProbe,
      });
      listenersFree = checked.free;
      occupied = checked.occupied;
    } catch {
      listenersFree = false;
      occupied = [...ports];
    }
    lastState = { leaseMissing, ownerAlive, listenersFree, occupied };
    // All three postconditions must hold jointly. Unknown liveness is
    // explicitly NOT completion (48D defect 1).
    if (leaseMissing === true && ownerAlive === false && listenersFree === true) {
      return { completed: true, ...lastState };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, Math.min(pollIntervalMs, remaining)));
  }
  return { completed: false, ...lastState };
}

export async function stopLocalRuntimeClosed({
  directory,
  resourceKey = LOCAL_RUNTIME_STACK_RESOURCE_KEY,
  platform = process.platform,
  env = process.env,
  fileSystem = nodeFs,
  isOwnerAlive = defaultIsOwnerAlive,
  requestControlShutdownImpl = requestControlShutdown,
  waitForCompletionImpl = waitForStopCompletionClosed,
  checkListenersImpl = checkCanonicalListenersFree,
  canonicalPorts = CANONICAL_STOP_PORTS,
  listenerHost = LOCAL_SHUTDOWN_CONTROL_HOST,
  controlTimeoutMs = 5000,
  completionTimeoutMs = 30_000,
} = {}) {
  const read = readRuntimeLease({ directory, resourceKey, platform, env, fileSystem });
  if (read.state === 'missing') {
    // Lease absence alone is NOT ALREADY_STOPPED. Require canonical listener proof.
    let checked;
    try {
      checked = await checkListenersImpl(canonicalPorts, {
        host: listenerHost,
        probe: defaultListenerFreeProbe,
      });
    } catch {
      checked = { free: false, occupied: [...canonicalPorts] };
    }
    if (checked.free === true) {
      return {
        result: CLOSED_RESULTS.ALREADY_STOPPED,
        reason: 'missing-lease-listeners-free',
        leasePath: read.leasePath,
        detail: { leaseMissing: true, listenersFree: true, occupied: [] },
      };
    }
    return {
      result: CLOSED_RESULTS.ORPHAN_LISTENER_DETECTED,
      reason: 'orphan-listener',
      leasePath: read.leasePath,
      detail: { leaseMissing: true, listenersFree: false, occupied: checked.occupied },
    };
  }
  if (read.state === 'corrupt') {
    // Resource mismatch surfaces as corrupt via file-per-key naming; surface
    // it as FOREIGN preservation (no auto-delete, no auto-kill) when the
    // stored document is otherwise a foreign namespace.
    const storedResourceKey = read.document?.resourceKey;
    if (typeof storedResourceKey === 'string' && storedResourceKey && storedResourceKey !== resourceKey) {
      return {
        result: CLOSED_RESULTS.FOREIGN_RUNTIME_PRESERVED,
        reason: 'resource-mismatch',
        leasePath: read.leasePath,
        ownerPid: read.document?.ownerPid,
      };
    }
    return {
      result: CLOSED_RESULTS.CONTROL_UNAVAILABLE,
      reason: 'corrupt-lease',
      leasePath: read.leasePath,
    };
  }
  const document = read.document;
  const classification = classifyLeaseForStopClosed(document, { resourceKey, isOwnerAlive });
  if (classification.outcome !== 'READY') {
    if (classification.outcome === 'MISSING') {
      let checked;
      try {
        checked = await checkListenersImpl(canonicalPorts, {
          host: listenerHost,
          probe: defaultListenerFreeProbe,
        });
      } catch {
        checked = { free: false, occupied: [...canonicalPorts] };
      }
      if (checked.free === true) {
        return {
          result: CLOSED_RESULTS.ALREADY_STOPPED,
          reason: 'missing-lease-listeners-free',
          leasePath: read.leasePath,
          ownerPid: document?.ownerPid,
        };
      }
      return {
        result: CLOSED_RESULTS.ORPHAN_LISTENER_DETECTED,
        reason: 'orphan-listener',
        leasePath: read.leasePath,
        ownerPid: document?.ownerPid,
        detail: { occupied: checked.occupied },
      };
    }
    // STALE / UNKNOWN / FOREIGN / CONTROL_UNAVAILABLE: preserve lease,
    // no auto-delete, no auto-kill, no control dial.
    return {
      result: classification.outcome,
      reason: classification.reason,
      leasePath: read.leasePath,
      ownerPid: document?.ownerPid,
    };
  }

  const control = classification.control;
  let requestResult;
  try {
    requestResult = await requestControlShutdownImpl({
      host: control.host,
      port: control.port,
      leaseId: document.leaseId,
      token: control.token,
      resourceKey,
      timeoutMs: controlTimeoutMs,
    });
  } catch (error) {
    return {
      result: CLOSED_RESULTS.CONTROL_UNAVAILABLE,
      reason: error?.message || 'control-request-failed',
      leasePath: read.leasePath,
      ownerPid: document.ownerPid,
    };
  }
  if (!requestResult?.ok) {
    return {
      result: requestResult?.result || CLOSED_RESULTS.CONTROL_UNAVAILABLE,
      reason: requestResult?.reason || 'control-unavailable',
      leasePath: read.leasePath,
      ownerPid: document.ownerPid,
    };
  }

  // Control accepted is NOT completion. Couple process + listener + lease.
  const completion = await waitForCompletionImpl(
    { leasePath: read.leasePath, ownerPid: document.ownerPid, ports: canonicalPorts },
    {
      fileSystem,
      isOwnerAlive,
      listenerProbe: defaultListenerFreeProbe,
      listenerHost,
      timeoutMs: completionTimeoutMs,
    },
  );
  if (!completion?.completed) {
    return {
      result: CLOSED_RESULTS.CONTROL_UNAVAILABLE,
      reason: 'shutdown-timeout',
      leasePath: read.leasePath,
      ownerPid: document.ownerPid,
      detail: completion,
    };
  }
  return {
    result: CLOSED_RESULTS.STOP_COMPLETED,
    reason: requestResult.status === 'ALREADY_STOPPING' ? 'already-stopping' : 'shutdown-accepted',
    leasePath: read.leasePath,
    ownerPid: document.ownerPid,
    detail: {
      leaseMissing: completion.leaseMissing,
      ownerAlive: completion.ownerAlive,
      listenersFree: completion.listenersFree,
      occupied: completion.occupied,
    },
  };
}

export function parseStopOptions(argv = []) {
  let directory;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--lease-dir' || arg === '--directory') {
      directory = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--lease-dir=')) {
      directory = arg.slice('--lease-dir='.length);
    } else if (arg.startsWith('--directory=')) {
      directory = arg.slice('--directory='.length);
    }
  }
  return { directory: typeof directory === 'string' && directory.trim() ? directory : undefined };
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const options = parseStopOptions(argv);
  // Explicit stop targets the canonical shared lease namespace by default.
  // GREENHUB_LOCAL_RUNTIME_DIR override is honored via resolveLeaseDirectory
  // for diagnostics only. Closed completion requires process + listener +
  // lease postconditions (48H); legacy STOPPED path is preserved in
  // stopLocalRuntime for regression.
  void MODULE_DIRECTORY;
  void resolveLeaseDirectory;
  const outcome = await stopLocalRuntimeClosed({
    directory: options.directory,
    env: environment,
  });
  console.log(outcome.result);
  if (outcome.result !== CLOSED_RESULTS.STOP_COMPLETED) {
    if (outcome.reason) console.error(`[local-runtime:stop] ${outcome.result}: ${outcome.reason} (lease=${outcome.leasePath || 'unknown'})`);
    else console.error(`[local-runtime:stop] ${outcome.result} (lease=${outcome.leasePath || 'unknown'})`);
  } else {
    console.log(`[local-runtime:stop] runtime stopped (lease=${outcome.leasePath})`);
  }
  return CLOSED_EXIT_CODES[outcome.result] ?? STOP_EXIT_CODES[outcome.result] ?? 1;
}

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : '';
const moduleFile = resolve(fileURLToPath(import.meta.url));
if (invokedFile === moduleFile) {
  const exitCode = await main();
  process.exitCode = exitCode;
}

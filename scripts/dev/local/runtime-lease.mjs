import { randomUUID } from 'node:crypto';
import { default as nodeFs } from 'node:fs';
import { default as nodeOs } from 'node:os';
import { default as nodePath } from 'node:path';

export const LOCAL_RUNTIME_STACK_RESOURCE_KEY = 'GREENHUB_LOCAL_RUNTIME_STACK';

export const LOCAL_RUNTIME_STACK_PORTS = Object.freeze([3000, 3001, 3002, 3003, 8080, 9099, 9199]);

export const LOCAL_RUNTIME_STACK_RESOURCE = Object.freeze({
  key: LOCAL_RUNTIME_STACK_RESOURCE_KEY,
  ports: LOCAL_RUNTIME_STACK_PORTS,
});

export const LOCAL_RUNTIME_LAUNCHER_IDENTITY = 'greenhub-local-launcher';

export const LEASE_FILE_NAME = `${LOCAL_RUNTIME_STACK_RESOURCE_KEY}.lock.json`;

export class LocalRuntimeLeaseError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LocalRuntimeLeaseError';
    this.resourceKey = details.resourceKey ?? LOCAL_RUNTIME_STACK_RESOURCE_KEY;
    this.ownerPid = details.ownerPid;
    this.ownerCheckout = details.ownerCheckout;
    this.acquiredAt = details.acquiredAt;
    this.ports = details.ports ? [...details.ports] : [...LOCAL_RUNTIME_STACK_PORTS];
    this.leasePath = details.leasePath;
    this.reason = details.reason ?? 'active-owner';
  }
}

function readEnvValue(environment, key) {
  const value = environment?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveLeaseDirectory({
  platform = process.platform,
  env = process.env,
  override,
} = {}) {
  if (typeof override === 'string' && override.trim()) return override;
  const explicit = readEnvValue(env, 'GREENHUB_LOCAL_RUNTIME_DIR');
  if (explicit) return explicit;

  if (platform === 'win32') {
    const base =
      readEnvValue(env, 'LOCALAPPDATA') || readEnvValue(env, 'APPDATA') || nodeOs.tmpdir();
    return nodePath.join(base, 'Greenhub', 'local-runtime');
  }

  const xdg = readEnvValue(env, 'XDG_RUNTIME_DIR');
  if (xdg) return nodePath.join(xdg, 'greenhub', 'local-runtime');
  return nodePath.join(nodeOs.tmpdir(), 'greenhub-local-runtime');
}

export function resolveLeaseFilePath(directory, resourceKey = LOCAL_RUNTIME_STACK_RESOURCE_KEY) {
  return nodePath.join(directory, `${resourceKey}.lock.json`);
}

export function defaultIsOwnerAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    return undefined;
  }
}

function isValidLeaseDocument(document, resourceKey) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return false;
  if (document.resourceKey !== resourceKey) return false;
  if (!Number.isInteger(document.ownerPid) || document.ownerPid <= 0) return false;
  if (typeof document.leaseId !== 'string' || !document.leaseId) return false;
  if (typeof document.checkoutPath !== 'string' || !document.checkoutPath) return false;
  if (typeof document.acquiredAt !== 'string' || !document.acquiredAt) return false;
  if (!Array.isArray(document.ports) || document.ports.length === 0) return false;
  return true;
}

function formatOwnerAttribution({ ownerPid, checkoutPath, acquiredAt, leasePath }) {
  return (
    `Greenhub local runtime은 ${checkoutPath} 의 PID ${ownerPid}이 소유 중입니다 ` +
    `(acquiredAt=${acquiredAt}, lease=${leasePath}). ` +
    `해당 runtime이 종료될 때까지 다른 checkout에서 local runtime을 시작할 수 없습니다. ` +
    `owner process가 확실히 종료된 뒤에도 이 오류가 계속되면 lease 파일(${leasePath})이 stale인지 확인하고 직접 삭제하세요.`
  );
}

function readExistingLease({ leasePath, resourceKey, fileSystem }) {
  let raw;
  try {
    raw = fileSystem.readFileSync(leasePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    return { state: 'corrupt', raw };
  }
  if (!isValidLeaseDocument(document, resourceKey)) return { state: 'corrupt', raw, document };
  return { state: 'present', document };
}

function toLeaseHandle({ document, leasePath, directory }) {
  return {
    resourceKey: document.resourceKey,
    ownerPid: document.ownerPid,
    checkoutPath: document.checkoutPath,
    acquiredAt: document.acquiredAt,
    launcherIdentity: document.launcherIdentity,
    ports: [...document.ports],
    leaseId: document.leaseId,
    leasePath,
    directory,
  };
}

function throwActiveOwner({ document, leasePath, reason = 'active-owner' }) {
  throw new LocalRuntimeLeaseError(
    formatOwnerAttribution({
      ownerPid: document.ownerPid,
      checkoutPath: document.checkoutPath,
      acquiredAt: document.acquiredAt,
      leasePath,
    }),
    {
      resourceKey: document.resourceKey,
      ownerPid: document.ownerPid,
      ownerCheckout: document.checkoutPath,
      acquiredAt: document.acquiredAt,
      ports: document.ports,
      leasePath,
      reason,
    },
  );
}

function writeExclusiveLease({ leasePath, document, fileSystem }) {
  let descriptor;
  try {
    descriptor = fileSystem.openSync(leasePath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') return { created: false };
    throw error;
  }
  try {
    fileSystem.writeSync(descriptor, JSON.stringify(document, null, 2));
  } catch (error) {
    try {
      fileSystem.closeSync(descriptor);
    } catch {
      // best effort: 아래 unlink에서 정리한다.
    }
    try {
      fileSystem.unlinkSync(leasePath);
    } catch {
      // best effort: 다음 획득 시도가 stale/active를 다시 판정한다.
    }
    throw error;
  }
  fileSystem.closeSync(descriptor);
  return { created: true };
}

export function acquireRuntimeLease({
  directory,
  resourceKey = LOCAL_RUNTIME_STACK_RESOURCE_KEY,
  ports = LOCAL_RUNTIME_STACK_PORTS,
  repositoryRoot,
  checkoutPath,
  launcherIdentity = LOCAL_RUNTIME_LAUNCHER_IDENTITY,
  ownerPid = process.pid,
  acquiredAt,
  leaseId,
  platform = process.platform,
  env = process.env,
  fileSystem = nodeFs,
  isOwnerAlive = defaultIsOwnerAlive,
} = {}) {
  const resolvedDirectory = directory ?? resolveLeaseDirectory({ platform, env });
  const leasePath = resolveLeaseFilePath(resolvedDirectory, resourceKey);
  const ownerCheckout = checkoutPath ?? repositoryRoot ?? process.cwd();
  const candidate = {
    resourceKey,
    ownerPid,
    checkoutPath: ownerCheckout,
    acquiredAt: acquiredAt ?? new Date().toISOString(),
    launcherIdentity,
    ports: [...ports],
    leaseId: leaseId ?? randomUUID(),
  };

  fileSystem.mkdirSync(resolvedDirectory, { recursive: true });

  const first = writeExclusiveLease({ leasePath, document: candidate, fileSystem });
  if (first.created) {
    return toLeaseHandle({ document: candidate, leasePath, directory: resolvedDirectory });
  }

  const existing = readExistingLease({ leasePath, resourceKey, fileSystem });
  if (existing.state === 'missing') {
    const retry = writeExclusiveLease({ leasePath, document: candidate, fileSystem });
    if (retry.created) {
      return toLeaseHandle({ document: candidate, leasePath, directory: resolvedDirectory });
    }
    const raced = readExistingLease({ leasePath, resourceKey, fileSystem });
    if (raced.state === 'present') throwActiveOwner({ document: raced.document, leasePath });
    throw new LocalRuntimeLeaseError(
      `Greenhub local runtime lease 획득 경쟁에서 졌습니다 (resource=${resourceKey}, lease=${leasePath}).`,
      { resourceKey, leasePath, ports: [...ports], reason: 'race-lost' },
    );
  }

  if (existing.state === 'corrupt') {
    throw new LocalRuntimeLeaseError(
      `Greenhub local runtime lease 파일이 손상되어 fail-closed합니다 (lease=${leasePath}). ` +
        `owner를 확인할 수 없으므로 자동 삭제하지 않습니다. owner process가 없음을 직접 확인한 뒤 파일을 삭제하세요.`,
      { resourceKey, leasePath, ports: [...ports], reason: 'corrupt-lease' },
    );
  }

  let liveness;
  try {
    liveness = isOwnerAlive(existing.document.ownerPid);
  } catch {
    liveness = undefined;
  }
  if (liveness !== false) {
    throwActiveOwner({
      document: existing.document,
      leasePath,
      reason: liveness === true ? 'active-owner' : 'owner-unknown',
    });
  }

  const reread = readExistingLease({ leasePath, resourceKey, fileSystem });
  if (reread.state === 'missing') {
    const retry = writeExclusiveLease({ leasePath, document: candidate, fileSystem });
    if (retry.created) {
      return toLeaseHandle({ document: candidate, leasePath, directory: resolvedDirectory });
    }
    const raced = readExistingLease({ leasePath, resourceKey, fileSystem });
    if (raced.state === 'present') throwActiveOwner({ document: raced.document, leasePath });
    throw new LocalRuntimeLeaseError(
      `Greenhub local runtime lease 획득 경쟁에서 졌습니다 (resource=${resourceKey}, lease=${leasePath}).`,
      { resourceKey, leasePath, ports: [...ports], reason: 'race-lost' },
    );
  }
  if (reread.state !== 'present' || reread.document.leaseId !== existing.document.leaseId) {
    const latest = readExistingLease({ leasePath, resourceKey, fileSystem });
    if (latest.state === 'present') throwActiveOwner({ document: latest.document, leasePath });
    throw new LocalRuntimeLeaseError(
      `Greenhub local runtime lease 획득 경쟁에서 졌습니다 (resource=${resourceKey}, lease=${leasePath}).`,
      { resourceKey, leasePath, ports: [...ports], reason: 'race-lost' },
    );
  }

  try {
    fileSystem.unlinkSync(leasePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const reclaimed = writeExclusiveLease({ leasePath, document: candidate, fileSystem });
  if (reclaimed.created) {
    return toLeaseHandle({ document: candidate, leasePath, directory: resolvedDirectory });
  }
  const winner = readExistingLease({ leasePath, resourceKey, fileSystem });
  if (winner.state === 'present') throwActiveOwner({ document: winner.document, leasePath });
  throw new LocalRuntimeLeaseError(
    `Greenhub local runtime lease 획득 경쟁에서 졌습니다 (resource=${resourceKey}, lease=${leasePath}).`,
    { resourceKey, leasePath, ports: [...ports], reason: 'race-lost' },
  );
}

export function releaseRuntimeLease(handle, { fileSystem = nodeFs } = {}) {
  const leasePath = handle?.leasePath ?? (handle?.directory
    ? resolveLeaseFilePath(handle.directory, handle?.resourceKey ?? LOCAL_RUNTIME_STACK_RESOURCE_KEY)
    : undefined);
  const leaseId = handle?.leaseId;
  if (!leasePath || !leaseId) return { released: false, reason: 'invalid-handle' };

  let raw;
  try {
    raw = fileSystem.readFileSync(leasePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { released: false, reason: 'not-found' };
    throw error;
  }

  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    return { released: false, reason: 'corrupt' };
  }
  if (document?.leaseId !== leaseId) return { released: false, reason: 'not-owner' };

  try {
    fileSystem.unlinkSync(leasePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { released: false, reason: 'not-found' };
    throw error;
  }
  return { released: true, reason: 'released' };
}

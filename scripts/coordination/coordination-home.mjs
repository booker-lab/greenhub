// Bounded mutation owner: GREENHUB-COORDINATION-DURABLE-CORE-01.
// Surface: scripts/coordination/** only. No application code is touched.
//
// Runtime-state contract:
//   REPOSITORY = code/schema/tests
//   RUNTIME_STATE = external local durable directory (never the repo worktree).
//
// Resolution order:
//   1. explicit `override` directory (tests use an isolated temp directory),
//   2. GREENHUB_COORDINATION_HOME environment variable,
//   3. OS user-home based Greenhub-local state path.
//
// This module never derives the home from repositoryRoot/checkoutPath/cwd.

import nodeOs from 'node:os';
import nodePath from 'node:path';

export const COORDINATION_HOME_ENV_KEY = 'GREENHUB_COORDINATION_HOME';

function readEnvValue(environment, key) {
  const value = environment?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve the durable local coordination home directory.
 * Pure function of (platform, env, override). Never touches the repository.
 */
export function resolveCoordinationHome({ platform = process.platform, env = process.env, override } = {}) {
  if (typeof override === 'string' && override.trim()) return override;
  const explicit = readEnvValue(env, COORDINATION_HOME_ENV_KEY);
  if (explicit) return explicit;

  const home = typeof nodeOs.homedir === 'function' ? nodeOs.homedir() : '';
  if (platform === 'win32') {
    const base =
      readEnvValue(env, 'LOCALAPPDATA') ||
      readEnvValue(env, 'APPDATA') ||
      home ||
      nodeOs.tmpdir();
    return nodePath.join(base, 'Greenhub', 'coordination');
  }

  const xdgState = readEnvValue(env, 'XDG_STATE_HOME');
  if (xdgState) return nodePath.join(xdgState, 'greenhub', 'coordination');
  if (home) return nodePath.join(home, '.local', 'state', 'greenhub', 'coordination');
  return nodePath.join(nodeOs.tmpdir(), 'greenhub-coordination');
}

export function isExplicitCoordinationHomeOverride({ env = process.env, override } = {}) {
  if (typeof override === 'string' && override.trim()) return true;
  return Boolean(readEnvValue(env, COORDINATION_HOME_ENV_KEY));
}

export function resolveTaskDirectory(home, taskId) {
  return nodePath.join(home, 'tasks', taskId);
}

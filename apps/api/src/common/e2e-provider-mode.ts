import { ConfigService } from '@nestjs/config';

const PRODUCTION_FIREBASE_PROJECT = 'green-e4fe3';
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{6,46}[a-z0-9]$/;

export type E2EProviderMode =
  | { enabled: false; mode: 'live' }
  | {
      enabled: true;
      mode: 'stub';
      runId: string;
      firebaseProjectId: string;
    };

export class E2EProviderModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E2EProviderModeError';
  }
}

function splitAllowedProjects(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((project) => project.trim())
      .filter(Boolean),
  );
}

export function resolveE2EProviderMode(config: ConfigService): E2EProviderMode {
  const enabled = config.get<string>('ROUND_DIRECT_E2E_ENABLED', 'false') === 'true';
  const mode = config.get<string>('ROUND_DIRECT_E2E_PROVIDER_MODE', 'live');

  if (!enabled) {
    if (mode === 'stub') {
      throw new E2EProviderModeError('비활성 상태에서는 stub provider mode를 사용할 수 없습니다.');
    }
    return { enabled: false, mode: 'live' };
  }

  const nodeEnvironment = config.get<string>('NODE_ENV', '');
  const railwayEnvironment = config.get<string>('RAILWAY_ENVIRONMENT_NAME', '');
  const vercelEnvironment = config.get<string>('VERCEL_ENV', '');
  if (
    nodeEnvironment === 'production' ||
    railwayEnvironment === 'production' ||
    vercelEnvironment === 'production'
  ) {
    throw new E2EProviderModeError('운영 환경에서는 회차 E2E provider 대역을 사용할 수 없습니다.');
  }
  if (config.get<string>('ROUND_DIRECT_E2E_ENV', '') !== 'preview') {
    throw new E2EProviderModeError('회차 E2E 환경 표식이 preview가 아닙니다.');
  }
  if (mode !== 'stub') {
    throw new E2EProviderModeError('회차 E2E는 stub provider mode만 허용합니다.');
  }
  if (!config.get<string>('ROUND_DIRECT_E2E_SHARED_SECRET', '').trim()) {
    throw new E2EProviderModeError('회차 E2E 공유 secret이 설정되지 않았습니다.');
  }

  const firebaseProjectId = config.get<string>('FIREBASE_PROJECT_ID', '').trim();
  const allowedProjects = splitAllowedProjects(
    config.get<string>('ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS', ''),
  );
  if (
    !firebaseProjectId ||
    firebaseProjectId === PRODUCTION_FIREBASE_PROJECT ||
    !allowedProjects.has(firebaseProjectId)
  ) {
    throw new E2EProviderModeError('허용된 비운영 Firebase project가 아닙니다.');
  }

  const runId = config.get<string>('ROUND_DIRECT_E2E_RUN_ID', '').trim();
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new E2EProviderModeError('회차 E2E 실행 ID 형식이 올바르지 않습니다.');
  }

  return {
    enabled: true,
    mode: 'stub',
    runId,
    firebaseProjectId,
  };
}

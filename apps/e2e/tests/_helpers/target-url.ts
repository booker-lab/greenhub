type TargetApp = 'consumer' | 'seller' | 'driver';

type TargetUrls = Record<TargetApp, string>;

const DEFAULT_TARGET_URLS: TargetUrls = {
  consumer: 'https://greenlove.co.kr',
  seller: 'https://seller.greenlove.co.kr',
  driver: 'https://driver.greenlove.co.kr',
};

// 로컬 대상 모드(ROUND_DIRECT_E2E_TARGET_MODE=local)에서만 허용하는 앱별 고정 루프백 origin.
// 세 앱을 서로 다른 호스트로 띄워 한 브라우저 컨텍스트의 Auth.js 세션 쿠키가 겹치지 않게 한다.
// scripts/check-round-direct-e2e-readiness.mjs의 LOCAL_TARGET_ORIGINS와 같아야 한다(테스트로 고정).
export const ROUND_DIRECT_LOCAL_TARGET_MODE = 'local';
export const ROUND_DIRECT_LOCAL_TARGET_ORIGINS: Readonly<TargetUrls> = Object.freeze({
  consumer: 'http://127.0.0.1:3101',
  seller: 'http://127.0.0.2:3102',
  driver: 'http://127.0.0.3:3103',
});

const TARGET_ENV_NAMES: Record<TargetApp, string> = {
  consumer: 'CONSUMER_BASE',
  seller: 'SELLER_BASE',
  driver: 'DRIVER_BASE',
};

function normalizeTargetUrl(value: unknown, requireHttps = false): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (requireHttps && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function readRoundDirectTargetMode(env: NodeJS.ProcessEnv): 'preview' | 'local' {
  const mode = env.ROUND_DIRECT_E2E_TARGET_MODE?.trim() ?? '';
  if (!mode) return 'preview';
  if (mode === ROUND_DIRECT_LOCAL_TARGET_MODE) return 'local';
  throw new Error('회차 E2E 대상 모드는 비워 두거나 local이어야 합니다.');
}

function normalizeLocalTargetUrl(app: TargetApp, value: unknown): string | null {
  const target = normalizeTargetUrl(value);
  return target === ROUND_DIRECT_LOCAL_TARGET_ORIGINS[app] ? target : null;
}

export function readRoundDirectTargetUrls(env: NodeJS.ProcessEnv = process.env): TargetUrls | null {
  if (env.ROUND_DIRECT_E2E_ENABLED !== 'true') return null;
  const targetMode = readRoundDirectTargetMode(env);

  const raw = env.ROUND_DIRECT_E2E_TARGET_URLS_JSON?.trim();
  if (!raw) {
    throw new Error('회차 E2E deployment target_url 전달값이 설정되지 않았습니다.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('회차 E2E deployment target_url 전달값이 JSON 형식이 아닙니다.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('회차 E2E deployment target_url 전달값이 객체가 아닙니다.');
  }

  const result = {} as TargetUrls;
  for (const app of Object.keys(DEFAULT_TARGET_URLS) as TargetApp[]) {
    const value = (parsed as Record<string, unknown>)[app];
    // preview는 HTTPS deployment URL만, local은 앱별 고정 루프백 origin만 허용한다.
    const target =
      targetMode === 'local'
        ? normalizeLocalTargetUrl(app, value)
        : normalizeTargetUrl(value, true);
    if (!target) {
      throw new Error(`회차 E2E ${app} deployment target_url이 유효하지 않습니다.`);
    }
    result[app] = target;
  }
  return result;
}

export function resolveE2ETargetUrl(app: TargetApp, env: NodeJS.ProcessEnv = process.env): string {
  const roundDirectTargets = readRoundDirectTargetUrls(env);
  if (roundDirectTargets) return roundDirectTargets[app];

  return normalizeTargetUrl(env[TARGET_ENV_NAMES[app]]) ?? DEFAULT_TARGET_URLS[app];
}

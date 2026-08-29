type TargetApp = 'consumer' | 'seller' | 'driver';

type TargetUrls = Record<TargetApp, string>;

const DEFAULT_TARGET_URLS: TargetUrls = {
  consumer: 'https://greenlove.co.kr',
  seller: 'https://seller.greenlove.co.kr',
  driver: 'https://driver.greenlove.co.kr',
};

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

export function readRoundDirectTargetUrls(env: NodeJS.ProcessEnv = process.env): TargetUrls | null {
  if (env.ROUND_DIRECT_E2E_ENABLED !== 'true') return null;

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
    const target = normalizeTargetUrl((parsed as Record<string, unknown>)[app], true);
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

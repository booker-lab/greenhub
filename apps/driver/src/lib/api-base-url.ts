export const DEVELOPMENT_API_BASE_URL = 'http://localhost:3000';

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigurationError';
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]';
}

export function resolveApiBaseUrl({
  configuredUrl,
  nodeEnv = process.env.NODE_ENV,
  developmentFallback = DEVELOPMENT_API_BASE_URL,
}: {
  configuredUrl?: string;
  nodeEnv?: string;
  developmentFallback?: string;
} = {}): string {
  const value = configuredUrl?.trim();
  if (!value) {
    if (nodeEnv === 'production') {
      throw new ApiConfigurationError(
        'Production API URL이 설정되지 않았습니다. NEXT_PUBLIC_API_URL을 설정하세요.',
      );
    }
    return developmentFallback;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiConfigurationError('API URL 설정이 올바른 URL 형식이 아닙니다.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ApiConfigurationError('API URL은 인증정보 없는 HTTP 또는 HTTPS URL이어야 합니다.');
  }
  if (url.search || url.hash) {
    throw new ApiConfigurationError('API URL에는 query 또는 fragment를 포함할 수 없습니다.');
  }
  if (nodeEnv === 'production' && isLoopbackHost(url.hostname)) {
    throw new ApiConfigurationError('Production API URL은 localhost를 사용할 수 없습니다.');
  }

  return url.toString().replace(/\/$/, '');
}

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl({
    configuredUrl: process.env.NEXT_PUBLIC_API_URL,
    nodeEnv: process.env.NODE_ENV,
  });
}

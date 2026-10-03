// 로그인 후 복귀할 주소(callbackUrl)를 같은 출처의 상대 경로로만 좁힌다.
// 열린 리다이렉트를 막기 위해 허용하지 않는 값은 모두 홈('/')으로 바꾼다.

export const DEFAULT_CALLBACK_PATH = '/';

const PROBE_ORIGIN = 'http://callback-check.invalid';

// 브라우저 URL 파서는 탭·줄바꿈 등 제어 문자를 지우고 `\`를 `/`로 바꾼다.
// 그래서 `/\evil.com`, `/\t/evil.com` 같은 값이 `//evil.com`(다른 출처)으로 바뀔 수 있다.
// 제어 문자와 역슬래시는 위치와 상관없이 거부한다.
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자 거부가 목적이다.
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f\\]/;

function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (FORBIDDEN_CHARS.test(path)) return false;

  try {
    // 임의의 기준 출처로 해석해도 출처가 바뀌지 않아야 같은 출처의 경로다.
    return new URL(path, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * callbackUrl 값을 안전한 같은 출처 상대 경로로 바꾼다.
 *
 * - `/`로 시작하는 상대 경로만 허용한다(`//`, `/\`, 제어 문자 포함은 거부).
 * - `origin`을 주면, Auth.js가 만들어 주는 같은 출처 절대 주소
 *   (`https://현재출처/checkout?...`)는 경로+쿼리+해시로 바꿔 허용한다.
 *   다른 출처이거나 `javascript:` 같은 스킴은 거부한다.
 * - 허용하지 않는 값은 모두 `/`.
 */
export function safeCallbackPath(raw: string | null | undefined, origin?: string): string {
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_CALLBACK_PATH;

  let candidate = raw;
  if (!raw.startsWith('/')) {
    if (!origin || FORBIDDEN_CHARS.test(raw)) return DEFAULT_CALLBACK_PATH;
    try {
      const url = new URL(raw);
      if (url.origin !== origin) return DEFAULT_CALLBACK_PATH;
      candidate = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return DEFAULT_CALLBACK_PATH;
    }
  }

  return isSafeRelativePath(candidate) ? candidate : DEFAULT_CALLBACK_PATH;
}

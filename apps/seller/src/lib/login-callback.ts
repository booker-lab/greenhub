// 로그인 뒤 돌아갈 주소(callbackUrl). proxy가 /login?callbackUrl=<경로>로 넘기고 로그인 화면이 받아 쓴다.
// 주소창에서 누구나 바꿀 수 있는 값이라 같은 출처의 상대 경로만 받는다. 다른 사이트로 보내는
// 값(//host, /\host, 스킴)·제어문자·로그인/API 경로는 버리고 null을 돌려준다(부르는 쪽이 기본 경로를 쓴다).

const CALLBACK_MAX_LENGTH = 2048;
// 제어문자(C0·DEL)와 역슬래시. 브라우저는 URL에서 역슬래시를 '/'로, 탭·줄바꿈을 지운 뒤 읽는다.
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자를 거르려고 일부러 넣었다.
const UNSAFE_CHARACTER = /[\u0000-\u001f\u007f\\]/;
const PARSE_BASE = 'https://callback.invalid';

function isBlockedPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return ['/login', '/api'].some((root) => lower === root || lower.startsWith(`${root}/`));
}

/** 안전한 같은 출처 상대 경로(pathname + search + hash)를 돌려준다. 받을 수 없는 값이면 null. */
export function safeCallbackPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > CALLBACK_MAX_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (UNSAFE_CHARACTER.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, PARSE_BASE);
  } catch {
    return null;
  }
  if (url.origin !== PARSE_BASE) return null;
  // '/a/../login'처럼 정규화하면 막힌 경로가 되는 값, '%2F'·'%6C'처럼 인코딩으로 감춘 값도 거른다.
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decoded.startsWith('//') || UNSAFE_CHARACTER.test(decoded)) return null;
  if (isBlockedPath(url.pathname) || isBlockedPath(decoded)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

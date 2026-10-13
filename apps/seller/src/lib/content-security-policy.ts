/**
 * 판매자 앱 Content-Security-Policy(Report-Only) 정책.
 *
 * proxy가 요청마다 nonce를 만들어 이 정책을 `Content-Security-Policy-Report-Only`로 보낸다.
 * 위반은 차단하지 않고 `/api/csp-report`로만 보고된다. 실제 보고를 확인한 뒤 강제로 바꾼다.
 * next.config.ts의 강제 CSP(object-src·base-uri·frame-ancestors·form-action)는 그대로 둔다.
 *
 * 출처 목록은 이 앱이 실제로 불러오는 곳만 둔다.
 * - API: NEXT_PUBLIC_API_URL(lib/api-base-url.ts와 같은 값)
 * - Firebase: lib/firebase.ts(Firestore 구독, Auth 커스텀 토큰 로그인·토큰 갱신, Storage 업로드)
 * - 이미지: 상품·배너·로고 사진(Firebase Storage 다운로드 URL, GCS URL)
 * - 로컬 개발(NODE_ENV=development): Firebase 에뮬레이터(lib/firebase.ts의 고정 주소)
 * - 프레임으로 띄우는 외부 화면은 없다.
 */

export const CSP_REPORT_PATH = '/api/csp-report';

const DEVELOPMENT_API_ORIGIN = 'http://localhost:3000';

const IMAGE_ORIGINS = ['https://firebasestorage.googleapis.com', 'https://storage.googleapis.com'];

const CONNECT_ORIGINS = [
  'https://firestore.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://firebasestorage.googleapis.com',
];

// lib/firebase.ts의 로컬 에뮬레이터(Firestore·Auth·Storage). 개발 모드에서만 허용한다.
const DEVELOPMENT_CONNECT_ORIGINS = [
  'http://127.0.0.1:8080',
  'http://127.0.0.1:9099',
  'http://127.0.0.1:9199',
];

export type ContentSecurityPolicyInput = {
  nonce: string;
  nodeEnv?: string;
  apiUrl?: string;
};

/** 요청마다 새로 만드는 128비트 nonce(base64). */
export function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * connect-src에 넣을 API origin. 설정이 비었거나 형식이 틀려도 proxy가 페이지를 막지 않도록
 * 예외를 던지지 않고 null을 돌려준다(API 설정 오류는 lib/api-base-url.ts가 따로 알린다).
 */
export function resolveCspApiOrigin(apiUrl: string | undefined, nodeEnv: string | undefined) {
  const value = apiUrl?.trim();
  if (!value) return nodeEnv === 'production' ? null : DEVELOPMENT_API_ORIGIN;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy({
  nonce,
  nodeEnv,
  apiUrl,
}: ContentSecurityPolicyInput): string {
  const isDevelopment = nodeEnv === 'development';
  const apiOrigin = resolveCspApiOrigin(apiUrl, nodeEnv);
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    // React 개발 모드는 오류 스택 복원에 eval을 쓴다. 운영 빌드에는 넣지 않는다.
    [
      'script-src',
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        ...(isDevelopment ? ["'unsafe-eval'"] : []),
      ],
    ],
    // Mantine 컴포넌트가 인라인 style을 쓴다.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...IMAGE_ORIGINS]],
    ['font-src', ["'self'", 'data:']],
    [
      'connect-src',
      [
        "'self'",
        ...(apiOrigin ? [apiOrigin] : []),
        ...CONNECT_ORIGINS,
        ...(isDevelopment ? DEVELOPMENT_CONNECT_ORIGINS : []),
      ],
    ],
    ['frame-src', ["'none'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['frame-ancestors', ["'self'"]],
    ['form-action', ["'self'"]],
    // report-to(Reporting API)를 함께 두면 Chrome은 report-uri를 무시한다. 로컬 확인에서
    // report-to 보고가 전달되지 않아 실제로 도착하는 report-uri만 둔다.
    ['report-uri', [CSP_REPORT_PATH]],
  ];
  return directives
    .map(([name, sources]) => `${name} ${[...new Set(sources)].join(' ')}`)
    .join('; ');
}

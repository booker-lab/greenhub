/**
 * 소비자 앱 Content-Security-Policy(Report-Only) 정책.
 *
 * proxy가 요청마다 nonce를 만들어 이 정책을 `Content-Security-Policy-Report-Only`로 보낸다.
 * 위반은 차단하지 않고 `/api/csp-report`로만 보고된다. 실제 보고를 확인한 뒤 강제로 바꾼다.
 * next.config.ts의 강제 CSP(object-src·base-uri·frame-ancestors)는 그대로 둔다.
 *
 * 출처 목록은 이 앱이 실제로 불러오는 곳만 둔다.
 * - API: NEXT_PUBLIC_API_URL(lib/api-base-url.ts와 같은 값)
 * - Firestore: lib/firebase.ts(Firestore만 쓴다. Auth·Storage SDK는 쓰지 않는다)
 * - 이미지: 상품 사진(Firebase Storage 다운로드 URL), 배송 사진(GCS 서명 URL)
 * - 결제: @portone/browser-sdk(cdn.portone.io에서 SDK를 불러와 결제창을 띄운다)
 * - 우편번호: checkout/page.tsx가 t1.daumcdn.net의 다음 우편번호 스크립트를 불러온다
 */

export const CSP_REPORT_PATH = '/api/csp-report';

const DEVELOPMENT_API_ORIGIN = 'http://localhost:3000';

const IMAGE_ORIGINS = ['https://firebasestorage.googleapis.com', 'https://storage.googleapis.com'];

const CONNECT_ORIGINS = ['https://firestore.googleapis.com', 'https://*.portone.io'];

const FRAME_ORIGINS = ['https://*.portone.io', 'https://postcode.map.daum.net'];

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
    ['connect-src', ["'self'", ...(apiOrigin ? [apiOrigin] : []), ...CONNECT_ORIGINS]],
    ['frame-src', FRAME_ORIGINS],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['frame-ancestors', ["'self'"]],
    // 모바일 결제는 결제사로 폼을 제출하며 이동하므로 form-action은 두지 않는다.
    // report-to(Reporting API)를 함께 두면 Chrome은 report-uri를 무시한다. 로컬 확인에서
    // report-to 보고가 전달되지 않아 실제로 도착하는 report-uri만 둔다.
    ['report-uri', [CSP_REPORT_PATH]],
  ];
  return directives
    .map(([name, sources]) => `${name} ${[...new Set(sources)].join(' ')}`)
    .join('; ');
}

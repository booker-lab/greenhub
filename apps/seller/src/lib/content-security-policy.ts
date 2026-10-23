/**
 * 판매자 앱 Content-Security-Policy(Report-Only) 정책.
 *
 * proxy가 요청마다 nonce를 만들어 이 정책을 `Content-Security-Policy-Report-Only`로 보낸다.
 * 위반은 차단하지 않고 `/api/csp-report`로만 보고된다. 실제 보고를 확인한 뒤 강제로 바꾼다.
 * next.config.ts의 강제 CSP(object-src·base-uri·frame-ancestors·form-action)는 그대로 둔다.
 *
 * 지시어 공통 틀은 packages/shared/src/content-security-policy.ts가 만들고, 이 파일은
 * 이 앱이 실제로 불러오는 출처 목록과 frame-src·form-action 차이만 정한다.
 * - API: NEXT_PUBLIC_API_URL(lib/api-base-url.ts와 같은 값)
 * - Firebase: lib/firebase.ts(Firestore 구독, Auth 커스텀 토큰 로그인·토큰 갱신, Storage 업로드)
 * - 이미지: 상품·배너·로고 사진(Firebase Storage 다운로드 URL, GCS URL)
 * - 로컬 개발(NODE_ENV=development): Firebase 에뮬레이터(lib/firebase.ts의 고정 주소)
 * - 프레임으로 띄우는 외부 화면은 없다.
 */

import {
  type AppContentSecurityPolicy,
  buildContentSecurityPolicy as buildPolicy,
  type ContentSecurityPolicyInput,
} from '@greenhub/shared';

export { CSP_REPORT_PATH, createCspNonce } from '@greenhub/shared';

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

const SELLER_POLICY: AppContentSecurityPolicy = {
  imageOrigins: IMAGE_ORIGINS,
  connectOrigins: CONNECT_ORIGINS,
  developmentConnectOrigins: DEVELOPMENT_CONNECT_ORIGINS,
  formActionSelf: true,
};

export function buildContentSecurityPolicy(input: ContentSecurityPolicyInput): string {
  return buildPolicy(SELLER_POLICY, input);
}

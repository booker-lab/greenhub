/**
 * 소비자 앱 Content-Security-Policy(Report-Only) 정책.
 *
 * proxy가 요청마다 nonce를 만들어 이 정책을 `Content-Security-Policy-Report-Only`로 보낸다.
 * 위반은 차단하지 않고 `/api/csp-report`로만 보고된다. 실제 보고를 확인한 뒤 강제로 바꾼다.
 * next.config.ts의 강제 CSP(object-src·base-uri·frame-ancestors)는 그대로 둔다.
 *
 * 지시어 공통 틀은 packages/shared/src/content-security-policy.ts가 만들고, 이 파일은
 * 이 앱이 실제로 불러오는 출처 목록과 frame-src·form-action 차이만 정한다.
 * - API: NEXT_PUBLIC_API_URL(lib/api-base-url.ts와 같은 값)
 * - Firestore: lib/firebase.ts(Firestore만 쓴다. Auth·Storage SDK는 쓰지 않는다)
 * - 이미지: 상품 사진(Firebase Storage 다운로드 URL), 배송 사진(GCS 서명 URL)
 * - 결제: @portone/browser-sdk(cdn.portone.io에서 SDK를 불러와 결제창을 띄운다)
 * - 우편번호: checkout/page.tsx가 t1.daumcdn.net의 다음 우편번호 스크립트를 불러온다
 */

import {
  type AppContentSecurityPolicy,
  buildContentSecurityPolicy as buildPolicy,
  type ContentSecurityPolicyInput,
} from '@greenhub/shared';

export { CSP_REPORT_PATH, createCspNonce } from '@greenhub/shared';

const IMAGE_ORIGINS = ['https://firebasestorage.googleapis.com', 'https://storage.googleapis.com'];

const CONNECT_ORIGINS = ['https://firestore.googleapis.com', 'https://*.portone.io'];

const FRAME_ORIGINS = ['https://*.portone.io', 'https://postcode.map.daum.net'];

const CONSUMER_POLICY: AppContentSecurityPolicy = {
  imageOrigins: IMAGE_ORIGINS,
  connectOrigins: CONNECT_ORIGINS,
  frameOrigins: FRAME_ORIGINS,
  // 모바일 결제는 결제사로 폼을 제출하며 이동하므로 form-action은 두지 않는다.
  formActionSelf: false,
};

export function buildContentSecurityPolicy(input: ContentSecurityPolicyInput): string {
  return buildPolicy(CONSUMER_POLICY, input);
}

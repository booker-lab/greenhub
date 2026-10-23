import { resolveApiBaseUrl } from '@greenhub/shared';

// NEXT_PUBLIC_API_URL은 빌드할 때 이 앱 코드 안에서 값이 굳어야 하므로 환경변수는 여기서 읽는다.
// 주소 검사 규칙은 packages/shared/src/api-base-url.ts의 resolveApiBaseUrl이 정한다.
export function getApiBaseUrl(): string {
  return resolveApiBaseUrl({
    configuredUrl: process.env.NEXT_PUBLIC_API_URL,
    nodeEnv: process.env.NODE_ENV,
  });
}

import { handleCspReportRequest } from '@greenhub/shared';

// 브라우저가 보내는 CSP 위반 보고를 받아 요약 한 줄만 남긴다. 처리 규칙은 packages/shared/src/csp-report.ts.
export async function POST(request: Request): Promise<Response> {
  return handleCspReportRequest(request);
}

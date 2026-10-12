import {
  CSP_REPORT_CONTENT_TYPES,
  formatCspViolation,
  readBodyWithinLimit,
  readContentType,
  summarizeCspReports,
} from '@/lib/csp-report';

// 브라우저가 보내는 CSP 위반 보고를 받아 요약 한 줄만 남긴다. 응답 본문은 없다.
export async function POST(request: Request): Promise<Response> {
  if (!CSP_REPORT_CONTENT_TYPES.includes(readContentType(request))) {
    return new Response(null, { status: 415 });
  }
  const text = await readBodyWithinLimit(request);
  if (text === null) return new Response(null, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  for (const summary of summarizeCspReports(payload)) {
    console.warn(formatCspViolation(summary));
  }
  return new Response(null, { status: 204 });
}

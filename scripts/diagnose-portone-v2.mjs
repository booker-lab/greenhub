const API_BASE_URL = 'https://api.portone.io';
const MAX_FIELD_LENGTH = 500;

function sanitizeField(value, secret) {
  if (typeof value !== 'string') return 'unknown';

  let sanitized = value.replace(/[\r\n\t]/g, ' ');
  if (secret) sanitized = sanitized.split(secret).join('[REDACTED]');
  return sanitized.slice(0, MAX_FIELD_LENGTH);
}

function safeResponseBody(body, secret) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { type: 'unparseable', message: '응답 본문이 JSON 객체가 아님' };
  }

  return {
    type: sanitizeField(body.type, secret),
    message: sanitizeField(body.message, secret),
  };
}

const apiSecret = process.env.PORTONE_V2_SECRET ?? '';
const paymentId = process.env.PAYMENT_ID ?? '';

if (!apiSecret || !paymentId) {
  console.log(
    JSON.stringify({
      httpStatus: null,
      responseBody: {
        type: 'MissingEnvironmentVariable',
        message: 'PORTONE_V2_SECRET과 PAYMENT_ID가 모두 필요함',
      },
    }),
  );
  process.exitCode = 2;
} else {
  try {
    const response = await fetch(`${API_BASE_URL}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${apiSecret}` },
    });

    let body;
    try {
      body = await response.json();
    } catch {
      body = { type: 'NonJsonResponse', message: '응답 본문을 JSON으로 해석하지 못함' };
    }

    console.log(
      JSON.stringify({
        httpStatus: response.status,
        responseBody: safeResponseBody(body, apiSecret),
      }),
    );
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        httpStatus: null,
        responseBody: {
          type: 'NetworkError',
          message: sanitizeField(error instanceof Error ? error.message : String(error), apiSecret),
        },
      }),
    );
    process.exitCode = 1;
  }
}

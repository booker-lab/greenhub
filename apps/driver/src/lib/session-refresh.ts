/**
 * 기사 앱 세션(API 토큰) 갱신의 순수 판단 (DOM·next-auth 없음, node:test로 검증).
 *
 * API 토큰은 1시간이면 만료되고, Auth.js jwt callback(auth.ts)은 세션을 다시 받을 때만 토큰을
 * 갱신한다. 화면은 기억해 둔 토큰으로 API를 부르므로, 세션을 다시 받지 않은 채 앱을 오래 켜 두면
 * 만료된 토큰을 보내 401이 나고 "로그인이 필요합니다"에 막힌다.
 *
 * 1) 조회(GET)는 401이면 세션을 한 번 다시 받아 새 토큰으로 같은 조회를 한 번만 다시 보낸다.
 *    명령(PATCH·POST)은 절대 다시 보내지 않는다. 명령은 응답이 불확실하면 상태를 다시 조회해
 *    수렴한다(#379).
 * 2) 앱을 켜 둔 동안 2분마다 세션을 다시 확인해 jwt callback이 토큰을 미리 갱신하게 한다.
 *    확인 실패는 무시하고(약한 전파에서 세션을 비로그인으로 바꾸지 않는다), 새 토큰을 받았을
 *    때만 화면 세션을 갱신한다.
 */

/** 세션 다시 확인 주기. API 토큰 1시간·jwt callback 갱신 기준 55분 사이에 여러 번 들어간다. */
export const SESSION_KEEPALIVE_INTERVAL_MS = 120_000;

/** 세션 다시 받기 대기 한도. 조회 시간 제한(api-timeout.ts API_READ_TIMEOUT_MS)과 같다. */
export const SESSION_REFRESH_TIMEOUT_MS = 15_000;

function usableAccessToken(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** task 결과를 기한 안에 받는다. 실패·기한 초과는 null이다(던지지 않는다). */
async function settleWithin(task: () => Promise<unknown>, timeoutMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(task), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 조회 1회. 401이면 refreshAccessToken으로 세션을 한 번 다시 받아, 쓸 수 있는 토큰이면 같은
 * 조회를 그 토큰으로 한 번만 다시 보낸다. 다시 받지 못했으면 처음 401 응답을 그대로 돌려준다.
 * 401이 아닌 응답과 네트워크 오류는 손대지 않는다.
 */
export async function retryReadOnceOnUnauthorized(args: {
  read: (token: string) => Promise<Response>;
  token: string;
  refreshAccessToken: () => Promise<unknown>;
  refreshTimeoutMs?: number;
}): Promise<Response> {
  const first = await args.read(args.token);
  if (first.status !== 401) return first;
  const refreshed = usableAccessToken(
    await settleWithin(
      args.refreshAccessToken,
      args.refreshTimeoutMs ?? SESSION_REFRESH_TIMEOUT_MS,
    ),
  );
  if (!refreshed) return first;
  return args.read(refreshed);
}

/** 다시 확인한 세션의 토큰이 화면 세션과 다를 때만 화면 세션을 갱신한다. */
export function shouldSyncSessionAccessToken(
  probed: unknown,
  current: string | null | undefined,
): boolean {
  const token = usableAccessToken(probed);
  return token !== null && token !== current;
}

/**
 * 주기적으로 세션을 다시 확인한다. 확인이 끝나기 전에는 다음 확인을 겹쳐 보내지 않고,
 * 실패·기한 초과·빈 토큰은 무시한다. 돌려준 함수를 부르면 멈춘다.
 */
export function startSessionKeepAlive(args: {
  probeAccessToken: () => Promise<unknown>;
  currentAccessToken: () => string | null | undefined;
  syncSession: () => void;
  intervalMs?: number;
  probeTimeoutMs?: number;
}): () => void {
  let probing = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (probing) return;
    probing = true;
    void settleWithin(args.probeAccessToken, args.probeTimeoutMs ?? SESSION_REFRESH_TIMEOUT_MS)
      .then((probed) => {
        if (!stopped && shouldSyncSessionAccessToken(probed, args.currentAccessToken())) {
          args.syncSession();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        probing = false;
      });
  }, args.intervalMs ?? SESSION_KEEPALIVE_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

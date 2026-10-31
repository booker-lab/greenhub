// 의도한 이동(fixture expectPath)이 있는 화면은 그 주소에 도착한 뒤 찍는다.
//
// 예: 소비자 /groupbuy는 화면이 판매 방식을 조회한 뒤 router.replace('/')로 옮긴다. networkidle·짧은 대기만으로는
// 첫 컴파일·부하가 겹치면 옮기기 전에 찍혀 정상 판정(주소 다름)에서 빠졌다.
// 판정은 느슨하게 하지 않는다: 시간 안에 도착하지 않으면 기다리기만 멈추고, 판정(soundness.mjs)이 그대로 실패시킨다.

export const EXPECTED_PATH_TIMEOUT_MS = 15_000;

/**
 * page의 주소(pathname)가 expectedPath가 될 때까지 기다린다. 기다리는 동안 주소가 바뀌었으면(이동했으면)
 * 옮겨 간 화면의 데이터 요청이 끝나도록 settle()을 부른다.
 * @param {{ url(): string, waitForURL(match: (url: URL) => boolean, options: object): Promise<unknown> }} page
 * @param {string} expectedPath
 * @param {{ timeout?: number, settle?: () => Promise<void> }} [options]
 * @returns {Promise<{ reached: boolean, moved: boolean }>}
 */
export async function waitForExpectedPath(page, expectedPath, options = {}) {
  const { timeout = EXPECTED_PATH_TIMEOUT_MS, settle } = options;
  const before = new URL(page.url()).pathname;
  if (before === expectedPath) return { reached: true, moved: false };
  const reached = await page
    .waitForURL((url) => url.pathname === expectedPath, { timeout, waitUntil: 'commit' })
    .then(() => true)
    .catch(() => false);
  const moved = new URL(page.url()).pathname !== before;
  if (moved && settle) await settle();
  return { reached, moved };
}

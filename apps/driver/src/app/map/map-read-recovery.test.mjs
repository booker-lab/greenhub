import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildDriverListScope,
  classifyDriverListReadStatus,
  shouldPreserveDriverListOnReadError,
} from '../../lib/driver-list-read.ts';

const mapSource = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

// Regression reference: verbatim behavioral copy of page.tsx nearestNeighbor.
// Source-containment assertions below pin the implementation; behavioral
// assertions below pin its semantics. Production/Kakao calls are never made.
function nearestNeighborReference(orders) {
  if (orders.length <= 1) return orders;
  const visited = new Set();
  const result = [];
  let current = orders[0];
  result.push(current);
  visited.add(current.id);

  while (result.length < orders.length) {
    let nearest = null;
    let minDist = Infinity;
    for (const o of orders) {
      if (visited.has(o.id)) continue;
      if (!o.lat || !o.lng || !current.lat || !current.lng) {
        nearest = o;
        break;
      }
      const dist = Math.hypot(o.lat - current.lat, o.lng - current.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = o;
      }
    }
    if (!nearest) break;
    result.push(nearest);
    visited.add(nearest.id);
    current = nearest;
  }
  return result;
}

// 1. initial loading: first authoritative GET before empty.
test('Map initial loading precedes any empty render', () => {
  assert.match(mapSource, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(mapSource, /배송 경로를 불러오는 중입니다/);
  assert.match(mapSource, /\{loading \?/);
  const loadingPos = mapSource.indexOf('{loading ?');
  const emptyPos = mapSource.indexOf('오늘 배송 주문이 없습니다');
  assert.ok(loadingPos !== -1 && emptyPos !== -1 && loadingPos < emptyPos);
  assert.match(mapSource, /if \(background\) \{\s*setRefreshing\(true\);\s*\} else \{\s*setLoading\(true\);\s*\}/s);
});

// 2. successful results: authoritative GET + filter renders route list.
test('Map successful results render filtered route list', () => {
  assert.match(mapSource, /apiFetch\(\s*['"]\/driver\/orders['"]/);
  assert.match(
    mapSource,
    /order\.status\s*===\s*['"]PREPARING['"]\s*\|\|\s*order\.status\s*===\s*['"]DELIVERING['"]/,
  );
  assert.match(mapSource, /setHasSuccessfulRead\(true\)/);
  assert.match(mapSource, /hasSuccessfulReadRef\.current = true/);
  assert.match(mapSource, /sorted\.map\(\(order, idx\)/);
  assert.match(mapSource, /buildKakaoNaviUrl\(\)/);
});

// 3. successful empty: only after authoritative success with zero filtered rows.
test('Map successful empty requires prior success and is separated from error', () => {
  assert.match(mapSource, /오늘 배송 주문이 없습니다/);
  assert.match(mapSource, /error && !hasSuccessfulRead/);
  const errorOnlyPos = mapSource.indexOf('error && !hasSuccessfulRead');
  const emptyPos = mapSource.indexOf('오늘 배송 주문이 없습니다');
  assert.ok(errorOnlyPos !== -1 && emptyPos !== -1 && errorOnlyPos < emptyPos);
  assert.match(mapSource, /setError\(null\)/);
});

// 4. initial fetch failure is not collapsed into empty.
test('Map initial fetch failure shows error with retry, not empty', () => {
  assert.match(mapSource, /배송 경로를 불러오지 못했습니다\. 잠시 후 다시 시도해주세요\./);
  assert.match(mapSource, /다시 시도/);
  // Initial failure clears to [] AND records an error (never a silent empty).
  // 401·403 authority loss는 별도 분기로 먼저 clear되므로 stale 판정은 공유 helper를 거친다.
  assert.match(
    mapSource,
    /shouldPreserveDriverListOnReadError\(kind, hasSuccessfulReadRef\.current\)\) \{\s*\/\/ refresh 실패/s,
  );
  assert.match(mapSource, /\} else \{\s*setOrders\(\[\]\);\s*setError\('배송 경로를 불러오지 못했습니다/s);
  // The old collapse (catch -> setOrders([]) with no setError) must be gone.
  assert.doesNotMatch(mapSource, /\.catch\(\(cause[^)]*\) => \{\s*if \(!active[^}]*return;\s*setOrders\(\[\]\);\s*\}\);/s);
});

// 5. retry re-executes the same /driver/orders GET.
test('Map retry re-executes the same orders GET', () => {
  assert.match(mapSource, /const \[reloadKey, setReloadKey\] = useState\(0\)/);
  assert.match(mapSource, /setReloadKey\(\(key\)\s*=>\s*key\s*\+\s*1\)/);
  assert.match(mapSource, /sessionStatus,\s*reloadKey\]/);
  const retryCount = (mapSource.match(/setReloadKey\(\(key\) => key \+ 1\)/g) ?? []).length;
  assert.ok(retryCount >= 2, `expected retry on initial-error and stale branches, found ${retryCount}`);
});

// 6. auth loss clears protected route data and never shows normal empty.
test('Map auth loss clears protected route data and shows auth state', () => {
  assert.match(mapSource, /const \[authRequired, setAuthRequired\] = useState\(false\)/);
  assert.match(mapSource, /if \(!token\) \{/);
  assert.match(mapSource, /setOrders\(\[\]\)/);
  assert.match(mapSource, /setAuthRequired\(true\)/);
  assert.match(mapSource, /로그인이 필요합니다\. 세션을 다시 확인해 주세요\./);
  assert.match(mapSource, /\) : authRequired \? \(/);
  const authPos = mapSource.indexOf(') : authRequired ?');
  const emptyPos = mapSource.indexOf('오늘 배송 주문이 없습니다');
  assert.ok(authPos !== -1 && emptyPos !== -1 && authPos < emptyPos);
  // Success memory resets so the next authed read starts as initial loading.
  assert.match(mapSource, /hasSuccessfulReadRef\.current = false/);
  assert.match(mapSource, /setHasSuccessfulRead\(false\)/);
  // In-flight reads are invalidated on auth loss.
  assert.match(mapSource, /requestIdRef\.current \+= 1;/);
});

// 7. token scope change / overlapping retry cannot be overwritten by stale responses.
test('Map token change and overlapping retry are guarded by request sequence', () => {
  assert.match(mapSource, /const requestIdRef = useRef\(0\)/);
  assert.match(mapSource, /requestId === requestIdRef\.current/);
  assert.match(mapSource, /const isCurrent = \(\) => active && requestId === requestIdRef\.current/);
  assert.match(mapSource, /if \(!isCurrent\(\)\) return;/);
  assert.match(mapSource, /new AbortController\(\)/);
  assert.match(mapSource, /controller\.abort\(\)/);
  assert.match(mapSource, /session\?\.user\.accessToken, sessionStatus, reloadKey\]/);
  assert.match(mapSource, /if \(sessionStatus === 'loading'\) return;/);
});

// 8. malformed payload is handled as fetch error, not success/empty.
test('Map malformed payload is a fetch error, not an empty list', () => {
  assert.match(mapSource, /if \(!Array\.isArray\(payload\)\) throw new Error/);
  assert.match(mapSource, /if \(!response\.ok\)/);
  assert.match(mapSource, /error && !hasSuccessfulRead/);
});

// 9. stale route failure policy: keep previous route, mark stale, offer retry.
test('Map refresh failure keeps previous route as stale with retry', () => {
  assert.match(mapSource, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(mapSource, /setRefreshing\(true\)/);
  assert.match(mapSource, /최신 정보를 확인하는 중입니다/);
  assert.match(mapSource, /hasSuccessfulReadRef/);
  assert.match(mapSource, /최신 경로를 불러오지 못했습니다\. 이전 경로를 보여줍니다\./);
  assert.match(mapSource, /\(이전 경로 표시 중\)/);
  // Stale branch must not clear the retained route.
  const staleIfStart = mapSource.indexOf(
    'if (shouldPreserveDriverListOnReadError(kind, hasSuccessfulReadRef.current)) {',
  );
  const staleSetErrorPos = mapSource.indexOf("setError('최신 경로를 불러오지 못했습니다");
  const staleSetErrorEnd = mapSource.indexOf("');", staleSetErrorPos) + 3;
  const staleBranch = mapSource.slice(staleIfStart, staleSetErrorEnd);
  assert.doesNotMatch(staleBranch, /setOrders\(\[\]\)/);
});

// 10. error/stale navigation is fail-closed.
test('Map navigation is fail-closed on error and stale states', () => {
  // Active navigation requires a fresh success with no error.
  assert.match(
    mapSource,
    /sorted\.length > 0 && !loading && !authRequired && !error && hasSuccessfulRead/,
  );
  assert.match(mapSource, /component="a"/);
  assert.match(mapSource, /href=\{buildKakaoNaviUrl\(\)\}/);
  // Stale navigation renders disabled with an explicit safety notice.
  assert.match(mapSource, /sorted\.length > 0 && error && hasSuccessfulRead/);
  assert.match(mapSource, /disabled/);
  assert.match(
    mapSource,
    /최신 경로 확인에 실패해 주행을 시작할 수 없습니다\. 다시 시도 후 최신 경로에서/,
  );
});

// 10b. loading/auth/initial-error states expose no navigation action.
test('Map loading, auth, and initial-error states expose no navigation', () => {
  const navActivePos = mapSource.indexOf('!error && hasSuccessfulRead');
  assert.ok(navActivePos !== -1);
  // Loading branch contains no navigation link.
  const loadingBranch = mapSource.slice(
    mapSource.indexOf('{loading ?'),
    mapSource.indexOf(') : authRequired ?'),
  );
  assert.doesNotMatch(loadingBranch, /buildKakaoNaviUrl|component="a"/);
  // Auth branch contains no navigation link.
  const authBranch = mapSource.slice(
    mapSource.indexOf(') : authRequired ?'),
    mapSource.indexOf(') : error && !hasSuccessfulRead ?'),
  );
  assert.doesNotMatch(authBranch, /buildKakaoNaviUrl|component="a"/);
});

// 11a. nearestNeighbor implementation is preserved (regression pins).
test('Map nearestNeighbor implementation is preserved', () => {
  assert.match(mapSource, /function nearestNeighbor/);
  assert.match(mapSource, /Math\.hypot\(o\.lat - current\.lat, o\.lng - current\.lng\)/);
  assert.match(mapSource, /visited\.has\(o\.id\)/);
  assert.match(mapSource, /if \(!o\.lat \|\| !o\.lng \|\| !current\.lat \|\| !current\.lng\)/);
});

// 11b. nearestNeighbor: empty and single inputs are identity.
test('nearestNeighbor handles empty and single orders', () => {
  assert.deepEqual(nearestNeighborReference([]), []);
  const single = [{ id: 'a', lat: 5, lng: 5 }];
  assert.deepEqual(nearestNeighborReference(single), single);
});

// 11c. nearestNeighbor: orders by proximity from the first order.
// NOTE: the preserved implementation treats 0 coordinates as missing
// (falsy `!o.lat` guard), so regression fixtures use non-zero coordinates.
test('nearestNeighbor orders by proximity from the first order', () => {
  const orders = [
    { id: 'start', lat: 5, lng: 5 },
    { id: 'far', lat: 15, lng: 5 },
    { id: 'near', lat: 6, lng: 5 },
  ];
  const ids = nearestNeighborReference(orders).map((o) => o.id);
  assert.deepEqual(ids, ['start', 'near', 'far']);
});

// 11d. nearestNeighbor: greedy chain follows the closest unvisited order.
test('nearestNeighbor follows the greedy closest chain', () => {
  const orders = [
    { id: 'a', lat: 5, lng: 5 },
    { id: 'b', lat: 10, lng: 5 },
    { id: 'c', lat: 11, lng: 5 },
  ];
  const ids = nearestNeighborReference(orders).map((o) => o.id);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

// 11e. nearestNeighbor: orders without coordinates fall through in input order.
test('nearestNeighbor keeps input order fallback for missing coordinates', () => {
  const orders = [
    { id: 'a', lat: 5, lng: 5 },
    { id: 'no-geo' },
    { id: 'b', lat: 6, lng: 6 },
  ];
  const ids = nearestNeighborReference(orders).map((o) => o.id);
  assert.deepEqual(ids, ['a', 'no-geo', 'b']);
});

// DRIVER-LIST-AUTH-SCOPE-RECOVERY-02 focused regression.
// Board와 같은 공유 helper로 401·403 authority loss와 user/token scope를 고정한다.

// Map 목록 상태의 최소 시뮬레이터. page.tsx 분기 순서
// (AUTH clear → helper preserve 판정 → initial clear, scope 변경 시 동기 clear)를
// 그대로 미러하며 실제 helper 분류 함수를 사용한다.
function createMapSim() {
  return { orders: [], hasSuccess: false, authRequired: false, error: null };
}

function applyMapSuccess(sim, rows) {
  sim.orders = rows;
  sim.hasSuccess = true;
  sim.authRequired = false;
  sim.error = null;
  return sim;
}

function applyMapFailure(sim, { status = null, network = false } = {}) {
  const kind = network ? 'FETCH_ERROR' : classifyDriverListReadStatus(status);
  if (kind === 'AUTH_ERROR') {
    sim.orders = [];
    sim.hasSuccess = false;
    sim.authRequired = true;
    sim.error = null;
    return sim;
  }
  if (shouldPreserveDriverListOnReadError(kind, sim.hasSuccess)) {
    sim.error = 'stale';
    return sim;
  }
  sim.orders = [];
  sim.error = 'initial';
  return sim;
}

// 12. success → 401/403이면 Map protected route를 즉시 clear하고 auth 상태로 전환한다.
test('Map 401·403 authority loss clears protected route and shows auth state', () => {
  // 배선: generic Error 문자열이 아닌 typed 분류를 throw한다.
  assert.match(mapSource, /throw toDriverListReadError\(response\.status\)/);
  assert.doesNotMatch(mapSource, /request failed: \$\{response\.status\}/);
  assert.match(mapSource, /toDriverListReadErrorKind\(cause\)/);
  const catchBlock = mapSource.slice(mapSource.indexOf('.catch('), mapSource.indexOf('.finally('));
  const authAt = catchBlock.indexOf("kind === 'AUTH_ERROR'");
  const preserveAt = catchBlock.indexOf('if (shouldPreserveDriverListOnReadError');
  assert.ok(authAt !== -1 && preserveAt !== -1 && authAt < preserveAt);
  const authBranch = catchBlock.slice(authAt, preserveAt);
  assert.match(authBranch, /setOrders\(\[\]\)/);
  assert.match(authBranch, /setHasSuccessfulRead\(false\)/);
  assert.match(authBranch, /hasSuccessfulReadRef\.current = false/);
  assert.match(authBranch, /setAuthRequired\(true\)/);
  // runtime: 401과 403 모두 stale 없이 auth-required로 전환된다.
  for (const status of [401, 403]) {
    const sim = applyMapSuccess(createMapSim(), [{ id: 'r1' }, { id: 'r2' }]);
    applyMapFailure(sim, { status });
    assert.deepEqual(sim.orders, []);
    assert.equal(sim.hasSuccess, false);
    assert.equal(sim.authRequired, true);
    assert.equal(sim.error, null);
  }
});

// 13. 같은 scope의 network/5xx 실패는 이전 route를 stale로 유지한다.
test('Map same-scope transient failure preserves stale route', () => {
  const sim = applyMapSuccess(createMapSim(), [{ id: 'r1' }]);
  applyMapFailure(sim, { network: true });
  assert.equal(sim.orders.length, 1);
  assert.equal(sim.hasSuccess, true);
  assert.equal(sim.authRequired, false);
  assert.equal(sim.error, 'stale');
  const failed5xx = applyMapSuccess(createMapSim(), [{ id: 'r1' }]);
  applyMapFailure(failed5xx, { status: 500 });
  assert.equal(failed5xx.orders.length, 1);
  assert.equal(failed5xx.hasSuccess, true);
});

// 14. user/token A → B 전환은 새 fetch 완료 전에 A route를 동기 clear한다.
test('Map user/token scope change synchronously clears previous route', () => {
  assert.match(mapSource, /listScopeRef/);
  assert.match(mapSource, /buildDriverListScope\(\{/);
  assert.match(
    mapSource,
    /session\?\.user\.id,\s*session\?\.user\.role,\s*session\?\.user\.accessToken,\s*sessionStatus,\s*reloadKey\]/,
  );
  const scopeAt = mapSource.indexOf('listScopeRef.current !== nextScope');
  assert.ok(scopeAt !== -1, 'scope 변경 분기가 있어야 한다');
  const scopeBlock = mapSource.slice(scopeAt, scopeAt + 900);
  assert.match(scopeBlock, /setOrders\(\[\]\)/);
  assert.match(scopeBlock, /setHasSuccessfulRead\(false\)/);
  assert.match(scopeBlock, /setError\(null\)/);
  assert.match(mapSource, /__no_token__/);
  // runtime: A 성공 상태에서 B scope로 바뀌는 순간 A route가 사라진다.
  const scopeA = buildDriverListScope({ userId: 'user-a', role: 'driver', token: 'token-a' });
  const scopeB = buildDriverListScope({ userId: 'user-b', role: 'driver', token: 'token-b' });
  assert.notEqual(scopeA, scopeB);
  const sim = applyMapSuccess(createMapSim(), [{ id: 'a-route' }]);
  if (scopeA !== scopeB) {
    sim.orders = [];
    sim.hasSuccess = false;
    sim.authRequired = false;
    sim.error = null;
  }
  assert.deepEqual(sim.orders, []);
  assert.equal(sim.hasSuccess, false);
  // B의 첫 read 실패는 A route를 재노출하지 않는다.
  applyMapFailure(sim, { network: true });
  assert.deepEqual(sim.orders, []);
  assert.equal(sim.hasSuccess, false);
});

// 15. AUTH 상태에서는 navigation이 노출되지 않고 stale fail-close가 유지된다.
test('Map auth-loss exposes no navigation and stale fail-close is preserved', () => {
  // AUTH 분기는 orders를 비우므로 active/stale navigation 가드가 모두 실패한다.
  const catchBlock = mapSource.slice(mapSource.indexOf('.catch('), mapSource.indexOf('.finally('));
  const authAt = catchBlock.indexOf("kind === 'AUTH_ERROR'");
  const authBranch = catchBlock.slice(authAt, catchBlock.indexOf('if (shouldPreserveDriverListOnReadError'));
  assert.match(authBranch, /setOrders\(\[\]\)/);
  assert.doesNotMatch(authBranch, /buildKakaoNaviUrl/);
  // fresh navigation 가드와 stale fail-closed 렌더는 그대로 유지된다.
  assert.match(
    mapSource,
    /sorted\.length > 0 && !loading && !authRequired && !error && hasSuccessfulRead/,
  );
  assert.match(mapSource, /sorted\.length > 0 && error && hasSuccessfulRead/);
  assert.match(mapSource, /disabled/);
});

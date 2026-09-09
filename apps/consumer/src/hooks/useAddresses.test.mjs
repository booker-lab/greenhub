import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./useAddresses.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'useAddresses.ts',
}).outputText;

const API = 'https://api.example.test';
const TOKEN = 'test-token';

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

const addrA = {
  id: 'addr-a',
  label: '집',
  address: '서울 강남구 테헤란로 152',
  addressDetail: '101호',
  zipCode: '06232',
  isDefault: true,
};

const addrB = {
  id: 'addr-b',
  label: '회사',
  address: '서울 서초구 반포대로 58',
  addressDetail: '',
  zipCode: '06560',
  isDefault: false,
};

function readCount(fetchCalls) {
  return fetchCalls.filter((c) => c.method === 'GET' && c.url === `${API}/auth/me`).length;
}

function createDriver(initialAddresses, failOverrides = {}) {
  const serverAddresses = structuredClone(initialAddresses);
  const fetchCalls = [];
  const fail = { read: false, add: false, update: false, del: false, def: false, ...failOverrides };
  let idCounter = 100;

  const stateSlots = [];
  const effectSlots = [];
  let hookCursor = 0;
  let effectCursor = 0;

  globalThis.fetch = async (url, init = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    fetchCalls.push({ url, method, headers: init.headers, body: init.body });

    if (url === `${API}/auth/me` && method === 'GET') {
      if (fail.read) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ savedAddresses: structuredClone(serverAddresses) }),
      };
    }

    if (url === `${API}/auth/me/addresses` && method === 'POST') {
      if (fail.add) return { ok: false, status: 400, json: async () => ({}) };
      const body = JSON.parse(init.body);
      idCounter += 1;
      const created = {
        id: `addr-new-${idCounter}`,
        label: body.label,
        address: body.address,
        addressDetail: body.addressDetail ?? '',
        zipCode: body.zipCode,
        isDefault: serverAddresses.length === 0,
      };
      serverAddresses.push(created);
      return { ok: true, status: 201, json: async () => structuredClone(created) };
    }

    const defaultMatch = String(url).match(/\/auth\/me\/addresses\/([^/]+)\/default$/);
    if (defaultMatch && method === 'PATCH') {
      if (fail.def) return { ok: false, status: 400, json: async () => ({}) };
      const id = decodeURIComponent(defaultMatch[1]);
      const target = serverAddresses.find((a) => a.id === id);
      if (!target) return { ok: false, status: 404, json: async () => ({}) };
      for (const a of serverAddresses) a.isDefault = a.id === id;
      return { ok: true, status: 200, json: async () => structuredClone(target) };
    }

    const itemMatch = String(url).match(/\/auth\/me\/addresses\/([^/]+)$/);
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1]);
      if (method === 'PATCH') {
        if (fail.update) return { ok: false, status: 400, json: async () => ({}) };
        const target = serverAddresses.find((a) => a.id === id);
        if (!target) return { ok: false, status: 404, json: async () => ({}) };
        const body = JSON.parse(init.body);
        Object.assign(target, {
          label: body.label,
          address: body.address,
          addressDetail: body.addressDetail ?? '',
          zipCode: body.zipCode,
        });
        return { ok: true, status: 200, json: async () => structuredClone(target) };
      }
      if (method === 'DELETE') {
        if (fail.del) return { ok: false, status: 400, json: async () => ({}) };
        const idx = serverAddresses.findIndex((a) => a.id === id);
        if (idx === -1) return { ok: false, status: 404, json: async () => ({}) };
        const [removed] = serverAddresses.splice(idx, 1);
        if (removed.isDefault && serverAddresses.length > 0) serverAddresses[0].isDefault = true;
        return { ok: true, status: 200, json: async () => ({}) };
      }
    }

    throw new Error(`예상하지 못한 fetch: ${method} ${url}`);
  };

  const requireForTest = (specifier) => {
    if (specifier === 'react') {
      return {
        useState: (initial) => {
          const idx = hookCursor++;
          if (!(idx in stateSlots)) stateSlots[idx] = initial;
          const setState = (next) => {
            stateSlots[idx] = typeof next === 'function' ? next(stateSlots[idx]) : next;
          };
          return [stateSlots[idx], setState];
        },
        useEffect: (cb, deps) => {
          const idx = effectCursor++;
          if (effectSlots[idx] === undefined) {
            effectSlots[idx] = { deps: deps ? [...deps] : deps, pending: cb, cleanup: undefined };
          } else {
            const prev = effectSlots[idx].deps;
            let changed = true;
            if (prev && deps && prev.length === deps.length) {
              changed = deps.some((d, i) => !Object.is(d, prev[i]));
            }
            if (changed) {
              effectSlots[idx].deps = deps ? [...deps] : deps;
              effectSlots[idx].pending = cb;
            } else {
              effectSlots[idx].pending = null;
            }
          }
        },
        useCallback: (cb) => cb,
      };
    }
    if (specifier === 'next-auth/react') {
      return { useSession: () => ({ data: { user: { accessToken: TOKEN } } }) };
    }
    if (specifier === '@/lib/api-base-url') {
      return { getApiBaseUrl: () => API };
    }
    if (specifier === '@greenhub/shared') {
      return {};
    }
    throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
  };

  const hookModule = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    requireForTest,
    hookModule,
    hookModule.exports,
  );
  const useAddresses = hookModule.exports.useAddresses;

  let latest = null;
  async function flushTicks(n = 6) {
    for (let i = 0; i < n; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  async function settle() {
    for (let round = 0; round < 6; round += 1) {
      hookCursor = 0;
      effectCursor = 0;
      latest = useAddresses();
      const pending = [];
      for (let i = 0; i < effectSlots.length; i += 1) {
        if (effectSlots[i].pending) pending.push(i);
      }
      if (pending.length === 0) break;
      for (const idx of pending) {
        const slot = effectSlots[idx];
        if (slot.cleanup) {
          try {
            slot.cleanup();
          } catch {
            // cleanup 오류는 무시한다.
          }
        }
        const cb = slot.pending;
        slot.pending = null;
        const ret = cb();
        slot.cleanup = typeof ret === 'function' ? ret : undefined;
      }
      await flushTicks();
    }
    hookCursor = 0;
    effectCursor = 0;
    latest = useAddresses();
    for (let i = 0; i < effectSlots.length; i += 1) {
      if (effectSlots[i].pending) {
        // 안정화되지 않은 pending이 있으면 한 번 더 해소한다.
        await settleOnceMore();
        break;
      }
    }
    return latest;
  }

  async function settleOnceMore() {
    const pending = [];
    for (let i = 0; i < effectSlots.length; i += 1) {
      if (effectSlots[i].pending) pending.push(i);
    }
    for (const idx of pending) {
      const slot = effectSlots[idx];
      if (slot.cleanup) {
        try {
          slot.cleanup();
        } catch {
          // 무시
        }
      }
      const cb = slot.pending;
      slot.pending = null;
      const ret = cb();
      slot.cleanup = typeof ret === 'function' ? ret : undefined;
    }
    await flushTicks();
    hookCursor = 0;
    effectCursor = 0;
    latest = useAddresses();
    return latest;
  }

  return {
    serverAddresses,
    fetchCalls,
    fail,
    get: () => latest,
    settle,
  };
}

test('mutation tick이 authoritative reread effect에 연결된다', () => {
  assert.match(source, /\[\s*token\s*,\s*tick\s*\]/);
  assert.match(source, /setTick\(\(t\) => t \+ 1\)/);
  assert.doesNotMatch(source, /const\s+\[_tick/);
});

test('authoritative read 계약을 유지한다 (Bearer /auth/me, 새 의존성 없음)', () => {
  assert.match(source, /\/auth\/me/);
  assert.match(source, /Authorization/);
  assert.match(source, /Bearer/);
  assert.doesNotMatch(source, /react-query/i);
  assert.doesNotMatch(source, /tanstack/i);
});

test('public refetch()가 실제 network reread를 발생시킨다', async () => {
  const driver = createDriver([addrA]);
  await driver.settle();
  assert.equal(readCount(driver.fetchCalls), 1);
  assert.deepEqual(
    driver.get().addresses.map((a) => a.id),
    ['addr-a'],
  );

  driver.get().refetch();
  await driver.settle();

  assert.equal(readCount(driver.fetchCalls), 2);
  assert.deepEqual(
    driver.get().addresses.map((a) => a.id),
    ['addr-a'],
  );
  const reread = driver.fetchCalls.find((c) => c.method === 'GET');
  assert.equal(reread.headers.Authorization, `Bearer ${TOKEN}`);
});

test('add 성공 후 authoritative reread를 통해 새 주소가 나타난다', async () => {
  const driver = createDriver([addrA]);
  await driver.settle();
  assert.equal(readCount(driver.fetchCalls), 1);

  await driver.get().addAddress({
    label: '부모님댁',
    address: '부산 해운대구 해운대로 123',
    addressDetail: '202호',
    zipCode: '48000',
  });
  await driver.settle();

  assert.equal(readCount(driver.fetchCalls), 2);
  const labels = driver.get().addresses.map((a) => a.label);
  assert.ok(labels.includes('부모님댁'));
  assert.equal(driver.get().addresses.length, 2);
  const post = driver.fetchCalls.find((c) => c.method === 'POST');
  assert.equal(post.url, `${API}/auth/me/addresses`);
  assert.equal(post.headers.Authorization, `Bearer ${TOKEN}`);
});

test('update 성공 후 변경 내용이 reread에 반영된다', async () => {
  const driver = createDriver([addrA]);
  await driver.settle();

  await driver.get().updateAddress('addr-a', {
    label: '본가',
    address: '서울 강남구 테헤란로 152',
    addressDetail: '101호',
    zipCode: '06232',
  });
  await driver.settle();

  assert.equal(readCount(driver.fetchCalls), 2);
  assert.equal(driver.get().addresses.find((a) => a.id === 'addr-a').label, '본가');
  const patch = driver.fetchCalls.find(
    (c) => c.method === 'PATCH' && c.url === `${API}/auth/me/addresses/addr-a`,
  );
  assert.ok(patch);
});

test('delete 성공 후 삭제된 주소가 reread에서 사라진다', async () => {
  const driver = createDriver([addrA, addrB]);
  await driver.settle();
  assert.equal(driver.get().addresses.length, 2);

  await driver.get().deleteAddress('addr-b');
  await driver.settle();

  assert.equal(readCount(driver.fetchCalls), 2);
  assert.deepEqual(
    driver.get().addresses.map((a) => a.id),
    ['addr-a'],
  );
});

test('default 변경 후 최신 default 상태가 reread에 반영된다', async () => {
  const driver = createDriver([addrA, addrB]);
  await driver.settle();
  assert.equal(driver.get().addresses.find((a) => a.id === 'addr-a').isDefault, true);

  await driver.get().setDefaultAddress('addr-b');
  await driver.settle();

  assert.equal(readCount(driver.fetchCalls), 2);
  assert.equal(driver.get().addresses.find((a) => a.id === 'addr-b').isDefault, true);
  assert.equal(driver.get().addresses.find((a) => a.id === 'addr-a').isDefault, false);
});

test('command 실패는 reread 성공으로 오인하지 않고 local state를 조작하지 않는다', async () => {
  const driver = createDriver([addrA, addrB]);
  await driver.settle();
  const readsBefore = readCount(driver.fetchCalls);
  const beforeIds = driver.get().addresses.map((a) => a.id);

  driver.fail.add = true;
  await assert.rejects(
    driver.get().addAddress({ label: 'X', address: 'Y', addressDetail: '', zipCode: 'Z' }),
  );
  await driver.settle();
  assert.equal(readCount(driver.fetchCalls), readsBefore);
  assert.deepEqual(driver.get().addresses.map((a) => a.id), beforeIds);

  driver.fail.update = true;
  await assert.rejects(
    driver.get().updateAddress('addr-a', { label: 'X', address: 'Y', addressDetail: '', zipCode: 'Z' }),
  );
  await driver.settle();
  assert.equal(readCount(driver.fetchCalls), readsBefore);
  assert.equal(driver.get().addresses.find((a) => a.id === 'addr-a').label, '집');

  driver.fail.del = true;
  await assert.rejects(driver.get().deleteAddress('addr-b'));
  await driver.settle();
  assert.equal(readCount(driver.fetchCalls), readsBefore);
  assert.deepEqual(driver.get().addresses.map((a) => a.id), beforeIds);

  driver.fail.def = true;
  await assert.rejects(driver.get().setDefaultAddress('addr-b'));
  await driver.settle();
  assert.equal(readCount(driver.fetchCalls), readsBefore);
  assert.equal(driver.get().addresses.find((a) => a.id === 'addr-a').isDefault, true);
});

test('refetch 실패와 정상 empty addresses를 구분한다', async () => {
  const emptyDriver = createDriver([]);
  await emptyDriver.settle();
  assert.deepEqual(emptyDriver.get().addresses, []);
  assert.equal(emptyDriver.get().error, null);
  assert.equal(emptyDriver.get().loading, false);

  const driver = createDriver([addrA]);
  await driver.settle();
  assert.equal(driver.get().error, null);

  driver.fail.read = true;
  driver.get().refetch();
  await driver.settle();

  assert.notEqual(driver.get().error, null);
  assert.deepEqual(
    driver.get().addresses.map((a) => a.id),
    ['addr-a'],
  );
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./nav-back.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { isSameOriginReferrer, resolveBackAction, readBackNavigationContext } = module.exports;

const ORIGIN = 'https://shop.example.test';
const base = {
  historyLength: 3,
  canGoBack: undefined,
  referrer: `${ORIGIN}/`,
  origin: ORIGIN,
  onLandingPage: false,
};

test('같은 출처 referrer 판정', () => {
  assert.equal(isSameOriginReferrer(`${ORIGIN}/search?q=a`, ORIGIN), true);
  for (const referrer of [
    '',
    'https://www.google.com/',
    'http://shop.example.test/',
    'https://shop.example.test.evil.com/',
    'not a url',
  ]) {
    assert.equal(isSameOriginReferrer(referrer, ORIGIN), false, referrer);
  }
});

test('공유 링크를 새 탭으로 열면(기록 1개) 홈으로 보낸다', () => {
  assert.equal(
    resolveBackAction({ ...base, historyLength: 1, onLandingPage: true, referrer: '' }),
    'home',
  );
  assert.equal(resolveBackAction({ ...base, historyLength: 1, referrer: `${ORIGIN}/` }), 'home');
  assert.equal(resolveBackAction({ ...base, historyLength: 0 }), 'home');
});

test('Navigation API가 있으면 같은 출처 이전 기록 유무를 그대로 따른다', () => {
  assert.equal(resolveBackAction({ ...base, canGoBack: true, historyLength: 1 }), 'back');
  assert.equal(resolveBackAction({ ...base, canGoBack: false, historyLength: 5 }), 'home');
});

test('다른 사이트에서 들어온 첫 화면이면 홈으로, 같은 출처에서 왔으면 뒤로', () => {
  for (const referrer of ['', 'https://www.google.com/search?q=x', 'https://m.search.naver.com/']) {
    assert.equal(
      resolveBackAction({ ...base, historyLength: 2, onLandingPage: true, referrer }),
      'home',
      referrer,
    );
  }
  assert.equal(
    resolveBackAction({ ...base, historyLength: 2, onLandingPage: true, referrer: `${ORIGIN}/` }),
    'back',
  );
});

test('화면 안에서 이동해 왔으면 처음 들어온 곳과 상관없이 뒤로 간다', () => {
  for (const referrer of ['', 'https://www.google.com/', `${ORIGIN}/`]) {
    assert.equal(
      resolveBackAction({ ...base, historyLength: 4, onLandingPage: false, referrer }),
      'back',
      referrer,
    );
  }
});

function fakeWindow({
  historyLength = 2,
  canGoBack,
  referrer = '',
  path = '/products/p1',
  entryName,
  throwOnEntries = false,
} = {}) {
  return {
    history: { length: historyLength },
    location: { origin: ORIGIN, pathname: path },
    document: { referrer },
    navigation: canGoBack === undefined ? undefined : { canGoBack },
    performance: {
      getEntriesByType: (type) => {
        if (throwOnEntries) throw new Error('unsupported');
        assert.equal(type, 'navigation');
        return entryName === undefined ? [] : [{ name: entryName }];
      },
    },
  };
}

test('브라우저 값 읽기: 처음 연 경로와 지금 경로가 같으면 첫 화면으로 본다(쿼리는 보지 않는다)', () => {
  const landed = readBackNavigationContext(
    fakeWindow({
      entryName: `${ORIGIN}/products/p1?utm=share`,
      referrer: 'https://www.google.com/',
    }),
  );
  assert.deepEqual(landed, {
    historyLength: 2,
    canGoBack: undefined,
    referrer: 'https://www.google.com/',
    origin: ORIGIN,
    onLandingPage: true,
  });
  assert.equal(
    readBackNavigationContext(fakeWindow({ entryName: `${ORIGIN}/` })).onLandingPage,
    false,
  );
});

test('브라우저 값 읽기: 읽지 못한 값은 기존 동작(뒤로) 쪽으로 둔다', () => {
  assert.equal(readBackNavigationContext(fakeWindow()).onLandingPage, false);
  assert.equal(
    readBackNavigationContext(fakeWindow({ throwOnEntries: true })).onLandingPage,
    false,
  );
  assert.equal(readBackNavigationContext(fakeWindow({ canGoBack: 'yes' })).canGoBack, undefined);
  assert.equal(readBackNavigationContext(fakeWindow({ canGoBack: false })).canGoBack, false);
  const noPerf = fakeWindow();
  delete noPerf.performance;
  assert.equal(readBackNavigationContext(noPerf).onLandingPage, false);
});

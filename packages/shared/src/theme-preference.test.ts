import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './content-security-policy';
import {
  applyThemePreference,
  readThemePreference,
  THEME_INIT_SCRIPT,
  THEME_INIT_SCRIPT_CSP_SOURCE,
  THEME_STORAGE_KEY,
} from './theme-preference';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  };
}

/** 인라인 스크립트를 가짜 document·localStorage로 실행한다. */
function runInitScript(storage: { getItem: (k: string) => string | null }) {
  const root = fakeRoot();
  new Function('localStorage', 'document', THEME_INIT_SCRIPT)(storage, { documentElement: root });
  return root.getAttribute('data-theme');
}

describe('화면 색 구성 전환(D5-b)', () => {
  it('CSP 해시는 인라인 스크립트 글자의 SHA-256이다(스크립트를 바꾸면 해시도 바꾼다)', () => {
    const digest = createHash('sha256').update(THEME_INIT_SCRIPT, 'utf8').digest('base64');
    expect(THEME_INIT_SCRIPT_CSP_SOURCE).toBe(`'sha256-${digest}'`);
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it('CSP script-src에 해시가 들어간다', () => {
    const policy = buildContentSecurityPolicy(
      { imageOrigins: [], connectOrigins: [], formActionSelf: true },
      { nonce: 'n', nodeEnv: 'production', apiUrl: 'https://api.example.com' },
    );
    const scriptSrc = policy.split('; ').find((d) => d.startsWith('script-src '));
    expect(scriptSrc).toContain(THEME_INIT_SCRIPT_CSP_SOURCE);
  });

  it('인라인 스크립트: 밝게·어둡게만 data-theme을 붙이고, 그 밖의 값·저장소 오류는 기기 설정을 따른다', () => {
    expect(runInitScript(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(runInitScript(memoryStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light');
    expect(runInitScript(memoryStorage({ [THEME_STORAGE_KEY]: 'blue' }))).toBeNull();
    expect(runInitScript(memoryStorage())).toBeNull();
    expect(
      runInitScript({
        getItem: () => {
          throw new Error('SecurityError');
        },
      }),
    ).toBeNull();
  });

  it('선택을 저장하고 적용한다. 시스템은 저장값과 속성을 지운다', () => {
    const storage = memoryStorage();
    const root = fakeRoot();
    applyThemePreference('dark', root, storage);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(readThemePreference(storage)).toBe('dark');
    applyThemePreference('system', root, storage);
    expect(root.getAttribute('data-theme')).toBeNull();
    expect(storage.data.has(THEME_STORAGE_KEY)).toBe(false);
    expect(readThemePreference(storage)).toBe('system');
  });

  it('저장에 실패해도 지금 화면에는 적용한다', () => {
    const root = fakeRoot();
    const broken = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    applyThemePreference('light', root, broken);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(readThemePreference(undefined)).toBe('system');
  });
});

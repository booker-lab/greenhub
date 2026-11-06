import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  COLOR_SCHEME_SCRIPT,
  COLOR_SCHEME_SCRIPT_CSP_HASH,
  COLOR_SCHEME_STORAGE_KEY,
  parseColorSchemePreference,
  readColorSchemePreference,
  writeColorSchemePreference,
} from './color-scheme.js';

function memoryStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(COLOR_SCHEME_STORAGE_KEY, initial);
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

/** 인라인 스크립트를 가짜 localStorage·document로 돌려 data-theme 결과를 본다. */
function runScript(storage: { getItem: (key: string) => string | null }) {
  const dataset: Record<string, string> = {};
  new Function('localStorage', 'document', COLOR_SCHEME_SCRIPT)(storage, {
    documentElement: { dataset },
  });
  return dataset.theme;
}

describe('화면 모드 선택값', () => {
  it('CSP 해시는 인라인 스크립트 본문의 sha256이다', () => {
    const digest = createHash('sha256').update(COLOR_SCHEME_SCRIPT).digest('base64');
    expect(COLOR_SCHEME_SCRIPT_CSP_HASH).toBe(`'sha256-${digest}'`);
  });

  it('인라인 스크립트는 light·dark만 속성으로 넣고 나머지·저장소 오류는 시스템(속성 없음)이다', () => {
    expect(runScript(memoryStorage('dark'))).toBe('dark');
    expect(runScript(memoryStorage('light'))).toBe('light');
    expect(runScript(memoryStorage())).toBeUndefined();
    expect(runScript(memoryStorage('system'))).toBeUndefined();
    expect(runScript(memoryStorage('Dark'))).toBeUndefined();
    expect(() => runScript(throwingStorage)).not.toThrow();
    expect(runScript(throwingStorage)).toBeUndefined();
  });

  it('저장값을 읽을 때 모르는 값·저장소 없음·오류는 시스템이다', () => {
    expect(parseColorSchemePreference('dark')).toBe('dark');
    expect(parseColorSchemePreference('light')).toBe('light');
    expect(parseColorSchemePreference('auto')).toBe('system');
    expect(parseColorSchemePreference(null)).toBe('system');
    expect(readColorSchemePreference(memoryStorage('light'))).toBe('light');
    expect(readColorSchemePreference(null)).toBe('system');
    expect(readColorSchemePreference(throwingStorage)).toBe('system');
  });

  it('시스템은 키를 지우고, 저장 오류는 던지지 않는다', () => {
    const storage = memoryStorage('dark');
    writeColorSchemePreference('light', storage);
    expect(storage.map.get(COLOR_SCHEME_STORAGE_KEY)).toBe('light');
    writeColorSchemePreference('system', storage);
    expect(storage.map.has(COLOR_SCHEME_STORAGE_KEY)).toBe(false);
    expect(() => writeColorSchemePreference('dark', throwingStorage)).not.toThrow();
  });
});

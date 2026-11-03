/**
 * 화면 색 구성 직접 전환(다크 모드 D5-b, design-direction.md §9.3).
 *
 * 기본은 기기 설정(`prefers-color-scheme`)을 CSS만으로 따른다. 사용자가 설정 화면에서 밝게·어둡게를 고르면
 * `localStorage`에 남기고 `<html data-theme>`을 붙인다. 칠하기 전에 적용해야 첫 화면이 깜박이지 않으므로
 * 세 앱 루트 layout의 `<head>`에 아래 인라인 스크립트 한 줄을 둔다. 쿠키는 쓰지 않는다(쿠키를 읽으면 모든 화면이
 * 요청마다 서버에서 만들어져 정적 렌더링이 깨진다).
 *
 * CSP(Report-Only) `script-src`는 요청마다 nonce + `'strict-dynamic'`이다. layout이 nonce를 받으려면 요청 헤더를
 * 읽어야 하므로, 이 고정 스크립트는 `'sha256-…'` 해시로 허용한다(`content-security-policy.ts`).
 * 스크립트 글자를 바꾸면 해시도 바꿔야 한다. `theme-preference.test.ts`가 둘이 맞는지 확인한다.
 */

export const THEME_STORAGE_KEY = 'greenhub-theme';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** 저장값이 밝게·어둡게일 때만 `<html data-theme>`을 붙인다. 저장소를 못 읽으면 기기 설정을 따른다. */
export const THEME_INIT_SCRIPT =
  'try{var t=localStorage.getItem("greenhub-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}';

/** `THEME_INIT_SCRIPT`의 CSP 해시 출처(SHA-256, base64). */
export const THEME_INIT_SCRIPT_CSP_SOURCE = "'sha256-3AJjs1EiGODXcDYwupX3FaA4elPPrioK2mIP9yLF1Wo='";

export function isExplicitTheme(value: unknown): value is 'light' | 'dark' {
  return value === 'light' || value === 'dark';
}

/** 저장된 선택을 읽는다. 없거나 읽지 못하면 'system'. */
export function readThemePreference(
  storage: Pick<Storage, 'getItem'> | undefined,
): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isExplicitTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * 선택을 저장하고 문서에 바로 적용한다. 'system'은 저장값과 속성을 지워 기기 설정을 따르게 한다.
 * 저장에 실패해도(사생활 보호 모드 등) 지금 화면에는 적용한다.
 */
export function applyThemePreference(
  preference: ThemePreference,
  root: Pick<Element, 'setAttribute' | 'removeAttribute'>,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
): void {
  if (isExplicitTheme(preference)) root.setAttribute('data-theme', preference);
  else root.removeAttribute('data-theme');
  try {
    if (isExplicitTheme(preference)) storage?.setItem(THEME_STORAGE_KEY, preference);
    else storage?.removeItem(THEME_STORAGE_KEY);
  } catch {
    // 저장하지 못하면 다음 방문에는 기기 설정을 따른다.
  }
}

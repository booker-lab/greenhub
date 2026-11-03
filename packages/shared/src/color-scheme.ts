/**
 * 화면 모드 직접 선택(다크 모드 D5-b, design-direction.md §9.3).
 *
 * 선택값은 세 앱이 같은 `localStorage` 키 하나에 둔다. 값이 `light`·`dark`가 아니거나(없음 포함)
 * localStorage를 쓸 수 없으면(사파리 개인 모드 등) 시스템(기기 설정)으로 본다.
 * 적용은 `<html data-theme="light|dark">` 속성이다. 시스템이면 속성을 두지 않고, 색은 dark.css의
 * `prefers-color-scheme` 미디어 쿼리가 정한다.
 *
 * 첫 페인트 전에 속성을 넣도록 각 앱 루트 layout `<head>`에 COLOR_SCHEME_SCRIPT를 인라인으로 둔다.
 * 루트 layout은 요청 헤더를 읽지 않으므로(정적 렌더링) nonce 대신 이 고정 스크립트의 sha256 해시를
 * CSP `script-src`에 더한다(content-security-policy.ts). 스크립트를 한 글자라도 바꾸면 해시도 바꾼다
 * (color-scheme.test.ts가 확인한다).
 */

export const COLOR_SCHEME_STORAGE_KEY = 'greenhub-color-scheme';

/** 화면 모드 선택값. system은 저장값이 없는 상태다. */
export type ColorSchemePreference = 'system' | 'light' | 'dark';

export const COLOR_SCHEME_PREFERENCES: readonly ColorSchemePreference[] = [
  'system',
  'light',
  'dark',
];

/** 첫 페인트 전에 `<html data-theme>`을 정하는 인라인 스크립트(루트 layout `<head>`). */
export const COLOR_SCHEME_SCRIPT = `try{var t=localStorage.getItem("${COLOR_SCHEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** COLOR_SCHEME_SCRIPT의 CSP 해시 소스. */
export const COLOR_SCHEME_SCRIPT_CSP_HASH = "'sha256-vetTXFXcSiwJzoxthExAUb93WNz5Evs5Oe67fhsMztk='";

/** 저장값을 선택값으로 읽는다. 모르는 값은 시스템이다. */
export function parseColorSchemePreference(value: unknown): ColorSchemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 저장된 선택값. 저장소를 쓸 수 없으면 시스템이다. */
export function readColorSchemePreference(
  storage: PreferenceStorage | null = defaultStorage(),
): ColorSchemePreference {
  try {
    return parseColorSchemePreference(storage?.getItem(COLOR_SCHEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** 선택값을 저장한다. 저장에 실패해도(개인 모드·용량) 예외를 던지지 않는다. */
export function writeColorSchemePreference(
  preference: ColorSchemePreference,
  storage: PreferenceStorage | null = defaultStorage(),
): void {
  try {
    if (preference === 'system') storage?.removeItem(COLOR_SCHEME_STORAGE_KEY);
    else storage?.setItem(COLOR_SCHEME_STORAGE_KEY, preference);
  } catch {
    // 저장하지 못해도 이번 화면에는 적용한다. 다음 방문은 시스템으로 열린다.
  }
}

/** `<html data-theme>`을 선택값에 맞춘다(인라인 스크립트와 같은 규칙). */
export function applyColorSchemePreference(
  preference: ColorSchemePreference,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root) return;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
}

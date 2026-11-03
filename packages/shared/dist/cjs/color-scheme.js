"use strict";
/**
 * 화면 모드 직접 선택(다크 모드 D5-b, design-direction.md §9.3).
 *
 * 선택값은 앱마다 같은 `localStorage` 키 하나에 둔다. 값이 `light`·`dark`가 아니거나(없음 포함)
 * localStorage를 쓸 수 없으면(사파리 개인 모드 등) 시스템(기기 설정)으로 본다.
 * 적용은 `<html data-theme="light|dark">` 속성이다. 시스템이면 속성을 두지 않고, 색은 dark.css의
 * `prefers-color-scheme` 미디어 쿼리가 정한다.
 *
 * 첫 페인트 전에 속성을 넣도록 쓰는 앱(판매자·기사) 루트 layout `<head>`에 COLOR_SCHEME_SCRIPT를 인라인으로 둔다.
 * 고정 문자열이라 nonce를 넘기지 않고(layout이 nonce를 읽을 필요가 없다) 그 sha256 해시를 각 앱 CSP 구성의
 * `inlineScriptHashes`로 `script-src`에 더한다. 스크립트를 한 글자라도 바꾸면 해시도 바꾼다
 * (color-scheme.test.ts가 확인한다). 소비자 앱은 다크 모드를 쓰지 않아 이 스크립트를 두지 않는다(2026-11-03 사용자 결정).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLOR_SCHEME_SCRIPT_CSP_HASH = exports.COLOR_SCHEME_SCRIPT = exports.COLOR_SCHEME_PREFERENCES = exports.COLOR_SCHEME_STORAGE_KEY = void 0;
exports.parseColorSchemePreference = parseColorSchemePreference;
exports.readColorSchemePreference = readColorSchemePreference;
exports.writeColorSchemePreference = writeColorSchemePreference;
exports.applyColorSchemePreference = applyColorSchemePreference;
exports.COLOR_SCHEME_STORAGE_KEY = 'greenhub-color-scheme';
exports.COLOR_SCHEME_PREFERENCES = [
    'system',
    'light',
    'dark',
];
/** 첫 페인트 전에 `<html data-theme>`을 정하는 인라인 스크립트(루트 layout `<head>`). */
exports.COLOR_SCHEME_SCRIPT = `try{var t=localStorage.getItem("${exports.COLOR_SCHEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
/** COLOR_SCHEME_SCRIPT의 CSP 해시 소스. */
exports.COLOR_SCHEME_SCRIPT_CSP_HASH = "'sha256-vetTXFXcSiwJzoxthExAUb93WNz5Evs5Oe67fhsMztk='";
/** 저장값을 선택값으로 읽는다. 모르는 값은 시스템이다. */
function parseColorSchemePreference(value) {
    return value === 'light' || value === 'dark' ? value : 'system';
}
function defaultStorage() {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    }
    catch {
        return null;
    }
}
/** 저장된 선택값. 저장소를 쓸 수 없으면 시스템이다. */
function readColorSchemePreference(storage = defaultStorage()) {
    try {
        return parseColorSchemePreference(storage?.getItem(exports.COLOR_SCHEME_STORAGE_KEY));
    }
    catch {
        return 'system';
    }
}
/** 선택값을 저장한다. 저장에 실패해도(개인 모드·용량) 예외를 던지지 않는다. */
function writeColorSchemePreference(preference, storage = defaultStorage()) {
    try {
        if (preference === 'system')
            storage?.removeItem(exports.COLOR_SCHEME_STORAGE_KEY);
        else
            storage?.setItem(exports.COLOR_SCHEME_STORAGE_KEY, preference);
    }
    catch {
        // 저장하지 못해도 이번 화면에는 적용한다. 다음 방문은 시스템으로 열린다.
    }
}
/** `<html data-theme>`을 선택값에 맞춘다(인라인 스크립트와 같은 규칙). */
function applyColorSchemePreference(preference, root = typeof document === 'undefined' ? null : document.documentElement) {
    if (!root)
        return;
    if (preference === 'system')
        delete root.dataset.theme;
    else
        root.dataset.theme = preference;
}

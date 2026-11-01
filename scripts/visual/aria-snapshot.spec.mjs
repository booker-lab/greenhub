// aria-snapshot.mjs의 경로 안내 감추기·되돌리기 로직을 가짜 document로 검증한다(브라우저 없이 CI에서 돈다).
// 실제 Chromium ariaSnapshot에서 경로 안내만 빠지는지는 aria-snapshot.browser-check.mjs(로컬 전용)가 본다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ARIA_EXCLUDED_TAGS,
  ARIA_HIDDEN_MARK,
  hideExcludedHosts,
  restoreExcludedHosts,
} from './aria-snapshot.mjs';

/** 속성과 shadow root만 흉내 낸 요소. */
function element(tag, attrs = {}, shadowText) {
  const attributes = new Map(Object.entries(attrs));
  return {
    tag,
    attributes,
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    shadowRoot:
      shadowText === undefined
        ? null
        : {
            querySelector: (selector) =>
              selector === '[role="alert"],[aria-live]' ? { textContent: shadowText } : null,
          },
  };
}

/** 태그 이름과 [속성] 선택자만 아는 가짜 document. */
function fakeDocument(elements) {
  return {
    querySelectorAll(selector) {
      const attr = /^\[([^\]=]+)\]$/.exec(selector)?.[1];
      return attr
        ? elements.filter((el) => el.attributes.has(attr))
        : elements.filter((el) => el.tag === selector);
    },
  };
}

const options = (doc) => ({ tags: ARIA_EXCLUDED_TAGS, mark: ARIA_HIDDEN_MARK, doc });

describe('aria-snapshot: 경로 안내만 감추고 되돌린다', () => {
  it('경로 안내만 aria-hidden으로 감추고 그때 글자를 돌려준다. 앱이 그린 alert는 손대지 않는다', () => {
    const appAlert = element('div', { role: 'alert' });
    const announcer = element('next-route-announcer', {}, '  결제 확인 중...  ');
    const doc = fakeDocument([appAlert, announcer]);

    const texts = hideExcludedHosts(options(doc));

    assert.deepEqual(texts, ['결제 확인 중...']);
    assert.equal(announcer.getAttribute('aria-hidden'), 'true');
    assert.deepEqual([...appAlert.attributes], [['role', 'alert']]);
  });

  it('되돌리면 없던 aria-hidden은 지우고 표시도 남기지 않는다', () => {
    const announcer = element('next-route-announcer', {}, '');
    const doc = fakeDocument([announcer]);
    hideExcludedHosts(options(doc));
    restoreExcludedHosts(options(doc));
    assert.deepEqual([...announcer.attributes], []);
  });

  it('원래 있던 aria-hidden 값은 되돌린 뒤에도 그대로다', () => {
    const announcer = element('next-route-announcer', { 'aria-hidden': 'false' }, '');
    const doc = fakeDocument([announcer]);
    hideExcludedHosts(options(doc));
    assert.equal(announcer.getAttribute('aria-hidden'), 'true');
    restoreExcludedHosts(options(doc));
    assert.deepEqual([...announcer.attributes], [['aria-hidden', 'false']]);
  });

  it('shadow root가 없거나 경로 안내가 없으면 빈 글자·빈 목록이다', () => {
    assert.deepEqual(hideExcludedHosts(options(fakeDocument([element('next-route-announcer')]))), [
      '',
    ]);
    assert.deepEqual(
      hideExcludedHosts(options(fakeDocument([element('div', { role: 'alert' })]))),
      [],
    );
  });

  it('브라우저 page.evaluate로 넘길 수 있게 바깥 변수를 쓰지 않는다', () => {
    // evaluate는 함수 글자만 보내므로 모듈 안 이름(ARIA_*, HIDDEN_MARK 등)을 쓰면 브라우저에서 깨진다.
    for (const fn of [hideExcludedHosts, restoreExcludedHosts]) {
      assert.doesNotMatch(fn.toString(), /ARIA_|HIDDEN_MARK/);
    }
  });

  it('빼는 요소는 경로 안내 하나뿐이다', () => {
    assert.deepEqual(ARIA_EXCLUDED_TAGS, ['next-route-announcer']);
  });
});

// 앱이 그린 접근성 트리(Playwright ariaSnapshot)를 남긴다. Next.js 경로 안내(route announcer)는 뺀다.
//
// Next.js App Router는 화면을 옮길 때마다 <next-route-announcer> 요소의 shadow root 안 role=alert·aria-live 요소에
// 새 문서 제목(없으면 h1)을 넣어 스크린 리더에 알린다. 이 글자는 이동 뒤 제목이 바뀐 것을 Next effect가 볼 때만
// 채워지는 타이밍 경쟁이라, 같은 화면을 찍어도 채워지기도 하고 비기도 한다(2026-11-01 소비자 운영 빌드 실측:
// checkout-paid 태블릿을 따로 3번씩 찍으니 작업 전 3/3·작업 후 2/3에서 "결제 확인 중..."). 앱 코드가 그리지 않는
// 요소라 작업 전·후 비교(parity.mjs)에서 가짜 차이만 만든다.
//
// 저장된 aria YAML에는 요소 이름이 없어 경로 안내의 `- alert`와 앱이 그린 `- alert`를 구별할 수 없다. 그래서 찍을 때
// <next-route-announcer> 요소만 정확히 골라 잠시 aria-hidden으로 감춘 채 찍고, 원래대로 되돌린다. 앱이 그린 alert는
// 그대로 남는다(aria-snapshot.spec.mjs). 경로 안내 글자는 manifest에 따로 남겨 볼 수 있게 한다.

/** 접근성 트리에서 빼는 요소(태그 이름). manifest의 ariaExcludes로 남아 parity.mjs가 같은 방식으로 찍은 묶음인지 본다. */
export const ARIA_EXCLUDED_TAGS = ['next-route-announcer'];

const HIDDEN_MARK = 'data-visual-aria-excluded';

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ aria: string, routeAnnouncer: string[] }>}
 *   aria: 경로 안내를 뺀 body의 접근성 트리(실패하면 실패 문구).
 *   routeAnnouncer: 경로 안내 요소마다 그때 들어 있던 글자(없으면 빈 글자).
 */
export async function appAriaSnapshot(page, { timeout = 10_000 } = {}) {
  const routeAnnouncer = await page
    .evaluate(
      ({ tags, mark }) => {
        const hosts = tags.flatMap((tag) => [...document.querySelectorAll(tag)]);
        return hosts.map((host) => {
          const live = host.shadowRoot?.querySelector('[role="alert"],[aria-live]');
          // 원래 aria-hidden 값을 표시에 남겨 되돌릴 때 쓴다(없으면 빈 표시).
          host.setAttribute(mark, host.getAttribute('aria-hidden') ?? '');
          host.setAttribute('aria-hidden', 'true');
          return (live?.textContent ?? '').trim();
        });
      },
      { tags: ARIA_EXCLUDED_TAGS, mark: HIDDEN_MARK },
    )
    .catch(() => []);
  try {
    const aria = await page
      .locator('body')
      .ariaSnapshot({ timeout })
      .catch((e) => `ariaSnapshot 실패: ${e.message}`);
    return { aria, routeAnnouncer };
  } finally {
    await page
      .evaluate((mark) => {
        for (const host of document.querySelectorAll(`[${mark}]`)) {
          const previous = host.getAttribute(mark);
          if (previous === '') host.removeAttribute('aria-hidden');
          else host.setAttribute('aria-hidden', previous);
          host.removeAttribute(mark);
        }
      }, HIDDEN_MARK)
      .catch(() => {});
  }
}

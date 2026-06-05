import type { Page } from '@playwright/test';

export async function installFastInterval(page: Page) {
  await page.addInitScript(() => {
    const originalSetInterval = window.setInterval.bind(window);
    Reflect.set(window, '__adminOrdersIntervalDelays', []);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      (
        window as unknown as { __adminOrdersIntervalDelays: number[] }
      ).__adminOrdersIntervalDelays.push(timeout ?? 0);
      return originalSetInterval(handler, 20, ...args);
    }) as typeof window.setInterval;
  });
}

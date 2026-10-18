import type { Page } from '@playwright/test';

// 소비자 앱 루트 레이아웃이 내보내는 빌드 기능 토글 meta 이름.
// apps/consumer/src/app/layout.tsx의 <meta name="greenhub-features">와 같아야 한다.
export const CONSUMER_FEATURES_META_NAME = 'greenhub-features';

/**
 * 배포된 소비자 빌드의 기능 토글 상태.
 * 테스트 대상 동작(리다이렉트 여부 등)이 아니라 빌드가 내보낸 meta만 보고 판정한다.
 */
export interface ConsumerFeatures {
  /** meta 원문. meta가 없는 옛 빌드면 null(전부 꺼짐으로 본다). */
  readonly raw: string | null;
  isOn(key: string): boolean;
}

/**
 * packages/shared/src/features.ts의 parseFeatureFlags와 같은 규칙으로 판정한다.
 *   - null·빈 값: 모두 꺼짐
 *   - 전체가 "all": 모두 켜짐
 *   - 그 밖: 쉼표로 나눠 앞뒤 공백을 지운 키만 켜짐
 * e2e 패키지는 @greenhub/shared에 의존하지 않으므로 규칙을 옮겨 두고, 단위 테스트가
 * 실제 parseFeatureFlags와 결과가 같은지 고정한다(consumer-features.test.mjs).
 */
export function parseConsumerFeatures(raw: string | null | undefined): ConsumerFeatures {
  const text = (raw ?? '').trim();
  const all = text === 'all';
  const keys = new Set(
    all || !text ? [] : text.split(',').map((key) => key.trim()).filter(Boolean),
  );
  return {
    raw: raw ?? null,
    isOn: (key: string) => all || keys.has(key),
  };
}

/** 홈(/)을 열어 빌드 기능 토글 meta를 읽는다. meta가 없으면(옛 빌드) 전부 꺼짐이다. */
export async function readConsumerFeatures(page: Page, base: string): Promise<ConsumerFeatures> {
  const response = await page.goto(`${base}/`);
  if (!response || !response.ok()) {
    throw new Error(`소비자 홈을 열지 못해 기능 토글을 읽을 수 없습니다(status ${response?.status()}).`);
  }
  const meta = page.locator(`head meta[name="${CONSUMER_FEATURES_META_NAME}"]`);
  const count = await meta.count();
  if (count > 1) {
    throw new Error(`${CONSUMER_FEATURES_META_NAME} meta가 ${count}개입니다. 하나여야 합니다.`);
  }
  return parseConsumerFeatures(count === 0 ? null : await meta.getAttribute('content'));
}

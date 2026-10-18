import { type FeatureKey, parseFeatureFlags } from '@greenhub/shared';

// 팔도감 벤치마킹 비교용 기능 토글. 값은 빌드할 때 굳는다(NEXT_PUBLIC_*).
// 운영 기본값은 비어 있어 모든 기능이 꺼진다. packages/shared/src/features.ts 참고.
const ENABLED = parseFeatureFlags(process.env.NEXT_PUBLIC_GREENHUB_FEATURES);

export function isFeatureOn(key: FeatureKey): boolean {
  return ENABLED.has(key);
}

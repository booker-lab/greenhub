import type { NextConfig } from 'next';
import { isLocalPreviewEnabled } from './local-preview';

type LocalImageConfig = Pick<
  NonNullable<NextConfig['images']>,
  'remotePatterns' | 'dangerouslyAllowLocalIP'
>;

// 로컬 Firebase Storage 에뮬레이터 포트(scripts/dev/local 하네스가 띄운다).
const LOCAL_STORAGE_EMULATOR_PORT = '9199';

// 로컬 런타임(dev:local·화면 확인 하네스의 next dev)에서만 Storage 에뮬레이터 사진을 next/image로 보여준다.
// 에뮬레이터 주소는 127.0.0.1·localhost라 사설 IP 차단(dangerouslyAllowLocalIP)도 함께 풀어야 최적화가 된다.
// 운영·Preview 빌드는 NODE_ENV가 production이라 빈 값을 돌려주므로 이미지 설정이 바뀌지 않는다.
export function localStorageEmulatorImageConfig(
  env: Partial<Record<'GREENHUB_LOCAL_RUNTIME' | 'NODE_ENV', string | undefined>> = process.env,
): LocalImageConfig {
  if (!isLocalPreviewEnabled(env)) return {};
  return {
    remotePatterns: ['127.0.0.1', 'localhost'].map((hostname) => ({
      protocol: 'http' as const,
      hostname,
      port: LOCAL_STORAGE_EMULATOR_PORT,
      pathname: '/v0/b/**',
    })),
    dangerouslyAllowLocalIP: true,
  };
}

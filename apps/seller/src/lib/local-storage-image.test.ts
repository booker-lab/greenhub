import { describe, expect, it } from 'vitest';
import { localStorageEmulatorImageConfig } from './local-storage-image';

describe('localStorageEmulatorImageConfig', () => {
  it('로컬 런타임(next dev + GREENHUB_LOCAL_RUNTIME=true)에서만 Storage 에뮬레이터 주소를 허용해요', () => {
    expect(
      localStorageEmulatorImageConfig({ GREENHUB_LOCAL_RUNTIME: 'true', NODE_ENV: 'development' }),
    ).toEqual({
      remotePatterns: [
        { protocol: 'http', hostname: '127.0.0.1', port: '9199', pathname: '/v0/b/**' },
        { protocol: 'http', hostname: 'localhost', port: '9199', pathname: '/v0/b/**' },
      ],
      dangerouslyAllowLocalIP: true,
    });
  });

  it('운영·Preview 빌드(NODE_ENV=production)는 로컬 표시가 있어도 아무것도 더하지 않아요', () => {
    expect(
      localStorageEmulatorImageConfig({ GREENHUB_LOCAL_RUNTIME: 'true', NODE_ENV: 'production' }),
    ).toEqual({});
    expect(localStorageEmulatorImageConfig({ NODE_ENV: 'production' })).toEqual({});
  });

  it('로컬 표시가 없거나 true가 아니면 dev에서도 더하지 않아요', () => {
    expect(localStorageEmulatorImageConfig({ NODE_ENV: 'development' })).toEqual({});
    expect(
      localStorageEmulatorImageConfig({ GREENHUB_LOCAL_RUNTIME: '1', NODE_ENV: 'development' }),
    ).toEqual({});
    expect(localStorageEmulatorImageConfig({})).toEqual({});
  });
});

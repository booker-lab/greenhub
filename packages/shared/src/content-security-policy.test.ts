import { describe, expect, it } from 'vitest';
import {
  type AppContentSecurityPolicy,
  buildContentSecurityPolicy,
  createCspNonce,
  resolveCspApiOrigin,
} from './content-security-policy.js';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

const app: AppContentSecurityPolicy = {
  imageOrigins: ['https://img.example.test'],
  connectOrigins: ['https://db.example.test'],
  developmentConnectOrigins: ['http://127.0.0.1:8080'],
  formActionSelf: true,
};

describe('CSP 정책 공통 틀', () => {
  it('지시어를 정해진 순서로 만들고 앱 출처 목록을 끼운다', () => {
    expect(
      buildContentSecurityPolicy(app, {
        nonce: 'abc123==',
        nodeEnv: 'production',
        apiUrl: 'https://api.example.test/v1',
      }),
    ).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'nonce-abc123==' 'strict-dynamic'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://img.example.test",
        "font-src 'self' data:",
        "connect-src 'self' https://api.example.test https://db.example.test",
        "frame-src 'none'",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
        "form-action 'self'",
        'report-uri /api/csp-report',
      ].join('; '),
    );
  });

  it('개발 모드에서만 unsafe-eval과 개발용 연결 출처를 더한다', () => {
    const development = directives(
      buildContentSecurityPolicy(app, { nonce: 'n', nodeEnv: 'development' }),
    );
    expect(development.get('script-src')).toContain("'unsafe-eval'");
    expect(development.get('connect-src')).toEqual([
      "'self'",
      'http://localhost:3000',
      'https://db.example.test',
      'http://127.0.0.1:8080',
    ]);
  });

  it('프레임 출처를 주면 frame-src에 쓰고, form-action을 끄면 지시어를 두지 않는다', () => {
    const policy = directives(
      buildContentSecurityPolicy(
        { ...app, frameOrigins: ['https://pay.example.test'], formActionSelf: false },
        { nonce: 'n', nodeEnv: 'production' },
      ),
    );
    expect(policy.get('frame-src')).toEqual(['https://pay.example.test']);
    expect(policy.has('form-action')).toBe(false);
    expect(policy.has('report-to')).toBe(false);
  });

  it('API 주소가 없거나 잘못돼도 예외 없이 운영에서는 API origin을 빼고 개발에서는 localhost를 쓴다', () => {
    expect(resolveCspApiOrigin(undefined, 'production')).toBeNull();
    expect(resolveCspApiOrigin('not a url', 'production')).toBeNull();
    expect(resolveCspApiOrigin('javascript:alert(1)', 'production')).toBeNull();
    expect(resolveCspApiOrigin('', 'development')).toBe('http://localhost:3000');
    expect(resolveCspApiOrigin('https://api.example.test/path?q=1', 'production')).toBe(
      'https://api.example.test',
    );
    const policy = directives(buildContentSecurityPolicy(app, { nonce: 'n', nodeEnv: 'production' }));
    expect(policy.get('connect-src')?.[0]).toBe("'self'");
    expect(policy.get('connect-src')).not.toContain('null');
  });

  it('nonce는 요청마다 다른 128비트 base64 값이다', () => {
    const first = createCspNonce();
    const second = createCspNonce();
    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(second).not.toBe(first);
  });
});

import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './content-security-policy';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

const production = directives(
  buildContentSecurityPolicy({
    nonce: 'abc123==',
    nodeEnv: 'production',
    apiUrl: 'https://api.example.test/v1',
  }),
);

describe('기사 앱 CSP 정책', () => {
  it('스크립트는 요청 nonce와 strict-dynamic으로만 허용하고 운영에서는 eval을 넣지 않는다', () => {
    expect(production.get('script-src')).toEqual([
      "'self'",
      "'nonce-abc123=='",
      "'strict-dynamic'",
    ]);
    expect(production.get('default-src')).toEqual(["'self'"]);
  });

  it('개발 모드에서만 unsafe-eval과 Firebase 에뮬레이터 연결을 허용한다', () => {
    const development = directives(
      buildContentSecurityPolicy({ nonce: 'n', nodeEnv: 'development', apiUrl: undefined }),
    );
    expect(development.get('script-src')).toContain("'unsafe-eval'");
    expect(development.get('connect-src')).toEqual(
      expect.arrayContaining([
        'http://localhost:3000',
        'http://127.0.0.1:9099',
        'http://127.0.0.1:9199',
      ]),
    );
    expect(production.get('connect-src')).not.toContain('http://127.0.0.1:9099');
  });

  it('연결은 자기 출처, API origin, 쓰는 Firebase 엔드포인트만 허용한다', () => {
    expect(production.get('connect-src')).toEqual([
      "'self'",
      'https://api.example.test',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://firebasestorage.googleapis.com',
    ]);
  });

  it('이미지·스타일·글꼴·워커·매니페스트·프레임 지시어를 둔다', () => {
    expect(production.get('img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://firebasestorage.googleapis.com',
      'https://storage.googleapis.com',
      'https://k.kakaocdn.net',
      'https://img1.kakaocdn.net',
      'https://t1.kakaocdn.net',
    ]);
    expect(production.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(production.get('font-src')).toEqual(["'self'", 'data:']);
    expect(production.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(production.get('manifest-src')).toEqual(["'self'"]);
    expect(production.get('frame-src')).toEqual(["'none'"]);
    expect(production.get('object-src')).toEqual(["'none'"]);
    expect(production.get('base-uri')).toEqual(["'self'"]);
    expect(production.get('frame-ancestors')).toEqual(["'self'"]);
    // 카카오 로그인 폼 제출 뒤 외부 리다이렉트가 있어 form-action은 두지 않는다.
    expect(production.has('form-action')).toBe(false);
  });

  it('위반 보고를 /api/csp-report로 보낸다', () => {
    expect(production.get('report-uri')).toEqual(['/api/csp-report']);
    expect(production.has('report-to')).toBe(false);
  });
});

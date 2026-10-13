import {
  CorsConfigurationError,
  configuredCorsOrigins,
  configuredVercelPreviewProjects,
  isAllowedCorsOrigin,
  isAllowedVercelPreviewOrigin,
  LOCAL_DRIVER_ORIGIN,
  resolveCorsOriginPolicy,
  shouldAllowVercelPreviewOrigins,
} from './cors-origin';

describe('local Driver CORS origin', () => {
  it('local runtime에는 Driver 개발 origin만 정확히 추가한다', () => {
    expect(configuredCorsOrigins({ GREENHUB_LOCAL_RUNTIME: 'true' })).toEqual([
      LOCAL_DRIVER_ORIGIN,
    ]);
    expect(
      configuredCorsOrigins({
        CORS_ORIGIN: 'https://consumer.example.test',
        GREENHUB_LOCAL_RUNTIME: 'true',
      }),
    ).toEqual(['https://consumer.example.test', LOCAL_DRIVER_ORIGIN]);
  });

  it('local runtime이 아니면 설정되지 않은 origin을 자동 허용하지 않는다', () => {
    expect(configuredCorsOrigins({})).toEqual([]);
  });

  it('wildcard origin을 fail-closed로 거부한다', () => {
    expect(() => configuredCorsOrigins({ CORS_ORIGIN: '*' })).toThrow(CorsConfigurationError);
  });
});

describe('Vercel Preview CORS origin', () => {
  it.each([
    'https://greenhubconsumer-git-codex-mvp-sal-a07a43-jos-projects-d1cecc0c.vercel.app',
    'https://greenhubconsumer-9y7rxyxmf-jos-projects-d1cecc0c.vercel.app',
    'https://greenhub-seller-123456789-jos-projects-d1cecc0c.vercel.app',
  ])('allows a scoped GreenHub Preview origin: %s', (origin) => {
    expect(isAllowedVercelPreviewOrigin(origin)).toBe(true);
  });

  it.each([
    'http://greenhubconsumer-9y7rxyxmf-jos-projects-d1cecc0c.vercel.app',
    'https://greenhubconsumer-9y7rxyxmf-another-team.vercel.app',
    'https://unrelated-9y7rxyxmf-jos-projects-d1cecc0c.vercel.app',
    'https://greenhubconsumer.vercel.app',
    'https://greenhubconsumer-9y7rxyxmf-jos-projects-d1cecc0c.vercel.app.evil.test',
  ])('rejects an unscoped origin: %s', (origin) => {
    expect(isAllowedVercelPreviewOrigin(origin)).toBe(false);
  });

  it('supports an explicit project allowlist', () => {
    const projects = configuredVercelPreviewProjects('greenhubconsumer, invalid project ');
    expect(projects).toEqual(['greenhubconsumer']);
    expect(
      isAllowedVercelPreviewOrigin(
        'https://greenhub-seller-123456789-jos-projects-d1cecc0c.vercel.app',
        projects,
      ),
    ).toBe(false);
  });
});

describe('CORS origin 정책', () => {
  const previewOrigin = 'https://greenhubconsumer-9y7rxyxmf-jos-projects-d1cecc0c.vercel.app';
  const productionValues = {
    RAILWAY_ENVIRONMENT_NAME: 'production',
    CORS_ORIGIN: 'https://greenlove.co.kr, https://seller.greenlove.co.kr',
  };

  it('운영 런타임은 기본적으로 Preview origin을 거부하고 정적 origin만 허용한다', () => {
    const policy = resolveCorsOriginPolicy(productionValues);

    expect(policy.allowVercelPreviews).toBe(false);
    expect(isAllowedCorsOrigin('https://greenlove.co.kr', policy)).toBe(true);
    expect(isAllowedCorsOrigin(previewOrigin, policy)).toBe(false);
  });

  it('운영 런타임도 명시 플래그가 있으면 Preview origin을 허용한다', () => {
    const policy = resolveCorsOriginPolicy({
      ...productionValues,
      CORS_ALLOW_VERCEL_PREVIEWS: 'true',
    });

    expect(isAllowedCorsOrigin(previewOrigin, policy)).toBe(true);
  });

  it('비운영 런타임은 기본적으로 Preview origin을 허용하고 명시적으로 끌 수 있다', () => {
    const staging = { RAILWAY_ENVIRONMENT_NAME: 'staging', NODE_ENV: 'production' };

    expect(isAllowedCorsOrigin(previewOrigin, resolveCorsOriginPolicy(staging))).toBe(true);
    expect(
      isAllowedCorsOrigin(
        previewOrigin,
        resolveCorsOriginPolicy({ ...staging, CORS_ALLOW_VERCEL_PREVIEWS: 'false' }),
      ),
    ).toBe(false);
  });

  it('알 수 없는 Preview 플래그 값은 fail-closed로 거부한다', () => {
    expect(() => shouldAllowVercelPreviewOrigins({ CORS_ALLOW_VERCEL_PREVIEWS: 'yes' })).toThrow(
      CorsConfigurationError,
    );
  });

  it('허용되지 않은 origin은 오류 없이 false로 판정하고 origin 없는 요청은 허용한다', () => {
    const policy = resolveCorsOriginPolicy(productionValues);

    expect(() => isAllowedCorsOrigin('https://evil.example.test', policy)).not.toThrow();
    expect(isAllowedCorsOrigin('https://evil.example.test', policy)).toBe(false);
    expect(isAllowedCorsOrigin(undefined, policy)).toBe(true);
  });

  it('Preview 팀과 project 설정을 정책에 반영한다', () => {
    const policy = resolveCorsOriginPolicy({
      NODE_ENV: 'development',
      VERCEL_PREVIEW_TEAM: 'other-team',
      VERCEL_PREVIEW_PROJECTS: 'greenhub-seller',
    });

    expect(policy.previewTeam).toBe('other-team');
    expect(policy.previewProjects).toEqual(['greenhub-seller']);
    expect(isAllowedCorsOrigin(previewOrigin, policy)).toBe(false);
    expect(
      isAllowedCorsOrigin('https://greenhub-seller-123456789-other-team.vercel.app', policy),
    ).toBe(true);
  });
});

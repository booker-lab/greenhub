import {
  CorsConfigurationError,
  configuredCorsOrigins,
  configuredVercelPreviewProjects,
  isAllowedVercelPreviewOrigin,
  LOCAL_DRIVER_ORIGIN,
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

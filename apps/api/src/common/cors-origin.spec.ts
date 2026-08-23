import { configuredVercelPreviewProjects, isAllowedVercelPreviewOrigin } from './cors-origin';

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

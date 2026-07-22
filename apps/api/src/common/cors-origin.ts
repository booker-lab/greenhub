const DEFAULT_VERCEL_TEAM = 'jos-projects-d1cecc0c';
const DEFAULT_VERCEL_PROJECTS = ['greenhubconsumer', 'greenhub-seller', 'greenhub-driver'];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isAllowedVercelPreviewOrigin(
  origin: string,
  projects = DEFAULT_VERCEL_PROJECTS,
  team = DEFAULT_VERCEL_TEAM,
) {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' || url.port || url.pathname !== '/' || url.search || url.hash) {
    return false;
  }

  const projectAlternation = projects.map(escapeRegExp).join('|');
  if (!projectAlternation) return false;

  // Vercel Preview는 branch alias(project-git-branch-team)와 immutable deployment
  // URL(project-9-char-id-team)을 모두 발급한다. 프로젝트와 팀은 정확히 제한한다.
  const hostname = new RegExp(
    `^(?:${projectAlternation})-(?:git-[a-z0-9-]+|[a-z0-9]{9})-${escapeRegExp(team)}\\.vercel\\.app$`,
  );
  return hostname.test(url.hostname);
}

export function configuredVercelPreviewProjects(raw = process.env.VERCEL_PREVIEW_PROJECTS) {
  if (!raw) return DEFAULT_VERCEL_PROJECTS;
  return raw
    .split(',')
    .map((project) => project.trim().toLowerCase())
    .filter((project) => /^[a-z0-9-]+$/.test(project));
}

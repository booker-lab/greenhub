import { isProductionRuntime } from '../config/runtime-config';

const DEFAULT_VERCEL_TEAM = 'jos-projects-d1cecc0c';
const DEFAULT_VERCEL_PROJECTS = ['greenhubconsumer', 'greenhub-seller', 'greenhub-driver'];
export const LOCAL_DRIVER_ORIGIN = 'http://localhost:3003';

export class CorsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorsConfigurationError';
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function configuredCorsOrigins(values: Record<string, unknown> = process.env): string[] {
  const raw = typeof values.CORS_ORIGIN === 'string' ? values.CORS_ORIGIN : '';
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    throw new CorsConfigurationError('CORS wildcard origin은 허용되지 않습니다.');
  }

  if (values.GREENHUB_LOCAL_RUNTIME === 'true' && !origins.includes(LOCAL_DRIVER_ORIGIN)) {
    origins.push(LOCAL_DRIVER_ORIGIN);
  }

  return origins;
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

/**
 * Vercel Preview origin 허용 여부. CORS_ALLOW_VERCEL_PREVIEWS를 명시하면 그 값을 따르고,
 * 없으면 비운영 런타임에서만 허용한다(운영 API는 기본적으로 Preview origin을 받지 않는다).
 */
export function shouldAllowVercelPreviewOrigins(
  values: Record<string, unknown> = process.env,
): boolean {
  const raw =
    typeof values.CORS_ALLOW_VERCEL_PREVIEWS === 'string'
      ? values.CORS_ALLOW_VERCEL_PREVIEWS.trim().toLowerCase()
      : '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw) {
    throw new CorsConfigurationError('CORS_ALLOW_VERCEL_PREVIEWS는 true 또는 false여야 합니다.');
  }
  return !isProductionRuntime(values);
}

export type CorsOriginPolicy = {
  allowedOrigins: string[];
  allowVercelPreviews: boolean;
  previewProjects: string[];
  previewTeam: string;
};

export function resolveCorsOriginPolicy(
  values: Record<string, unknown> = process.env,
): CorsOriginPolicy {
  const previewTeam =
    typeof values.VERCEL_PREVIEW_TEAM === 'string' && values.VERCEL_PREVIEW_TEAM.trim()
      ? values.VERCEL_PREVIEW_TEAM.trim()
      : DEFAULT_VERCEL_TEAM;
  return {
    allowedOrigins: configuredCorsOrigins(values),
    allowVercelPreviews: shouldAllowVercelPreviewOrigins(values),
    previewProjects: configuredVercelPreviewProjects(
      typeof values.VERCEL_PREVIEW_PROJECTS === 'string'
        ? values.VERCEL_PREVIEW_PROJECTS
        : undefined,
    ),
    previewTeam,
  };
}

export function isAllowedCorsOrigin(origin: string | undefined, policy: CorsOriginPolicy): boolean {
  // origin 없는 요청(헬스체크, 서버 간 통신)은 CORS 대상 아님 — 허용
  if (!origin) return true;
  if (policy.allowedOrigins.includes(origin)) return true;
  return (
    policy.allowVercelPreviews &&
    isAllowedVercelPreviewOrigin(origin, policy.previewProjects, policy.previewTeam)
  );
}

#!/usr/bin/env node
/**
 * 운영 배포 기록을 GitHub Release로 남긴다. `.github/workflows/production-deploy.yml`의 `record` job이
 * 배포 job 성공 뒤에 부른다. 배포 기록 PR(docs/memory.md)을 손으로 쓰던 일을 대신한다.
 *
 *   node scripts/release/release-record.mjs --sha=<40자리> --scope=<all|indexes|api|frontends|rules> \
 *     --api-platform=<railway|cloudrun> --e2e-run-id=<회차 E2E run ID> --run-id=<배포 run ID> \
 *     --results=<배포 결과 파일>
 *
 * - 결과 파일은 한 줄에 `단계<TAB>JSON`이다(배포 job이 production-deploy.mjs 출력을 모은 것).
 * - tag는 `prod-<KST 날짜>-<SHA 앞 8자리>`. 같은 이름이 이미 있으면 뒤에 run ID를 붙인다.
 * - 변경 목록은 직전 `prod-` Release와 비교해 GitHub가 만든다. 직전 Release가 없으면 생략한다.
 * - 범위가 all일 때만 Latest로 표시한다. 일부 범위 배포는 기록만 남긴다.
 * - 같은 배포 run의 Release가 이미 있으면 새로 만들지 않는다(job 재실행).
 *
 * 자격 증명: GITHUB_TOKEN(contents:write). 출력하지 않는다. JSON 한 줄을 출력하고, 실패하면 exit 1.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertSha, REPO_NAME, REPO_ORG } from './production-deploy.mjs';

export const TAG_PREFIX = 'prod-';
export const SCOPES = Object.freeze(['all', 'indexes', 'api', 'frontends', 'rules']);
export const API_PLATFORMS = Object.freeze(['railway', 'cloudrun']);
const REPO_URL = `https://github.com/${REPO_ORG}/${REPO_NAME}`;
const API = `https://api.github.com/repos/${REPO_ORG}/${REPO_NAME}`;
// GitHub Release 본문 한도(125,000자)보다 여유를 둔다.
const MAX_BODY_LENGTH = 120_000;

export const runUrl = (runId) => `${REPO_URL}/actions/runs/${runId}`;
/** 본문에서 배포 run을 찾는 줄. 줄 끝까지 맞춰 run 123이 run 1234와 겹치지 않게 한다. */
const runLine = (runId) => `- 배포 run: ${runUrl(runId)}`;

export function kstDate(now) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
}

export function baseTag({ sha, now }) {
  return `${TAG_PREFIX}${kstDate(now).replaceAll('-', '')}-${sha.slice(0, 8)}`;
}

export function releaseName({ sha, scope, apiPlatform, now }) {
  const parts = [`운영 배포 ${kstDate(now)} · ${sha.slice(0, 8)}`];
  if (scope !== 'all') parts.push(`범위 ${scope}`);
  if (apiPlatform !== 'railway') parts.push(`API ${apiPlatform}`);
  return parts.join(' · ');
}

/** `단계<TAB>JSON` 줄을 읽는다. JSON이 아닌 줄은 원문 그대로 둔다. */
export function parseResults(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const step = tab === -1 ? line : line.slice(0, tab);
      const raw = tab === -1 ? '' : line.slice(tab + 1);
      try {
        return { step, result: JSON.parse(raw), raw };
      } catch {
        return { step, result: null, raw };
      }
    });
}

const code = (value) => `\`${String(value).replaceAll('`', "'")}\``;
const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

export function describeResult({ step, result, raw }) {
  if (!result) return { label: step, value: code(raw || '(빈 결과)') };
  switch (step) {
    case 'indexes':
      return { label: 'Firestore 인덱스', value: '모두 READY' };
    case 'railway':
      return {
        label: 'API(Railway)',
        value: `배포 ${code(result.deploymentId)} ${result.status ?? ''}`.trim(),
      };
    case 'cloudrun':
    case 'cloudrun-standby':
      return {
        label: step === 'cloudrun' ? 'API(Cloud Run)' : 'Cloud Run 예비 서버',
        value: `리비전 ${code(result.revision)}${result.previous ? ` (이전 ${code(result.previous)})` : ''}`,
      };
    case 'health':
      return { label: 'API /health', value: `commit ${code(result.commit)}` };
    case 'vercel':
      return {
        label: `${result.app}(Vercel)`,
        value:
          result.status === 'skipped'
            ? `빌드 생략 ${code(result.deploymentId)} — ${result.reason ?? ''} 운영은 직전 배포 그대로`
            : code(result.deploymentId),
      };
    case 'rules':
      return { label: 'Firestore·Storage 규칙', value: '배포됨' };
    default:
      return { label: step, value: code(raw) };
  }
}

export function buildReleaseBody({
  sha,
  scope,
  apiPlatform,
  e2eRunId,
  runId,
  results,
  previous,
  changes,
}) {
  const lines = [
    '## 운영 배포 기록',
    '',
    `- SHA: ${code(sha)}`,
    `- 범위: ${code(scope)} · API: ${code(apiPlatform)}`,
    runLine(runId),
    `- 원격 회차 E2E run: ${runUrl(e2eRunId)}`,
    previous
      ? `- 직전 배포: [${previous.tag_name}](${previous.html_url}) — 되돌릴 때는 직전 배포의 배포 ID를 쓴다.`
      : '- 직전 배포: Release 기록 없음. 그 전 이력은 `docs/memory.md` 5절.',
    '',
    '### 배포 결과',
    '',
  ];
  if (results.length) {
    lines.push('| 대상 | 결과 |', '|---|---|');
    for (const entry of results) {
      const { label, value } = describeResult(entry);
      lines.push(`| ${cell(label)} | ${cell(value)} |`);
    }
  } else {
    lines.push('배포 결과가 전달되지 않았다. 배포 run 요약을 본다.');
  }
  lines.push('', '### 변경', '');
  lines.push(changes?.trim() || '직전 배포 Release가 없어 변경 목록을 생략했다.');
  const body = `${lines.join('\n')}\n`;
  return body.length > MAX_BODY_LENGTH
    ? `${body.slice(0, MAX_BODY_LENGTH)}\n\n(길이 한도로 잘림. 배포 run 요약을 본다.)\n`
    : body;
}

async function github({ token, fetchImpl, method = 'GET', path, body, allow404 = false }) {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow404 && res.status === 404) return null;
  const text = await res.text();
  if (!res.ok)
    throw new Error(`GitHub ${method} ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export async function recordRelease({
  sha,
  scope,
  apiPlatform,
  e2eRunId,
  runId,
  results,
  token,
  fetchImpl = fetch,
  now = new Date(),
}) {
  assertSha(sha);
  if (!SCOPES.includes(scope)) throw new Error(`scope는 ${SCOPES.join('|')} 중 하나여야 합니다.`);
  if (!API_PLATFORMS.includes(apiPlatform)) {
    throw new Error(`api-platform은 ${API_PLATFORMS.join('|')} 중 하나여야 합니다.`);
  }
  for (const [name, value] of [
    ['e2e-run-id', e2eRunId],
    ['run-id', runId],
  ]) {
    if (!/^\d+$/.test(String(value ?? ''))) throw new Error(`${name}은(는) 숫자여야 합니다.`);
  }
  if (!token) throw new Error('GITHUB_TOKEN이 없어 실행을 멈춥니다.');
  const call = (options) => github({ token, fetchImpl, ...options });

  // 배포 기록은 하루 몇 건이라 첫 쪽(100건)만 본다.
  const releases = (await call({ path: '/releases?per_page=100' })) ?? [];
  const existing = releases.find((release) => release.body?.split('\n').includes(runLine(runId)));
  if (existing) {
    return { status: 'exists', tag: existing.tag_name, url: existing.html_url };
  }
  // 목록 순서는 배포 순서가 아니다(같은 날 tag는 이름 역순으로 온다). created_at도 대상 커밋 날짜라
  // 쓸 수 없고, record job이 Release를 만든 시각인 published_at이 가장 늦은 것을 직전 배포로 본다.
  const previous =
    releases
      .filter((release) => release.tag_name?.startsWith(TAG_PREFIX) && !release.draft)
      .sort((a, b) =>
        String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')),
      )[0] ?? null;

  let tag = baseTag({ sha, now });
  const taken =
    releases.some((release) => release.tag_name === tag) ||
    (await call({ path: `/git/ref/tags/${tag}`, allow404: true })) !== null;
  if (taken) tag = `${tag}-${runId}`;

  let changes = null;
  if (previous) {
    const notes = await call({
      method: 'POST',
      path: '/releases/generate-notes',
      body: { tag_name: tag, target_commitish: sha, previous_tag_name: previous.tag_name },
    });
    changes = notes?.body ?? null;
  }

  const created = await call({
    method: 'POST',
    path: '/releases',
    body: {
      tag_name: tag,
      target_commitish: sha,
      name: releaseName({ sha, scope, apiPlatform, now }),
      body: buildReleaseBody({
        sha,
        scope,
        apiPlatform,
        e2eRunId,
        runId,
        results,
        previous,
        changes,
      }),
      make_latest: scope === 'all' ? 'true' : 'false',
    },
  });
  return {
    status: 'created',
    tag,
    url: created?.html_url ?? null,
    previous: previous?.tag_name ?? null,
  };
}

export function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const match = /^--([a-z0-9-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`알 수 없는 인자: ${arg}`);
    options[match[1]] = match[2];
  }
  return options;
}

export async function main(
  argv,
  {
    env = process.env,
    fetchImpl = fetch,
    readFile = (path) => readFileSync(path, 'utf8'),
    now,
  } = {},
) {
  const options = parseArgs(argv);
  return recordRelease({
    sha: options.sha,
    scope: options.scope,
    apiPlatform: options['api-platform'],
    e2eRunId: options['e2e-run-id'],
    runId: options['run-id'],
    results: options.results ? parseResults(readFile(options.results)) : [],
    token: env.GITHUB_TOKEN?.trim(),
    fetchImpl,
    now,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    console.error(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    process.exit(1);
  }
}

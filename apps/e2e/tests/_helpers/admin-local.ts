/**
 * 어드민 로컬 E2E 헬퍼 — `pnpm dev:local`(실제 API + Firestore·Auth 에뮬레이터)에서만 돈다.
 *
 * 운영·스테이징·원격 Preview에는 절대 붙지 않는다.
 *  - 실행 조건: `ADMIN_LOCAL_E2E=1`을 명시했을 때만. 없으면 spec 전체를 건너뛴다.
 *  - 대상 주소는 env로 바꿀 수 없다(dev:local 고정 계약: API 3000·셀러/어드민 3002·에뮬레이터 8080/9099).
 *  - 실행 전 API `/health`와 에뮬레이터 응답을 확인하고, 안 되면 바로 실패한다(fail closed).
 *
 * 데이터 수명(AGENTS.md 8번): spec이 만든 문서·계정은 그 spec이 afterAll에서 지운다.
 * 지울 대상은 만든 id 목록과 이번 실행 관리자(actorId)가 남긴 기록으로만 정한다. 다른 문서는 건드리지 않는다.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { loginViaCredentials } from './auth';

export const ADMIN_LOCAL_SELLER_BASE = 'http://localhost:3002';
export const ADMIN_LOCAL_API_BASE = 'http://localhost:3000';
const EMULATOR_ORIGIN = 'http://127.0.0.1:8080';
const AUTH_EMULATOR_ORIGIN = 'http://127.0.0.1:9099';
const PROJECT_ID = 'greenhub-local';
const DOCUMENT_ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const DOCUMENTS_URL = `${EMULATOR_ORIGIN}/v1/${DOCUMENT_ROOT}`;
// 에뮬레이터 전용 owner 토큰 — 보안 규칙을 건너뛴다. 주소가 127.0.0.1:8080으로 고정이라 밖으로 나가지 않는다.
const EMULATOR_HEADERS = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const COMMIT_CHUNK = 400;

export const ADMIN_LOCAL_SKIP_REASON =
  'ADMIN_LOCAL_E2E=1이 아니어서 건너뜀 — pnpm dev:local 스택에서만 실행한다(apps/e2e/README.md)';

export function adminLocalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ADMIN_LOCAL_E2E === '1';
}

/** 실행마다·프로젝트(chromium·mobile)마다 겹치지 않는 짧은 id. 문서 id·이름에 붙인다. */
export function newRunId(testInfo: TestInfo): string {
  const project = testInfo.project.name === 'mobile' ? 'm' : 'c';
  return `${project}${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/** 실행마다 다른 휴대폰 번호(010-XXXX-XXXX). 동시에 도는 프로젝트끼리 화면에서 겹치지 않게 한다. */
export function newPhone(): string {
  const digits = String(randomUUID().replace(/\D/g, '')).padEnd(8, '0').slice(0, 8);
  return `010-${digits.slice(0, 4)}-${digits.slice(4)}`;
}

// ── 에뮬레이터 REST ─────────────────────────────────────────────────

type Plain =
  | null
  | undefined
  | boolean
  | number
  | string
  | Date
  | Plain[]
  | { [key: string]: Plain };
export type DocData = Record<string, Plain>;

function toValue(value: Plain): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  return { mapValue: { fields: toFields(value) } };
}

function toFields(data: Record<string, Plain>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toValue(value)]));
}

function fromValue(value: Record<string, any>): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue.fields ?? {});
  return undefined;
}

function fromFields(fields: Record<string, any>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)]));
}

async function emulatorRequest(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: EMULATOR_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`에뮬레이터 요청 실패: ${method} ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function commit(writes: unknown[]): Promise<void> {
  for (let i = 0; i < writes.length; i += COMMIT_CHUNK) {
    await emulatorRequest('POST', `${DOCUMENTS_URL}:commit`, {
      writes: writes.slice(i, i + COMMIT_CHUNK),
    });
  }
}

/** 문서를 통째로 쓴다(있으면 덮어씀). path = 'collection/docId'. */
export async function seedDocs(docs: Array<{ path: string; data: DocData }>): Promise<void> {
  await commit(
    docs.map(({ path, data }) => ({
      update: { name: `${DOCUMENT_ROOT}/${path}`, fields: toFields(data) },
    })),
  );
}

export async function deleteDocs(paths: readonly string[]): Promise<void> {
  await commit(paths.map((path) => ({ delete: `${DOCUMENT_ROOT}/${path}` })));
}

export async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${DOCUMENTS_URL}/${path}`, { headers: EMULATOR_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`에뮬레이터 문서 읽기 실패: ${res.status}`);
  const doc = (await res.json()) as { fields?: Record<string, any> };
  return fromFields(doc.fields ?? {});
}

/** collection에서 field == value인 문서 경로 목록. 정리 대상(이번 관리자가 남긴 기록 등)을 찾는 데만 쓴다. */
export async function findDocPaths(
  collection: string,
  field: string,
  value: string,
): Promise<string[]> {
  const rows = (await emulatorRequest('POST', `${DOCUMENTS_URL}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } },
    },
  })) as Array<{ document?: { name: string } }>;
  return rows
    .map((row) => row.document?.name)
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.slice(DOCUMENT_ROOT.length + 1));
}

// ── 로컬 스택 확인 ──────────────────────────────────────────────────

/** dev:local이 떠 있는지 확인한다. 안 떠 있으면 데이터를 만들기 전에 실패시킨다. */
export async function assertLocalRuntimeReady(): Promise<void> {
  const health = await fetch(`${ADMIN_LOCAL_API_BASE}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(
      '로컬 API(localhost:3000)가 응답하지 않습니다 — pnpm dev:local을 먼저 띄우세요.',
    );
  }
  const emulator = await fetch(`${EMULATOR_ORIGIN}/`).catch(() => null);
  if (!emulator?.ok) {
    throw new Error('Firestore 에뮬레이터(127.0.0.1:8080)가 응답하지 않습니다.');
  }
}

// ── 관리자 계정 ─────────────────────────────────────────────────────

export interface LocalAdmin {
  id: string;
  email: string;
  password: string;
}

/**
 * 이번 spec 전용 관리자를 에뮬레이터에 바로 만든다. 관리자 가입 경로는 제품에 없고, API 가입(POST /auth/register)은
 * IP당 분당 10회 한도라 spec·프로젝트마다 가입하면 막힌다. 비밀번호 해시는 API와 같은 bcrypt로 만들고,
 * 로그인은 API 실경로(POST /auth/login)로 검증한다. 문서 모양은 AuthService.register와 같다.
 */
export async function createLocalAdmin(runId: string): Promise<LocalAdmin> {
  const id = `e2e-adm-${runId}-admin`;
  const admin = {
    id,
    email: `e2e-admin-${runId}@greenhub.local`,
    // 로컬 에뮬레이터 전용 1회용 값(실행마다 새로 만든다).
    password: `Local-${randomUUID()}`,
  };
  // e2e 패키지에는 bcrypt가 없어 API 워크스페이스의 것을 그대로 빌려 쓴다(같은 해시 형식 보장).
  const bcrypt = createRequire(resolve(__dirname, '../../../api/package.json'))('bcrypt') as {
    hash(value: string, rounds: number): Promise<string>;
  };
  const now = new Date();
  await seedDocs([
    {
      path: `users/${id}`,
      data: {
        id,
        email: admin.email,
        name: `E2E 관리자 ${runId}`,
        phone: null,
        role: 'admin',
        storeId: null,
        providers: ['email'],
        passwordHash: await bcrypt.hash(admin.password, 4),
        savedAddresses: [],
        fcmToken: null,
        createdAt: now,
        updatedAt: now,
      },
    },
  ]);
  return admin;
}

/** 관리자 계정과 그 관리자가 남긴 기록(관리자 작업 기록·로그인 기록·refresh 토큰)을 지운다. */
export async function deleteLocalAdmin(admin: LocalAdmin | null): Promise<void> {
  if (!admin) return;
  const owned = [
    ...(await findDocPaths('adminAuditLogs', 'actorId', admin.id)),
    ...(await findDocPaths('auditLogs', 'userId', admin.id)),
  ];
  await deleteDocs([...owned, `refreshTokens/${admin.id}`, `users/${admin.id}`]);
  // 어드민 화면이 Firebase 커스텀 토큰으로 로그인하면 Auth 에뮬레이터에 같은 uid가 생길 수 있어 그 uid만 지운다(없으면 무시).
  await fetch(
    `${AUTH_EMULATOR_ORIGIN}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`,
    { method: 'POST', headers: EMULATOR_HEADERS, body: JSON.stringify({ localId: admin.id }) },
  ).catch(() => null);
}

/**
 * 셀러/어드민 앱에 관리자 세션을 만든다. 로컬 런타임은 Credentials 헤더 게이트를 생략하므로
 * 헤더는 자리값이다(apps/seller/src/auth.ts isLocalCredentialRuntime).
 */
export async function loginLocalAdmin(page: Page, admin: LocalAdmin): Promise<void> {
  await loginViaCredentials(page, ADMIN_LOCAL_SELLER_BASE, admin.email, admin.password, {
    name: 'x-greenhub-local-e2e',
    value: '1',
  });
}

/** 어드민 화면을 연다. SSE가 상시 열려 있어 networkidle 대신 제목 노출로 기다린다. */
export async function openAdminPage(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(`${ADMIN_LOCAL_SELLER_BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')));
  await expect(page.getByText(heading, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
}

/** 데스크톱 표와 모바일 카드가 함께 DOM에 있으므로 지금 보이는 쪽만 고른다. */
export function visible(locator: Locator): Locator {
  return locator.filter({ visible: true });
}

/** 데스크톱은 표의 행, 모바일(<sm)은 카드 목록의 항목이다. 컴포넌트 클래스 대신 표 구조와 listitem 역할로 찾는다. */
export function rowOrListItem(page: Page): Locator {
  return visible(page.locator('tbody > tr').or(page.getByRole('listitem')));
}

/** Mantine Select에서 옵션 하나를 고른다(검색 가능한 Select는 글자를 쳐서 좁힌다). */
export async function pickSelectOption(
  page: Page,
  select: Locator,
  optionName: string,
  { search = false }: { search?: boolean } = {},
): Promise<void> {
  await select.click();
  if (search) await select.fill(optionName);
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

/** 원화 표기(화면 toKRW·toLocaleString과 같은 모양). */
export function krw(amount: number): string {
  return `₩${amount.toLocaleString('ko-KR')}`;
}

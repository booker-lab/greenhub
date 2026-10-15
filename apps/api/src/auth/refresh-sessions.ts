// 기기(로그인)마다 refresh 세션 하나를 둔다. 저장 위치는 사용자당 문서 하나인 `refreshTokens/{sub}`의
// `sessions` 맵이다(키: 세션 id `sid`, 값: 그 세션의 회전 기록). 사용자 문서를 지우는 기존 정리 스크립트·
// 관리자 정지(`refreshTokens/{sub}` 삭제 = 모든 세션 폐기)·백업 제외 목록이 경로 변경 없이 그대로 맞는다.
// 세션 수가 작고(상한 REFRESH_SESSION_MAX_COUNT) 모든 변경을 한 트랜잭션의 읽기-후-쓰기로 하므로
// 맵 키를 필드 경로로 다룰 일이 없다.

// 한 사용자가 동시에 유지할 수 있는 refresh 세션 수. 넘으면 가장 오래 쓰이지 않은 세션부터 끊는다.
export const REFRESH_SESSION_MAX_COUNT = 10;

// `users/{uid}.activeSessionIds`: 현재 살아 있는 세션 id 목록. JwtStrategy가 이미 읽는 사용자 문서에서
// access token의 `sid`를 확인하므로 요청마다 Firestore 읽기를 더하지 않는다. 로그인·로그아웃·재사용 감지가
// `refreshTokens/{sub}.sessions`와 같은 트랜잭션에서 함께 다시 쓴다.
export const ACTIVE_SESSION_IDS_FIELD = 'activeSessionIds';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type RefreshSessionRecord = {
  // SHA-256(hex) of the current refresh token.
  token: string;
  previousToken?: string;
  sealedToken?: string;
  rotatedAt?: number;
  createdAt: number;
};

export type RefreshSessions = Record<string, RefreshSessionRecord>;

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

function isSessionRecord(value: unknown): value is RefreshSessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['token'] === 'string' && typeof record['createdAt'] === 'number';
}

// 저장된 문서에서 형식이 맞는 세션만 꺼낸다. 이전 단일 기록 형식(최상위 `token`)은 세션으로 보지 않는다
// (sid 없는 이전 refresh token은 다시 로그인해야 한다).
export function readRefreshSessions(data: unknown): RefreshSessions {
  if (typeof data !== 'object' || data === null) return {};
  const sessions = (data as { sessions?: unknown }).sessions;
  if (typeof sessions !== 'object' || sessions === null) return {};
  const result: RefreshSessions = {};
  for (const [sid, record] of Object.entries(sessions)) {
    if (isSessionId(sid) && isSessionRecord(record)) result[sid] = record;
  }
  return result;
}

function lastActiveAt(record: RefreshSessionRecord): number {
  return Math.max(record.createdAt, record.rotatedAt ?? 0);
}

// 새 세션을 더한다. 상한에 닿으면 마지막 사용(로그인·회전) 시각이 가장 이른 세션부터 내보낸다.
// 만료된 세션(30일 넘게 회전하지 않은 세션)은 마지막 사용이 가장 이르므로 먼저 정리된다.
export function addRefreshSession(
  sessions: RefreshSessions,
  sid: string,
  record: RefreshSessionRecord,
  maxCount: number = REFRESH_SESSION_MAX_COUNT,
): { sessions: RefreshSessions; evicted: string[] } {
  const ordered = Object.entries(sessions)
    .filter(([id]) => id !== sid)
    .sort(([, a], [, b]) => lastActiveAt(a) - lastActiveAt(b));
  const evictCount = Math.max(0, ordered.length - (maxCount - 1));
  const evicted = ordered.slice(0, evictCount).map(([id]) => id);
  const kept = Object.fromEntries(ordered.slice(evictCount));
  return { sessions: { ...kept, [sid]: record }, evicted };
}

// 검색 화면(/search)의 검색어를 주소의 ?q=와 맞추는 규칙.
// 결과에서 상세로 갔다가 뒤로 오거나 /search?q=호접란 링크로 들어와도 검색어와 결과가 남게 한다.

export const SEARCH_PATH = '/search';
export const SEARCH_QUERY_PARAM = 'q';
// 입력할 때마다 주소를 바꾸지 않고, 입력이 잠깐 멈추면 맞춘다.
export const SEARCH_URL_SYNC_DELAY_MS = 300;

/** 공백뿐인 검색어는 빈 검색어로 본다. 그 밖에는 입력한 그대로 둔다. */
export function normalizeSearchQuery(query: string | null | undefined): string {
  if (typeof query !== 'string') return '';
  return query.trim() ? query : '';
}

/** 주소의 쿼리에서 검색어를 읽는다. */
export function readSearchQuery(params: { get(name: string): string | null }): string {
  return normalizeSearchQuery(params.get(SEARCH_QUERY_PARAM));
}

/**
 * 검색어를 담은 검색 화면 주소를 만든다. 다른 쿼리 값은 그대로 둔다.
 * 검색어가 비면 q를 지운다.
 */
export function buildSearchHref(query: string, currentSearch = ''): string {
  const params = new URLSearchParams(currentSearch);
  const normalized = normalizeSearchQuery(query);
  if (normalized) params.set(SEARCH_QUERY_PARAM, normalized);
  else params.delete(SEARCH_QUERY_PARAM);
  const search = params.toString();
  return search ? `${SEARCH_PATH}?${search}` : SEARCH_PATH;
}

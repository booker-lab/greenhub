// 상단 "뒤로" 버튼이 브라우저 뒤로 가기를 할지, 홈으로 보낼지 정한다.
// 공유 링크를 새 탭으로 열면 돌아갈 기록이 없어 router.back()이 아무 일도 하지 않는다.
// 다른 사이트에서 들어온 첫 화면이면 뒤로 가기가 가게를 떠나므로 홈으로 보낸다.

export type BackAction = 'back' | 'home';

export interface BackNavigationContext {
  /** window.history.length */
  historyLength: number;
  /** Navigation API의 navigation.canGoBack(같은 출처 이전 기록이 있는지). 지원하지 않으면 undefined. */
  canGoBack?: boolean;
  /** document.referrer */
  referrer: string;
  /** window.location.origin */
  origin: string;
  /** 이 문서를 처음 연 경로에 아직 머물러 있는지(화면 안 이동을 아직 하지 않았는지). */
  onLandingPage: boolean;
}

export function isSameOriginReferrer(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}

export function resolveBackAction(context: BackNavigationContext): BackAction {
  // 브라우저가 같은 출처 이전 기록 유무를 알려 주면 그 값을 그대로 따른다.
  if (typeof context.canGoBack === 'boolean') return context.canGoBack ? 'back' : 'home';
  if (context.historyLength <= 1) return 'home';
  // 화면 안에서 이동했다면 이전 기록은 이 가게 화면이다. document.referrer는 화면 안 이동으로 바뀌지 않으므로
  // 처음 연 화면일 때만 referrer로 같은 출처에서 왔는지 본다.
  if (context.onLandingPage && !isSameOriginReferrer(context.referrer, context.origin)) {
    return 'home';
  }
  return 'back';
}

type BrowserLike = {
  history: { length: number };
  location: { origin: string; pathname: string };
  document: { referrer: string };
  navigation?: { canGoBack?: unknown };
  performance?: { getEntriesByType?: (type: string) => ArrayLike<{ name: string }> };
};

/** 브라우저 값을 읽어 판정 입력을 만든다. 읽지 못한 값은 뒤로 가기 쪽(기존 동작)으로 둔다. */
export function readBackNavigationContext(win: BrowserLike): BackNavigationContext {
  const canGoBack = win.navigation?.canGoBack;
  let onLandingPage = false;
  try {
    const entry = win.performance?.getEntriesByType?.('navigation')?.[0];
    if (entry) onLandingPage = new URL(entry.name).pathname === win.location.pathname;
  } catch {
    onLandingPage = false;
  }
  return {
    historyLength: win.history.length,
    canGoBack: typeof canGoBack === 'boolean' ? canGoBack : undefined,
    referrer: win.document.referrer,
    origin: win.location.origin,
    onLandingPage,
  };
}

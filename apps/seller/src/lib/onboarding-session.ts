// 온보딩에서 가게를 만든 뒤 서버 세션에 새 storeId가 실렸는지 확인한다. 실리기 전에 판매자 화면으로
// 가면 proxy가 storeId 없는 세션으로 보고 /onboarding으로 되돌려 보낸다.

type SessionWithStore = { user?: { storeId?: string | null } | null } | null | undefined;

export type ConfirmSessionStoreOptions = {
  /** 서버 세션을 다시 받는다. 판매자 앱에서는 update({}) — API로 다시 검증하고 세션 쿠키를 갱신한다. */
  refresh: () => Promise<SessionWithStore>;
  storeId: string;
  attempts?: number;
  waitMs?: number;
  wait?: (ms: number) => Promise<void>;
};

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 서버 세션의 storeId가 만든 가게와 같아지면 true. 정해진 횟수 안에 안 되면 false. */
export async function confirmSessionStore({
  refresh,
  storeId,
  attempts = 3,
  waitMs = 700,
  wait = defaultWait,
}: ConfirmSessionStoreOptions): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(waitMs);
    try {
      const session = await refresh();
      if (session?.user?.storeId === storeId) return true;
    } catch {
      // 일시 오류는 다음 시도에서 다시 확인한다.
    }
  }
  return false;
}

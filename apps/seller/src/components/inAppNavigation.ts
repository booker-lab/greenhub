/**
 * '지금 화면 바로 앞에 앱 화면이 있는지' 판정 — PageHeader의 backHref 뒤로가기가 쓴다.
 * window.history.length는 같은 탭에서 앞서 본 다른 사이트까지 세고, '앱 안에서 이동한 적이 있는지'는
 * 지금 위치 앞에 무엇이 있는지를 말해 주지 않는다(외부 → /hubs → 상세 → 뒤로 오면 앞은 외부 사이트다).
 * 브라우저 Navigation API의 canGoBack은 지금 항목 앞에 같은 출처 항목이 있을 때만 true다.
 * 이 API가 없는 브라우저에서는 false로 보고 상위 화면으로 보낸다(앱 밖으로 나가지 않는 쪽으로 닫는다).
 * vitest에서 `@/` 별칭 없이 직접 검증할 수 있도록 React·Next 의존성을 두지 않는다.
 */

interface NavigationLike {
  canGoBack?: unknown;
}

function currentNavigation(): NavigationLike | undefined {
  return (globalThis as { navigation?: NavigationLike }).navigation;
}

/** 바로 앞 기록이 같은 출처(앱) 화면이면 true — 이때만 router.back()으로 돌아가도 앱 안에 머문다. */
export function canGoBackInApp(
  navigation: NavigationLike | undefined = currentNavigation(),
): boolean {
  return navigation?.canGoBack === true;
}

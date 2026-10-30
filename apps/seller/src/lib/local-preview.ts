// 로컬 전용 화면(UI 교체 대조 화면 등)을 열지 정한다.
// 화면 확인 하네스(scripts/visual/start.mjs)와 dev:local(scripts/dev/local/launcher.mjs)만
// GREENHUB_LOCAL_RUNTIME=true로 next dev를 띄운다. 운영 빌드는 NODE_ENV가 production으로 고정되므로
// 같은 값을 넣어도 열리지 않는다(auth.ts의 로컬 로그인과 같은 조건).
export function isLocalPreviewEnabled(
  env: Partial<Record<'GREENHUB_LOCAL_RUNTIME' | 'NODE_ENV', string | undefined>> = process.env,
): boolean {
  return env.GREENHUB_LOCAL_RUNTIME === 'true' && env.NODE_ENV !== 'production';
}

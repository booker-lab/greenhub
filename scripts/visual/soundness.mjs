// 캡처가 "의도한 화면"을 찍었는지 판정한다. 판정을 통과하지 못한 캡처는 비교에 넣지 않는다.
//
// 작업 전·후가 같은 오류 화면(가짜 API 404, 로그인으로 튕김, 누를 글자 없음)이면 픽셀 차이가 0이어도
// 아무것도 증명하지 못하기 때문이다(ui-stack-migration-plan.md P0.5).

/** fixture 화면이 도착해야 하는 주소(pathname). 의도한 이동이 있으면 fixture에 expectPath를 준다. */
export function expectedPathOf(screen) {
  if (screen.expectPath) return screen.expectPath;
  return new URL(screen.path, 'http://visual.invalid').pathname;
}

/**
 * 한 캡처의 문제 목록. 비어 있으면 정상이다.
 * @param {{ missing?: string[], errors?: string[], failed?: string[], stepNote?: string | null, unsupported?: string, finalPath?: string }} shot
 * @param {string} expectedPath
 */
export function shotProblems(shot, expectedPath) {
  const problems = [];
  if (shot.missing?.length) problems.push(`fixture 없음: ${shot.missing.join(', ')}`);
  if (shot.errors?.length) problems.push(`콘솔 오류 ${shot.errors.length}건`);
  if (shot.failed?.length) problems.push(`API 요청 실패: ${shot.failed.join(', ')}`);
  if (shot.stepNote) problems.push(shot.stepNote);
  if (shot.unsupported) problems.push(shot.unsupported);
  if (shot.finalPath !== expectedPath) {
    problems.push(`주소 다름: ${shot.finalPath ?? '(없음)'} (기대 ${expectedPath})`);
  }
  return problems;
}

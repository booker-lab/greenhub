// 안정 촬영 — 같은 화면을 새로 열어 다시 찍고, 픽셀이 같은 결과가 두 번 나온 장만 쓴다.
//
// 같은 커밋을 두 번 찍어도 일부 화면은 렌더 결과가 두 가지로 갈린다(DOM·애니메이션·hover 상태는 같고
// 글자·모서리 안티앨리어싱만 채널 2~40 다름, ui-stack-migration-plan.md P0.5 "남은 흔들림").
// 같은 페이지를 연달아 찍으면 늘 같으므로, 시도마다 페이지를 새로 열어 상태를 처음부터 다시 만든다.
// 끝내 같은 결과가 두 번 나오지 않으면 그 화면은 불안정으로 정상 판정에서 떨어진다(조용히 넘기지 않는다).

/** 시도 횟수 상한. 최소 2번은 찍어야 "같은 결과 두 번"을 확인할 수 있다. */
export const STABLE_MAX_ATTEMPTS = 5;

/**
 * 시도 결과를 차례로 보고 같은 결과가 두 번째로 나온 시도를 고른다.
 * @param {string[]} hashes 시도별 이미지 지문(찍은 순서)
 * @returns {{ index: number, hash: string } | null} 고른 시도(두 번째로 나온 쪽)와 지문, 없으면 null
 */
export function pickStable(hashes) {
  const seen = new Set();
  for (let i = 0; i < hashes.length; i += 1) {
    if (seen.has(hashes[i])) return { index: i, hash: hashes[i] };
    seen.add(hashes[i]);
  }
  return null;
}

/**
 * 같은 결과가 두 번 나올 때까지 최대 maxAttempts번 찍는다.
 * 정상 판정에 실패한 시도(fixture 없음·콘솔 오류 등)가 나오면 다시 찍지 않고 그 시도를 그대로 돌려준다.
 * 다시 찍어 오류를 피하면 오류 화면을 숨기게 되기 때문이다.
 * @template T
 * @param {() => Promise<{ hash: string, sound: boolean, value: T }>} shoot 화면을 새로 열어 한 번 찍는다
 * @param {number} [maxAttempts]
 * @returns {Promise<{ value: T, attempts: number, hashes: string[], outcome: 'stable' | 'unsound' | 'unstable' }>}
 *   stable: 같은 결과 두 번, unsound: 정상 판정 실패 시도에서 멈춤, unstable: 끝내 같은 결과 두 번이 없음
 */
export async function shootStable(shoot, maxAttempts = STABLE_MAX_ATTEMPTS) {
  if (maxAttempts < 2) throw new Error('안정 촬영은 최소 2번 찍어야 합니다.');
  const hashes = [];
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await shoot();
    if (!last.sound) return { value: last.value, attempts: attempt, hashes, outcome: 'unsound' };
    hashes.push(last.hash);
    // 같은 지문의 두 장은 픽셀이 같으므로 방금 찍은(두 번째로 나온) 장을 쓴다.
    if (pickStable(hashes))
      return { value: last.value, attempts: attempt, hashes, outcome: 'stable' };
  }
  return { value: last.value, attempts: maxAttempts, hashes, outcome: 'unstable' };
}

// shots.mjs 캡처 기록(manifest.json)의 중간 저장·이어 찍기. 의존성 없음(manifest-store.spec.mjs).
//
// 긴 촬영이 도구 시간 제한 등으로 끊겨도 그때까지 찍은 화면의 기록이 남도록 화면마다 manifest를 저장한다.
// 저장은 임시 파일에 쓴 뒤 이름을 바꿔(원자적 쓰기) 끊긴 순간에도 반쯤 쓴 JSON이 남지 않는다.
// 끝나지 않은 묶음(complete: false)은 diff·parity가 비교하지 않는다. 예전에는 끊기면 manifest가 없어 비교가
// 실패했으므로, 판정 결과는 그대로다(같은 곳에서 끊긴 두 묶음을 일부만 비교해 통과시키지 않는다).
import fs from 'node:fs';

/** 화면 하나(화면 id + 폭)의 열쇠. */
export function shotKey(shot) {
  return `${shot.id}@${shot.viewport}`;
}

/** JSON을 임시 파일에 쓴 뒤 이름을 바꾼다. 같은 볼륨 안의 rename은 원자적이다. */
export function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** 같은 화면(id + 폭)의 기록은 바꾸고, 없으면 더한다. */
export function upsertShot(manifest, shot) {
  const k = shotKey(shot);
  const i = manifest.shots.findIndex((s) => shotKey(s) === k);
  if (i === -1) manifest.shots.push(shot);
  else manifest.shots[i] = shot;
}

/** 이번 실행이 찍을 화면 열쇠(화면 목록 × 폭). */
export function expectedKeys(screens, viewports) {
  return viewports.flatMap((viewport) => screens.map((s) => shotKey({ id: s.id, viewport })));
}

/** 이 묶음이 찍기로 한 화면을 모두 찍었는지. */
export function isComplete(manifest) {
  const have = new Set(manifest.shots.map(shotKey));
  return (manifest.expected ?? []).every((k) => have.has(k));
}

/**
 * 이어 찍기: 앞선(끊긴) 기록을 이어받을 수 있는지 보고, 이어받은 manifest를 만든다.
 * 앱·기준 시각·화면 폭·화면 묶음(--set)이 같아야 한다. 다르면 problems에 이유를 담고 manifest는 null이다.
 */
export function resumeManifest(previous, fresh) {
  const problems = [];
  if (!previous) return { manifest: null, problems: ['이어 찍을 manifest.json이 없습니다'] };
  if (previous.app !== fresh.app) problems.push(`앱이 다릅니다: ${previous.app} / ${fresh.app}`);
  if (previous.visualNow !== fresh.visualNow) {
    problems.push(`기준 시각이 다릅니다: ${previous.visualNow} / ${fresh.visualNow}`);
  }
  const vp = (m) => [...(m.viewports ?? [])].sort().join(',');
  if (vp(previous) !== vp(fresh)) {
    problems.push(`화면 폭 목록이 다릅니다: ${vp(previous)} / ${vp(fresh)}`);
  }
  if ((previous.set ?? null) !== (fresh.set ?? null)) {
    problems.push(
      `화면 묶음(--set)이 다릅니다: ${previous.set ?? '기본'} / ${fresh.set ?? '기본'}`,
    );
  }
  if (problems.length) return { manifest: null, problems };
  const expected = [...new Set([...(previous.expected ?? []), ...(fresh.expected ?? [])])];
  return {
    manifest: {
      ...fresh,
      expected,
      shots: [...previous.shots],
      resumedFrom: [...(previous.resumedFrom ?? []), previous.createdAt],
    },
    problems: [],
  };
}

/**
 * 이번 실행에서 찍을 (화면, 폭) 쌍. 이어 찍기면 이미 기록이 있는 쌍은 건너뛴다.
 * 단 --only로 직접 고른 화면은 기록이 있어도 다시 찍는다(재시작이 걸친 화면 등).
 */
export function pendingShots(screens, viewports, manifest, { resume = false, only = [] } = {}) {
  const have = new Set(resume ? manifest.shots.map(shotKey) : []);
  const pending = [];
  for (const viewport of viewports) {
    for (const screen of screens) {
      if (have.has(shotKey({ id: screen.id, viewport })) && !only.includes(screen.id)) continue;
      pending.push({ screen, viewport });
    }
  }
  return pending;
}

/** diff·parity가 비교하지 않을 끝나지 않은 묶음이면 그 이유를 돌려준다. 예전 manifest(complete 없음)는 끝난 것으로 본다. */
export function incompleteReason(manifest, side) {
  if (manifest.complete !== false) return null;
  const have = new Set(manifest.shots.map(shotKey));
  const left = (manifest.expected ?? []).filter((k) => !have.has(k)).length;
  return `${side} 촬영이 끝나지 않았습니다(남은 화면 ${left}장). shots.mjs --resume로 이어 찍으세요.`;
}

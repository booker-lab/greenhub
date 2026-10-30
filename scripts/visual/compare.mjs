// 작업 전·후 캡처 비교 판정 — diff.mjs(명령)와 compare.spec.mjs(테스트)가 쓴다.
//
// 판정 규칙(ui-stack-migration-plan.md P0.5·§7):
// - 두 캡처 모두 정상 판정(soundness.mjs)을 통과해야 비교한다. 아니면 그 화면은 실패다.
// - 기준 시각·화면 폭 목록이 다르면 비교하지 않는다(같은 조건에서 찍은 캡처만 비교한다).
// - 픽셀이 하나라도 다르면 차이다. 의도한 차이는 허용 목록에 화면·폭·영역·사유로만 적을 수 있고,
//   그 영역 밖의 차이는 0이어야 한다. 크기가 다르면 영역 대신 "full"로만 허용한다.

/**
 * 허용 목록 JSON을 검증한다. 형식이 틀리면 예외로 멈춘다(넘기지 않는다).
 * 항목: { screen, viewport?, box: { x, y, width, height } | "full", reason }
 */
export function parseAllowances(json) {
  if (!Array.isArray(json)) throw new Error('허용 목록은 배열이어야 합니다');
  return json.map((entry, i) => {
    const where = `허용 목록 ${i + 1}번째`;
    if (!entry || typeof entry !== 'object') throw new Error(`${where}: 객체가 아닙니다`);
    if (typeof entry.screen !== 'string' || !entry.screen) throw new Error(`${where}: screen 없음`);
    if (entry.viewport !== undefined && typeof entry.viewport !== 'string') {
      throw new Error(`${where}: viewport는 문자열이어야 합니다`);
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`${where}: reason(사유) 없음`);
    }
    if (entry.box !== 'full') {
      const box = entry.box;
      const valid =
        box &&
        ['x', 'y', 'width', 'height'].every((k) => Number.isInteger(box[k]) && box[k] >= 0) &&
        box.width > 0 &&
        box.height > 0;
      if (!valid)
        throw new Error(`${where}: box는 {x,y,width,height} 정수(너비·높이 > 0) 또는 "full"`);
    }
    return {
      screen: entry.screen,
      viewport: entry.viewport ?? null,
      box: entry.box,
      reason: entry.reason.trim(),
    };
  });
}

export function allowancesFor(allowances, screen, viewport) {
  return allowances.filter(
    (a) => a.screen === screen && (a.viewport === null || a.viewport === viewport),
  );
}

function insideAny(boxes, x, y) {
  return boxes.some((b) => x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height);
}

/**
 * 두 RGBA 이미지를 비교한다.
 * @param {{width:number,height:number,data:Uint8Array}} before
 * @param {{width:number,height:number,data:Uint8Array}} after
 * @param {{ boxes?: Array<{x:number,y:number,width:number,height:number}>, full?: boolean, tolerance?: number }} options
 */
export function comparePixels(before, after, { boxes = [], full = false, tolerance = 0 } = {}) {
  if (before.width !== after.width || before.height !== after.height) {
    return {
      sameSize: false,
      size: { before: [before.width, before.height], after: [after.width, after.height] },
      diffCount: null,
      unexplainedCount: full ? 0 : null,
      allowedCount: null,
      bbox: null,
      mask: null,
    };
  }
  const { width, height } = after;
  const mask = new Uint8Array(width * height); // 0 같음, 1 허용한 차이, 2 설명 안 된 차이
  let diffCount = 0;
  let unexplainedCount = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let differs = false;
      for (let c = 0; c < 4; c++) {
        if (Math.abs(before.data[i + c] - after.data[i + c]) > tolerance) {
          differs = true;
          break;
        }
      }
      if (!differs) continue;
      diffCount++;
      if (full || insideAny(boxes, x, y)) {
        mask[y * width + x] = 1;
        continue;
      }
      mask[y * width + x] = 2;
      unexplainedCount++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return {
    sameSize: true,
    size: { before: [before.width, before.height], after: [width, height] },
    diffCount,
    unexplainedCount,
    allowedCount: diffCount - unexplainedCount,
    bbox: unexplainedCount
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : null,
    mask,
  };
}

const key = (shot) => `${shot.id}::${shot.viewport}`;

/**
 * 두 캡처 묶음(manifest)을 비교한다.
 * @param {object} beforeRun shots.mjs manifest
 * @param {object} afterRun shots.mjs manifest
 * @param {(run: 'before'|'after', shot: object) => {width:number,height:number,data:Uint8Array}} loadImage
 * @param {ReturnType<typeof parseAllowances>} allowances
 */
export function compareRuns(
  beforeRun,
  afterRun,
  loadImage,
  allowances = [],
  { tolerance = 0 } = {},
) {
  const problems = [];
  if (!beforeRun.visualNow || beforeRun.visualNow !== afterRun.visualNow) {
    problems.push(
      `기준 시각이 다릅니다: before ${beforeRun.visualNow ?? '(없음)'} · after ${afterRun.visualNow ?? '(없음)'}`,
    );
  }
  const vpBefore = [...(beforeRun.viewports ?? [])].sort().join(',');
  const vpAfter = [...(afterRun.viewports ?? [])].sort().join(',');
  if (!vpBefore || vpBefore !== vpAfter) {
    problems.push(
      `화면 폭 목록이 다릅니다: before ${vpBefore || '(없음)'} · after ${vpAfter || '(없음)'}`,
    );
  }
  if (problems.length) return { ok: false, problems, screens: [], unusedAllowances: [] };

  const beforeByKey = new Map(beforeRun.shots.map((s) => [key(s), s]));
  const afterKeys = new Set(afterRun.shots.map(key));
  const used = new Set();
  const screens = [];
  for (const shot of afterRun.shots) {
    const prev = beforeByKey.get(key(shot));
    const base = { id: shot.id, viewport: shot.viewport, file: shot.file };
    if (!prev) {
      screens.push({ ...base, status: 'new', detail: 'before에 없는 화면' });
      continue;
    }
    const unsound = [
      ...(prev.sound ? [] : (prev.problems ?? ['정상 판정 없음']).map((p) => `before: ${p}`)),
      ...(shot.sound ? [] : (shot.problems ?? ['정상 판정 없음']).map((p) => `after: ${p}`)),
    ];
    if (unsound.length) {
      screens.push({ ...base, status: 'unsound', detail: unsound.join(' · ') });
      continue;
    }
    const mine = allowancesFor(allowances, shot.id, shot.viewport);
    const full = mine.some((a) => a.box === 'full');
    const boxes = mine.filter((a) => a.box !== 'full').map((a) => a.box);
    const result = comparePixels(loadImage('before', prev), loadImage('after', shot), {
      boxes,
      full,
      tolerance,
    });
    if (result.diffCount !== 0) for (const a of mine) used.add(a);
    let status;
    if (!result.sameSize) status = full ? 'allowed' : 'diff';
    else if (result.diffCount === 0) status = 'same';
    else status = result.unexplainedCount === 0 ? 'allowed' : 'diff';
    screens.push({
      ...base,
      status,
      size: result.size,
      diffCount: result.diffCount,
      unexplainedCount: result.unexplainedCount,
      bbox: result.bbox,
      reasons: mine.map((a) => a.reason),
      mask: result.mask,
      width: result.size.after[0],
      height: result.size.after[1],
    });
  }
  for (const prev of beforeRun.shots) {
    if (!afterKeys.has(key(prev))) {
      screens.push({
        id: prev.id,
        viewport: prev.viewport,
        file: prev.file,
        status: 'missing',
        detail: 'after에 없는 화면',
      });
    }
  }
  const failing = screens.filter((s) => !['same', 'allowed'].includes(s.status));
  return {
    ok: failing.length === 0,
    problems: failing.map(
      (s) => `${s.id}(${s.viewport}): ${s.status}${s.detail ? ` · ${s.detail}` : ''}`,
    ),
    screens,
    unusedAllowances: allowances.filter((a) => !used.has(a)),
  };
}

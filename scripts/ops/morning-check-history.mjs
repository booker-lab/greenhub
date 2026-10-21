/**
 * 아침 운영 점검 보고 파일의 전날 비교와 보관(설계 §5-1 3번).
 *
 * - 보고 파일: <reportsDir>/YYYY-MM-DD.json(KST 날짜). 같은 날 다시 돌리면 덮어쓴다.
 * - 비교 대상: 오늘보다 앞선 날짜 중 가장 최근 파일(PC가 꺼진 날이 있어도 마지막 보고와 비교한다).
 * - 보관: 오늘 포함 30일. 이 이름 규칙에 맞는 파일만 지우고 다른 파일은 건드리지 않는다.
 * 비교·보관 판단은 순수 함수이고, 파일 입출력은 fs를 주입받는 함수에서만 한다.
 */
import { join } from 'node:path';

export const REPORT_RETENTION_DAYS = 30;
export const REPORT_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/;

const DAY_MS = 24 * 60 * 60 * 1000;

function reportDateOf(fileName) {
  const match = REPORT_FILE_PATTERN.exec(fileName);
  return match ? match[1] : null;
}

function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 오늘보다 앞선 보고 파일 중 가장 최근 것. 없으면 null. */
export function pickPreviousReportFile(fileNames, today) {
  const dates = fileNames
    .map(reportDateOf)
    .filter((date) => date !== null && date < today)
    .sort();
  return dates.length > 0 ? `${dates[dates.length - 1]}.json` : null;
}

/** 보관 기간(오늘 포함 30일)이 지난 보고 파일. 날짜가 today-30 이하인 것. */
export function expiredReportFiles(fileNames, today, retentionDays = REPORT_RETENTION_DAYS) {
  const oldestKept = shiftDate(today, -(retentionDays - 1));
  return fileNames.filter((name) => {
    const date = reportDateOf(name);
    return date !== null && date < oldestKept;
  });
}

function entryKeys(item) {
  return Array.isArray(item?.entries) ? item.entries.map((entry) => entry.key) : [];
}

function isFlagged(item) {
  return Boolean(item?.checked) && (item.level === '🔴' || item.level === '🟡');
}

/**
 * 오늘 보고에 전날 비교를 붙인 새 보고를 돌려준다(입력은 바꾸지 않는다).
 * - entry.since: 'new'(전날 같은 key가 없음) | 'continuing'(전날에도 있음)
 * - item.since: 이상이 있을 때만. 전날 그 항목이 이상이 아니었으면 'new', 이상이었으면 'continuing'.
 *   entries 없는 항목(P1·S2)은 이것만으로 비교한다.
 * - M2는 평소 'summary'로 한 줄만 보이고, key 묶음이 전날과 다른 날(생김·바뀜·사라짐)에만 'full'로 자세히 보인다.
 * 전날 보고가 없으면 모두 'new'이고 M2는 'full'이다.
 */
export function compareWithPrevious(report, previous) {
  const previousItems = {};
  for (const item of Array.isArray(previous?.items) ? previous.items : []) previousItems[item.id] = item;

  const items = report.items.map((item) => {
    const before = previousItems[item.id];
    const beforeKeys = before?.checked ? entryKeys(before) : [];
    const entries = item.entries.map((entry) => ({
      ...entry,
      since: beforeKeys.includes(entry.key) ? 'continuing' : 'new',
    }));
    const next = { ...item, entries };
    if (isFlagged(item)) {
      next.since = isFlagged(before) ? 'continuing' : 'new';
      next.newCount = entries.filter((entry) => entry.since === 'new').length;
    }
    if (item.id === 'M2' && isFlagged(item)) {
      const nowKeys = entryKeys(item).slice().sort();
      const prevKeys = isFlagged(before) ? beforeKeys.slice().sort() : [];
      const changed = nowKeys.length !== prevKeys.length || nowKeys.some((key, i) => key !== prevKeys[i]);
      next.display = changed ? 'full' : 'summary';
    }
    return next;
  });

  return {
    ...report,
    comparison: { previousDate: typeof previous?.date === 'string' ? previous.date : null },
    items,
  };
}

/**
 * 보고 파일 저장 → 오래된 파일 정리 → 전날 보고 읽기를 한 번에 한다. 저장은 비교를 붙인 뒤에 한다.
 * fs: node:fs/promises 모양({ mkdir, readdir, readFile, writeFile, rm })
 * 돌려주는 값: { report(비교가 붙은 보고), savedPath, removed(지운 파일 이름) }
 */
export async function recordReport({ fs, reportsDir, report }) {
  await fs.mkdir(reportsDir, { recursive: true });
  const names = await fs.readdir(reportsDir);
  const previousName = pickPreviousReportFile(names, report.date);

  let previous = null;
  if (previousName) {
    try {
      previous = JSON.parse(await fs.readFile(join(reportsDir, previousName), 'utf8'));
    } catch {
      // 깨진 전날 보고는 비교에 쓰지 않는다(오늘 보고는 모두 'new'가 된다).
      previous = null;
    }
  }

  const compared = compareWithPrevious(report, previous);
  const savedPath = join(reportsDir, `${report.date}.json`);
  await fs.writeFile(savedPath, `${JSON.stringify(compared, null, 2)}\n`, 'utf8');

  const removed = expiredReportFiles(names, report.date);
  for (const name of removed) {
    await fs.rm(join(reportsDir, name), { force: true });
  }
  return { report: compared, savedPath, removed };
}

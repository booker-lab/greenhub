import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  compareWithPrevious,
  expiredReportFiles,
  pickPreviousReportFile,
  recordReport,
} from './morning-check-history.mjs';

const item = (id, level, keys = [], extra = {}) => ({
  id,
  title: id,
  level,
  checked: level !== null,
  count: keys.length,
  entries: keys.map((key) => ({ key, level })),
  decision: '',
  ...extra,
});
const report = (date, items) => ({ date, overall: '🟢', counts: { red: 0, yellow: 0 }, items });

describe('전날 보고 고르기', () => {
  test('오늘보다 앞선 날짜 중 가장 최근 파일(꺼진 날을 건너뛴다), 오늘 파일·이름 규칙 밖 파일은 무시', () => {
    const names = ['2026-10-19.json', '2026-10-20.json', '2026-10-22.json', 'notes.txt', '2026-10-21.json.bak'];
    assert.equal(pickPreviousReportFile(names, '2026-10-22'), '2026-10-20.json');
    assert.equal(pickPreviousReportFile(['2026-10-22.json'], '2026-10-22'), null);
    assert.equal(pickPreviousReportFile([], '2026-10-22'), null);
  });
});

describe('30일 보관', () => {
  test('오늘 포함 30일(today-29)까지 남기고 today-30부터 지운다, 이름 규칙 밖 파일은 건드리지 않는다', () => {
    const names = ['2026-09-22.json', '2026-09-23.json', '2026-09-24.json', '2026-10-22.json', 'keep-me.json', 'readonly-key.json'];
    // 2026-10-22 - 29일 = 2026-09-23
    assert.deepEqual(expiredReportFiles(names, '2026-10-22'), ['2026-09-22.json']);
  });

  test('달·해가 바뀌어도 날짜로 센다', () => {
    assert.deepEqual(expiredReportFiles(['2025-12-03.json', '2025-12-04.json'], '2026-01-02'), ['2025-12-03.json']);
  });
});

describe('전날과 비교', () => {
  test('entry key가 전날에도 있으면 continuing, 없으면 new', () => {
    const compared = compareWithPrevious(
      report('2026-10-22', [item('O1', '🔴', ['A-1', 'A-2'])]),
      report('2026-10-21', [item('O1', '🔴', ['A-1'])]),
    );
    const o1 = compared.items[0];
    assert.deepEqual(o1.entries.map((e) => [e.key, e.since]), [
      ['A-1', 'continuing'],
      ['A-2', 'new'],
    ]);
    assert.equal(o1.since, 'continuing');
    assert.equal(o1.newCount, 1);
    assert.equal(compared.comparison.previousDate, '2026-10-21');
  });

  test('전날 이상이 아니던 항목은 new, entries 없는 항목(P1)도 항목 단위로 비교한다', () => {
    const compared = compareWithPrevious(
      report('2026-10-22', [item('P1', '🟡', [], { count: 2 }), item('P2', '🟡', ['x'])]),
      report('2026-10-21', [item('P1', '🟡', [], { count: 1 }), item('P2', '🟢')]),
    );
    assert.equal(compared.items[0].since, 'continuing');
    assert.equal(compared.items[1].since, 'new');
  });

  test('🟢 항목에는 since를 붙이지 않는다', () => {
    const compared = compareWithPrevious(report('2026-10-22', [item('S1', '🟢')]), null);
    assert.equal(compared.items[0].since, undefined);
    assert.equal(compared.comparison.previousDate, null);
  });

  test('전날 확인 못 한 항목의 key는 비교에 쓰지 않는다(모두 new)', () => {
    const before = item('S3', null);
    before.entries = [{ key: 'k' }];
    const compared = compareWithPrevious(report('2026-10-22', [item('S3', '🔴', ['k'])]), report('2026-10-21', [before]));
    assert.equal(compared.items[0].entries[0].since, 'new');
    assert.equal(compared.items[0].since, 'new');
  });

  test('M2: key 묶음이 같으면 summary(한 줄), 생기거나 바뀌거나 줄면 full(자세히)', () => {
    const same = compareWithPrevious(
      report('2026-10-22', [item('M2', '🟡', ['가|0.03|0.05', '나|0.1|0.05'])]),
      report('2026-10-21', [item('M2', '🟡', ['나|0.1|0.05', '가|0.03|0.05'])]),
    );
    assert.equal(same.items[0].display, 'summary');

    const changed = compareWithPrevious(
      report('2026-10-22', [item('M2', '🟡', ['가|0.04|0.05'])]),
      report('2026-10-21', [item('M2', '🟡', ['가|0.03|0.05'])]),
    );
    assert.equal(changed.items[0].display, 'full');

    const shrunk = compareWithPrevious(
      report('2026-10-22', [item('M2', '🟡', ['가|0.03|0.05'])]),
      report('2026-10-21', [item('M2', '🟡', ['가|0.03|0.05', '나|0.1|0.05'])]),
    );
    assert.equal(shrunk.items[0].display, 'full');

    const first = compareWithPrevious(report('2026-10-22', [item('M2', '🟡', ['가|0.03|0.05'])]), null);
    assert.equal(first.items[0].display, 'full');
  });

  test('입력 보고를 바꾸지 않는다', () => {
    const today = report('2026-10-22', [item('O1', '🔴', ['A-1'])]);
    const snapshot = JSON.stringify(today);
    compareWithPrevious(today, null);
    assert.equal(JSON.stringify(today), snapshot);
  });
});

describe('보고 파일 기록', () => {
  function memoryFs(initial) {
    const norm = (path) => String(path).replace(/\\/g, '/');
    const files = {};
    for (const [path, text] of Object.entries(initial)) files[norm(path)] = text;
    const removed = [];
    return {
      files,
      removed,
      async mkdir() {},
      async readdir(dir) {
        const prefix = `${norm(dir)}/`;
        return Object.keys(files).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
      },
      async readFile(path) {
        if (!(norm(path) in files)) throw new Error('없음');
        return files[norm(path)];
      },
      async writeFile(path, text) {
        files[norm(path)] = text;
      },
      async rm(path) {
        removed.push(norm(path));
        delete files[norm(path)];
      },
    };
  }

  test('전날과 비교해 오늘 파일로 저장하고, 30일 지난 보고만 지운다', async () => {
    const fs = memoryFs({
      '/r/2026-09-22.json': '{}',
      '/r/2026-10-21.json': JSON.stringify(report('2026-10-21', [item('O1', '🔴', ['A-1'])])),
      '/r/readonly-key.json': 'do-not-touch',
    });
    const result = await recordReport({ fs, reportsDir: '/r', report: report('2026-10-22', [item('O1', '🔴', ['A-1'])]) });
    assert.equal(result.report.items[0].entries[0].since, 'continuing');
    assert.deepEqual(JSON.parse(fs.files['/r/2026-10-22.json']), result.report);
    assert.deepEqual(result.removed, ['2026-09-22.json']);
    assert.deepEqual(fs.removed, ['/r/2026-09-22.json']);
    assert.equal(fs.files['/r/readonly-key.json'], 'do-not-touch');
  });

  test('전날 파일이 깨져 있으면 비교 없이(모두 new) 저장한다', async () => {
    const fs = memoryFs({ '/r/2026-10-21.json': '{깨짐' });
    const result = await recordReport({ fs, reportsDir: '/r', report: report('2026-10-22', [item('O1', '🔴', ['A-1'])]) });
    assert.equal(result.report.items[0].entries[0].since, 'new');
    assert.equal(result.report.comparison.previousDate, null);
  });

  test('같은 날 다시 돌리면 오늘 파일을 덮어쓰고, 비교는 그 앞 날짜와 한다', async () => {
    const fs = memoryFs({
      '/r/2026-10-20.json': JSON.stringify(report('2026-10-20', [item('O1', '🔴', ['A-1'])])),
      '/r/2026-10-22.json': JSON.stringify(report('2026-10-22', [item('O1', '🔴', ['Z-9'])])),
    });
    const result = await recordReport({ fs, reportsDir: '/r', report: report('2026-10-22', [item('O1', '🔴', ['A-1'])]) });
    assert.equal(result.report.comparison.previousDate, '2026-10-20');
    assert.equal(result.report.items[0].entries[0].since, 'continuing');
    assert.equal(JSON.parse(fs.files['/r/2026-10-22.json']).items[0].entries[0].key, 'A-1');
  });
});

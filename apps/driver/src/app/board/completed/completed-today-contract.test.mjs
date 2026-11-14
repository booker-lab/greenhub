import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 오늘 완료 내역·사진 다시 보기 화면(board/completed)의 소스 계약.
// 권한 상실·사용자 전환 때 보호 데이터(완료 내역·사진)를 즉시 지우는지, 사진 창이 매번 주소를 새로 받고
// referrer 없이 띄우는지, 들어오는 길(작업 보드 진행 줄·내 정보)이 있는지 확인한다.
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const clientSource = await read('./_client.tsx');
const pageSource = await read('./page.tsx');
const boardSource = await read('../_client.tsx');
const profileSource = await read('../../profile/page.tsx');

function sliceBetween(source, start, end) {
  const at = source.indexOf(start);
  assert.ok(at !== -1, `${start}를 찾지 못했다`);
  const endAt = source.indexOf(end, at + start.length);
  assert.ok(endAt !== -1, `${end}를 찾지 못했다`);
  return source.slice(at, endAt);
}

test('페이지는 클라이언트 화면 하나를 그린다', () => {
  assert.match(pageSource, /import CompletedTodayClient from '\.\/_client';/);
  assert.match(pageSource, /return <CompletedTodayClient \/>;/);
});

test('완료 내역은 apiRead로 읽고 형식이 어긋나면 조회 실패로 다룬다', () => {
  assert.match(
    clientSource,
    /apiRead\('\/driver\/completed-today', token, \{ signal: controller\.signal \}\)/,
  );
  assert.match(
    clientSource,
    /toDriverListReadError\(response\.status, '완료 내역을 불러오지 못했어요'\)/,
  );
  assert.match(
    clientSource,
    /const parsed = readDriverCompletedToday\(await response\.json\(\)\);/,
  );
  assert.match(clientSource, /if \(!parsed\) throw new Error/);
});

test('권한 상실은 완료 내역·성공 기록·사진을 즉시 지우고 조회 순번을 무효화한다', () => {
  const block = sliceBetween(clientSource, 'const loseAuthority = () => {', '};');
  for (const pattern of [
    /requestIdRef\.current \+= 1;/,
    /hasSuccessfulReadRef\.current = false;/,
    /setHasSuccessfulRead\(false\);/,
    /setOrders\(\[\]\);/,
    /closeViewer\(\);/,
    /setAuthRequired\(true\);/,
  ]) {
    assert.match(block, pattern);
  }
  const closeBlock = sliceBetween(clientSource, 'const closeViewer = () => {', '};');
  assert.match(closeBlock, /photoSeqRef\.current \+= 1;/);
  assert.match(closeBlock, /photoAbortRef\.current\?\.abort\(\);/);
  assert.match(closeBlock, /setViewer\(null\);/);
});

test('목록 조회의 401·403은 권한 상실로 수렴하고 이전 목록을 남기지 않는다', () => {
  const block = sliceBetween(clientSource, '.catch((cause: unknown) => {', '.finally(');
  assert.match(block, /if \(kind === 'AUTH_ERROR'\) \{[\s\S]*?loseAuthority\(\);\s*return;/);
  // 일시 실패만 이전 성공이 있을 때 목록을 남긴다.
  assert.match(block, /shouldPreserveDriverListOnReadError\(kind, hasSuccessfulReadRef\.current\)/);
  assert.match(block, /else \{\s*setOrders\(\[\]\);/);
});

test('토큰이 없으면 0건 성공으로 보이지 않고 권한 상실로 수렴한다', () => {
  const block = sliceBetween(clientSource, 'if (!token) {', 'return;');
  assert.match(block, /loseAuthority\(\);/);
});

test('사용자·역할·토큰이 바뀌면 새 조회 전에 이전 내역·사진을 버린다', () => {
  assert.match(
    clientSource,
    /const nextScope = buildDriverListScope\(\{\s*userId: session\?\.user\.id,\s*role: session\?\.user\.role,\s*token,\s*\}\);/,
  );
  const block = sliceBetween(clientSource, 'if (listScopeRef.current !== nextScope) {', '}\n');
  for (const pattern of [
    /requestIdRef\.current \+= 1;/,
    /listScopeRef\.current = nextScope;/,
    /hasSuccessfulReadRef\.current = false;/,
    /setOrders\(\[\]\);/,
    /closeViewer\(\);/,
  ]) {
    assert.match(block, pattern);
  }
  assert.match(
    clientSource,
    /\}, \[session\?\.user\.id, session\?\.user\.role, session\?\.user\.accessToken, sessionStatus, reloadKey\]\);/,
  );
});

test('오래된 목록 응답은 순번 가드로 화면에 쓰지 않는다', () => {
  assert.match(
    clientSource,
    /const isCurrent = \(\) => active && requestId === requestIdRef\.current;/,
  );
  const success = sliceBetween(clientSource, '.then((nextOrders) => {', 'setOrders(nextOrders);');
  assert.match(success, /if \(!isCurrent\(\)\) return;/);
});

test('사진은 누를 때마다 주소를 새로 받고, 사진 보는 중 401·403이면 사진과 목록을 지운다', () => {
  const block = sliceBetween(clientSource, 'async function loadPhoto(', '\n  }\n');
  assert.match(
    block,
    /apiRead\(\s*`\/driver\/completed-today\/\$\{encodeURIComponent\(order\.id\)\}\/photo`,/,
  );
  assert.match(block, /photoSeqRef\.current \+= 1;/);
  assert.match(
    block,
    /mountedRef\.current && seq === photoSeqRef\.current && liveScopeRef\.current === startScope/,
  );
  assert.match(block, /if \(kind === 'AUTH_ERROR'\) \{[\s\S]*?loseAuthority\(\);\s*return;/);
  assert.match(block, /show\(kind === 'MISSING' \? 'missing' : 'error'\);/);
  // 사진 주소는 기억해 두지 않는다(창을 열 때마다 조회).
  assert.doesNotMatch(clientSource, /photoCache|urlCache/);
  assert.match(clientSource, /onOpenPhoto=\{\(\) => void loadPhoto\(order, false\)\}/);
});

test('이미지 로드 실패는 주소를 한 번만 다시 받고, 그다음은 실패 안내다', () => {
  const block = sliceBetween(clientSource, 'const handleImageError = () => {', '\n  };');
  assert.match(
    block,
    /if \(!viewer\.refetched\) \{\s*void loadPhoto\(viewer\.order, true\);\s*return;\s*\}/,
  );
  assert.match(block, /phase: 'error'/);
  assert.match(clientSource, /사진을 불러오지 못했어요/);
});

test('사진은 next/image가 아닌 img로 referrer 없이 전체 화면 창에 띄운다', () => {
  assert.doesNotMatch(clientSource, /from 'next\/image'/);
  const imgAt = clientSource.indexOf('<img');
  assert.ok(imgAt !== -1, 'img 요소가 있어야 한다');
  const img = clientSource.slice(imgAt, clientSource.indexOf('/>', imgAt));
  assert.match(img, /referrerPolicy="no-referrer"/);
  assert.match(img, /onError=\{onImageError\}/);
  assert.match(clientSource, /className="fixed inset-0 z-\[200\] flex flex-col/);
  assert.match(clientSource, /<DialogClose\s+aria-label="닫기"/);
});

test('사진이 없는 행은 버튼 없이 "사진이 없어요"를 쓴다', () => {
  assert.match(
    clientSource,
    /\{order\.hasPhoto \? \([\s\S]*?사진 보기[\s\S]*?\) : \([\s\S]*?사진이 없어요[\s\S]*?\)\}/,
  );
});

test('머리·빈 화면·오류 문구와 손님 정보 미노출', () => {
  assert.match(clientSource, /`오늘 완료 \$\{orders\.length\}곳`/);
  assert.match(clientSource, /오늘 마친 배송이 없어요/);
  assert.match(clientSource, /다시 시도/);
  assert.match(clientSource, /\(이전 목록 표시 중\)/);
  assert.match(clientSource, /로그인이 끝났어요\. 다시 로그인해 주세요\./);
  assert.doesNotMatch(clientSource, /buyerName|buyerPhone|받는 분/);
  // 뒤로가기는 상세와 같은 판정(앱 안 기록이 없으면 작업 보드로 바꿔 보낸다)이다.
  assert.match(
    clientSource,
    /resolveDriverDetailBackAction\(readDriverDetailBackContext\(window\)\) === 'back'/,
  );
  assert.match(clientSource, /router\.replace\('\/board'\);/);
});

test('작업 보드 진행 줄의 "오늘 완료 n곳"은 1곳 이상일 때만 완료 내역 링크다', () => {
  const at = boardSource.indexOf('{completedToday !== null && completedToday > 0 && (');
  assert.ok(at !== -1, '1곳 이상일 때만 링크를 그려야 한다');
  const block = boardSource.slice(at, boardSource.indexOf('</Link>', at));
  assert.match(block, /<Link\s+href="\/board\/completed"/);
  assert.match(block, /오늘 완료 \{completedToday\}곳/);
  // 0곳은 링크 없이 글자만 둔다. 항목마다 nowrap으로 묶어 항목 중간에서 줄을 바꾸지 않는다(S-07).
  assert.match(
    boardSource,
    /\{completedToday === 0 && \(\s*<>\s*\{' · '\}\s*<span style=\{progressItem\}>오늘 완료 0곳<\/span>\s*<\/>\s*\)\}/,
  );
  assert.equal(boardSource.match(/href="\/board\/completed"/g)?.length, 1);
});

test('내 정보에는 오늘 완료 내역으로 가는 줄이 하나 있다', () => {
  assert.equal(profileSource.match(/href="\/board\/completed"/g)?.length, 1);
  assert.match(profileSource, /오늘 완료 내역/);
});

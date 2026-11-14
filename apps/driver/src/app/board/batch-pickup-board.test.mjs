import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 한 번에 수거 화면 배선 계약. 판정·순서·재전송 금지는 _lib/batch-pickup.test.ts(vitest)가 순수 함수로 확인하고,
// 여기서는 작업 보드가 그 순수 함수와 기존 안전 규칙(ref 가드·scope 가드·인증 상실 정리)에 묶여 있는지 본다.
const boardSource = await readFile(new URL('./_client.tsx', import.meta.url), 'utf8');
const cardSource = await readFile(
  new URL('../../components/OrderCard.tsx', import.meta.url),
  'utf8',
);
const detailSource = await readFile(new URL('./[orderId]/page.tsx', import.meta.url), 'utf8');
const dialogSource = await readFile(
  new URL('./_components/BatchPickupConfirmDialog.tsx', import.meta.url),
  'utf8',
);

const startAt = boardSource.indexOf('async function startBatchPickup(');
const startBlock = boardSource.slice(startAt, boardSource.indexOf('\n  return (', startAt));

test('고를 수 있는 주문은 순수 판정(isBatchPickupSelectable)으로만 정한다', () => {
  // 이 기기 사진 대기열에 항목이 있는 주문도 같은 순수 판정이 뺀다(Y3).
  assert.match(
    boardSource,
    /const batchCandidates = preparing\.filter\(\(order\) =>\n\s*isBatchPickupSelectable\(order, \{ pendingPhotoOrderIds \}\),\n\s*\);/,
  );
  assert.match(
    boardSource,
    /const selectedOrders = batchCandidates\.filter\(\(order\) => selectedIds\.has\(order\.id\)\)/,
  );
  // 고르기 칸은 내 수거 묶음에만 둔다(맡을 수 있는 주문 묶음에는 batch를 넘기지 않는다).
  const availableAt = boardSource.indexOf('title="맡을 수 있는 주문"');
  const availableBlock = boardSource.slice(availableAt, boardSource.indexOf('/>', availableAt));
  assert.doesNotMatch(availableBlock, /batch=/);
  assert.match(boardSource, /checked: reason === null && batch\.selectedIds\.has\(order\.id\)/);
});

test('실행은 ref 가드로 한 번만 시작하고 runBatchPickup이 차례로 보낸다', () => {
  assert.ok(startAt !== -1);
  assert.match(startBlock, /if \(batchInFlightRef\.current\) return;/);
  assert.match(startBlock, /batchInFlightRef\.current = true;/);
  assert.match(startBlock, /await runBatchPickup\(\{/);
  assert.match(startBlock, /isCurrent: batchStillCurrent/);
  // 기존 상태 변경 경로와 본문을 그대로 쓴다.
  assert.match(
    startBlock,
    /`\/stores\/\$\{apiPathSegment\(order\.storeId\)\}\/orders\/\$\{apiPathSegment\(order\.id\)\}\/status`/,
  );
  assert.match(startBlock, /method: 'PATCH'/);
  assert.match(startBlock, /status: BATCH_PICKUP_TARGET_STATUS/);
  // 동시 전송(Promise.all)이나 자동 재전송 타이머가 없다.
  assert.doesNotMatch(startBlock, /Promise\.all|setTimeout|setInterval/);
});

test('화면 이탈·scope 전환이면 남은 요청을 보내지 않는다', () => {
  assert.match(
    startBlock,
    /mountedRef\.current && seq === batchSeqRef\.current && liveListScopeRef\.current === startScope/,
  );
  assert.match(boardSource, /mountedRef\.current = false;\s*batchSeqRef\.current \+= 1;/);
  // scope 전환·토큰 없음·목록 401·403은 모두 resetBatch로 실행 세대를 올린다.
  assert.equal((boardSource.match(/resetBatch\(\);/g) ?? []).length, 3);
  assert.match(boardSource, /const resetBatch = \(\) => \{\s*batchSeqRef\.current \+= 1;/);
});

test('인증 상실이면 보호 목록을 지우고 인증 오류 화면으로 가며, 끝나면 요약을 보이고 목록을 다시 읽는다', () => {
  const authAt = startBlock.indexOf("run.stoppedBy === 'AUTH_LOST'");
  assert.ok(authAt !== -1);
  const authBlock = startBlock.slice(authAt, startBlock.indexOf('return;', authAt));
  assert.match(authBlock, /requestIdRef\.current \+= 1;/);
  assert.match(authBlock, /hasSuccessfulReadRef\.current = false;/);
  assert.match(authBlock, /setPreparing\(\[\]\);/);
  assert.match(authBlock, /setDelivering\(\[\]\);/);
  assert.match(authBlock, /setAuthRequired\(true\);/);
  assert.match(startBlock, /setBatchSummary\(summarizeBatchPickup\(run\.results\)\);/);
  assert.match(startBlock, /retry\(\);/);
  assert.match(startBlock, /if \(!batchStillCurrent\(\)\) return;/);
});

test('목록이 최신이 아니면 실행·확인을 막고 확인 창은 주소·상품 수·알림을 보인다', () => {
  assert.match(
    boardSource,
    /const batchListFresh =\s*hasSuccessfulRead && !authRequired && error === null && !loading && !refreshing;/,
  );
  assert.match(startBlock, /!batchListFresh\) return;/);
  assert.match(boardSource, /buildBatchPickupConfirmContent\(selectedOrders\)/);
  assert.match(dialogSource, /content\.places\.map/);
  assert.match(dialogSource, /content\.itemsLine/);
  assert.match(dialogSource, /content\.notice/);
  assert.match(boardSource, /여러 주문 한 번에 배송 시작/);
  assert.match(boardSource, /`\$\{selectedOrders\.length\}곳 배송 시작`/);
});

test('수거 장소는 행·상세 모두 readPickupPlace로 그리고 상세에서는 배송지보다 위에 있다', () => {
  assert.match(cardSource, /readPickupPlace\(order\)/);
  assert.match(detailSource, /const pickup = readPickupPlace\(order\);/);
  const pickupAt = detailSource.indexOf('{pickup && (');
  const addressAt = detailSource.indexOf('{addressParts.detail ?? addressParts.base}');
  assert.ok(pickupAt !== -1 && addressAt !== -1 && pickupAt < addressAt);
  // 행의 지도 링크는 상세 링크 밖에 둔다(링크 안 링크 금지).
  const linkEnd = cardSource.indexOf('</Link>\n  );\n\n  if (!pickup) return row;');
  assert.ok(linkEnd !== -1);
  assert.ok(cardSource.indexOf('<PickupLine', linkEnd) > linkEnd);
});

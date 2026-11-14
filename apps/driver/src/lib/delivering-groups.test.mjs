import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { groupDeliveringOrders, takeDeliveringFirstScreen } from './delivering-groups.ts';

const boardSource = await readFile(new URL('../app/board/_client.tsx', import.meta.url), 'utf8');

const order = (id, status = 'DELIVERING') => ({ id, status });
const ids = (list) => list.map((o) => o.id);

test('보류가 아닌 첫 배송 중 주문이 다음 배송지이고 나머지 순서는 응답 순서 그대로다', () => {
  const groups = groupDeliveringOrders([
    order('h1', 'DELIVERY_HELD'),
    order('d1'),
    order('d2'),
    order('h2', 'DELIVERY_HELD'),
    order('d3'),
  ]);
  assert.equal(groups.next?.id, 'd1');
  assert.deepEqual(ids(groups.rest), ['d2', 'd3']);
  assert.deepEqual(ids(groups.held), ['h1', 'h2']);
});

test('보류만 있으면 다음 배송지가 없고 보류 묶음만 남는다', () => {
  const groups = groupDeliveringOrders([order('h1', 'DELIVERY_HELD')]);
  assert.equal(groups.next, undefined);
  assert.deepEqual(groups.rest, []);
  assert.deepEqual(ids(groups.held), ['h1']);
  const empty = groupDeliveringOrders([]);
  assert.equal(empty.next, undefined);
  assert.deepEqual([empty.rest, empty.held], [[], []]);
});

const many = (prefix, count, status) =>
  Array.from({ length: count }, (_, i) => order(`${prefix}-${i}`, status));

test('보류 묶음은 첫 화면 행 수를 배송할 주문과 따로 센다', () => {
  const groups = groupDeliveringOrders([...many('d', 8), ...many('h', 7, 'DELIVERY_HELD')]);
  const shown = takeDeliveringFirstScreen(groups, 5);
  assert.equal(shown.next?.id, 'd-0');
  // 보류 7행이 있어도 배송할 주문(다음 배송지 제외) 5행이 그대로 보인다.
  assert.equal(shown.rest.length, 5);
  assert.equal(shown.held.length, 5);
  // 가려진 행: 배송할 주문 7-5=2, 보류 7-5=2.
  assert.equal(shown.hidden, 4);
});

test('전체가 첫 화면 행 수 이하면 더 보기가 없다', () => {
  const shown = takeDeliveringFirstScreen(
    groupDeliveringOrders([order('d1'), order('d2'), order('h1', 'DELIVERY_HELD')]),
    5,
  );
  assert.equal(shown.hidden, 0);
  assert.deepEqual(ids(shown.rest), ['d2']);
  assert.deepEqual(ids(shown.held), ['h1']);
});

test('완료 사진이 대기열에 있는 배송 중 주문은 다음 배송지가 아니고 "사진 올리는 중" 묶음이다(S-02)', () => {
  const groups = groupDeliveringOrders(
    [order('d1'), order('d2'), order('h1', 'DELIVERY_HELD'), order('d3')],
    new Set(['d1', 'h1']),
  );
  // 방금 사진을 찍은 d1 대신 다음 주문이 다음 배송지다.
  assert.equal(groups.next?.id, 'd2');
  assert.deepEqual(ids(groups.rest), ['d3']);
  assert.deepEqual(ids(groups.photoPending), ['d1']);
  // 보류 주문은 대기열 ID와 겹쳐도 보류 묶음에 둔다.
  assert.deepEqual(ids(groups.held), ['h1']);

  const allPending = groupDeliveringOrders([order('d1'), order('d2')], new Set(['d1', 'd2']));
  assert.equal(allPending.next, undefined);
  assert.deepEqual(allPending.rest, []);
  assert.deepEqual(ids(allPending.photoPending), ['d1', 'd2']);

  // 대기열을 넘기지 않으면 예전과 같다.
  assert.deepEqual(ids(groupDeliveringOrders([order('d1')]).photoPending), []);
});

test('사진 올리는 중 묶음도 첫 화면 행 수를 따로 센다', () => {
  const pending = new Set(Array.from({ length: 7 }, (_, i) => `p-${i}`));
  const groups = groupDeliveringOrders([...many('d', 3), ...many('p', 7)], pending);
  const shown = takeDeliveringFirstScreen(groups, 5);
  assert.equal(shown.next?.id, 'd-0');
  assert.equal(shown.rest.length, 2);
  assert.equal(shown.photoPending.length, 5);
  assert.equal(shown.hidden, 2);
});

test('배송 중 탭은 보류·사진 대기가 있을 때 묶음 제목에 건수를 쓰고 묶음 판단을 순수 함수에 맡긴다', () => {
  assert.match(boardSource, /groupDeliveringOrders\(orders, pendingPhotoOrderIds\)/);
  assert.match(boardSource, /title="배송할 주문"/);
  assert.match(boardSource, /title="사진 올리는 중"/);
  assert.match(boardSource, /total=\{delivering\.photoPending\.length\}/);
  assert.match(boardSource, /title="보류"\s+total=\{delivering\.held\.length\}/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { groupPreparingOrders, takePreparingFirstScreen } from './preparing-groups.ts';

const boardSource = await readFile(new URL('../app/board/_client.tsx', import.meta.url), 'utf8');

test('assignedToMe로 내 수거와 맡을 수 있는 주문을 나누고 순서를 지킨다', () => {
  const orders = [
    { id: 'open-1', assignedToMe: false },
    { id: 'mine-1', assignedToMe: true },
    { id: 'open-2', assignedToMe: false },
    { id: 'mine-2', assignedToMe: true },
  ];
  const groups = groupPreparingOrders(orders);
  assert.deepEqual(
    groups?.mine.map((order) => order.id),
    ['mine-1', 'mine-2'],
  );
  assert.deepEqual(
    groups?.available.map((order) => order.id),
    ['open-1', 'open-2'],
  );
});

test('한쪽 묶음이 비어도 나눈다', () => {
  const groups = groupPreparingOrders([{ id: 'open', assignedToMe: false }]);
  assert.deepEqual(groups?.mine, []);
  assert.equal(groups?.available.length, 1);
});

test('배정 여부가 없는 이전 API 응답은 나누지 않는다(한 묶음 호환)', () => {
  assert.equal(groupPreparingOrders([{ id: 'a' }, { id: 'b' }]), null);
  // 하나라도 모르면 맡을 수 있다고 잘못 보이지 않도록 나누지 않는다.
  assert.equal(groupPreparingOrders([{ id: 'a', assignedToMe: true }, { id: 'b' }]), null);
  assert.equal(groupPreparingOrders([{ id: 'a', assignedToMe: 'true' }]), null);
  assert.equal(groupPreparingOrders([]), null);
});

test('작업 보드 수거 대기 탭은 묶음 제목에 건수를 쓰고 배송 중 탭은 나누지 않는다', () => {
  assert.match(
    boardSource,
    /const groups = tab === 'preparing' \? groupPreparingOrders\(orders\) : null;/,
  );
  assert.match(boardSource, /title="내 수거"/);
  assert.match(boardSource, /title="맡을 수 있는 주문"/);
  assert.match(boardSource, /\{total\}/);
});

const rows = (prefix, count) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` }));

test('첫 화면 5행은 두 묶음을 합쳐 세고 내 수거가 먼저 채운다', () => {
  const shown = takePreparingFirstScreen({ mine: rows('m', 3), available: rows('a', 6) }, 5);
  assert.equal(shown.mine.length, 3);
  assert.equal(shown.available.length, 2);
  assert.equal(shown.hidden, 4);
});

test('내 수거가 5행 이상이면 맡을 수 있는 주문은 첫 화면에 없고 더 보기에 센다', () => {
  const shown = takePreparingFirstScreen({ mine: rows('m', 7), available: rows('a', 2) }, 5);
  assert.equal(shown.mine.length, 5);
  assert.equal(shown.available.length, 0);
  assert.equal(shown.hidden, 4);
});

test('전체가 5행 이하면 더 보기가 없다', () => {
  const shown = takePreparingFirstScreen({ mine: rows('m', 2), available: rows('a', 3) }, 5);
  assert.equal(shown.hidden, 0);
  assert.equal(shown.mine.length + shown.available.length, 5);
});

test('수거 대기 점 띠는 내 수거만 그리고 탭 숫자는 전체 행 수를 쓴다', () => {
  assert.match(boardSource, /const myPreparing = preparingGroups \? preparingGroups\.mine : preparing/);
  assert.match(boardSource, /count: preparing\.length/);
});

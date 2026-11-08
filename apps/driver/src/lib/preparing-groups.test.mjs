import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { groupPreparingOrders } from './preparing-groups.ts';

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
  assert.match(boardSource, /\{orders\.length\}/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./order-status.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'order-status.ts',
}).outputText;
const statusModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  () => {
    throw new Error('예상하지 못한 모듈 요청');
  },
  statusModule,
  statusModule.exports,
);
const { ORDER_STATUS_LABELS, orderTimelineStepLabel } = statusModule.exports;

const mypageSource = await readFile(new URL('../app/mypage/_client.tsx', import.meta.url), 'utf8');
const detailSource = await readFile(
  new URL('../app/mypage/orders/[id]/_client.tsx', import.meta.url),
  'utf8',
);
const notificationsSource = await readFile(
  new URL('../app/mypage/notifications/_client.tsx', import.meta.url),
  'utf8',
);

test('주문 상태 이름표는 모든 주문 상태를 고객 말로 고정한다', () => {
  assert.deepEqual(ORDER_STATUS_LABELS, {
    PENDING: '결제 확인 중',
    RECRUITING: '모집 중',
    CONFIRMED: '주문 확정',
    ACCEPTED: '결제 완료',
    PREPARING: '상품 준비 중',
    DELIVERING: '배송 중',
    DELIVERY_HELD: '배송 보류',
    HUB_ARRIVED: '거점 도착',
    PICKED_UP: '픽업 완료',
    DELIVERED: '배송 완료',
    CANCELLED: '주문 취소',
    REVIEWED: '구매 확정',
    CLOSED_UNDELIVERED: '배송 종결',
  });
});

test('결제가 끝난 주문(ACCEPTED)은 알림 화면과 같은 이름으로 부른다', () => {
  assert.equal(ORDER_STATUS_LABELS.ACCEPTED, '결제 완료');
  assert.match(notificationsSource, /ORDER_ACCEPTED:\s*'결제 완료'/);
});

test('MY 주문 목록과 주문 상세는 같은 이름표 하나를 쓰고 따로 표를 두지 않는다', () => {
  for (const screen of [mypageSource, detailSource]) {
    assert.match(screen, /from '@\/lib\/order-status'/);
    assert.doesNotMatch(screen, /Partial<Record<OrderStatus, string>>\s*=\s*\{/);
    assert.doesNotMatch(screen, /ACCEPTED:\s*'/);
  }
});

test('배송 현황 첫 단계는 상태 이름이 아니라 단계 이름(주문 접수)으로 부른다', () => {
  assert.equal(orderTimelineStepLabel('ACCEPTED'), '주문 접수');
  assert.equal(orderTimelineStepLabel('PREPARING'), '상품 준비 중');
  assert.equal(orderTimelineStepLabel('DELIVERED'), '배송 완료');
  assert.match(detailSource, /labels=\{steps\.map\(orderTimelineStepLabel\)\}/);
});

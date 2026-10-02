import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panelSource = await readFile(new URL('./RoundPurchasePanel.tsx', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../page.tsx', import.meta.url), 'utf8');

test('회차 가격은 상품 원본 가격이 아니라 SaleRoundItem.roundPrice를 사용한다', () => {
  assert.match(panelSource, /item\.roundPrice\.toLocaleString\('ko-KR'\)/);
  assert.doesNotMatch(panelSource, /product\.price/);
});

test('주문 마감은 회차 schedule.orderCloseAt을 Asia\\/Seoul 기준 공통 표기로 보여준다', async () => {
  const labelSource = await readFile(
    new URL('../../../../lib/round-schedule-label.ts', import.meta.url),
    'utf8',
  );
  assert.match(panelSource, /formatOrderCloseLabel\(round\.schedule\.orderCloseAt\)/);
  assert.match(labelSource, /timeZone: 'Asia\/Seoul'/);
  assert.match(panelSource, /주문 마감/);
});

test('주문 시작 전 회차는 판매 예정 제목과 주문 시작 시각을 보여준다', () => {
  assert.match(panelSource, /round\.status === 'SCHEDULED'/);
  assert.match(panelSource, /판매 예정 회차/);
  assert.match(panelSource, /주문 시작/);
  assert.match(panelSource, /round\.schedule\.orderOpenAt/);
});

test('이천 직접배송과 화요일 배송 및 기상 연기 원칙을 명확히 고지한다', () => {
  assert.match(panelSource, /경기도 이천시 직접배송/);
  assert.match(panelSource, /화요일 오전 9시까지 문 앞 배송/);
  assert.match(panelSource, /기상 상황/);
  assert.match(panelSource, /재배송비\s+없이 새 배송 일정/);
});

test('청약철회 제한 조건과 계약 불이행 예외를 함께 고지한다', () => {
  assert.match(panelSource, /청약철회 제한/);
  assert.match(panelSource, /주문 마감 후/);
  assert.match(panelSource, /상품 가치가 현저히 감소/);
  assert.match(panelSource, /표시·광고 또는 계약 내용과 다르게 이행된 경우/);
});

test('현재와 마감 상태를 구분하고 구매 불가 상태를 구매 가능으로 표시하지 않는다', () => {
  assert.match(panelSource, /state === 'closed'/);
  assert.match(panelSource, /isPurchasable \? '구매 가능'/);
  assert.match(panelSource, /closed \? '판매 마감' : '판매 예정'/);
  assert.match(panelSource, /data-round-purchasable=\{isPurchasable\}/);
});

test('상품 상세은 Task 4.8이 검증한 회차 상품 구조를 패널에 그대로 전달한다', () => {
  assert.match(
    pageSource,
    /import RoundPurchasePanel(, \{ RoundPurchaseNotices \})? from '.\/_components\/RoundPurchasePanel'/,
  );
  assert.match(pageSource, /\{roundProduct && <RoundPurchaseNotices \/>\}/);
  assert.match(
    pageSource,
    /<RoundPurchasePanel\s+round=\{roundProduct\.round\}\s+item=\{roundProduct\.item\}\s+state=\{roundProduct\.state\}\s+isPurchasable=\{roundProduct\.isPurchasable\}\s+\/>/s,
  );
});

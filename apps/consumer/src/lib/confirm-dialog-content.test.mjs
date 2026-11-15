import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./confirm-dialog-content.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'confirm-dialog-content.ts',
}).outputText;
const contentModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  () => {
    throw new Error('예상하지 못한 모듈 요청');
  },
  contentModule,
  contentModule.exports,
);
const { addressDeleteConfirmContent, orderCancelConfirmContent, summarizeProductNames } =
  contentModule.exports;

const dialogSource = await readFile(
  new URL('../components/ConfirmDialog.tsx', import.meta.url),
  'utf8',
);
const orderSource = await readFile(
  new URL('../app/mypage/orders/[id]/_client.tsx', import.meta.url),
  'utf8',
);
const addressSource = await readFile(
  new URL('../app/mypage/addresses/_client.tsx', import.meta.url),
  'utf8',
);
const withdrawSource = await readFile(
  new URL('../app/mypage/withdraw/_client.tsx', import.meta.url),
  'utf8',
);

/** 확인창에 찍히는 글자를 한 줄로 모은다. */
function allText(content) {
  return [
    content.title,
    ...content.facts.flatMap((row) => [row.label, row.value]),
    ...content.flow.flatMap((row) => [row.label, row.value]),
    content.warning ?? '',
    content.confirmLabel,
  ].join(' | ');
}

const paidOrder = {
  orderNumber: '20261112-000012',
  isRoundOrder: true,
  paymentPending: false,
  totalAmount: 80000,
  productNames: ['미니 호접란', '몬스테라', '스투키'],
};

test('회차 주문 취소 확인창은 제목 = 동작 + 대상, 상품·환불 줄, 빨간 한 줄, 확정 문구를 만든다', () => {
  assert.deepEqual(orderCancelConfirmContent(paidOrder), {
    title: '주문 20261112-000012 취소',
    facts: [{ label: '상품', value: '미니 호접란 외 2개' }],
    flow: [{ label: '환불', value: '80,000원 · 결제한 수단' }],
    warning: '취소한 주문은 되살릴 수 없어요.',
    confirmLabel: '주문 취소하기',
  });
});

test('상품이 하나면 "외 n개"를 붙이지 않고, 이름이 없으면 상품 줄을 뺀다', () => {
  assert.equal(summarizeProductNames(['미니 호접란']), '미니 호접란');
  assert.equal(summarizeProductNames(['미니 호접란', '몬스테라']), '미니 호접란 외 1개');
  assert.equal(summarizeProductNames(['  ', null, '몬스테라', undefined, 3]), '몬스테라');
  assert.equal(summarizeProductNames([]), null);
  assert.equal(summarizeProductNames([null, '', '   ']), null);
  assert.deepEqual(
    orderCancelConfirmContent({ ...paidOrder, productNames: ['미니 호접란'] }).facts,
    [{ label: '상품', value: '미니 호접란' }],
  );
  assert.deepEqual(orderCancelConfirmContent({ ...paidOrder, productNames: [] }).facts, []);
});

test('결제를 마치지 않은 주문은 환불 줄 대신 "결제 전 주문이에요"를 쓴다', () => {
  const content = orderCancelConfirmContent({ ...paidOrder, paymentPending: true });
  assert.deepEqual(content.flow, [{ label: '결제', value: '결제 전 주문이에요' }]);
  assert.doesNotMatch(allText(content), /환불/);
  assert.equal(content.title, '주문 20261112-000012 취소');
  assert.equal(content.confirmLabel, '주문 취소하기');
});

test('7자리 금액은 쉼표로 끊어 쓰고, 읽을 수 없는 금액은 환불 줄을 뺀다', () => {
  assert.deepEqual(orderCancelConfirmContent({ ...paidOrder, totalAmount: 1234500 }).flow, [
    { label: '환불', value: '1,234,500원 · 결제한 수단' },
  ]);
  assert.deepEqual(orderCancelConfirmContent({ ...paidOrder, totalAmount: 9999999 }).flow, [
    { label: '환불', value: '9,999,999원 · 결제한 수단' },
  ]);
  for (const totalAmount of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, null, undefined, '80000']) {
    const content = orderCancelConfirmContent({ ...paidOrder, totalAmount });
    assert.deepEqual(content.flow, [], String(totalAmount));
    assert.doesNotMatch(allText(content), /NaN|null|undefined|Infinity/);
  }
});

test('주문번호를 읽지 못해도 null·undefined 글자를 제목에 쓰지 않는다', () => {
  for (const orderNumber of ['', '   ', null, undefined]) {
    const content = orderCancelConfirmContent({ ...paidOrder, orderNumber });
    assert.equal(content.title, '주문 취소');
    assert.doesNotMatch(allText(content), /null|undefined/);
  }
});

test('공동구매 참여 취소는 같은 틀에 기존 문구를 쓴다', () => {
  assert.deepEqual(orderCancelConfirmContent({ ...paidOrder, isRoundOrder: false }), {
    title: '공동구매 참여를 취소할까요?',
    facts: [],
    flow: [],
    warning: '취소하면 되돌릴 수 없어요.',
    confirmLabel: '참여 취소하기',
  });
});

test('배송지 삭제 확인창은 이름을 제목에, 전체 주소를 줄이지 않고 이름–값에 넣는다', () => {
  assert.deepEqual(
    addressDeleteConfirmContent({
      label: '집',
      address: '경기도 이천시 중리천로 1',
      addressDetail: '201호',
    }),
    {
      title: '배송지 집 삭제',
      facts: [{ label: '주소', value: '경기도 이천시 중리천로 1 201호' }],
      flow: [],
      warning: null,
      confirmLabel: '삭제하기',
    },
  );
});

test('30자 배송지 이름과 긴 주소도 자르지 않는다', () => {
  const label = '가'.repeat(30);
  const address = '경기도 이천시 부발읍 경충대로 2091번길 123-45 그린러브아파트';
  const addressDetail = '101동 1502호 (현관 비밀번호 없음, 경비실 옆 무인 택배함)';
  const content = addressDeleteConfirmContent({ label, address, addressDetail });
  assert.equal(content.title, `배송지 ${label} 삭제`);
  assert.equal(content.facts[0].value, `${address} ${addressDetail}`);
  assert.doesNotMatch(allText(content), /…|\.\.\./);
});

test('배송지 이름·주소가 비면 그 자리를 빼고 null 글자를 쓰지 않는다', () => {
  assert.deepEqual(addressDeleteConfirmContent({ label: ' ', address: '', addressDetail: null }), {
    title: '배송지 삭제',
    facts: [],
    flow: [],
    warning: null,
    confirmLabel: '삭제하기',
  });
  const noDetail = addressDeleteConfirmContent({ label: '회사', address: '서울 강남구 테헤란로 152' });
  assert.deepEqual(noDetail.facts, [{ label: '주소', value: '서울 강남구 테헤란로 152' }]);
  assert.doesNotMatch(allText(noDetail), /null|undefined/);
});

test('확인창 틀은 닫기(외곽선) + 초록 확정 하나이고 처리 중에는 닫히지 않는다', () => {
  // 상태는 boolean 여러 개가 아니라 유니온 하나다.
  assert.match(dialogSource, /export type ConfirmDialogState = 'closed' \| 'open' \| 'submitting';/);
  assert.match(dialogSource, /open=\{state !== 'closed'\}/);
  // 처리 중에는 Esc·바깥 누름(onOpenChange)과 닫기 버튼으로 닫히지 않는다.
  assert.match(dialogSource, /if \(!open && state === 'open'\) onClose\(\);/);
  assert.match(dialogSource, /disabled=\{submitting\}/);
  assert.match(dialogSource, /if \(state === 'open'\) onConfirm\(\);/);
  // 버튼은 닫기(plain) + 기본(초록) 확정뿐이다. 빨간 버튼·체크박스·오른쪽 위 X는 없다.
  assert.equal(dialogSource.match(/<Button\b/g)?.length, 1);
  assert.equal(dialogSource.match(/<LoadingButton\b/g)?.length, 1);
  assert.match(dialogSource, /variant="plain"[\s\S]*?닫기/);
  assert.doesNotMatch(dialogSource, /variant="(destructive|outline-destructive)"|type="checkbox"|Checkbox/);
  assert.doesNotMatch(dialogSource, /DialogClose|CloseIcon/);
  // 첫 초점은 닫기 버튼이다.
  assert.match(dialogSource, /initialFocus=\{closeRef\}/);
  // 새 직접 색 값을 쓰지 않는다(그림자는 공용 DialogContent와 같은 값).
  assert.doesNotMatch(dialogSource, /#[0-9a-fA-F]{3,8}\b/);
});

test('주문 취소·배송지 삭제·탈퇴 화면은 브라우저 기본 확인창과 빨간 버튼을 쓰지 않는다', () => {
  // 빨강 안내 상자(Alert)는 문제 상태 표시라 그대로다. 버튼만 본다.
  const redButton =
    /<(?:Ui)?(?:Loading)?Button\b[^>]*variant="(?:destructive|outline-destructive)"/;
  for (const [name, text] of [
    ['주문 상세', orderSource],
    ['배송지', addressSource],
    ['회원 탈퇴', withdrawSource],
  ]) {
    assert.doesNotMatch(text, /\bconfirm\(/, name);
  }
  assert.doesNotMatch(addressSource, redButton);
  assert.doesNotMatch(withdrawSource, redButton);
  // 주문 상세는 취소 영역만 본다(배송 보류 주문의 재배송비 결제 버튼은 이 변경의 대상이 아니다).
  const cancelCommand = orderSource.slice(
    orderSource.indexOf('{showCancelCommand && ('),
    orderSource.indexOf('{showCancelReconcileWarning && ('),
  );
  assert.ok(cancelCommand.includes('onClick={openCancelDialog}'));
  assert.doesNotMatch(cancelCommand, redButton);
  assert.match(orderSource, /<ConfirmDialog\s+state=\{cancelDialog\}/);
  assert.match(addressSource, /<ConfirmDialog\s+state=\{deleteDialog\.state\}/);
  // 여는 버튼은 이름을 그대로 두고 검정 글자 외곽선(plain)이다.
  assert.match(
    orderSource,
    /variant="plain"\s+loading=\{cancelBusy\}[\s\S]*?onClick=\{openCancelDialog\}\s*>\s*\{detail\.isRoundOrder \? '주문 취소' : '공동구매 참여 취소'\}/,
  );
  assert.match(addressSource, /variant="plain" onClick=\{onDelete\}>\s*삭제\s*</);
  // 탈퇴는 화면의 체크박스가 확인 단계다. 창을 더하지 않고 버튼만 초록(기본 변형)이다.
  assert.doesNotMatch(withdrawSource, /ConfirmDialog/);
  const withdrawButton = withdrawSource.slice(
    withdrawSource.indexOf('<LoadingButton'),
    withdrawSource.indexOf('</LoadingButton>'),
  );
  assert.doesNotMatch(withdrawButton, /variant=/);
  assert.match(withdrawButton, /disabled=\{!confirmed\}/);
  assert.match(withdrawButton, /data-testid="withdraw-submit"/);
});

test('취소·삭제 요청은 확인창의 확정에서만 나가고 본문은 그대로다', () => {
  const open = orderSource.slice(
    orderSource.indexOf('function openCancelDialog'),
    orderSource.indexOf('async function handleCancel'),
  );
  assert.doesNotMatch(open, /fetch\(/);
  assert.match(open, /setCancelDialog\('open'\);/);
  const handler = orderSource.slice(
    orderSource.indexOf('async function handleCancel'),
    orderSource.indexOf('async function handleRedeliveryPayment'),
  );
  assert.match(handler, /setCancelDialog\('submitting'\);/);
  assert.match(handler, /method: 'PATCH'/);
  assert.match(handler, /body: JSON\.stringify\(\{ reason: '고객 요청' \}\)/);
  assert.match(handler, /finally \{\s*setCancelDialog\('closed'\);\s*\}/);
  assert.match(orderSource, /onConfirm=\{handleCancel\}/);

  const remove = addressSource.slice(
    addressSource.indexOf('async function handleDelete'),
    addressSource.indexOf('async function handleSetDefault'),
  );
  assert.match(remove, /if \(deleteDialog\.state !== 'open'\) return;/);
  assert.match(remove, /setDeleteDialog\(\{ state: 'submitting', addr \}\);/);
  assert.match(remove, /await deleteAddress\(addr\.id\);/);
  assert.match(remove, /'삭제 중 오류가 발생했습니다\.'/);
  assert.match(remove, /finally \{\s*setDeleteDialog\(\{ state: 'closed' \}\);\s*\}/);
});

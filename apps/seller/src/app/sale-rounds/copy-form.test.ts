import type { SetStateAction } from 'react';
import { describe, expect, it } from 'vitest';
import { copyFormFieldChange } from './copy-form';

interface Form {
  name: string;
  orderOpenAt: string;
  orderCloseAt: string;
  sourceId: string;
}

const FORM: Form = {
  name: '10월 6일 배송 회차 복사',
  orderOpenAt: '2026-10-08T10:00',
  orderCloseAt: '2026-10-12T00:00',
  sourceId: 'round-open',
};

function run(field: 'name' | 'orderOpenAt' | 'orderCloseAt', value: string, current: Form | null) {
  const queued: SetStateAction<Form | null>[] = [];
  const handler = copyFormFieldChange<Form>((action) => queued.push(action), field);
  const event: { currentTarget: { value: string } | null } = { currentTarget: { value } };
  handler(event as { currentTarget: { value: string } });
  // React는 핸들러가 끝나면 event.currentTarget을 null로 되돌린다. 갱신 함수는 그 뒤에 돈다.
  event.currentTarget = null;
  return queued.reduce<Form | null>(
    (state, action) => (typeof action === 'function' ? action(state) : action),
    current,
  );
}

describe('copyFormFieldChange', () => {
  it('핸들러가 끝난 뒤 갱신 함수가 돌아도 입력한 값으로 바꾼다', () => {
    expect(run('name', '복사 시험 회차', FORM)).toEqual({ ...FORM, name: '복사 시험 회차' });
    expect(run('orderOpenAt', '2026-10-09T10:00', FORM)).toEqual({
      ...FORM,
      orderOpenAt: '2026-10-09T10:00',
    });
    expect(run('orderCloseAt', '2026-10-13T00:00', FORM)).toEqual({
      ...FORM,
      orderCloseAt: '2026-10-13T00:00',
    });
  });

  it('모달이 닫혀 양식이 없으면 그대로 둔다', () => {
    expect(run('name', '복사 시험 회차', null)).toBeNull();
  });
});

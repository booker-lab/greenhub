import type { Dispatch, SetStateAction } from 'react';

export type CopyFormField = 'name' | 'orderOpenAt' | 'orderCloseAt';

/** 이전 회차 복사 모달 입력칸의 onChange. */
export function copyFormFieldChange<T extends Record<CopyFormField, string>>(
  setForm: Dispatch<SetStateAction<T | null>>,
  field: CopyFormField,
) {
  return (event: { currentTarget: { value: string } }) => {
    // React는 핸들러가 끝나면 event.currentTarget을 null로 되돌리고, 갱신 함수는 그 뒤(렌더 때)에 돌 수 있다.
    // 갱신 함수 안에서 읽으면 "Cannot read properties of null (reading 'value')"가 나므로 값을 먼저 읽는다.
    const value = event.currentTarget.value;
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };
}

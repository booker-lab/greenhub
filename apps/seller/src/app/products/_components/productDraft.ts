import type { ProductFormData } from './productForm.types';

/** 입력이 멈춘 뒤 이만큼 지나면 신규 등록 폼을 임시저장한다. */
export const DRAFT_AUTOSAVE_DELAY_MS = 800;

/** 임시저장에 넣는 값. 다시 열면 이어서 쓰도록 현재 단계(`_step`)를 함께 담는다. */
export function draftSnapshot(form: ProductFormData, step: number): string {
  return JSON.stringify({ ...form, _step: step });
}

/**
 * 자동 임시저장 여부. 신규 등록 모드에서만 저장하고, 아무것도 쓰지 않은 처음 상태
 * (1단계 + 빈 폼)는 저장하지 않는다. 그래야 '초기화'나 첫 진입 직후 빈 임시저장이 다시 생기지 않는다.
 */
export function shouldAutoSaveDraft({
  mode,
  form,
  step,
  pristine,
}: {
  mode: 'create' | 'edit';
  form: ProductFormData;
  step: number;
  pristine: ProductFormData;
}): boolean {
  if (mode !== 'create') return false;
  return !(step === 1 && JSON.stringify(form) === JSON.stringify(pristine));
}

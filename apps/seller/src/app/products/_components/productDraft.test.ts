import { describe, expect, it } from 'vitest';
import { DRAFT_AUTOSAVE_DELAY_MS, draftSnapshot, shouldAutoSaveDraft } from './productDraft';
import type { ProductFormData } from './productForm.types';

// productForm.types의 defaultForm은 '@/' 경로를 불러와 vitest에서 풀리지 않으므로 판정에 필요한 모양만 만든다.
const defaultForm = () =>
  ({ name: '', price: '', selection: { colors: [] } }) as unknown as ProductFormData;

describe('shouldAutoSaveDraft', () => {
  it('신규 등록에서 입력이 바뀌면 1단계라도 자동 저장한다', () => {
    const pristine = defaultForm();
    const form = { ...defaultForm(), name: '장미' };
    expect(shouldAutoSaveDraft({ mode: 'create', form, step: 1, pristine })).toBe(true);
  });

  it('신규 등록이라도 아무것도 쓰지 않은 처음 상태는 저장하지 않는다', () => {
    expect(
      shouldAutoSaveDraft({
        mode: 'create',
        form: defaultForm(),
        step: 1,
        pristine: defaultForm(),
      }),
    ).toBe(false);
  });

  it('단계를 넘겼으면 폼이 비어 있어도 단계를 남기려고 저장한다', () => {
    expect(
      shouldAutoSaveDraft({
        mode: 'create',
        form: defaultForm(),
        step: 2,
        pristine: defaultForm(),
      }),
    ).toBe(true);
  });

  it('수정 모드는 자동 저장하지 않는다', () => {
    const form = { ...defaultForm(), name: '장미' };
    expect(shouldAutoSaveDraft({ mode: 'edit', form, step: 2, pristine: defaultForm() })).toBe(
      false,
    );
  });
});

describe('draftSnapshot', () => {
  it('현재 단계를 _step으로 함께 담는다', () => {
    const saved = JSON.parse(draftSnapshot({ ...defaultForm(), name: '장미' }, 3));
    expect(saved.name).toBe('장미');
    expect(saved._step).toBe(3);
  });

  it('디바운스 간격은 800ms다', () => {
    expect(DRAFT_AUTOSAVE_DELAY_MS).toBe(800);
  });
});

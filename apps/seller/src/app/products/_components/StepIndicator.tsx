'use client';

import { STEP_LABELS } from './productForm.types';

// ① 외형 유지(UI 교체 P2b): Mantine Container(sm = 720px, 좌우 16)·Group(gap 0)·Text(p, 여백 0) 값.

/** ProductForm 5단계 진행 인디케이터. */
export function StepIndicator({ step }: { step: number }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border)',
        padding: '8px 16px',
      }}
    >
      <div className="mx-auto max-w-[720px] px-4">
        {/* 두 줄 이름이 있어도 동그라미가 같은 높이에 오도록 위쪽 정렬 */}
        <div className="flex flex-row flex-nowrap items-start justify-start gap-0">
          {STEP_LABELS.map((label, i) => {
            const s = i + 1;
            const active = s === step;
            const done = s < step;
            return (
              <div key={s} style={{ flex: 1, textAlign: 'center', padding: '4px 2px' }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    margin: '0 auto 2px',
                    backgroundColor: active
                      ? 'var(--color-primary)'
                      : done
                        ? 'var(--color-primary-surface)'
                        : 'var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-medium)',
                    color: active
                      ? 'white'
                      : done
                        ? 'var(--color-primary-dark)'
                        : 'var(--color-text-disabled)',
                  }}
                >
                  {done ? '✓' : s}
                </div>
                <p
                  className="m-0 p-0 text-base font-normal"
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    lineHeight: 1.35,
                    wordBreak: 'keep-all',
                    color: active ? 'var(--color-primary-dark)' : 'var(--color-text-disabled)',
                    fontWeight: active ? 'var(--fw-bold)' : 400,
                  }}
                >
                  {label}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

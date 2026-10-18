'use client';

import { PRODUCT_REQUEST_MAX_LENGTH } from '@greenhub/shared';
import { useState } from 'react';
import { createProductRequest } from '@/lib/benchmark-api';

// 찾는 상품 제안(product-request). 꽃 이름만 받고 개인정보는 받지 않는다.
export default function ProductRequestBox({
  storeId,
  initialText = '',
}: {
  storeId: string | null;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  if (!storeId) return null;
  return (
    <section
      aria-labelledby="product-request-title"
      style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)', padding: 16 }}
    >
      <h2 id="product-request-title" style={{ fontSize: 'var(--font-size-md)', fontWeight: 800, margin: 0 }}>
        찾으시는 꽃이 없나요?
      </h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '4px 0 12px' }}>
        꽃 이름을 남겨 주시면 다음 회차를 준비할 때 참고할게요. 이름이나 연락처는 받지 않아요.
      </p>
      {state === 'done' ? (
        <p role="status" style={{ color: 'var(--color-primary-dark)', fontSize: 'var(--font-size-sm)', fontWeight: 700, margin: 0 }}>
          고맙습니다. 남겨 주신 꽃을 살펴볼게요.
        </p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!text.trim()) return;
            setState('sending');
            try {
              await createProductRequest(storeId, text.trim());
              setState('done');
            } catch {
              setState('error');
            }
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input
            value={text}
            maxLength={PRODUCT_REQUEST_MAX_LENGTH}
            onChange={(event) => setText(event.target.value)}
            placeholder="예) 흰 덴드로비움"
            aria-label="찾는 꽃 이름"
            style={{
              border: 'var(--border)',
              borderRadius: 'var(--radius-full)',
              flex: 1,
              fontSize: 'var(--font-size-md)',
              minHeight: 'var(--touch-target)',
              minWidth: 0,
              padding: '0 16px',
            }}
          />
          <button
            type="submit"
            disabled={state === 'sending' || !text.trim()}
            style={{
              background: 'var(--color-primary)',
              border: 0,
              borderRadius: 'var(--radius-full)',
              color: 'var(--color-bg)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-md)',
              fontWeight: 800,
              minHeight: 'var(--touch-target)',
              padding: '0 18px',
            }}
          >
            남기기
          </button>
        </form>
      )}
      {state === 'error' && (
        <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', margin: '8px 0 0' }}>
          보내지 못했어요. 잠시 뒤에 다시 남겨 주세요.
        </p>
      )}
    </section>
  );
}

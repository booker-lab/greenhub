'use client';

import { Button } from '@greenhub/ui/components/button';
import { Loader } from '@greenhub/ui/components/loader';
import type { CSSProperties } from 'react';

// ① 외형 유지(UI 교체 P2b): Mantine Button variant="light" color="gray" radius="md" loading.
// loading이면 Mantine처럼 글자를 감추고 가운데에 Loader(버튼 높이 ÷ 1.8 = 20px, 글자색)를 두며 누를 수 없다.
export function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button
      variant="secondary"
      className="rounded-[8px] data-loading:cursor-not-allowed"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
    >
      {loading ? (
        <>
          <span className="invisible">새로고침</span>
          <Loader
            color="currentColor"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ '--loader-size': '20px', '--loader-border': '2.5px' } as CSSProperties}
          />
        </>
      ) : (
        '새로고침'
      )}
    </Button>
  );
}

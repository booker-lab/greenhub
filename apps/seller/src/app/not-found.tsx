import { SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '페이지를 찾을 수 없어요',
};

// 없는 주소나 꺼진 기능 화면으로 들어왔을 때 Next 기본(영어) 404 대신 보여주는 안내 화면.
// 소비자 앱(#568)과 같은 모양이다.
// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px·좌우 md)·py 64, Stack(가운데·gap md),
// Title order 1(줄 높이 1.3·800), Text(m-0 p-0)와 같은 값.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-16">
      <div className="flex flex-col items-center justify-start gap-4">
        <div
          aria-hidden
          style={{
            alignItems: 'center',
            background: 'var(--color-surface-muted)',
            borderRadius: 'var(--radius-full)',
            color: 'var(--color-text-secondary)',
            display: 'flex',
            height: 72,
            justifyContent: 'center',
            width: 72,
          }}
        >
          <SearchX size={32} strokeWidth={1.8} />
        </div>
        <h1
          className="m-0 text-center leading-[1.3] font-extrabold"
          style={{
            color: 'var(--color-text)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          페이지를 찾을 수 없어요
        </h1>
        <p
          className="m-0 p-0 text-center text-base"
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--font-size-sm)',
            wordBreak: 'keep-all',
          }}
        >
          주소가 바뀌었거나 지금은 쓰지 않는 화면이에요.
          <br />
          홈에서 다시 찾아 주세요.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 'var(--touch-target)',
            padding: '0 24px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-bg)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            textDecoration: 'none',
          }}
        >
          홈으로 가기
        </Link>
      </div>
    </div>
  );
}

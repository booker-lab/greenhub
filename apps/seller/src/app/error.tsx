'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';

const actionStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--touch-target)',
  padding: '0 24px',
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-bold)',
  textDecoration: 'none',
  cursor: 'pointer',
} as const;

// 화면을 그리다 런타임 오류가 났을 때 Next 기본(영어) 오류 화면 대신 보여주는 안내 화면.
// 소비자 앱(#568)과 같은 모양이다. 오류 메시지·스택은 보이지 않게 하고,
// 서버 기록과 맞춰볼 digest만 작게 보여준다.
// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px·좌우 md)·py 64, Stack(가운데·gap md,
// 버튼 묶음 gap xs·최대 280px), Title order 1(줄 높이 1.3), Text(m-0 p-0)와 같은 값.
const TEXT = 'm-0 p-0 text-center text-base';
const mutedSm = {
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
} as const;

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-16">
      <title>잠시 문제가 생겼어요</title>
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
          <TriangleAlert size={32} strokeWidth={1.8} />
        </div>
        <h1
          className="m-0 text-center leading-[1.3] font-extrabold"
          style={{
            color: 'var(--color-text)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          잠시 문제가 생겼어요
        </h1>
        <p className={TEXT} style={{ ...mutedSm, wordBreak: 'keep-all' }}>
          화면을 불러오는 중에 문제가 생겼어요.
          <br />
          잠시 뒤 다시 시도해 주세요. 입력하던 내용은 저장되지 않았을 수 있어요.
        </p>
        <div className="flex w-full max-w-[280px] flex-col items-stretch justify-start gap-2.5">
          {/* retry는 서버 데이터를 다시 받아 화면을 다시 그린다(reset은 다시 그리기만 한다) */}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              ...actionStyle,
              border: 'none',
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-bg)',
            }}
          >
            다시 시도
          </button>
          <Link
            href="/"
            style={{
              ...actionStyle,
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
          >
            홈으로 가기
          </Link>
        </div>
        <p className={TEXT} style={{ ...mutedSm, wordBreak: 'keep-all' }}>
          계속 같은 화면이 나오면 아래 오류 번호와 함께 운영팀에 알려 주세요.
        </p>
        {error.digest ? (
          <p className={TEXT} style={mutedSm}>
            오류 번호 {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}

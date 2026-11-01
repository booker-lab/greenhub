'use client';

// ① 외형 유지(UI 교체 P4): Mantine Group(사이 띄움, 위 정렬, gap xs = 10px, 줄바꿈)·Text(p, 여백 0, 줄 높이 1.55)와 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';
// Mantine ff="monospace"(--mantine-font-family-monospace) 값.
const MONOSPACE =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace';

export function Row({
  label,
  value,
  bold,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-row flex-wrap items-start justify-between gap-2.5">
      <p
        className={TEXT}
        style={{
          flexShrink: 0,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-disabled)',
        }}
      >
        {label}
      </p>
      <p
        className={`${TEXT} text-right`}
        style={{
          fontFamily: mono ? MONOSPACE : undefined,
          wordBreak: 'break-all',
          fontSize: 'var(--font-size-sm)',
          fontWeight: bold ? 'var(--fw-bold)' : undefined,
          // ② 강조 값은 초록 대신 검정(초록은 행동에만, design-direction §2).
          color: bold || highlight ? 'var(--color-text)' : 'var(--color-text-secondary)',
        }}
      >
        {value}
      </p>
    </div>
  );
}

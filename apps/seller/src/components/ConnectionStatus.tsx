'use client';

interface ConnectionStatusProps {
  loading: boolean;
  error?: string | null;
  /** Firebase Auth 준비 여부 (미지정 시 준비 완료로 간주). */
  firebaseReady?: boolean;
  source?: 'api' | 'realtime';
}

/** API 또는 실시간 데이터 원본의 연결 상태를 표시한다. */
export function ConnectionStatus({
  loading,
  error,
  firebaseReady = true,
  source = 'realtime',
}: ConnectionStatusProps) {
  const connecting = loading || !firebaseReady;
  const color = connecting
    ? 'var(--color-caution-border)'
    : error
      ? 'var(--color-danger)'
      : 'var(--color-primary)';
  const label =
    connecting ? '연결 중' : error ? '연결 오류' : source === 'api' ? '서버 연결' : '실시간 연결';

  // ① 외형 유지(UI 교체 P4): Mantine Group(gap 6·가운데)·Text와 같은 값.
  return (
    <div className="flex flex-row flex-wrap items-center justify-start gap-1.5">
      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
      <p
        className="m-0 p-0 text-base font-normal"
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
      >
        {label}
      </p>
    </div>
  );
}

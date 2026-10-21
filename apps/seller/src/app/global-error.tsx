'use client';

// 루트 layout까지 실패했을 때 쓰는 최후의 오류 화면. root layout·Providers·전역 CSS가 없으므로
// html/body를 직접 그리고, 색은 @greenhub/ui 토큰 값을 그대로 옮겨 인라인으로 쓴다.
// 소비자 앱(#568)과 같은 모양이다. 오류 메시지·스택은 보여주지 않고 digest만 작게 보여준다.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          backgroundColor: '#FFFFFF',
          color: '#111111',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <title>잠시 문제가 생겼어요</title>
        <main
          style={{
            maxWidth: 430,
            margin: '0 auto',
            padding: '64px 16px',
            textAlign: 'center',
            wordBreak: 'keep-all',
          }}
        >
          <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>잠시 문제가 생겼어요</h1>
          <p style={{ fontSize: 15, color: '#6B716E', margin: '0 0 24px' }}>
            화면을 불러오는 중에 문제가 생겼어요.
            <br />
            잠시 뒤 다시 시도해 주세요.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              minHeight: 44,
              padding: '0 24px',
              border: 'none',
              borderRadius: 9999,
              backgroundColor: '#00A65A',
              color: '#FFFFFF',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            다시 시도
          </button>
          <p style={{ margin: '16px 0 0' }}>
            {/* 루트 layout이 깨진 상태라 클라이언트 이동 대신 전체 새로고침 링크를 쓴다 */}
            <a href="/" style={{ color: '#111111', fontSize: 15 }}>
              홈으로 가기
            </a>
          </p>
          <p style={{ fontSize: 15, color: '#6B716E', margin: '24px 0 0' }}>
            계속 같은 화면이 나오면 아래 오류 번호와 함께 운영팀에 알려 주세요.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 15, color: '#6B716E', margin: '12px 0 0' }}>
              오류 번호 {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}

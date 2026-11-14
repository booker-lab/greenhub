import { text } from '@/components/look';
import { ReopenButton } from './reopen-button';

/**
 * 서비스워커 오프라인 대체 문서(next.config.ts fallbacks.document, S-01).
 *
 * 신호가 없어 화면 문서를 받지 못했을 때(로그인 검사 화면은 NetworkOnly) 브라우저 오류 화면 대신 이 화면을
 * 보인다. 서비스워커 설치 때 미리 받아 두는 문서라 주문·손님 정보나 세션을 읽지 않는 고정 문구만 둔다
 * (로그인 검사 경로가 아니어서 proxy도 세션을 싣지 않는다). 사진 업로드 대기열은 앱을 다시 열면 이어서 올린다.
 */
export default function OfflinePage() {
  return (
    <main
      className="flex flex-col items-center justify-center gap-4 px-4 text-center"
      style={{ minHeight: '70dvh' }}
    >
      <h1
        className="m-0"
        style={{
          fontSize: 'var(--font-size-xl)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-text)',
          lineHeight: 1.4,
        }}
      >
        신호가 없어요.
      </h1>
      <p className={text} style={{ color: 'var(--color-text)', wordBreak: 'keep-all' }}>
        신호가 잡히면 앱을 다시 열어 주세요. 올리지 못한 사진은 휴대폰에 저장돼 있어요.
      </p>
      <ReopenButton />
    </main>
  );
}

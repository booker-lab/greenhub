import { AppButton } from '@/components/app-button';
import { text } from '@/components/look';

// 없는 경로는 Next 기본 영문 404 대신 기사 앱 화면(흰 바탕·검정 글자)으로 안내하고 배송 목록으로 돌려보낸다.
export default function NotFound() {
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
        찾는 화면이 없어요.
      </h1>
      <p
        className={text}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
      >
        주소가 바뀌었거나 없는 화면이에요.
      </p>
      <AppButton href="/board" size="xl">
        배송 목록으로
      </AppButton>
    </main>
  );
}

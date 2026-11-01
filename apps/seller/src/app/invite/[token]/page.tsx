import { Button, ButtonLink } from '@greenhub/ui/components/button';
import type { Metadata } from 'next';
import Image from 'next/image';
import { isInviteTokenFormat } from '@/lib/seller-invite';
import { startInviteSignup } from './actions';

export const dynamic = 'force-dynamic';

// 초대 링크는 받은 사람만 쓰는 1회용 주소다. 검색에 남기지 않고, 다른 사이트로 주소를 넘기지 않는다.
export const metadata: Metadata = {
  title: '판매자 초대',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const textSm = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' };

// ① 외형 유지(UI 교체 P4): Mantine Container size xs(최대 540px)·Paper(radius lg·p xl; 그림자는 ② D2로 걷음)·
// Stack(gap xs·md)·Title order 3(22px·줄 높이 1.4·800)·Text(m-0 p-0)·Button(md·outline, radius xl)과 같은 값.
const TEXT = 'm-0 p-0 text-base';
const STACK = 'flex flex-col items-stretch justify-start gap-4';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = isInviteTokenFormat(token);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--frame)',
        padding: '0 16px',
      }}
    >
      <div className="mx-auto w-full max-w-[540px] px-4">
        <div className="block rounded-[16px] bg-white p-8">
          <div className="mb-5 flex flex-col items-center justify-start gap-2.5">
            <Image
              src="/icons/icon-192x192.png"
              alt="그린러브 판매자 앱 아이콘"
              width={64}
              height={64}
              style={{ borderRadius: 16, display: 'block' }}
            />
            <h3 className="m-0 text-center text-[22px] leading-[1.4] font-extrabold">
              {valid ? '그린러브 판매자로 초대받았어요' : '초대 링크를 확인할 수 없어요'}
            </h3>
          </div>

          {valid ? (
            <div className={STACK}>
              <p className={TEXT} style={textSm}>
                아래 버튼을 눌러 카카오로 로그인하면 판매자 계정이 만들어지고, 이어서 사업자 정보를
                입력하게 돼요.
              </p>
              <p className={TEXT} style={textSm}>
                · 초대 링크는 한 번만 쓸 수 있고, 받은 뒤 72시간이 지나면 만료돼요.
                <br />· 초대받은 이메일을 쓰는 카카오 계정으로 로그인해 주세요.
                <br />· 이미 손님으로 쓰는 카카오 계정은 판매자로 바꿀 수 없어요. 다른 카카오
                계정으로 가입해 주세요.
              </p>
              <form action={startInviteSignup.bind(null, token)}>
                <Button
                  type="submit"
                  size="md"
                  className="w-full"
                  style={{ backgroundColor: '#FEE500', color: '#191919' }}
                >
                  카카오로 판매자 가입하기
                </Button>
              </form>
            </div>
          ) : (
            <div className={STACK}>
              <p className={TEXT} style={textSm}>
                링크 주소가 잘렸거나 잘못된 초대예요. 관리자에게 새 초대 링크를 요청해 주세요.
              </p>
              <ButtonLink href="/login" variant="outline" className="w-full">
                로그인 화면으로
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

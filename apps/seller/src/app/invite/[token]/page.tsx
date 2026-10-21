import { Box, Button, Container, Paper, Stack, Text, Title } from '@mantine/core';
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

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = isInviteTokenFormat(token);

  return (
    <Box
      component="main"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-bg)',
        padding: '0 16px',
      }}
    >
      <Container size="xs" w="100%">
        <Paper radius="lg" shadow="sm" p="xl">
          <Stack align="center" gap="xs" mb="lg">
            <Image
              src="/icons/icon-192x192.png"
              alt="그린러브 판매자 앱 아이콘"
              width={64}
              height={64}
              style={{ borderRadius: 16, display: 'block' }}
            />
            <Title order={3} ta="center">
              {valid ? '그린러브 판매자로 초대받았어요' : '초대 링크를 확인할 수 없어요'}
            </Title>
          </Stack>

          {valid ? (
            <Stack gap="md">
              <Text style={textSm}>
                아래 버튼을 눌러 카카오로 로그인하면 판매자 계정이 만들어지고, 이어서 사업자 정보를
                입력하게 돼요.
              </Text>
              <Text style={textSm}>
                · 초대 링크는 한 번만 쓸 수 있고, 받은 뒤 72시간이 지나면 만료돼요.
                <br />· 초대받은 이메일을 쓰는 카카오 계정으로 로그인해 주세요.
                <br />· 이미 손님으로 쓰는 카카오 계정은 판매자로 바꿀 수 없어요. 다른 카카오
                계정으로 가입해 주세요.
              </Text>
              <form action={startInviteSignup.bind(null, token)}>
                <Button
                  type="submit"
                  fullWidth
                  size="md"
                  radius="xl"
                  style={{ backgroundColor: '#FEE500', color: '#191919' }}
                >
                  카카오로 판매자 가입하기
                </Button>
              </form>
            </Stack>
          ) : (
            <Stack gap="md">
              <Text style={textSm}>
                링크 주소가 잘렸거나 잘못된 초대예요. 관리자에게 새 초대 링크를 요청해 주세요.
              </Text>
              <Button component="a" href="/login" variant="outline" fullWidth radius="xl">
                로그인 화면으로
              </Button>
            </Stack>
          )}
        </Paper>
      </Container>
    </Box>
  );
}

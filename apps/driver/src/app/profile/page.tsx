import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import { Box, Stack, Card, Group, Text, Title, Button, Divider } from '@mantine/core';
import { getApiBaseUrl } from '@/lib/api-base-url';

const LOGOUT_REVOKE_TIMEOUT_MS = 5_000;

/**
 * 로그아웃 전에 API의 refresh token을 폐기한다. auth()가 만료된 access token을 먼저 갱신하므로
 * 현재 access token으로 `POST /auth/logout`을 부른다. 실패해도 로그아웃은 계속한다.
 */
async function revokeApiSession(): Promise<void> {
  try {
    const current = await auth();
    const accessToken = current?.user?.accessToken;
    if (!accessToken) return;
    await fetch(`${getApiBaseUrl()}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(LOGOUT_REVOKE_TIMEOUT_MS),
    });
  } catch {
    // 응답이 없거나 늦어도 로그아웃은 계속한다. refresh token은 만료 시각에 끝난다.
  }
}

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect('/login');

  const { user } = session;

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <Box component="header" style={{ padding: '24px 16px 16px' }}>
        <Title order={4}>내 정보</Title>
      </Box>

      <Box component="main" style={{ flex: 1, padding: '0 16px' }}>
        <Stack gap="md">
          {/* 프로필 */}
          <Card radius="xl" withBorder p="lg">
            <Group gap="md" align="center">
              {user.image ? (
                <Image
                  src={user.image}
                  alt="프로필"
                  width={60}
                  height={60}
                  style={{ borderRadius: '50%' }}
                />
              ) : (
                <Box
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: '50%',
                    backgroundColor: 'var(--color-primary-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: 'var(--color-primary-dark)',
                      fontWeight: 'var(--fw-bold)',
                      fontSize: 'var(--font-size-xl)',
                    }}
                  >
                    {user.name?.[0] ?? '기'}
                  </Text>
                </Box>
              )}
              <Stack gap={2}>
                <Text style={{ fontWeight: 'var(--fw-bold)' }}>{user.name ?? '기사'}</Text>
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {user.email ?? ''}
                </Text>
              </Stack>
            </Group>
          </Card>

          {/* 계정 정보 */}
          <Card radius="xl" withBorder p={0}>
            <Group justify="space-between" align="center" px="md" py="md">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                연결된 계정
              </Text>
              <Group gap="xs">
                <Box
                  style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: '#FEE500' }}
                />
                <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
                  카카오
                </Text>
              </Group>
            </Group>
            <Divider />
            <Group justify="space-between" align="center" px="md" py="md">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                앱 버전
              </Text>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                1.0.0
              </Text>
            </Group>
          </Card>

          {/* 로그아웃 */}
          <form
            action={async () => {
              'use server';
              await revokeApiSession();
              await signOut({ redirectTo: '/login' });
            }}
          >
            <Button type="submit" fullWidth variant="default" radius="xl" size="md">
              로그아웃
            </Button>
          </form>
        </Stack>
      </Box>
    </Box>
  );
}

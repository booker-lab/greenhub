import { Box, Button, Card, Divider, Group, Stack, Text, Title } from '@mantine/core';
import Image from 'next/image';
import { signOut } from '@/auth';
import type { ProfileDisplay } from '../_lib';

function ProfileAvatar({ profile }: { profile: ProfileDisplay }) {
  if (profile.image) {
    return (
      <Image
        src={profile.image}
        alt="프로필"
        width={60}
        height={60}
        style={{ borderRadius: '50%' }}
      />
    );
  }

  return (
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
          color: 'var(--color-primary)',
          fontWeight: 'var(--fw-bold)',
          fontSize: 'var(--font-size-xl)',
        }}
      >
        {profile.initial}
      </Text>
    </Box>
  );
}

export function ProfileView({ profile }: { profile: ProfileDisplay }) {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <Box component="header" style={{ padding: '24px 16px 16px' }}>
        <Title order={4}>내 정보</Title>
      </Box>

      <Box component="main" style={{ flex: 1, padding: '0 16px' }}>
        <Stack gap="md">
          <Card radius="xl" withBorder p="lg">
            <Group gap="md" align="center">
              <ProfileAvatar profile={profile} />
              <Stack gap={2}>
                <Text style={{ fontWeight: 'var(--fw-bold)' }}>{profile.name}</Text>
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {profile.email}
                </Text>
              </Stack>
            </Group>
          </Card>

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

          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <Button type="submit" fullWidth variant="outline" color="red" radius="xl" size="md">
              로그아웃
            </Button>
          </form>
        </Stack>
      </Box>
    </Box>
  );
}

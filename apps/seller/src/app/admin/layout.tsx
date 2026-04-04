import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { Box, Badge, Container, Group, Text } from '@mantine/core'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user || session.user.role !== 'admin') {
    redirect('/orders')
  }

  return (
    <Box style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-gray-0)' }}>
      <Box
        component="header"
        style={{
          backgroundColor: 'var(--mantine-color-white)',
          borderBottom: '1px solid var(--mantine-color-gray-2)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Container size="lg" px="md" py="sm">
          <Group justify="space-between">
            <Text fw={700} fz="lg">관리자 콘솔</Text>
            <Badge color="red" variant="light" fw={600}>ADMIN</Badge>
          </Group>
        </Container>
        <Box style={{ overflowX: 'auto' }}>
          <Container size="lg" px="md" pb="xs">
            <Group gap={4} style={{ flexWrap: 'nowrap' }}>
              {[
                { href: '/admin/stores', label: '판매자' },
                { href: '/admin/users', label: '소비자' },
                { href: '/admin/drivers', label: '드라이버' },
                { href: '/admin/orders', label: '주문' },
                { href: '/admin/settlements', label: '정산' },
                { href: '/admin/invite', label: '초대' },
              ].map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  style={{
                    flexShrink: 0,
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 500,
                    color: 'var(--mantine-color-gray-6)',
                    textDecoration: 'none',
                  }}
                >
                  {item.label}
                </a>
              ))}
            </Group>
          </Container>
        </Box>
      </Box>
      <Container size="lg" px="md" py="lg">{children}</Container>
    </Box>
  )
}

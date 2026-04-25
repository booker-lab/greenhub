import { signIn } from "@/auth";
import { Box, Stack, Button, Text, Title, Alert, Paper } from "@mantine/core";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const { pending } = await searchParams;

  return (
    <Box
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: 'var(--color-bg)',
        padding: "0 16px",
      }}
    >
      <Box w="100%" style={{ maxWidth: 400 }}>
        <Paper radius="lg" p="xl" style={{ border: 'var(--border)' }}>
          {/* 로고 */}
          <Stack align="center" gap="xs" mb="xl">
            <Box
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                backgroundColor: 'var(--color-primary)',
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" rx="1" />
                <path d="M16 8h4l3 3v5h-7V8z" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </Box>
            <Title order={2} style={{ fontSize: 'var(--font-size-xl)' }}>Green Love 드라이버</Title>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>드라이버 계정으로 로그인하세요</Text>
          </Stack>

          {/* 승인 대기 안내 */}
          {pending === "true" && (
            <Alert color="yellow" radius="md" mb="md">
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }} mb={4}>승인 대기 중입니다</Text>
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                관리자 승인 후 이용할 수 있습니다.<br />
                승인이 완료되면 다시 로그인해 주세요.
              </Text>
            </Alert>
          )}

          {/* 카카오 로그인 */}
          <form
            action={async () => {
              "use server";
              await signIn("kakao", { redirectTo: "/board" });
            }}
          >
            <Button
              type="submit"
              fullWidth
              size="md"
              radius="xl"
              style={{ backgroundColor: "#FEE500", color: "#191919" }}
              leftSection={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#191919">
                  <path d="M12 3C6.477 3 2 6.477 2 10.9c0 2.776 1.548 5.217 3.906 6.72l-.994 3.71a.25.25 0 00.375.274L9.43 19.28A11.6 11.6 0 0012 19.8c5.523 0 10-3.477 10-7.9S17.523 3 12 3z" />
                </svg>
              }
            >
              카카오로 시작하기
            </Button>
          </form>
        </Paper>
      </Box>
    </Box>
  );
}

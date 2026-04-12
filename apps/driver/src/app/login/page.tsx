import { signIn } from "@/auth";
import { Box, Stack, Button, Text, Title, Alert } from "@mantine/core";

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
        backgroundColor: "var(--green-bg)",
        padding: "0 24px",
      }}
    >
      <Stack align="center" gap="xl" w="100%" maw={360}>
        {/* 로고 */}
        <Stack align="center" gap="xs">
          <Box
            style={{
              width: 80,
              height: 80,
              borderRadius: 16,
              backgroundColor: "var(--green-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text c="white" fw={700} fz={28}>G</Text>
          </Box>
          <Title order={2} c="brand.7">Green Love</Title>
          <Text size="sm" c="dimmed">드라이버</Text>
        </Stack>

        {/* 승인 대기 안내 */}
        {pending === "true" && (
          <Alert color="yellow" radius="md" w="100%">
            <Text size="sm" fw={600} mb={4}>승인 대기 중입니다</Text>
            <Text size="xs">
              관리자 승인 후 이용할 수 있습니다.<br />
              승인이 완료되면 다시 로그인해 주세요.
            </Text>
          </Alert>
        )}

        {/* 카카오 로그인 */}
        <form
          style={{ width: "100%" }}
          action={async () => {
            "use server";
            await signIn("kakao", { redirectTo: "/board" });
          }}
        >
          <Button
            type="submit"
            fullWidth
            size="lg"
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
      </Stack>
    </Box>
  );
}

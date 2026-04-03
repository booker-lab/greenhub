import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Image from "next/image";
import { Box, Stack, Card, Group, Text, Title, Button, Divider } from "@mantine/core";

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { user } = session;

  return (
    <Box style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <Box component="header" style={{ padding: "24px 16px 16px" }}>
        <Title order={4}>내 정보</Title>
      </Box>

      <Box component="main" style={{ flex: 1, padding: "0 16px" }}>
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
                  style={{ borderRadius: "50%" }}
                />
              ) : (
                <Box
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: "50%",
                    backgroundColor: "var(--green-pale)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text c="brand.6" fw={700} fz={20}>
                    {user.name?.[0] ?? "D"}
                  </Text>
                </Box>
              )}
              <Stack gap={2}>
                <Text fw={700}>{user.name ?? "드라이버"}</Text>
                <Text size="sm" c="dimmed">{user.email ?? ""}</Text>
              </Stack>
            </Group>
          </Card>

          {/* 계정 정보 */}
          <Card radius="xl" withBorder p={0}>
            <Group justify="space-between" align="center" px="md" py="md">
              <Text size="sm" c="dimmed">연결된 계정</Text>
              <Group gap="xs">
                <Box style={{ width: 16, height: 16, borderRadius: "50%", backgroundColor: "#FEE500" }} />
                <Text size="sm" fw={500}>카카오</Text>
              </Group>
            </Group>
            <Divider />
            <Group justify="space-between" align="center" px="md" py="md">
              <Text size="sm" c="dimmed">앱 버전</Text>
              <Text size="sm" c="dimmed">1.0.0</Text>
            </Group>
          </Card>

          {/* 로그아웃 */}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button
              type="submit"
              fullWidth
              variant="outline"
              color="red"
              radius="xl"
              size="md"
            >
              로그아웃
            </Button>
          </form>
        </Stack>
      </Box>
    </Box>
  );
}

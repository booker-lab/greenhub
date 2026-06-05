import { LoginView } from './_components/LoginView';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const { pending } = await searchParams;
  return <LoginView pending={pending === 'true'} />;
}

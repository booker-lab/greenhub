import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ProfileView } from './_components/ProfileView';
import { getProfileDisplay } from './_lib';

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect('/login');

  const { user } = session;
  return <ProfileView profile={getProfileDisplay(user)} />;
}

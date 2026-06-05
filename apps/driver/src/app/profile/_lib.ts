import type { Session } from 'next-auth';

type SessionUser = Session['user'];

export type ProfileDisplay = {
  email: string;
  image: string | null;
  initial: string;
  name: string;
};

export function getProfileDisplay(user: SessionUser): ProfileDisplay {
  const name = user.name?.trim() || '드라이버';
  return {
    email: user.email ?? '',
    image: user.image ?? null,
    initial: name[0] ?? 'D',
    name,
  };
}

import { auth } from '@/auth';
import { getApiBaseUrl } from '@/lib/api-base-url';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await auth();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };

  if (session?.user?.accessToken) {
    headers.Authorization = `Bearer ${session.user.accessToken}`;
  }

  return fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });
}

import { getApiBaseUrl } from '@/lib/api-base-url';

export async function apiFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const isFormData = options.body instanceof FormData;
  return fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

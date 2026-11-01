'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import type { AdminTodoCounts, AdminTodoKey } from './navItems';
import { ADMIN_TODO_PATHS, readAdminTodoCount } from './todoCounts';

const KEYS = Object.keys(ADMIN_TODO_PATHS) as AdminTodoKey[];

/**
 * 사이드바 할 일 수. 화면을 옮길 때마다(refreshKey) 다시 센다 — 처리한 뒤 다른 메뉴로 가면 숫자가 맞춰진다.
 * 각 조회는 따로 실패할 수 있고, 실패한 메뉴는 숫자를 쓰지 않는다. 늦게 온 옛 응답은 버린다.
 */
export function useAdminTodoCounts(refreshKey: string | null): AdminTodoCounts {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [counts, setCounts] = useState<AdminTodoCounts>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey는 다시 세는 시점(화면 이동)으로만 쓴다
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    for (const key of KEYS) {
      apiJson<unknown>(ADMIN_TODO_PATHS[key], token).then(
        (body) => {
          if (!cancelled) setCounts((prev) => ({ ...prev, [key]: readAdminTodoCount(key, body) }));
        },
        () => {
          if (!cancelled) setCounts((prev) => ({ ...prev, [key]: null }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  return counts;
}

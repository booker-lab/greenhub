'use client';

import { createContext, useContext } from 'react';
import type { AdminTodoCounts } from './navItems';

// 사이드바 할 일 수를 화면도 함께 쓰게 하는 통로 — 같은 조회를 화면에서 다시 하지 않는다.
// AdminShell이 useAdminTodoCounts 값을 넣고, 목록 화면의 "확인할 일 줄"이 읽는다(주문의 배송 보류 건수).
export const AdminTodoCountsContext = createContext<AdminTodoCounts>({});

export function useAdminTodoCountsValue(): AdminTodoCounts {
  return useContext(AdminTodoCountsContext);
}

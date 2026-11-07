'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { DashboardCard } from '@/components/DashboardCard';
import {
  START_CHECKLIST_STATUS_LABEL,
  type StartChecklist,
  type StartChecklistItemStatus,
} from './start-checklist';

// ① 외형 유지: TodayTasksCard 줄과 같은 Text·UnstyledButton 값을 쓴다.
const TEXT = 'm-0 p-0 text-base font-normal';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';

// 점 색은 오늘 할 일과 같다 — 할 일=검정, 확인하지 못함=빨강, 완료·확인 중=흐린 회색.
const DOT: Record<StartChecklistItemStatus, string> = {
  done: 'var(--color-text-disabled)',
  todo: 'var(--color-text)',
  checking: 'var(--color-text-disabled)',
  unknown: 'var(--color-danger)',
};

/**
 * 새 가게 시작 체크리스트(상품 등록·판매 회차·정산 계좌). 홈과 주문 관리 맨 위에 같은 카드를 둔다.
 * 판정은 start-checklist.ts가 하고, 셋 다 완료면(또는 아직 조회 중이기만 하면) 아무것도 그리지 않는다.
 */
export function StartChecklistCard({ checklist }: { checklist: StartChecklist }) {
  if (!checklist.visible) return null;

  return (
    <DashboardCard title="시작 체크리스트">
      <p
        className={TEXT}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
      >
        판매를 시작하려면 아래 준비를 마쳐 주세요. 모두 마치면 이 안내는 사라져요.
      </p>
      <ul className="m-0 mt-2 flex list-none flex-col items-stretch justify-start gap-0 p-0">
        {checklist.items.map((item, i) => {
          const statusLabel = START_CHECKLIST_STATUS_LABEL[item.status];
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className={UNSTYLED_BUTTON}
                aria-label={`${item.label} ${statusLabel}, 바로가기`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 0',
                  borderTop: i > 0 ? '1px solid var(--color-border)' : undefined,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: DOT[item.status],
                    flexShrink: 0,
                  }}
                />
                <p
                  className={TEXT}
                  style={{
                    flex: 1,
                    fontSize: 'var(--font-size-sm)',
                    color:
                      item.status === 'done' ? 'var(--color-text-secondary)' : 'var(--color-text)',
                    fontWeight: item.status === 'done' ? undefined : 'var(--fw-medium)',
                    textDecoration: item.status === 'done' ? 'line-through' : undefined,
                  }}
                >
                  {item.label}
                </p>
                <p
                  className={TEXT}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color:
                      item.status === 'unknown'
                        ? 'var(--color-danger)'
                        : 'var(--color-text-secondary)',
                    flexShrink: 0,
                  }}
                >
                  {statusLabel}
                </p>
                <ChevronRight size={16} color="var(--color-text-disabled)" />
              </Link>
            </li>
          );
        })}
      </ul>
    </DashboardCard>
  );
}

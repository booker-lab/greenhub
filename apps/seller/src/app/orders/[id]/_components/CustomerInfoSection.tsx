'use client';

import type { Order } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { displayBuyerName, displayBuyerPhone, displayRequestNote, toTelHref } from '../_lib';
import { Row } from './OrderRow';

// ① 외형 유지(UI 교체 P4): Mantine Paper(radius lg = 16px, shadow xs, p md)·Stack·Text(p, 여백 0, 줄 높이 1.55)와
// 같은 값. 전화 걸기는 Mantine Button light md(링크)이고, 마우스를 올리면 Mantine처럼 brand-2 면이 된다.
const TEXT = 'm-0 p-0 text-base font-normal';
const PAPER = 'block rounded-[16px] bg-white p-4 shadow-mantine-xs';

export function CustomerInfoSection({ order }: { order: Order }) {
  const phone = displayBuyerPhone(order);
  const telHref = phone ? toTelHref(phone) : null;
  const requestNote = displayRequestNote(order);

  return (
    <div className={PAPER}>
      <p
        className={`${TEXT} mb-2.5`}
        style={{
          fontWeight: 'var(--fw-medium)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
        }}
      >
        손님 정보
      </p>
      <div className="flex flex-col gap-1.5">
        <Row label="주문자" value={displayBuyerName(order)} />
        <Row label="연락처" value={phone ?? '연락처 없음'} />
        {requestNote && (
          <div className="mt-1 flex flex-col gap-0.5">
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              요청사항
            </p>
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {requestNote}
            </p>
          </div>
        )}
        {telHref && (
          <Button
            render={<a href={telHref} />}
            nativeButton={false}
            variant="light"
            size="md"
            className="mt-2.5 w-full hover:bg-[#a6e5c0]"
            style={{ fontWeight: 'var(--fw-medium)' }}
          >
            전화 걸기
          </Button>
        )}
      </div>
    </div>
  );
}

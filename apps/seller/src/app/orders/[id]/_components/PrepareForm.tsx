'use client';

import type { Order } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { isRoundOrder } from '@/lib/round-purchase-list';
import { makePreparedAtOptions } from '../_lib';

// ① 외형 유지(UI 교체 P4): Mantine Paper(radius lg = 16px, p md; 그림자는 ② D2로 걷음)·Group(gap xs = 10px)·
// Text(p, 여백 0, 줄 높이 1.55)와 같은 값. 안쪽 Text(span)는 바깥 크기를 물려받지 않고 16px로 돌아간다.
const TEXT = 'm-0 p-0 text-base font-normal';
const GROUP = 'flex flex-row flex-wrap items-center justify-start gap-2.5';

interface PrepareFormProps {
  order: Order;
  deliveryDate: string | null;
  preparedAt: string | null;
  setPreparedAt: (v: string | null) => void;
  actionLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PrepareForm({
  order,
  deliveryDate,
  preparedAt,
  setPreparedAt,
  actionLoading,
  onConfirm,
  onCancel,
}: PrepareFormProps) {
  // 회차 주문은 기사가 배송일 새벽에 한꺼번에 가져가므로 수거 예정 시각을 고르지 않는다
  // (서버도 preparedAt을 요구하지 않는다). 확인만 받고 같은 준비 시작 요청을 보낸다.
  const roundOrder = isRoundOrder(order);

  return (
    <div className="block rounded-[16px] bg-white p-4">
      <p
        className={`${TEXT} mb-3`}
        style={{
          fontWeight: 'var(--fw-medium)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
        }}
      >
        {roundOrder ? '회차 주문 준비 시작' : '드라이버 수거 예정 시각 설정'}
      </p>
      {deliveryDate && (
        <p
          className={`${TEXT} mb-2.5`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          {roundOrder
            ? '배송일'
            : order.saleType === 'normal'
              ? '소비자 희망 배송일'
              : '공동구매 배송 예정일'}
          :{' '}
          <span
            className={TEXT}
            style={{ fontWeight: 'var(--fw-medium)', color: 'var(--color-text-secondary)' }}
          >
            {new Date(deliveryDate).toLocaleDateString('ko-KR')}
          </span>
        </p>
      )}
      {roundOrder ? (
        <p
          className={`${TEXT} mb-3`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          준비를 시작하면 손님께 알림톡이 가고, 기사 화면에 이 주문이 보여요.
        </p>
      ) : (
        <>
          <div className={`${GROUP} mb-2.5`}>
            {makePreparedAtOptions().map((opt) => (
              <Button
                key={opt.iso}
                size="xs"
                variant={preparedAt === opt.iso ? 'default' : 'outline-gray'}
                onClick={() => setPreparedAt(preparedAt === opt.iso ? null : opt.iso)}
                style={{ flex: 1, fontWeight: 'var(--fw-medium)' }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <p
            className={`${TEXT} mb-3`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {preparedAt
              ? `선택됨: ${new Date(preparedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : '선택하지 않아도 준비 시작 처리는 가능합니다.'}
          </p>
        </>
      )}
      <div className={GROUP}>
        <Button
          onClick={onConfirm}
          disabled={actionLoading}
          size="md"
          className="flex-1"
          style={{
            backgroundColor: 'var(--color-primary)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          {actionLoading ? '처리 중...' : '준비 시작 확인'}
        </Button>
        <Button onClick={onCancel} size="md" variant="outline-gray" className="flex-1">
          취소
        </Button>
      </div>
    </div>
  );
}

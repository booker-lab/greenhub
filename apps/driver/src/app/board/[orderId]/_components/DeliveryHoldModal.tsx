'use client';

import {
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Radio,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';

export type HoldReason =
  | 'WEATHER'
  | 'ACCESS_UNAVAILABLE'
  | 'ADDRESS_ISSUE'
  | 'CUSTOMER_UNREACHABLE';

export type DeliveryHold = {
  reasonCode: HoldReason;
  reasonMessage: string;
  customerResponsible: boolean;
  redeliveryFee: number | null;
  nextContactAt: string | null;
  nextDeliveryAt: string | null;
};

export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  WEATHER: '기상 악화',
  ACCESS_UNAVAILABLE: '출입 불가',
  ADDRESS_ISSUE: '주소 오류',
  CUSTOMER_UNREACHABLE: '고객 연락 불가',
};

interface DeliveryHoldModalProps {
  opened: boolean;
  loading: boolean;
  orderId: string;
  storeId: string;
  onClose: () => void;
  onLoading: (loading: boolean) => void;
}

export function DeliveryHoldModal({
  opened,
  loading,
  orderId,
  storeId,
  onClose,
  onLoading,
}: DeliveryHoldModalProps) {
  const { data: session } = useSession();
  const [reasonCode, setReasonCode] = useState<HoldReason>('WEATHER');
  const [reasonMessage, setReasonMessage] = useState('');
  const [customerResponsible, setCustomerResponsible] = useState(false);
  const [redeliveryFee, setRedeliveryFee] = useState<string | number>('');
  const [nextContactAt, setNextContactAt] = useState('');
  const [nextDeliveryAt, setNextDeliveryAt] = useState('');
  const [error, setError] = useState('');
  const isWeather = reasonCode === 'WEATHER';

  function changeReason(value: string) {
    const next = value as HoldReason;
    setReasonCode(next);
    if (next === 'WEATHER') {
      setCustomerResponsible(false);
      setRedeliveryFee('');
    }
  }

  async function submit() {
    const message = reasonMessage.trim();
    const token = session?.user.accessToken;
    if (!message) {
      setError('보류 사유를 입력해주세요.');
      return;
    }
    if (isWeather && !nextDeliveryAt) {
      setError('기상 보류의 새 배송 예정 시각을 입력해주세요.');
      return;
    }
    if (!token) {
      setError('인증 정보를 확인할 수 없습니다.');
      return;
    }
    const fee = typeof redeliveryFee === 'number' ? redeliveryFee : Number(redeliveryFee);
    const deliveryHold = {
      reasonCode,
      reasonMessage: message,
      customerResponsible: isWeather ? false : customerResponsible,
      redeliveryFee: isWeather || !Number.isFinite(fee) || fee <= 0 ? null : fee,
      nextContactAt: nextContactAt ? new Date(nextContactAt).toISOString() : null,
      nextDeliveryAt: nextDeliveryAt ? new Date(nextDeliveryAt).toISOString() : null,
    };

    setError('');
    onLoading(true);
    try {
      const response = await apiFetch(`/stores/${storeId}/orders/${orderId}/delivery-hold`, token, {
        method: 'PATCH',
        body: JSON.stringify({ deliveryHold }),
      });
      if (!response.ok) throw new Error('배송 보류 저장 실패');
      const result = (await response.json()) as { orderId?: unknown; status?: unknown };
      if (result.orderId !== orderId || result.status !== 'DELIVERY_HELD') {
        throw new Error('배송 보류 응답 불일치');
      }
      onClose();
    } catch {
      setError('배송 보류를 저장하지 못했습니다. 주문 상태를 확인하고 다시 시도해주세요.');
    } finally {
      onLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="배송 보류 기록" centered>
      <Stack gap="md">
        <Radio.Group label="보류 유형" value={reasonCode} onChange={changeReason}>
          <Stack gap="xs" mt="xs">
            {Object.entries(HOLD_REASON_LABEL).map(([value, label]) => (
              <Radio key={value} value={value} label={label} />
            ))}
          </Stack>
        </Radio.Group>
        <Textarea
          label="보류 사유"
          value={reasonMessage}
          onChange={(event) => setReasonMessage(event.currentTarget.value)}
          required
          autosize
          minRows={2}
        />
        <Checkbox
          label="고객 책임"
          checked={customerResponsible}
          disabled={isWeather}
          onChange={(event) => setCustomerResponsible(event.currentTarget.checked)}
        />
        <NumberInput
          label="재배송비"
          value={redeliveryFee}
          disabled={isWeather}
          min={0}
          step={1000}
          suffix="원"
          onChange={setRedeliveryFee}
        />
        <TextInput
          label="다음 연락 예정"
          type="datetime-local"
          value={nextContactAt}
          onChange={(event) => setNextContactAt(event.currentTarget.value)}
        />
        <TextInput
          label="새 배송 예정"
          type="datetime-local"
          value={nextDeliveryAt}
          onChange={(event) => setNextDeliveryAt(event.currentTarget.value)}
        />
        {error && <Text c="red">{error}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            취소
          </Button>
          <Button color="red" onClick={submit} loading={loading}>
            배송 보류 저장
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

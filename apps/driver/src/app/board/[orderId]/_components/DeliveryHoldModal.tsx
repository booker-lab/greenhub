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
import { useEffect, useRef, useState } from 'react';
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
  // modal open 이후 authority 이동을 감지하기 위한 최소 prop. version이 아닌
  // 현재 order status만으로 hold command 허용 범위를 판정한다.
  orderStatus: string;
  onClose: () => void;
  onLoading: (loading: boolean) => void;
  onSaved?: () => void;
  // stale/403/409 수렴용 authoritative reread 트리거. 같은 hold command를
  // 자동 재전송하지 않고 parent의 fresh GET으로 수렴한다.
  onConvergence?: () => void;
}

// 배송 보류 command가 유효한 order authority 범위.
export const HOLD_COMMAND_ALLOWED_STATUSES = ['PREPARING', 'DELIVERING'] as const;

export function isHoldCommandAllowedStatus(status: string): boolean {
  return (HOLD_COMMAND_ALLOWED_STATUSES as readonly string[]).includes(status);
}

// 403 duplicate-sequential / 409 race-loser / stale-submit 공통 수렴 메시지.
// "실패했으니 다시 제출"이 아니라 상태 재확인을 안내한다.
export const HOLD_STALE_CONVERGENCE_MESSAGE =
  '이미 상태가 변경되었을 수 있습니다. 최신 상태를 다시 확인합니다.';

export function DeliveryHoldModal({
  opened,
  loading,
  orderId,
  storeId,
  orderStatus,
  onClose,
  onLoading,
  onSaved,
  onConvergence,
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
  // C3: 부모 loading state와 무관한 로컬 submitting guard. 동일 frame
  // double-submit에서도 두 번째 PATCH를 dispatch하지 않는다.
  const submittingRef = useRef(false);

  function resetHoldFormFields() {
    setReasonCode('WEATHER');
    setReasonMessage('');
    setCustomerResponsible(false);
    setRedeliveryFee('');
    setNextContactAt('');
    setNextDeliveryAt('');
  }

  // modal open 이후 order authority가 command 허용 범위를 벗어나면 stale form을
  // 남기지 않는다. parent가 이미 fresh authority를 들고 있으므로 별도 reread 없이
  // reset 후 닫는다. submit 경로의 stale 가드와 403/409 수렴이 실제 dispatch를 막는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: opened·orderStatus만의 의도적 stale 감시이며 onClose는 parent setter다
  useEffect(() => {
    if (opened && !isHoldCommandAllowedStatus(orderStatus)) {
      resetHoldFormFields();
      setError('');
      onClose();
    }
  }, [opened, orderStatus]);

  function changeReason(value: string) {
    const next = value as HoldReason;
    setReasonCode(next);
    if (next === 'WEATHER') {
      setCustomerResponsible(false);
      setRedeliveryFee('');
    }
  }

  async function submit() {
    // C3: 진행 중인 submit이 있으면 두 번째 PATCH를 dispatch하지 않는다.
    if (submittingRef.current) return;
    // modal open 이후 authority가 이동했다면 stale form을 그대로 submit하지 않는다.
    // dispatch 0회, form reset, convergence reread 유도 후 닫는다.
    if (!isHoldCommandAllowedStatus(orderStatus)) {
      resetHoldFormFields();
      setError(HOLD_STALE_CONVERGENCE_MESSAGE);
      onConvergence?.();
      onClose();
      return;
    }
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
    submittingRef.current = true;
    onLoading(true);
    try {
      const response = await apiFetch(`/stores/${storeId}/orders/${orderId}/delivery-hold`, token, {
        method: 'PATCH',
        body: JSON.stringify({ deliveryHold }),
      });
      if (!response.ok) {
        // 403 duplicate-sequential / 409 race-loser: 같은 hold command를 자동
        // 재전송하지 않고 convergence path로 보낸다. 일반적인 재제출 메시지를 쓰지 않는다.
        if (response.status === 403 || response.status === 409) {
          resetHoldFormFields();
          setError(HOLD_STALE_CONVERGENCE_MESSAGE);
          onConvergence?.();
          return;
        }
        throw new Error('배송 보류 저장 실패');
      }
      const result = (await response.json()) as { orderId?: unknown; status?: unknown };
      if (result.orderId !== orderId || result.status !== 'DELIVERY_HELD') {
        throw new Error('배송 보류 응답 불일치');
      }
      resetHoldFormFields();
      setError('');
      onClose();
      // Order 합성 없이 parent가 authoritative GET으로 수렴한다.
      onSaved?.();
    } catch {
      setError('배송 보류를 저장하지 못했습니다. 주문 상태를 확인하고 다시 시도해주세요.');
    } finally {
      submittingRef.current = false;
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
          <Button color="red" onClick={submit} loading={loading} disabled={loading}>
            배송 보류 저장
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

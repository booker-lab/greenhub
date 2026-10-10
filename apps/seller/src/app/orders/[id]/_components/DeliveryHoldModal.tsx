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
import { useEffect, useState } from 'react';
import {
  buildDeliveryHoldPayload,
  type DeliveryHoldPayload,
  deliveryHoldResponsibilityFeeHint,
  HOLD_REASON_LABEL,
  type HoldReason,
} from '../delivery-hold-form';

interface DeliveryHoldModalProps {
  opened: boolean;
  actionLoading: boolean;
  /** 서버가 거절한 이유(상태 변경·검증 실패) */
  actionError: string | null;
  onClose: () => void;
  /** 성공하면 true — 부모가 창을 닫고 주문을 다시 읽는다. */
  onSubmit: (deliveryHold: DeliveryHoldPayload) => Promise<boolean>;
}

// 판매자 보류: 기사가 가져가기 전 준비 중 주문을 한 건씩 멈춘다(일괄 보류 없음).
// 규칙은 기사 앱 보류 창과 같다 — 기상 보류는 고객 책임·재배송비 없이 새 배송 시각 필수,
// 그 밖에는 고객 책임 ⇔ 재배송비(0원 초과).
export function DeliveryHoldModal({
  opened,
  actionLoading,
  actionError,
  onClose,
  onSubmit,
}: DeliveryHoldModalProps) {
  const [reasonCode, setReasonCode] = useState<HoldReason>('WEATHER');
  const [reasonMessage, setReasonMessage] = useState('');
  const [customerResponsible, setCustomerResponsible] = useState(false);
  const [redeliveryFee, setRedeliveryFee] = useState<string | number>('');
  const [nextContactAt, setNextContactAt] = useState('');
  const [nextDeliveryAt, setNextDeliveryAt] = useState('');
  const [formError, setFormError] = useState('');
  const isWeather = reasonCode === 'WEATHER';
  const responsibilityFeeHint = deliveryHoldResponsibilityFeeHint({
    reasonCode,
    customerResponsible,
    redeliveryFee,
  });

  // 창을 새로 열 때마다 빈 입력에서 시작한다.
  useEffect(() => {
    if (!opened) return;
    setReasonCode('WEATHER');
    setReasonMessage('');
    setCustomerResponsible(false);
    setRedeliveryFee('');
    setNextContactAt('');
    setNextDeliveryAt('');
    setFormError('');
  }, [opened]);

  function changeReason(value: string) {
    const next = value as HoldReason;
    setReasonCode(next);
    if (next === 'WEATHER') {
      setCustomerResponsible(false);
      setRedeliveryFee('');
    }
  }

  async function submit() {
    if (actionLoading) return;
    const result = buildDeliveryHoldPayload({
      reasonCode,
      reasonMessage,
      customerResponsible,
      redeliveryFee,
      nextContactAt,
      nextDeliveryAt,
    });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setFormError('');
    await onSubmit(result.payload);
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text style={{ fontWeight: 'var(--fw-bold)' }}>배송 보류</Text>}
      radius="lg"
      centered
    >
      <Stack gap="md">
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          기사가 가져가기 전에 이 주문을 멈춰요. 고객에게 배송 보류 알림톡이 가요. 다시 보낼 때는
          주문 상세에서 &lsquo;재배송 준비로 돌리기&rsquo;를 눌러요.
        </Text>
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
          thousandSeparator=","
          suffix="원"
          onChange={setRedeliveryFee}
        />
        {responsibilityFeeHint && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
            {responsibilityFeeHint}
          </Text>
        )}
        <TextInput
          label="다음 연락 예정"
          type="datetime-local"
          value={nextContactAt}
          onChange={(event) => setNextContactAt(event.currentTarget.value)}
        />
        <TextInput
          label={isWeather ? '새 배송 예정 (필수)' : '새 배송 예정'}
          type="datetime-local"
          value={nextDeliveryAt}
          onChange={(event) => setNextDeliveryAt(event.currentTarget.value)}
        />
        {(formError || actionError) && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
            {formError || actionError}
          </Text>
        )}
        <Group gap="xs">
          <Button
            onClick={() => void submit()}
            disabled={actionLoading || responsibilityFeeHint !== null}
            flex={1}
            color="red"
            radius="xl"
            style={{ fontWeight: 'var(--fw-medium)' }}
          >
            {actionLoading ? '처리 중...' : '보류 저장'}
          </Button>
          <Button
            onClick={onClose}
            disabled={actionLoading}
            flex={1}
            radius="xl"
            variant="outline"
            color="gray"
          >
            닫기
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

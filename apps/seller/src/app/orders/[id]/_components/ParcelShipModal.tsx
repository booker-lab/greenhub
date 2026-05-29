'use client';

import { Button, Group, Modal, Select, Stack, TextInput } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { COURIER_OPTIONS } from '../../_constants';

interface ParcelShipModalProps {
  opened: boolean;
  actionLoading: boolean;
  onClose: () => void;
  onConfirm: (payload: { courierCompany: string; trackingNumber: string }) => Promise<void>;
}

export function ParcelShipModal({
  opened,
  actionLoading,
  onClose,
  onConfirm,
}: ParcelShipModalProps) {
  const [courier, setCourier] = useState<string | null>(COURIER_OPTIONS[0]);
  const [customCourier, setCustomCourier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  useEffect(() => {
    if (!opened) {
      setCourier(COURIER_OPTIONS[0]);
      setCustomCourier('');
      setTrackingNumber('');
    }
  }, [opened]);

  const courierCompany = useMemo(() => {
    if (courier === '기타') return customCourier.trim();
    return courier?.trim() ?? '';
  }, [courier, customCourier]);

  const normalizedTrackingNumber = trackingNumber.trim();
  const canSubmit = courierCompany.length > 0 && normalizedTrackingNumber.length >= 3;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="택배 발송 완료"
      centered
      radius="lg"
      closeOnClickOutside={!actionLoading}
      closeOnEscape={!actionLoading}
    >
      <Stack gap="md">
        <Select
          label="택배사"
          data={COURIER_OPTIONS}
          value={courier}
          onChange={setCourier}
          disabled={actionLoading}
          required
        />
        {courier === '기타' && (
          <TextInput
            label="택배사 직접 입력"
            value={customCourier}
            onChange={(event) => setCustomCourier(event.currentTarget.value)}
            disabled={actionLoading}
            required
          />
        )}
        <TextInput
          label="운송장번호"
          value={trackingNumber}
          onChange={(event) => setTrackingNumber(event.currentTarget.value)}
          disabled={actionLoading}
          required
          inputMode="text"
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={actionLoading}>
            취소
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                courierCompany,
                trackingNumber: normalizedTrackingNumber,
              })
            }
            disabled={!canSubmit || actionLoading}
            loading={actionLoading}
          >
            발송 완료
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

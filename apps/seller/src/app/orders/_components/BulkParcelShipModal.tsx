'use client';

import type { Order } from '@greenhub/shared';
import { Alert, Box, Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { COURIER_OPTIONS } from '../_constants';

export interface BulkParcelShipPayload {
  orderId: string;
  courierCompany: string;
  trackingNumber: string;
}

interface RowState {
  courier: string | null;
  customCourier: string;
  trackingNumber: string;
}

interface BulkParcelShipModalProps {
  opened: boolean;
  orders: Order[];
  loading: boolean;
  onClose: () => void;
  onConfirm: (payloads: BulkParcelShipPayload[]) => Promise<void>;
}

function orderLabel(order: Order): string {
  return order.orderNumber ?? `#${order.id.slice(-8).toUpperCase()}`;
}

function normalizeRow(row: RowState): { courierCompany: string; trackingNumber: string } {
  return {
    courierCompany: row.courier === '기타' ? row.customCourier.trim() : (row.courier ?? '').trim(),
    trackingNumber: row.trackingNumber.trim(),
  };
}

function createEmptyRow(): RowState {
  return { courier: COURIER_OPTIONS[0], customCourier: '', trackingNumber: '' };
}

export function BulkParcelShipModal({
  opened,
  orders,
  loading,
  onClose,
  onConfirm,
}: BulkParcelShipModalProps) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const orderKey = useMemo(() => orders.map((order) => order.id).join('|'), [orders]);

  useEffect(() => {
    if (!opened) {
      setRows({});
      return;
    }

    const orderIds = orderKey ? orderKey.split('|') : [];
    setRows(Object.fromEntries(orderIds.map((orderId) => [orderId, createEmptyRow()])));
  }, [opened, orderKey]);

  const payloads = useMemo(
    () =>
      orders.map((order) => ({
        orderId: order.id,
        ...normalizeRow(rows[order.id] ?? createEmptyRow()),
      })),
    [orders, rows],
  );

  const canSubmit =
    payloads.length > 0 &&
    payloads.every(
      (payload) => payload.courierCompany.length > 0 && payload.trackingNumber.length >= 3,
    );

  const updateRow = (orderId: string, patch: Partial<RowState>) => {
    setRows((current) => ({
      ...current,
      [orderId]: {
        ...createEmptyRow(),
        ...current[orderId],
        ...patch,
      },
    }));
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="택배 일괄 발송"
      centered
      radius="lg"
      size="lg"
      closeOnClickOutside={!loading}
      closeOnEscape={!loading}
    >
      <Stack gap="md">
        <Alert color="blue" variant="light" radius="md">
          <Text style={{ fontSize: 'var(--font-size-sm)' }}>
            선택한 주문마다 택배사와 운송장번호를 입력하면 배송 완료로 변경됩니다.
          </Text>
        </Alert>

        <Stack gap="sm" mah="60vh" style={{ overflowY: 'auto' }}>
          {orders.map((order) => {
            const row = rows[order.id] ?? createEmptyRow();
            const label = orderLabel(order);

            return (
              <Box
                key={order.id}
                p="sm"
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  background: 'var(--color-bg)',
                }}
              >
                <Stack gap="xs">
                  <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
                    주문 {label}
                  </Text>
                  {order.productName && (
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                      }}
                      lineClamp={1}
                    >
                      {order.productName}
                    </Text>
                  )}
                  <Select
                    label={`택배사 ${label}`}
                    data={COURIER_OPTIONS}
                    value={row.courier}
                    onChange={(value) => updateRow(order.id, { courier: value })}
                    disabled={loading}
                    required
                  />
                  {row.courier === '기타' && (
                    <TextInput
                      label={`택배사 직접 입력 ${label}`}
                      value={row.customCourier}
                      onChange={(event) =>
                        updateRow(order.id, { customCourier: event.currentTarget.value })
                      }
                      disabled={loading}
                      required
                    />
                  )}
                  <TextInput
                    label={`운송장번호 ${label}`}
                    value={row.trackingNumber}
                    onChange={(event) =>
                      updateRow(order.id, { trackingNumber: event.currentTarget.value })
                    }
                    disabled={loading}
                    required
                    inputMode="text"
                  />
                </Stack>
              </Box>
            );
          })}
        </Stack>

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={loading}>
            취소
          </Button>
          <Button
            onClick={() => onConfirm(payloads)}
            disabled={!canSubmit || loading}
            loading={loading}
          >
            {orders.length}건 발송 완료
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

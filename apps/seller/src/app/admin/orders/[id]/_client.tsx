'use client';

import {
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAdminOrderDetail } from '@/hooks/useAdminOrderDetail';
import { getStatusColor, STATUS_LABEL } from '../_lib';

function toKRW(value: number | null | undefined): string {
  return typeof value === 'number' ? `₩${value.toLocaleString('ko-KR')}` : '-';
}

function formatDate(value: unknown): string {
  if (!value) return '-';
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR', { hour12: false });
  }
  if (typeof value === 'object' && value !== null && '_seconds' in value) {
    const seconds = Number((value as { _seconds?: unknown })._seconds);
    if (Number.isFinite(seconds)) {
      return new Date(seconds * 1000).toLocaleString('ko-KR', { hour12: false });
    }
  }
  return '-';
}

function deliveryLabel(method?: string) {
  if (method === 'parcel') return '택배';
  if (method === 'direct') return '직접배송';
  if (method === 'hub') return '거점배송';
  return method ?? '-';
}

function saleTypeLabel(saleType?: string) {
  if (saleType === 'group') return '공동구매';
  if (saleType === 'normal') return '일반';
  return saleType ?? '-';
}

function addressText(order: { address?: string; deliveryAddress?: Record<string, string> | null }) {
  if (order.address?.trim()) return order.address;
  const address = order.deliveryAddress?.address?.trim();
  const detail = order.deliveryAddress?.addressDetail?.trim();
  const zipCode = order.deliveryAddress?.zipCode?.trim();
  const combined = [address, detail].filter(Boolean).join(' ');
  if (!combined && !zipCode) return '-';
  return zipCode ? `${combined} (${zipCode})` : combined;
}

function trackingText(order: { courierCompany?: string | null; trackingNumber?: string | null }) {
  if (!order.courierCompany?.trim() || !order.trackingNumber?.trim()) return '-';
  return `${order.courierCompany} / ${order.trackingNumber}`;
}

function canEditTracking(order: {
  deliveryMethod?: string;
  status?: string;
  courierCompany?: string | null;
  trackingNumber?: string | null;
}) {
  if (order.deliveryMethod !== 'parcel') return false;
  if (order.courierCompany?.trim() && order.trackingNumber?.trim()) return true;
  return ['DELIVERING', 'HUB_ARRIVED', 'PICKED_UP', 'DELIVERED', 'REVIEWED'].includes(
    order.status ?? '',
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
        {label}
      </Text>
      <Text ta="right" style={{ fontSize: 'var(--font-size-sm)', wordBreak: 'break-word' }}>
        {value || '-'}
      </Text>
    </Group>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper radius="md" p="md" shadow="xs" style={{ border: '1px solid var(--color-border)' }}>
      <Title order={5} mb="sm">
        {title}
      </Title>
      <Stack gap="xs">{children}</Stack>
    </Paper>
  );
}

export default function AdminOrderDetailClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const orderId = params.id;
  const backHref = searchParams.get('back') || '/admin/orders';
  const { detail, loading, error, reload, updateTracking } = useAdminOrderDetail(orderId);
  const order = detail?.order;
  const [trackingOpened, setTrackingOpened] = useState(false);
  const [courierCompany, setCourierCompany] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [savingTracking, setSavingTracking] = useState(false);
  const normalizedTracking = useMemo(
    () => ({
      courierCompany: courierCompany.trim(),
      trackingNumber: trackingNumber.trim(),
    }),
    [courierCompany, trackingNumber],
  );
  const canSubmitTracking =
    normalizedTracking.courierCompany.length > 0 && normalizedTracking.trackingNumber.length >= 3;

  useEffect(() => {
    if (!trackingOpened || !order) return;
    setCourierCompany(order.courierCompany ?? '');
    setTrackingNumber(order.trackingNumber ?? '');
  }, [order, trackingOpened]);

  async function handleUpdateTracking() {
    if (!canSubmitTracking) return;
    setSavingTracking(true);
    try {
      await updateTracking(normalizedTracking);
      notifications.show({ color: 'green', message: '송장 정보를 수정했습니다.' });
      setTrackingOpened(false);
    } catch (e) {
      notifications.show({
        color: 'red',
        message: e instanceof Error ? e.message : '송장 정보 수정 중 오류가 발생했습니다.',
      });
    } finally {
      setSavingTracking(false);
    }
  }

  return (
    <Box>
      <Group justify="space-between" align="flex-start" mb="md">
        <Box>
          <Button component={Link} href={backHref} size="xs" variant="subtle" color="gray" mb="xs">
            목록으로
          </Button>
          <Title order={4}>주문 정식 상세</Title>
        </Box>
        <Button size="xs" variant="light" color="gray" onClick={reload} disabled={loading}>
          새로고침
        </Button>
      </Group>

      {loading && (
        <Paper radius="md" p="xl" shadow="xs" style={{ border: '1px solid var(--color-border)' }}>
          <Text ta="center" style={{ color: 'var(--color-text-disabled)' }}>
            불러오는 중...
          </Text>
        </Paper>
      )}

      {!loading && error && (
        <Paper radius="md" p="xl" shadow="xs" style={{ border: '1px solid var(--color-border)' }}>
          <Text ta="center" style={{ color: 'var(--color-danger)' }}>
            {error}
          </Text>
        </Paper>
      )}

      {!loading && detail && order && (
        <Stack gap="md">
          <Paper radius="md" p="md" shadow="xs" style={{ border: '1px solid var(--color-border)' }}>
            <Group justify="space-between" align="flex-start">
              <Box>
                <Title order={5}>{order.orderNumber ?? order.id}</Title>
                <Text
                  mt={4}
                  ff="monospace"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {order.id}
                </Text>
              </Box>
              <Badge color={getStatusColor(order.status)} variant="light" radius="xl">
                {STATUS_LABEL[order.status] ?? order.status}
              </Badge>
            </Group>
          </Paper>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Section title="주문">
              <Field label="판매 방식" value={saleTypeLabel(order.saleType)} />
              <Field label="배송 방식" value={deliveryLabel(order.deliveryMethod)} />
              <Field label="총 결제금액" value={toKRW(order.totalAmount)} />
              <Field label="희망 배송일" value={formatDate(order.requestedDeliveryDate)} />
              <Field label="준비 예정" value={formatDate(order.preparedAt)} />
              <Group justify="space-between" align="flex-start" gap="md">
                <Box style={{ flex: 1 }}>
                  <Field label="송장" value={trackingText(order)} />
                </Box>
                {canEditTracking(order) && (
                  <Button
                    size="xs"
                    variant="light"
                    color="gray"
                    onClick={() => setTrackingOpened(true)}
                  >
                    송장 정정
                  </Button>
                )}
              </Group>
              {order.cancelReason && <Field label="취소 사유" value={order.cancelReason} />}
            </Section>

            <Section title="구매자·배송지">
              <Field label="구매자" value={detail.buyer?.name ?? order.buyerName ?? order.userId} />
              <Field label="연락처" value={detail.buyer?.phone ?? order.buyerPhone ?? '-'} />
              <Field label="이메일" value={detail.buyer?.email ?? '-'} />
              <Field label="배송지" value={addressText(order)} />
            </Section>

            <Section title="판매자">
              <Field label="상호" value={detail.store?.name ?? order.storeId} />
              <Field label="스토어 ID" value={detail.store?.id ?? order.storeId} />
              <Field label="상태" value={detail.store?.status ?? '-'} />
            </Section>

            <Section title="결제">
              <Field label="결제 상태" value={detail.payment?.status ?? '-'} />
              <Field label="결제 수단" value={detail.payment?.payMethod ?? '-'} />
              <Field label="결제 금액" value={toKRW(detail.payment?.amount ?? order.totalAmount)} />
              <Field label="거래 ID" value={detail.payment?.portoneTransactionId ?? '-'} />
            </Section>
          </SimpleGrid>

          <Section title="상품 라인">
            {detail.items.map((item) => (
              <Field
                key={`${item.productId ?? 'unknown'}-${item.productName ?? 'item'}`}
                label={item.productName ?? item.productId ?? '상품'}
                value={`${item.quantity ?? '-'}개 · ${toKRW(item.totalAmount)}`}
              />
            ))}
          </Section>

          <Section title="상태 타임라인">
            {detail.timeline.length === 0 ? (
              <Text style={{ color: 'var(--color-text-disabled)' }}>표시할 이력이 없습니다.</Text>
            ) : (
              detail.timeline.map((event) => (
                <Field
                  key={`${event.label}-${formatDate(event.at)}`}
                  label={event.label}
                  value={`${event.status} · ${formatDate(event.at)}`}
                />
              ))
            )}
          </Section>
        </Stack>
      )}
      <Modal
        opened={trackingOpened}
        onClose={() => setTrackingOpened(false)}
        title="송장 정정"
        centered
        radius="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            발송 이후 오타를 고치는 용도입니다. 새 발송 처리는 셀러 주문 화면에서 진행합니다.
          </Text>
          <TextInput
            label="택배사"
            value={courierCompany}
            onChange={(event) => setCourierCompany(event.currentTarget.value)}
          />
          <TextInput
            label="운송장번호"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setTrackingOpened(false)}>
              취소
            </Button>
            <Button
              onClick={handleUpdateTracking}
              loading={savingTracking}
              disabled={!canSubmitTracking}
            >
              저장
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
